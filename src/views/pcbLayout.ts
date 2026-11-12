/**
 * Platinen-Geometrie: Platzierung der Footprints, einfache Leiterbahnführung.
 * Wird von der Platinenansicht, der 3D-Ansicht und dem Gerber-Export gemeinsam genutzt.
 */
import { getPart, findPin } from '../parts/registry';
import { splitRef, type Project, type PartInst } from '../ohm/model';
import { MM } from '../parts/types';
import { autoroute } from '../eda/pcbRouter';

export interface Pad {
  ref: string;
  x: number;
  y: number;
  /** Durchmesser in Einheiten */
  d: number;
  square: boolean;
  drill: number;
  net: string | null;
}

export interface Footprint {
  id: string;
  inst: PartInst;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  pads: Pad[];
  label: string;
  height: number;
  kind: string;
}

export interface Trace {
  net: string;
  layer: 'top' | 'bottom';
  pts: { x: number; y: number }[];
  width: number;
}

export interface Via {
  x: number;
  y: number;
  net: string;
}

export type Surface = 'enig' | 'hasl' | 'osp' | 'silber' | 'zinn';

export interface PcbLayout {
  w: number;
  h: number;
  footprints: Footprint[];
  traces: Trace[];
  vias: Via[];
  color: string;
  /** Farbname des Lötstopplacks */
  maskName: string;
  matte: boolean;
  finish: 'gold' | 'silver';
  surface: Surface;
  layers: number;
  /** nicht verlegbare Verbindungen (Luftlinien) */
  unrouted: number;
  /** Massefläche (Copper Pour) */
  pour: { net: string; layers: ('top' | 'bottom')[]; clearance: number } | null;
}

export function surfaceOf(o: unknown): Surface {
  const v = String(o ?? 'enig').toLowerCase();
  if (v === 'hasl' || v === 'silber-hasl') return 'hasl';
  if (v === 'osp' || v === 'kupfer') return 'osp';
  if (v === 'silber' || v === 'immersion-silber') return 'silber';
  if (v === 'zinn' || v === 'immersion-zinn') return 'zinn';
  return 'enig';
}

/** Befestigungslöcher: M3 (3,2 mm), Mitte 3,5 mm vom Rand – gleiche Position wie die Schraubdome im Gehäuse */
export const MOUNT_HOLE_MM = 3.2;
export const MOUNT_INSET_MM = 3.5;
export function mountHoles(w: number, h: number): { x: number; y: number }[] {
  const i = MOUNT_INSET_MM / 0.254;
  if (w * 0.254 <= 30 || h * 0.254 <= 30) return [];
  return [
    { x: i, y: i },
    { x: w - i, y: i },
    { x: i, y: h - i },
    { x: w - i, y: h - i },
  ];
}

export const MASK_COLORS: Record<string, string> = {
  gruen: '#1f6b3a',
  schwarz: '#151515',
  blau: '#1d4fa8',
  rot: '#a51d1d',
  weiss: '#ececec',
  lila: '#5b2a86',
  gelb: '#d4b106',
};

function rotPt(x: number, y: number, rot: number, cx: number, cy: number) {
  const r = ((rot % 360) + 360) % 360;
  const dx = x - cx;
  const dy = y - cy;
  if (r === 90) return { x: cx - dy, y: cy + dx };
  if (r === 180) return { x: cx - dx, y: cy - dy };
  if (r === 270) return { x: cx + dy, y: cy - dx };
  return { x, y };
}

/** Footprint eines Teils (lokal): Pads aus den Pin-Positionen */
function footprintOf(inst: PartInst) {
  const def = getPart(inst.type)!;
  const pins = def.pins(inst.props).filter((p) => p.x > -100);
  const isModule = !!def.board || ['Displays', 'Sensoren', 'Funk'].includes(def.category) || pins.length > 8;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pins) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  if (!pins.length) {
    x0 = y0 = 0;
    x1 = y1 = 20;
  }
  const s = def.size(inst.props);
  let bx0: number;
  let by0: number;
  let bx1: number;
  let by1: number;
  if (isModule) {
    bx0 = 0;
    by0 = 0;
    bx1 = s.w;
    by1 = s.h;
  } else {
    const m = 8;
    bx0 = x0 - m;
    by0 = y0 - m;
    bx1 = x1 + m;
    by1 = y1 + m;
    // flache Bauteile (2 Pins in einer Reihe) bekommen eine Gehäusebreite
    if (by1 - by0 < 18) {
      by0 -= 5;
      by1 += 5;
    }
  }
  return { def, pins, bx0, by0, w: bx1 - bx0, h: by1 - by0, isModule };
}

export function boardSize(project: Project, fps: { w: number; h: number }[]): { w: number; h: number } {
  const g = project.views.platine?.groesse;
  const m = /^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*mm$/i.exec(String(g ?? ''));
  if (m) return { w: parseFloat(m[1]) * MM, h: parseFloat(m[2]) * MM };
  const area = fps.reduce((a, f) => a + (f.w + 16) * (f.h + 16), 0);
  const w = Math.max(160, Math.sqrt(area * 1.9));
  return { w: Math.round(w / 10) * 10, h: Math.round((area * 1.4) / w / 10) * 10 + 40 };
}

export function computePcb(project: Project): PcbLayout {
  const pcbProps = project.views.platine ?? {};
  const parts = project.parts.filter((p) => {
    const d = getPart(p.type);
    return d && !d.noBom && !p.type.startsWith('steckbrett') && d.category !== 'Messgeräte' && p.type !== 'magnet' && p.type !== 'ble-beacon' && d.category !== 'Computer';
  });
  const raw = parts.map((inst) => ({ inst, ...footprintOf(inst) }));
  const size0 = boardSize(project, raw);
  const size = { ...size0 };
  const place = (project as any).pcb as Record<string, { x: number; y: number; rot: number }> | undefined;
  // Automatische Platzierung: Boards zuerst, dann nach Höhe sortiert, zeilenweise
  const order = [...raw].sort((a, b) => (b.def.board ? 1 : 0) - (a.def.board ? 1 : 0) || b.h - a.h);
  const margin = 14;
  // Ecken für die Befestigungslöcher frei lassen: Zeilen beginnen/enden weiter innen
  const side = Math.ceil((MOUNT_INSET_MM + 3.4) / 0.254);
  let cx = side;
  let cy = margin;
  let rowH = 0;
  const pos = new Map<string, { x: number; y: number; rot: number }>();
  for (const f of order) {
    if (place?.[f.inst.id]) {
      pos.set(f.inst.id, place[f.inst.id]);
      continue;
    }
    if (cx + f.w > size.w - side && cx > side) {
      cx = side;
      cy += rowH + 12;
      rowH = 0;
    }
    pos.set(f.inst.id, { x: Math.round(cx / 5) * 5, y: Math.round(cy / 5) * 5, rot: 0 });
    cx += f.w + 12;
    rowH = Math.max(rowH, f.h);
  }
  const h = Math.max(size.h, cy + rowH + margin);
  // Breite wachsen lassen, falls ein Teil breiter ist als die geschätzte Platine (Ecken bleiben frei)
  if (!/mm$/i.test(String(project.views.platine?.groesse ?? ''))) {
    let right = 0;
    for (const [id, p] of pos) {
      const f = raw.find((r) => r.inst.id === id)!;
      right = Math.max(right, p.x + (p.rot % 180 ? f.h : f.w));
    }
    size.w = Math.max(size.w, Math.ceil((right + side) / 10) * 10);
  }
  // Netzzuordnung der Pins
  const netOf = new Map<string, string>();
  for (const n of project.nets) {
    for (const r of n.pins) {
      const [pid, pn] = splitRef(r);
      const inst = project.parts.find((p) => p.id === pid);
      const def = inst && getPart(inst.type);
      const pin = def && findPin(def, inst!.props, pn);
      if (pin) netOf.set(`${pid}.${pin.id}`, n.name);
    }
  }
  const footprints: Footprint[] = raw.map((f) => {
    const p = pos.get(f.inst.id)!;
    const cxl = f.w / 2;
    const cyl = f.h / 2;
    const pads: Pad[] = f.pins.map((pin, i) => {
      const lx = pin.x - f.bx0;
      const ly = pin.y - f.by0;
      const r = rotPt(lx, ly, p.rot, cxl, cyl);
      const ref = `${f.inst.id}.${pin.id}`;
      return { ref, x: p.x + r.x, y: p.y + r.y, d: f.isModule ? 6.8 : 7.2, square: i === 0, drill: f.def.type === '1n4007' ? 4.3 : 3.6, net: netOf.get(ref) ?? null };
    });
    const swap = p.rot % 180 !== 0;
    return { id: f.inst.id, inst: f.inst, x: p.x, y: p.y, w: swap ? f.h : f.w, h: swap ? f.w : f.h, rot: p.rot, pads, label: f.inst.id, height: f.def.height3d ?? 5, kind: f.def.type };
  });
  // Leiterbahnen: Verbindungen je Netz (minimaler Spannbaum), dann A*-Autorouter mit Vias
  const traces: Trace[] = [];
  const vias: Via[] = [];
  const layers = Number(pcbProps.lagen ?? 2);
  const conns: { net: string; a: Pad; b: Pad; width: number }[] = [];
  for (const n of project.nets) {
    const pads = footprints.flatMap((f) => f.pads).filter((p) => p.net === n.name);
    if (pads.length < 2) continue;
    const power = /GND|VCC|VBAT|5V|3V3|VIN|12V/i.test(n.name);
    const tree = [0];
    const rest = pads.map((_, i) => i).slice(1);
    while (rest.length) {
      let best = Infinity;
      let bi = 0;
      let bj = 0;
      for (const i of tree)
        for (let j = 0; j < rest.length; j++) {
          const d = Math.hypot(pads[i].x - pads[rest[j]].x, pads[i].y - pads[rest[j]].y);
          if (d < best) {
            best = d;
            bi = i;
            bj = j;
          }
        }
      const j = rest.splice(bj, 1)[0];
      tree.push(j);
      conns.push({ net: n.name, a: pads[bi], b: pads[j], width: power ? 2.4 : 1.4 });
    }
  }
  const allPads = footprints.flatMap((f) => f.pads);
  const boardH = Math.max(size.h, cy + rowH + margin);
  // Befestigungslöcher als Sperrflächen für den Autorouter (Schraubenkopf Ø 6 mm)
  const keepouts = mountHoles(size.w, boardH).map((m) => ({ x: m.x, y: m.y, d: 6.4 / 0.254, net: null }));
  const routed = autoroute(size.w, boardH, [...allPads, ...keepouts], conns, layers);
  traces.push(...routed.traces);
  vias.push(...routed.vias);
  const unrouted = routed.failed;
  const surface = surfaceOf(pcbProps.oberflaeche);
  // Massefläche: GND-Netz auf beiden Außenlagen, dazu Stitching-Vias
  const gndNet = project.nets.find((n) => /^(GND|MASSE|VSS)$/i.test(n.name))?.name ?? null;
  const pourOn = (pcbProps as any).masseflaeche !== false && !!gndNet;
  const clearance = 6;
  if (pourOn) {
    const others = footprints.flatMap((f) => f.pads).filter((p) => p.net !== gndNet);
    const otherTraces = traces.filter((t) => t.net !== gndNet);
    const free = (x: number, y: number) =>
      others.every((p) => Math.hypot(p.x - x, p.y - y) > p.d / 2 + clearance + 3) &&
      footprints.flatMap((f) => f.pads).every((p) => Math.hypot(p.x - x, p.y - y) > p.d / 2 + 4) &&
      otherTraces.every((t) => t.pts.every((a, i) => i === 0 || segDist(x, y, t.pts[i - 1], a) > t.width / 2 + clearance + 3));
    for (let y = 25; y < h - 20; y += 40) for (let x = 25; x < size.w - 20; x += 40) if (free(x, y)) vias.push({ x, y, net: gndNet! });
  }
  const maskName = String(pcbProps.farbe ?? 'gruen');
  return {
    w: size.w,
    h,
    footprints,
    traces,
    vias,
    color: MASK_COLORS[maskName.replace('-matt', '')] ?? MASK_COLORS.gruen,
    maskName,
    matte: /matt/.test(maskName),
    finish: surface === 'enig' ? 'gold' : 'silver',
    surface,
    layers,
    pour: pourOn ? { net: gndNet!, layers: layers >= 2 ? ['top', 'bottom'] : ['top'], clearance } : null,
    unrouted,
  };
}

function simplify(pts: { x: number; y: number }[]) {
  const out: { x: number; y: number }[] = [];
  for (const p of pts) {
    const l = out[out.length - 1];
    if (l && Math.abs(l.x - p.x) < 0.01 && Math.abs(l.y - p.y) < 0.01) continue;
    out.push(p);
  }
  return out;
}

export function segDist(x: number, y: number, a: { x: number; y: number }, b: { x: number; y: number }) {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / l2));
  return Math.hypot(a.x + t * (b.x - a.x) - x, a.y + t * (b.y - a.y) - y);
}

export const SURFACE_COLORS: Record<Surface, { base: string; hi: string; name: string }> = {
  enig: { base: '#d9a93c', hi: '#ffe9a8', name: 'ENIG (Gold)' },
  hasl: { base: '#b9bec4', hi: '#f2f4f6', name: 'HASL (Zinn-Blei-frei)' },
  osp: { base: '#c46f3c', hi: '#f0b48a', name: 'OSP (Kupfer)' },
  silber: { base: '#cfd3d8', hi: '#ffffff', name: 'Chem. Silber' },
  zinn: { base: '#a9aeb3', hi: '#dfe2e5', name: 'Chem. Zinn' },
};

function crossCount(a: { x: number; y: number }[], b: { x: number; y: number }[]): number {
  let n = 0;
  for (let i = 1; i < a.length; i++)
    for (let j = 1; j < b.length; j++) {
      const p1 = a[i - 1];
      const p2 = a[i];
      const p3 = b[j - 1];
      const p4 = b[j];
      const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
      if (Math.abs(d) < 1e-9) continue;
      const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
      const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
      if (t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98) n++;
    }
  return n;
}
