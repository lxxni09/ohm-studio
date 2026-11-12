/**
 * Führt eine Projektvariante in einer eigenen Engine-Instanz aus und sammelt Messwerte:
 * mittlere/maximale Leistung je Bauteil, maximaler Pinstrom, Netzspannungen, LED-Helligkeit.
 */
import { Engine, computeConnectivity } from '../sim/engine';
import { getPart } from '../parts/registry';
import type { Project } from '../ohm/model';

export interface RunMetrics {
  /** mittlere Verlustleistung je Teil (W) */
  power: Record<string, number>;
  /** Spitzenleistung je Teil (W) */
  peakPower: Record<string, number>;
  /** größter Betrag eines Pinstroms je Teil (A) */
  current: Record<string, number>;
  /** mittlere Spannung je benanntem Netz (V) */
  nets: Record<string, number>;
  /** mittlere Helligkeit/Aktivität je Ausgabeteil (0…1) */
  active: Record<string, number>;
  errors: string[];
  ok: boolean;
}

const OUTPUT_KEYS = ['brightness', 'on', 'speed', 'active', 'playing'];

export function clone(p: Project): Project {
  return JSON.parse(JSON.stringify(p)) as Project;
}

export function runProject(project: Project, opts: { seconds?: number; dt?: number; codes?: Map<string, { code: string; lang: string }> } = {}): RunMetrics {
  const seconds = opts.seconds ?? 0.25;
  const dt = opts.dt ?? 0.001;
  const e = new Engine(project);
  for (const c of project.code) e.setCode(c.ziel, c.datei, c.sprache ?? 'arduino');
  if (opts.codes) for (const [id, c] of opts.codes) e.setCode(id, c.code, c.lang);
  e.start();
  const power: Record<string, number> = {};
  const peak: Record<string, number> = {};
  const current: Record<string, number> = {};
  const netSum: Record<string, number> = {};
  const active: Record<string, number> = {};
  const conn = computeConnectivity(project);
  const netRoots = project.nets.map((n) => ({ name: n.name, ref: n.pins[0] })).filter((n) => n.ref);
  const steps = Math.round(seconds / dt);
  const every = Math.max(1, Math.floor(steps / 40));
  let samples = 0;
  let ok = true;
  try {
    for (let s = 0; s < steps; s++) {
      e.step(dt);
      if (s % every !== every - 1) continue;
      samples++;
      const cur = e.pinCurrents();
      const byPart = new Map<string, number>();
      for (const [ref, i] of cur) {
        const id = ref.slice(0, ref.indexOf('.'));
        const v = e.pinVoltage(id, ref.slice(ref.indexOf('.') + 1)) ?? 0;
        byPart.set(id, (byPart.get(id) ?? 0) + v * i);
        current[id] = Math.max(current[id] ?? 0, Math.abs(i));
      }
      for (const [id, p] of byPart) {
        const def = getPart(project.parts.find((x) => x.id === id)?.type ?? '');
        // Quellen liefern Leistung (negativ) – nur Verbraucher zählen
        const pw = def?.category === 'Stromversorgung' || def?.board ? Math.abs(p) : Math.max(0, p);
        power[id] = (power[id] ?? 0) + pw;
        peak[id] = Math.max(peak[id] ?? 0, pw);
      }
      for (const n of netRoots) {
        const v = e.netVoltage(n.ref);
        if (v !== null) netSum[n.name] = (netSum[n.name] ?? 0) + v;
      }
      for (const [id, st] of e.states) {
        const k = OUTPUT_KEYS.find((key) => typeof st[key] === 'number' || typeof st[key] === 'boolean');
        if (k) active[id] = (active[id] ?? 0) + Number(st[k]);
      }
    }
  } catch {
    ok = false;
  }
  void conn;
  const avg = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v / Math.max(1, samples)]));
  return { power: avg(power), peakPower: peak, current, nets: avg(netSum), active: avg(active), errors: e.messages.filter((m) => m.level === 'error').map((m) => m.text), ok };
}
