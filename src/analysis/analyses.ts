/**
 * Analysen (Abschnitt 4.3): Wärme, Monte Carlo / Worst-Case, FMEA, Lebensdauer/MTBF,
 * Power Integrity (IR-Drop, Strombelastbarkeit), Signalintegrität, EMV-Prüfung.
 * Alle Rechnungen laufen lokal auf Basis des echten Simulators und des Platinenlayouts.
 */
import { getPart } from '../parts/registry';
import { parseValue, formatValue } from '../lib/units';
import { computePcb, segDist, type PcbLayout } from '../views/pcbLayout';
import { microstripZ0 } from '../eda/drc';
import type { Project } from '../ohm/model';
import { clone, runProject, type RunMetrics } from './runner';

/* ------------------------------ Bauteildaten ------------------------------ */

interface Thermal {
  /** Wärmewiderstand Sperrschicht/Körper → Umgebung (K/W) */
  rth: number;
  tmax: number;
  /** Nennleistung (W) oder null */
  pmax: number | null;
  pkg: string;
}

export function thermalOf(type: string, props: Record<string, unknown> = {}): Thermal | null {
  const def = getPart(type);
  if (!def) return null;
  if (type === 'widerstand' || type === 'potentiometer' || type === 'trimmer') {
    const p = parseValue(props.leistung ?? 0.25, 0.25) || 0.25;
    return { rth: p >= 1 ? 80 : p >= 0.5 ? 125 : 200, tmax: 155, pmax: p, pkg: `Axial ${p} W` };
  }
  if (type === 'led' || type === 'rgb-led') return { rth: 300, tmax: 100, pmax: 0.1, pkg: 'LED 5 mm' };
  if (/^(BC|2N|S80|S90|PN)/i.test(type)) return { rth: 200, tmax: 150, pmax: 0.625, pkg: 'TO-92' };
  if (/IRL|IRF|TIP|LM78|L78|7805/i.test(type)) return { rth: 62, tmax: 150, pmax: 2, pkg: 'TO-220 (ohne Kühlkörper)' };
  if (/AMS1117|AO3400/i.test(type)) return { rth: 160, tmax: 125, pmax: 0.8, pkg: 'SOT-223/23' };
  if (/^1n|diode/i.test(type)) return { rth: 250, tmax: 150, pmax: 0.5, pkg: 'DO-35/41' };
  if (['ne555', 'lm358', 'pc817'].includes(type)) return { rth: 100, tmax: 125, pmax: 0.6, pkg: 'DIP-8' };
  if (['74hc595', 'cd4017'].includes(type)) return { rth: 80, tmax: 125, pmax: 0.75, pkg: 'DIP-16' };
  if (['l298n'].includes(type)) return { rth: 13, tmax: 135, pmax: 25, pkg: 'Multiwatt + Kühlkörper' };
  if (['drv8833', 'a4988'].includes(type)) return { rth: 40, tmax: 150, pmax: 1.5, pkg: 'Modul' };
  if (type === 'summer') return { rth: 150, tmax: 85, pmax: 0.3, pkg: 'Summer' };
  if (type === 'relais') return { rth: 80, tmax: 85, pmax: 0.6, pkg: 'Relais' };
  if (def.board) return { rth: 40, tmax: 85, pmax: 2.5, pkg: 'Board' };
  return null;
}

/** Ausfallrate in FIT (Ausfälle pro 10⁹ h) bei 40 °C, Richtwerte nach SN 29500 / MIL-HDBK-217 */
export function fitOf(type: string): number {
  const def = getPart(type);
  if (!def) return 0;
  if (def.noBom || def.category === 'Aufbau' || def.category === 'Messgeräte') return 0;
  const t: Record<string, number> = { widerstand: 0.2, potentiometer: 5, trimmer: 5, kondensator: 0.5, folienkondensator: 1, elko: 5, spule: 1, led: 5, 'rgb-led': 8, taster: 5, schalter: 3, relais: 50, summer: 10, sicherung: 2, quarz: 4, motor: 100, schrittmotor: 60, ne555: 10, lm358: 8, '74hc595': 10, pc817: 15 };
  if (t[type] !== undefined) return t[type];
  if (def.board) return 200;
  if (def.category === 'Halbleiter') return 2;
  if (def.category === 'ICs') return 15;
  if (def.category === 'Sensoren' || def.category === 'Funk' || def.category === 'Displays') return 60;
  return 10;
}

/* ------------------------------ Wärme ------------------------------ */

export interface ThermalRow {
  id: string;
  type: string;
  pkg: string;
  p: number;
  pmax: number | null;
  t: number;
  tmax: number;
  level: 'ok' | 'warn' | 'error';
  hint?: string;
}

export function thermalAnalysis(project: Project, m: RunMetrics, ambient = 25): ThermalRow[] {
  const rows: ThermalRow[] = [];
  for (const inst of project.parts) {
    const th = thermalOf(inst.type, inst.props);
    if (!th) continue;
    const p = Math.max(m.power[inst.id] ?? 0, 0);
    const t = ambient + p * th.rth;
    const load = th.pmax ? p / th.pmax : 0;
    const level: ThermalRow['level'] = t > th.tmax || load > 1 ? 'error' : t > th.tmax - 25 || load > 0.6 ? 'warn' : 'ok';
    let hint: string | undefined;
    if (level !== 'ok') {
      if (inst.type === 'widerstand') hint = load > 1 ? `Überlast – Widerstand mit ≥ ${Math.ceil(p * 2 * 4) / 4} W einsetzen.` : 'Über 60 % Nennlast – für lange Lebensdauer größere Bauform wählen.';
      else if (/TO-220/.test(th.pkg)) hint = `Kühlkörper nötig (Rth ≤ ${Math.max(1, Math.floor((th.tmax - 25 - ambient) / Math.max(p, 1e-3) - 3))} K/W).`;
      else hint = 'Leistung reduzieren oder Bauteil mit größerem Gehäuse wählen.';
    }
    rows.push({ id: inst.id, type: inst.type, pkg: th.pkg, p, pmax: th.pmax, t, tmax: th.tmax, level, hint });
  }
  return rows.sort((a, b) => b.t - b.tmax - (a.t - a.tmax));
}

/* ------------------------------ Monte Carlo ------------------------------ */

export function toleranceOf(type: string, props: Record<string, unknown>): number {
  if (props.toleranz !== undefined) return parseFloat(String(props.toleranz).replace(',', '.')) / 100;
  if (type === 'widerstand') return 0.05;
  if (type === 'potentiometer' || type === 'trimmer') return 0.2;
  if (type === 'kondensator') return 0.1;
  if (type === 'elko') return 0.2;
  if (type === 'spule') return 0.1;
  if (type === 'folienkondensator') return 0.05;
  return 0;
}

export interface McResult {
  runs: number;
  metrics: { key: string; label: string; nominal: number; mean: number; sd: number; min: number; max: number; values: number[]; unit: string }[];
  worst: { key: string; label: string; low: number; high: number; unit: string }[];
}

function gauss(rnd: () => number) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** einfacher deterministischer Zufallsgenerator (Mulberry32), damit Ergebnisse reproduzierbar sind */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function vary(project: Project, f: (id: string, tol: number) => number): Project {
  const p = clone(project);
  for (const inst of p.parts) {
    const tol = toleranceOf(inst.type, inst.props);
    if (!tol || inst.props.wert === undefined) continue;
    const v = parseValue(inst.props.wert, NaN);
    if (!Number.isFinite(v)) continue;
    inst.props.wert = String(v * (1 + f(inst.id, tol)));
  }
  return p;
}

function metricKeys(project: Project, m: RunMetrics) {
  const keys: { key: string; label: string; get: (r: RunMetrics) => number; unit: string }[] = [];
  for (const [n, v] of Object.entries(m.nets)) if (Math.abs(v) > 0.01) keys.push({ key: `net:${n}`, label: `Spannung ${n}`, get: (r) => r.nets[n] ?? 0, unit: 'V' });
  for (const inst of project.parts) {
    if (['led', 'rgb-led', 'motor', 'summer', 'relais'].includes(inst.type) && (m.current[inst.id] ?? 0) > 1e-4) keys.push({ key: `i:${inst.id}`, label: `Strom ${inst.id}`, get: (r) => r.current[inst.id] ?? 0, unit: 'A' });
    if (inst.type === 'widerstand' && (m.power[inst.id] ?? 0) > 1e-4) keys.push({ key: `p:${inst.id}`, label: `Leistung ${inst.id}`, get: (r) => r.power[inst.id] ?? 0, unit: 'W' });
  }
  return keys;
}

export async function monteCarlo(project: Project, runs = 100, onProgress?: (k: number) => void, seed = 7): Promise<McResult> {
  const nominal = runProject(project);
  const keys = metricKeys(project, nominal);
  const values: number[][] = keys.map(() => []);
  const rnd = rng(seed);
  for (let k = 0; k < runs; k++) {
    const m = runProject(vary(project, (_id, tol) => Math.max(-tol, Math.min(tol, (gauss(rnd) * tol) / 3))));
    keys.forEach((key, i) => values[i].push(key.get(m)));
    if (k % 5 === 4) {
      onProgress?.(k + 1);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  // Worst-Case: alle Toleranzen an den Grenzen (beide Richtungen + gemischt nach Vorzeichen)
  const corners = [runProject(vary(project, (_i, t) => t)), runProject(vary(project, (_i, t) => -t)), runProject(vary(project, (id, t) => (id.charCodeAt(id.length - 1) % 2 ? t : -t))), runProject(vary(project, (id, t) => (id.charCodeAt(id.length - 1) % 2 ? -t : t)))];
  const stats = keys.map((key, i) => {
    const v = values[i];
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, v.length - 1));
    return { key: key.key, label: key.label, unit: key.unit, nominal: key.get(nominal), mean, sd, min: Math.min(...v), max: Math.max(...v), values: v };
  });
  const worst = keys.map((key) => {
    const vs = corners.map((c) => key.get(c)).concat(key.get(nominal));
    return { key: key.key, label: key.label, unit: key.unit, low: Math.min(...vs), high: Math.max(...vs) };
  });
  return { runs, metrics: stats, worst };
}

/* ------------------------------ FMEA ------------------------------ */

export interface FmeaRow {
  id: string;
  type: string;
  mode: string;
  effect: string;
  s: number;
  o: number;
  d: number;
  rpn: number;
  action: string;
}

function modesFor(type: string, pins: number): { mode: string; kind: 'open' | 'short' | 'drift'; share: number }[] {
  if (type === 'widerstand') return [{ mode: 'Unterbrechung', kind: 'open', share: 0.6 }, { mode: 'Wertdrift +50 %', kind: 'drift', share: 0.4 }];
  if (type === 'kondensator' || type === 'folienkondensator') return [{ mode: 'Kurzschluss (Riss im Keramik)', kind: 'short', share: 0.5 }, { mode: 'Unterbrechung', kind: 'open', share: 0.5 }];
  if (type === 'elko') return [{ mode: 'Austrocknung (Kapazitätsverlust)', kind: 'drift', share: 0.6 }, { mode: 'Kurzschluss', kind: 'short', share: 0.3 }, { mode: 'Unterbrechung', kind: 'open', share: 0.1 }];
  if (type === 'led' || type === 'rgb-led') return [{ mode: 'Unterbrechung', kind: 'open', share: 0.7 }, { mode: 'Kurzschluss', kind: 'short', share: 0.3 }];
  if (type === 'taster' || type === 'schalter') return [{ mode: 'Kontakt öffnet nicht mehr', kind: 'open', share: 0.6 }, { mode: 'Kontakt klebt', kind: 'short', share: 0.4 }];
  if (type === 'relais') return [{ mode: 'Spule offen', kind: 'open', share: 0.5 }, { mode: 'Kontakt verschweißt', kind: 'short', share: 0.5 }];
  if (pins === 2) return [{ mode: 'Unterbrechung', kind: 'open', share: 0.5 }, { mode: 'Kurzschluss', kind: 'short', share: 0.5 }];
  return [{ mode: 'Totalausfall', kind: 'open', share: 1 }];
}

function inject(project: Project, id: string, kind: 'open' | 'short' | 'drift'): Project {
  const p = clone(project);
  const inst = p.parts.find((x) => x.id === id)!;
  if (kind === 'open') {
    for (const n of p.nets) n.pins = n.pins.filter((r) => !r.startsWith(id + '.'));
    return p;
  }
  if (kind === 'drift') {
    if (inst.props.wert !== undefined) inst.props.wert = String(parseValue(inst.props.wert, 0) * (inst.type === 'elko' ? 0.2 : 1.5));
    return p;
  }
  const def = getPart(inst.type)!;
  const pins = def.pins(inst.props).filter((x) => x.x > -100);
  const [a, b] = pins.map((x) => `${id}.${x.id}`);
  const na = p.nets.find((n) => n.pins.includes(a));
  const nb = p.nets.find((n) => n.pins.includes(b));
  if (inst.type === 'taster' || inst.type === 'schalter') {
    inst.props.an = true;
    inst.props.pressed = true;
  }
  if (na && nb && na !== nb) {
    na.pins.push(...nb.pins);
    p.nets = p.nets.filter((n) => n !== nb);
  } else if (na && !nb) na.pins.push(b);
  return p;
}

/** Netze, die von einer Spannungsquelle gespeist werden */
export function supplyNets(project: Project): Set<string> {
  const out = new Set<string>();
  for (const n of project.nets)
    for (const r of n.pins) {
      const [id, pin] = [r.slice(0, r.indexOf('.')), r.slice(r.indexOf('.') + 1)];
      const inst = project.parts.find((p) => p.id === id);
      const def = inst && getPart(inst.type);
      if (!def) continue;
      const pd = def.pins(inst!.props).find((x) => x.id === pin);
      if ((def.board && pd?.power && pd.power !== 'gnd') || (def.category === 'Stromversorgung' && /^(\+|OUT\+|VOUT|OUT)$/.test(pin))) out.add(n.name);
    }
  return out;
}

const pct = (a: number, b: number) => (Math.abs(b) < 1e-9 ? (Math.abs(a) < 1e-9 ? 0 : Infinity) : (a - b) / Math.abs(b));

export async function fmea(project: Project, onProgress?: (k: number, n: number) => void): Promise<FmeaRow[]> {
  const nominal = runProject(project);
  const hasTests = project.tests.length > 0;
  const candidates = project.parts.filter((x) => {
    const d = getPart(x.type);
    return d && !d.board && !d.noBom && d.category !== 'Aufbau' && d.category !== 'Messgeräte' && d.category !== 'Stromversorgung';
  });
  const supplies = supplyNets(project);
  const rows: FmeaRow[] = [];
  let k = 0;
  for (const inst of candidates) {
    const def = getPart(inst.type)!;
    const pins = def.pins(inst.props).filter((x) => x.x > -100).length;
    for (const fm of modesFor(inst.type, pins)) {
      const m = runProject(inject(project, inst.id, fm.kind));
      const effects: string[] = [];
      let s = 2;
      // Versorgungsschienen und Signale
      for (const [n, v0] of Object.entries(nominal.nets)) {
        const v = m.nets[n] ?? 0;
        if (v0 > 2.5 && v < v0 * 0.7) {
          if (supplies.has(n)) {
            effects.push(`Versorgung ${n} bricht ein (${v0.toFixed(1)} → ${v.toFixed(1)} V)`);
            s = Math.max(s, 9);
          } else {
            effects.push(`Signal ${n} dauerhaft LOW`);
            s = Math.max(s, 5);
          }
        } else if (v0 < 0.5 && v > 2.5 && !supplies.has(n)) {
          effects.push(`Signal ${n} dauerhaft HIGH`);
          s = Math.max(s, 5);
        }
      }
      // Überlast anderer Teile
      for (const other of project.parts) {
        const th = thermalOf(other.type, other.props);
        if (!th?.pmax || other.id === inst.id) continue;
        const pw = m.power[other.id] ?? 0;
        if (pw > th.pmax && pw > (nominal.power[other.id] ?? 0) * 1.5) {
          effects.push(`${other.id} überlastet (${formatValue(pw, 'W')}) – Brandgefahr`);
          s = 10;
        }
      }
      // Ausgaben
      for (const [id, a0] of Object.entries(nominal.active)) {
        const a = m.active[id] ?? 0;
        if (a0 > 0.05 && a < a0 * 0.3) {
          effects.push(`${id} fällt aus`);
          s = Math.max(s, 7);
        } else if (a0 < 0.05 && a > 0.3) {
          effects.push(`${id} dauerhaft an`);
          s = Math.max(s, 6);
        } else if (Math.abs(pct(a, a0)) > 0.25) {
          effects.push(`${id} verändert (${Math.round(a0 * 100)} → ${Math.round(a * 100)} %)`);
          s = Math.max(s, 4);
        }
      }
      if (!m.ok || m.errors.length > nominal.errors.length) {
        effects.push(m.errors.slice(nominal.errors.length)[0] ?? 'Simulation instabil');
        s = Math.max(s, 8);
      }
      const fit = fitOf(inst.type) * fm.share;
      const o = Math.max(1, Math.min(10, Math.round(Math.log10(Math.max(fit, 0.01)) * 2.5 + 4)));
      const d = s >= 9 ? 3 : hasTests ? 4 : 6;
      const action =
        s >= 9
          ? inst.type === 'kondensator' || inst.type === 'elko'
            ? 'Sicherung/PTC in die Versorgung, Kondensator mit höherer Spannungsfestigkeit'
            : 'Sicherung oder Strombegrenzung vorsehen'
          : s >= 7
            ? hasTests
              ? 'Funktionstest im Prüfplan behalten'
              : 'Funktionstest ergänzen (test: im .ohm)'
            : 'keine';
      rows.push({ id: inst.id, type: inst.type, mode: fm.mode, effect: effects.join('; ') || 'keine erkennbare Auswirkung', s, o, d, rpn: s * o * d, action });
    }
    onProgress?.(++k, candidates.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return rows.sort((a, b) => b.rpn - a.rpn);
}

/* ------------------------------ Lebensdauer ------------------------------ */

export interface LifeRow {
  id: string;
  what: string;
  hours: number;
  note: string;
}

export function lifetime(project: Project, m: RunMetrics, ambient = 25, dutyHoursPerDay = 24): { rows: LifeRow[]; fit: number; mtbf: number; years: number } {
  const rows: LifeRow[] = [];
  let fit = 0;
  for (const inst of project.parts) {
    const f = fitOf(inst.type);
    // Temperaturfaktor (Arrhenius, Ea ≈ 0,4 eV ≈ ×2 je 15 K über 40 °C)
    const th = thermalOf(inst.type, inst.props);
    const t = ambient + (th ? (m.power[inst.id] ?? 0) * th.rth : 0);
    fit += f * Math.pow(2, Math.max(0, t - 40) / 15);
    if (inst.type === 'elko') {
      const L0 = Number(inst.props.lebensdauer ?? 2000);
      const Tr = Number(inst.props.temperatur ?? 105);
      const h = L0 * Math.pow(2, (Tr - t) / 10);
      rows.push({ id: inst.id, what: 'Elko (Arrhenius-10-K-Regel)', hours: h, note: `${L0} h @ ${Tr} °C, Betrieb bei ${t.toFixed(0)} °C` });
    }
    if (inst.type === 'led' || inst.type === 'rgb-led') {
      const i = (m.current[inst.id] ?? 0) * 1000;
      if (i > 0.5) {
        const h = 50000 * Math.pow(20 / Math.max(i, 1), 1.5) * Math.pow(2, (25 - Math.max(t, 25)) / 20);
        rows.push({ id: inst.id, what: 'LED (L70: 70 % Helligkeit)', hours: Math.min(h, 200000), note: `${i.toFixed(1)} mA` });
      }
    }
    if (inst.type === 'relais') rows.push({ id: inst.id, what: 'Relais (mechanisch)', hours: 100000 / Math.max(1, 3600 / 60), note: '≈ 10⁵ Schaltspiele bei Last, Annahme 1 Schaltung/Minute' });
    if (inst.type === 'taster' || inst.type === 'schalter') rows.push({ id: inst.id, what: 'Taster (mechanisch)', hours: 100000 / (10 / 24), note: '≈ 10⁵ Betätigungen, Annahme 10/Tag' });
  }
  const mtbf = fit > 0 ? 1e9 / fit : Infinity;
  return { rows: rows.sort((a, b) => a.hours - b.hours), fit, mtbf, years: mtbf / (dutyHoursPerDay * 365) };
}

/* ------------------------------ Power Integrity ------------------------------ */

const RHO_CU = 1.72e-8;
const U_MM = 0.254;

export interface PiRow {
  net: string;
  current: number;
  lengthMm: number;
  widthMm: number;
  r: number;
  drop: number;
  dropPct: number;
  capacity: number;
  level: 'ok' | 'warn' | 'error';
}

/** IPC-2221: zulässiger Strom einer Außenlage-Bahn bei ΔT (K) */
export function ipc2221Current(widthMm: number, copperUm = 35, dT = 10, outer = true): number {
  const areaMil2 = (widthMm / 0.0254) * (copperUm / 25.4);
  return (outer ? 0.048 : 0.024) * Math.pow(dT, 0.44) * Math.pow(areaMil2, 0.725);
}

export function powerIntegrity(project: Project, m: RunMetrics, L: PcbLayout = computePcb(project)): PiRow[] {
  const rows: PiRow[] = [];
  const t = 35e-6;
  for (const n of project.nets) {
    const traces = L.traces.filter((x) => x.net === n.name);
    if (!traces.length) continue;
    const v = Math.abs(m.nets[n.name] ?? 0);
    const isPower = /^(gnd|vcc|vdd|vin|\d+v\d*|\+?\d+v|3v3|5v|12v|v\+)$/i.test(n.name) || n.pins.some((r) => /\.(GND|VCC|5V|3V3|VIN|\+|-)$/.test(r));
    // Netzstrom: Summe der eingespeisten Ströme (Hälfte der Summe der Beträge)
    let cur = 0;
    for (const ref of n.pins) {
      const id = ref.split('.')[0];
      cur += (m.current[id] ?? 0) / 2;
    }
    cur = Math.min(cur, 10);
    if (!isPower && cur < 0.05) continue;
    let len = 0;
    let rTot = 0;
    let wMin = Infinity;
    for (const tr of traces) {
      for (let i = 1; i < tr.pts.length; i++) {
        const l = Math.hypot(tr.pts[i].x - tr.pts[i - 1].x, tr.pts[i].y - tr.pts[i - 1].y) * U_MM;
        len += l;
        rTot += (RHO_CU * (l / 1000)) / ((tr.width * U_MM) / 1000) / t;
      }
      wMin = Math.min(wMin, tr.width * U_MM);
    }
    // Pfad ≈ halbe Gesamtlänge (Stern/Kette), Via-Widerstand ~1 mΩ
    const r = rTot / 2 + L.vias.filter((vi) => vi.net === n.name).length * 0.001;
    const drop = cur * r;
    const cap = ipc2221Current(wMin);
    const dropPct = v > 0.1 ? drop / v : 0;
    rows.push({ net: n.name, current: cur, lengthMm: len, widthMm: wMin, r, drop, dropPct, capacity: cap, level: cur > cap || dropPct > 0.05 ? 'error' : cur > cap * 0.6 || dropPct > 0.02 ? 'warn' : 'ok' });
  }
  return rows.sort((a, b) => b.current - a.current);
}

/* ------------------------------ Signalintegrität ------------------------------ */

export interface SiRow {
  net: string;
  lengthMm: number;
  z0: number;
  delayNs: number;
  riseNs: number;
  critMm: number;
  kind: string;
  note: string;
  level: 'ok' | 'warn' | 'error';
}

function boardOn(project: Project, net: { pins: string[] }) {
  for (const r of net.pins) {
    const inst = project.parts.find((p) => p.id === r.split('.')[0]);
    const def = inst && getPart(inst.type);
    if (def?.board) return def.board;
  }
  return null;
}

export function signalIntegrity(project: Project, L: PcbLayout = computePcb(project)): SiRow[] {
  const er = project.views.platine?.material === 'rogers' ? 3.66 : 4.4;
  const h = (project.views.platine?.dicke ?? 1.6) / Math.max(1, (project.views.platine?.lagen ?? 2) - 1);
  const rows: SiRow[] = [];
  for (const n of project.nets) {
    const traces = L.traces.filter((x) => x.net === n.name);
    if (!traces.length) continue;
    const b = boardOn(project, n);
    if (!b) continue;
    if (/^(gnd|vcc|5v|3v3|vin)$/i.test(n.name)) continue;
    let len = 0;
    for (const tr of traces) for (let i = 1; i < tr.pts.length; i++) len += Math.hypot(tr.pts[i].x - tr.pts[i - 1].x, tr.pts[i].y - tr.pts[i - 1].y) * U_MM;
    const w = traces[0].width * U_MM;
    const z0 = microstripZ0(w, h, er);
    const erEff = (er + 1) / 2 + ((er - 1) / 2) * Math.pow(1 + (12 * h) / w, -0.5);
    const psPerMm = (Math.sqrt(erEff) / 299.792458) * 1000; // ps/mm
    const delay = (len * psPerMm) / 1000;
    const rise = b.family === 'avr' ? 10 : b.family === 'rp2040' ? 3 : 2.5;
    const crit = (rise * 1000) / psPerMm / 6;
    const isI2c = n.pins.some((r) => /\.(SDA|SCL|A4|A5|GP4|GP5|D21|D22)$/.test(r)) && n.pins.some((r) => /\.(SDA|SCL)$/.test(r));
    let note = len > crit ? `Leitung länger als kritische Länge – Serienwiderstand (22–33 Ω) am Treiber einplanen` : 'unkritisch';
    let level: SiRow['level'] = len > crit ? 'warn' : 'ok';
    let kind = 'GPIO';
    if (isI2c) {
      kind = 'I²C';
      const cPerMm = 1e12 / (z0 * 299792458 / Math.sqrt(erEff)) / 1000; // pF/mm
      const c = len * cPerMm + n.pins.length * 10;
      // Pull-up suchen
      const pull = project.parts.find((p) => p.type === 'widerstand' && n.pins.some((r) => r.startsWith(p.id + '.')));
      const R = pull ? parseValue(pull.props.wert, 4700) : 30000;
      const tr = 0.8473 * R * c * 1e-12 * 1e9;
      note = `Buskapazität ≈ ${c.toFixed(0)} pF, Anstiegszeit ≈ ${tr.toFixed(0)} ns mit ${pull ? `Pull-up ${formatValue(R, 'Ω')}` : 'internem Pull-up (~30 kΩ)'} → ${tr < 300 ? '400 kHz ok' : tr < 1000 ? 'nur 100 kHz' : 'zu langsam – externe 4,7-kΩ-Pull-ups einsetzen'}`;
      level = tr < 300 ? 'ok' : tr < 1000 ? 'warn' : 'error';
    }
    rows.push({ net: n.name, lengthMm: len, z0, delayNs: delay, riseNs: rise, critMm: crit, kind, note, level });
  }
  return rows.sort((a, b) => b.lengthMm - a.lengthMm);
}

/* ------------------------------ EMV ------------------------------ */

export interface EmcIssue {
  level: 'ok' | 'warn' | 'error';
  rule: string;
  text: string;
  part?: string;
}

export function emcCheck(project: Project, L: PcbLayout = computePcb(project)): EmcIssue[] {
  const out: EmcIssue[] = [];
  const pads = L.footprints.flatMap((f) => f.pads.map((p) => ({ ...p, part: f.id })));
  // 1. Abblockkondensatoren an ICs
  for (const inst of project.parts) {
    const def = getPart(inst.type);
    if (!def || def.category !== 'ICs') continue;
    const vcc = pads.find((p) => p.part === inst.id && /\.(VCC|VDD|V\+|16|8)$/.test(p.ref));
    if (!vcc) continue;
    const caps = project.parts.filter((p) => p.type === 'kondensator' && parseValue(p.props.wert, 0) <= 1e-6 && parseValue(p.props.wert, 0) >= 1e-8);
    const near = caps.map((c) => pads.filter((p) => p.part === c.id)).flat().some((p) => Math.hypot(p.x - vcc.x, p.y - vcc.y) * U_MM < 15 && p.net === vcc.net);
    if (!near) out.push({ level: 'warn', rule: 'Abblockung', text: `${inst.id} (${def.name}) hat keinen 100-nF-Kondensator nahe am Versorgungspin. Ohne Abblockung entstehen Spannungseinbrüche und Störaussendung.`, part: inst.id });
    else out.push({ level: 'ok', rule: 'Abblockung', text: `${inst.id} ist abgeblockt.`, part: inst.id });
  }
  // 2. Induktive Lasten ohne Freilaufdiode
  for (const inst of project.parts) {
    if (!['relais', 'motor', 'schrittmotor', 'magnet', 'vibrationsmotor', 'spule'].includes(inst.type)) continue;
    if (getPart(inst.type)?.category === 'Ein-/Ausgabe' && inst.type === 'relais' && project.parts.some((p) => p.id === inst.id && p.props.modul)) continue;
    const myNets = new Set(project.nets.filter((n) => n.pins.some((r) => r.startsWith(inst.id + '.'))).map((n) => n.name));
    const diode = project.parts.some((p) => /^1n|diode/i.test(p.type) && project.nets.filter((n) => myNets.has(n.name) && n.pins.some((r) => r.startsWith(p.id + '.'))).length >= 2);
    if (!diode) out.push({ level: 'error', rule: 'Freilaufdiode', text: `${inst.id}: induktive Last ohne Freilaufdiode – beim Abschalten entstehen Spannungsspitzen von über 100 V, die Transistoren zerstören und stark stören. 1N4007 antiparallel einsetzen.`, part: inst.id });
  }
  // 3. Massefläche
  if (L.layers >= 2) out.push(project.views.platine?.masseflaeche === false ? { level: 'warn', rule: 'Massefläche', text: 'Keine Massefläche: Rückströme laufen über lange Wege, große Schleifenflächen strahlen ab. Massefläche auf der Unterseite aktivieren.' } : { level: 'ok', rule: 'Massefläche', text: 'Massefläche vorhanden – kurze Rückstrompfade.' });
  // 4. Lange Leitungen als Antenne (Kniefrequenz 0,35/tr; λ/20)
  const er = 4.4;
  for (const tr of L.traces) {
    let len = 0;
    for (let i = 1; i < tr.pts.length; i++) len += Math.hypot(tr.pts[i].x - tr.pts[i - 1].x, tr.pts[i].y - tr.pts[i - 1].y) * U_MM;
    const fKnee = 0.35 / 5e-9;
    const lambda20 = (299792458 / fKnee / Math.sqrt((er + 1) / 2) / 20) * 1000;
    if (len > lambda20 && !/^gnd$/i.test(tr.net)) {
      out.push({ level: 'warn', rule: 'Antenne', text: `Leiterbahn im Netz ${tr.net} ist ${len.toFixed(0)} mm lang (> λ/20 ≈ ${lambda20.toFixed(0)} mm bei ${(fKnee / 1e6).toFixed(0)} MHz Kniefrequenz) – kürzer führen oder Flanken entschärfen.` });
      break;
    }
  }
  // 5. Bahnen, die die Massefläche zerschneiden (lange Bahnen auf der Unterseite)
  const bottomLong = L.traces.filter((t) => t.layer === 'bottom' && t.net !== L.pour?.net && t.pts.length > 1 && Math.hypot(t.pts[t.pts.length - 1].x - t.pts[0].x, t.pts[t.pts.length - 1].y - t.pts[0].y) * U_MM > 30);
  if (bottomLong.length && L.pour) out.push({ level: 'warn', rule: 'Schlitze', text: `${bottomLong.length} lange Bahn(en) auf der Unterseite schlitzen die Massefläche (z. B. Netz ${bottomLong[0].net}) – Rückstrom muss außen herum.` });
  // 6. Quarz nahe am Mikrocontroller
  for (const q of project.parts.filter((p) => p.type === 'quarz')) {
    const qp = pads.find((p) => p.part === q.id);
    const mcu = pads.filter((p) => getPart(project.parts.find((x) => x.id === p.part)?.type ?? '')?.board);
    if (qp && mcu.length && Math.min(...mcu.map((p) => Math.hypot(p.x - qp.x, p.y - qp.y))) * U_MM > 20) out.push({ level: 'warn', rule: 'Quarz', text: `${q.id} liegt weit vom Mikrocontroller entfernt – Quarzleitungen < 10 mm halten.`, part: q.id });
  }
  void segDist;
  return out;
}
