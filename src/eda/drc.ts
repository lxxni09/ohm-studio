/**
 * DRC – Design Rule Check gegen Herstellerprofile.
 */
import { computePcb, mountHoles, MOUNT_HOLE_MM, segDist, type PcbLayout } from '../views/pcbLayout';
import type { Project } from '../ohm/model';

const U = 0.254;

export interface DrcProfile {
  id: string;
  name: string;
  /** Mindestwerte in mm */
  track: number;
  clearance: number;
  drill: number;
  annular: number;
  edge: number;
  maxLayers: number;
  url: string;
}

export const DRC_PROFILES: DrcProfile[] = [
  { id: 'jlcpcb', name: 'JLCPCB (Standard)', track: 0.127, clearance: 0.127, drill: 0.3, annular: 0.13, edge: 0.3, maxLayers: 32, url: 'https://jlcpcb.com/capabilities/pcb-capabilities' },
  { id: 'pcbway', name: 'PCBWay (Standard)', track: 0.1, clearance: 0.1, drill: 0.2, annular: 0.15, edge: 0.25, maxLayers: 32, url: 'https://www.pcbway.com/capabilities.html' },
  { id: 'aisler', name: 'Aisler (Beautiful Boards)', track: 0.15, clearance: 0.15, drill: 0.3, annular: 0.15, edge: 0.3, maxLayers: 4, url: 'https://aisler.net/help/design-rules' },
  { id: 'eurocircuits', name: 'Eurocircuits (Klasse 6C)', track: 0.15, clearance: 0.15, drill: 0.35, annular: 0.15, edge: 0.3, maxLayers: 16, url: 'https://www.eurocircuits.com/pcb-design-guidelines/' },
  { id: 'wuerth', name: 'Würth Elektronik (WEdirekt)', track: 0.15, clearance: 0.15, drill: 0.3, annular: 0.15, edge: 0.3, maxLayers: 16, url: 'https://www.wedirekt.de/de/pcb-designregeln' },
];

export interface DrcViolation {
  rule: string;
  text: string;
  x: number;
  y: number;
  level: 'error' | 'warn';
}

export function drc(project: Project, profileId = 'jlcpcb', L: PcbLayout = computePcb(project)): DrcViolation[] {
  const P = DRC_PROFILES.find((p) => p.id === profileId) ?? DRC_PROFILES[0];
  const out: DrcViolation[] = [];
  const mm = (u: number) => u * U;
  if (L.layers > P.maxLayers) out.push({ rule: 'Lagen', text: `${P.name} fertigt höchstens ${P.maxLayers} Lagen (Projekt: ${L.layers}).`, x: 10, y: 10, level: 'error' });
  for (const t of L.traces) {
    if (mm(t.width) + 1e-6 < P.track) out.push({ rule: 'Leiterbahnbreite', text: `Bahn im Netz ${t.net} ist ${mm(t.width).toFixed(3)} mm breit (min. ${P.track} mm).`, x: t.pts[0].x, y: t.pts[0].y, level: 'error' });
    for (const p of t.pts) {
      const e = Math.min(p.x, p.y, L.w - p.x, L.h - p.y) * U - mm(t.width) / 2;
      if (e < P.edge) {
        out.push({ rule: 'Randabstand', text: `Bahn im Netz ${t.net} liegt ${Math.max(0, e).toFixed(2)} mm vom Rand (min. ${P.edge} mm).`, x: p.x, y: p.y, level: 'error' });
        break;
      }
    }
  }
  const pads = L.footprints.flatMap((f) => f.pads);
  for (const p of pads) {
    if (mm(p.drill) + 1e-6 < P.drill) out.push({ rule: 'Bohrung', text: `Bohrung ${p.ref}: ${mm(p.drill).toFixed(2)} mm (min. ${P.drill} mm).`, x: p.x, y: p.y, level: 'error' });
    const ring = (mm(p.d) - mm(p.drill)) / 2;
    if (ring + 1e-6 < P.annular) out.push({ rule: 'Restring', text: `Restring ${p.ref}: ${ring.toFixed(2)} mm (min. ${P.annular} mm).`, x: p.x, y: p.y, level: 'error' });
    const e = Math.min(p.x, p.y, L.w - p.x, L.h - p.y) * U - mm(p.d) / 2;
    if (e < P.edge) out.push({ rule: 'Randabstand', text: `Pad ${p.ref} liegt ${Math.max(0, e).toFixed(2)} mm vom Rand (min. ${P.edge} mm).`, x: p.x, y: p.y, level: 'error' });
  }
  // Abstände Pad–Pad (verschiedene Netze)
  for (let i = 0; i < pads.length; i++)
    for (let j = i + 1; j < pads.length; j++) {
      const a = pads[i];
      const b = pads[j];
      if (a.net && a.net === b.net) continue;
      const gap = mm(Math.hypot(a.x - b.x, a.y - b.y) - a.d / 2 - b.d / 2);
      if (gap < P.clearance) out.push({ rule: 'Abstand', text: `Pads ${a.ref} und ${b.ref}: ${Math.max(0, gap).toFixed(3)} mm Abstand (min. ${P.clearance} mm).`, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, level: 'error' });
    }
  // Abstände Bahn–Pad (fremdes Netz, gleiche Lage – THT-Pads sind auf allen Lagen)
  for (const t of L.traces)
    for (const p of pads) {
      if (p.net === t.net) continue;
      for (let i = 1; i < t.pts.length; i++) {
        const gap = mm(segDist(p.x, p.y, t.pts[i - 1], t.pts[i]) - p.d / 2 - t.width / 2);
        if (gap < P.clearance) {
          out.push({ rule: 'Abstand', text: `Bahn (${t.net}, ${t.layer === 'top' ? 'oben' : 'unten'}) berührt fast Pad ${p.ref} (${Math.max(0, gap).toFixed(3)} mm, min. ${P.clearance} mm).`, x: p.x, y: p.y, level: gap <= 0 ? 'error' : 'warn' });
          break;
        }
      }
    }
  // Befestigungslöcher (M3) gegen Pads und Bahnen
  for (const m of mountHoles(L.w, L.h)) {
    const r = MOUNT_HOLE_MM / 2 / U + 1.5 / U; // Loch + Platz für Schraubenkopf (Ø 6 mm)
    const pad = pads.find((p) => Math.hypot(p.x - m.x, p.y - m.y) < r + p.d / 2);
    if (pad) out.push({ rule: 'Befestigungsloch', text: `Pad ${pad.ref} liegt zu nah am Befestigungsloch (Schraubenkopf Ø 6 mm).`, x: m.x, y: m.y, level: 'error' });
    const tr = L.traces.find((t) => t.pts.some((p, i) => i > 0 && segDist(m.x, m.y, t.pts[i - 1], p) < r + t.width / 2));
    if (tr) out.push({ rule: 'Befestigungsloch', text: `Leiterbahn im Netz ${tr.net} führt zu nah am Befestigungsloch vorbei.`, x: m.x, y: m.y, level: 'error' });
  }
  // Bahn–Bahn auf derselben Lage (fremde Netze): Kreuzungen
  for (let i = 0; i < L.traces.length; i++)
    for (let j = i + 1; j < L.traces.length; j++) {
      const a = L.traces[i];
      const b = L.traces[j];
      if (a.net === b.net || a.layer !== b.layer) continue;
      let hit: { x: number; y: number } | null = null;
      for (let k = 1; k < a.pts.length && !hit; k++)
        for (let m = 1; m < b.pts.length && !hit; m++) {
          const ip = intersect(a.pts[k - 1], a.pts[k], b.pts[m - 1], b.pts[m]);
          if (ip) hit = ip;
        }
      if (hit) out.push({ rule: 'Kurzschluss', text: `Bahnen der Netze ${a.net} und ${b.net} kreuzen sich auf der ${a.layer === 'top' ? 'Ober' : 'Unter'}seite.`, x: hit.x, y: hit.y, level: 'error' });
    }
  return out;
}

function intersect(p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }, p4: { x: number; y: number }) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  if (t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98) return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
  return null;
}

/** Mikrostreifen-Impedanz nach IPC-2141 (Ω) */
export function microstripZ0(wMm: number, hMm: number, er: number, tMm = 0.035): number {
  return (87 / Math.sqrt(er + 1.41)) * Math.log((5.98 * hMm) / (0.8 * wMm + tMm));
}

/** Breite für Zielimpedanz (Bisektion) */
export function widthForZ0(z: number, hMm: number, er: number, tMm = 0.035): number {
  let lo = 0.02;
  let hi = 10;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (microstripZ0(mid, hMm, er, tMm) > z) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
