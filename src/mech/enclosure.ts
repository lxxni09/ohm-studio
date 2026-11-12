/**
 * Gehäuse-Editor (Abschnitt 6.5): Unterschale + Deckel um die Platine, Schraubdome an den
 * Befestigungslöchern, automatische Ausschnitte (USB/Stecker am Rand, LEDs, Taster, Potis),
 * Knopf-Verlängerungen. Export als STL (3D-Druck) und STEP (CAD). Kollisionsprüfung.
 * Alle Maße in mm; Koordinaten: x/y wie Platine (y nach oben), z nach oben, Platinenunterseite auf Domhöhe.
 */
import { computePcb, mountHoles, type PcbLayout } from '../views/pcbLayout';
import { getPart } from '../parts/registry';
import { stepBoxes, type StepBox } from '../export/fab';
import type { Project } from '../ohm/model';

const U = 0.254;

export interface EnclosureParams {
  wand: number;
  boden: number;
  deckel: number;
  spiel: number;
  domHoehe: number;
  luftOben: number;
  domD: number;
  lochD: number;
  ausschnitte: boolean;
  knoepfe: boolean;
}

export const DEFAULT_ENCLOSURE: EnclosureParams = { wand: 2, boden: 2, deckel: 2, spiel: 1, domHoehe: 5, luftOben: 2, domD: 6, lochD: 2.5, ausschnitte: true, knoepfe: true };

export interface Hole {
  kind: 'rund' | 'rechteck';
  /** Fläche: deckel, links, rechts, vorne, hinten */
  face: 'deckel' | 'links' | 'rechts' | 'vorne' | 'hinten';
  /** Mittelpunkt in Flächenkoordinaten (mm) */
  u: number;
  v: number;
  w: number;
  h: number;
  why: string;
}

export interface Enclosure {
  p: EnclosureParams;
  /** Innenmaße */
  iw: number;
  ih: number;
  /** Gesamthöhe Unterschale (ohne Deckel) */
  hz: number;
  /** Außenmaße */
  ow: number;
  oh: number;
  pcbW: number;
  pcbH: number;
  pcbZ: number;
  pcbX: number;
  pcbY: number;
  maxPart: number;
  bosses: { x: number; y: number }[];
  holes: Hole[];
  parts: { id: string; x0: number; y0: number; x1: number; y1: number; z1: number }[];
  buttons: { id: string; x: number; y: number; z0: number; z1: number }[];
}

export function designEnclosure(project: Project, p: EnclosureParams = DEFAULT_ENCLOSURE, L: PcbLayout = computePcb(project)): Enclosure {
  const pcbW = L.w * U;
  const pcbH = L.h * U;
  const parts = L.footprints.map((f) => ({ id: f.id, x0: f.x * U, y0: (L.h - f.y - f.h) * U, x1: (f.x + f.w) * U, y1: (L.h - f.y) * U, z1: Math.max(1, f.height) }));
  const maxPart = Math.max(3, ...parts.map((x) => x.z1));
  const iw = pcbW + 2 * p.spiel;
  const ih = pcbH + 2 * p.spiel;
  const pcbX = p.wand + p.spiel;
  const pcbY = p.wand + p.spiel;
  const pcbZ = p.boden + p.domHoehe;
  const hz = pcbZ + 1.6 + maxPart + p.luftOben;
  // dieselben Positionen wie die Befestigungslöcher der Platine
  const bosses = mountHoles(L.w, L.h).map((m) => ({ x: pcbX + m.x * U, y: pcbY + (L.h - m.y) * U }));
  const holes: Hole[] = [];
  const buttons: Enclosure['buttons'] = [];
  const ow = iw + 2 * p.wand;
  const oh = ih + 2 * p.wand;
  if (p.ausschnitte) {
    for (const f of L.footprints) {
      const def = getPart(f.inst.type);
      const x0 = pcbX + f.x * U;
      const x1 = pcbX + (f.x + f.w) * U;
      const y0 = pcbY + (L.h - f.y - f.h) * U;
      const y1 = pcbY + (L.h - f.y) * U;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const top = pcbZ + 1.6 + Math.max(1, f.height);
      if (def?.board) {
        // USB-Buchse: an der nächstgelegenen Gehäusewand
        const dl = x0 - pcbX;
        const dr = pcbX + pcbW - x1;
        const db = y0 - pcbY;
        const dt = pcbY + pcbH - y1;
        const m = Math.min(dl, dr, db, dt);
        const face = m === dl ? 'links' : m === dr ? 'rechts' : m === db ? 'vorne' : 'hinten';
        const along = face === 'links' || face === 'rechts' ? cy : cx;
        holes.push({ kind: 'rechteck', face, u: along, v: pcbZ + 1.6 + 2, w: 12, h: 7, why: `USB-Anschluss ${f.id}` });
      } else if (/^(led|rgb-led)$/.test(f.inst.type)) holes.push({ kind: 'rund', face: 'deckel', u: cx, v: cy, w: 5.3, h: 5.3, why: `LED ${f.id}` });
      else if (/^(taster)$/.test(f.inst.type)) {
        holes.push({ kind: 'rund', face: 'deckel', u: cx, v: cy, w: 6.5, h: 6.5, why: `Taster ${f.id}` });
        if (p.knoepfe) buttons.push({ id: f.id, x: cx, y: cy, z0: top, z1: hz + p.deckel + 2 });
      } else if (/^(potentiometer|drehencoder|trimmer)$/.test(f.inst.type)) holes.push({ kind: 'rund', face: 'deckel', u: cx, v: cy, w: 7.5, h: 7.5, why: `Drehknopf ${f.id}` });
      else if (/^(schalter|batteriehalter|usb-netzteil)$/.test(f.inst.type) || def?.category === 'Displays') {
        if (def?.category === 'Displays') holes.push({ kind: 'rechteck', face: 'deckel', u: cx, v: cy, w: (x1 - x0) * 0.85, h: (y1 - y0) * 0.7, why: `Anzeige ${f.id}` });
      } else if (/hc-sr04|pir|ldr|lichtsensor/.test(f.inst.type)) holes.push({ kind: 'rund', face: 'deckel', u: cx, v: cy, w: Math.min(16, (x1 - x0) * 0.6), h: Math.min(16, (x1 - x0) * 0.6), why: `Sensoröffnung ${f.id}` });
    }
  }
  void ow;
  void oh;
  return { p, iw, ih, hz, ow: iw + 2 * p.wand, oh: ih + 2 * p.wand, pcbW, pcbH, pcbZ, pcbX, pcbY, maxPart, bosses, holes, parts: parts.map((x) => ({ ...x, x0: x.x0 + pcbX, x1: x.x1 + pcbX, y0: x.y0 + pcbY, y1: x.y1 + pcbY })), buttons };
}

/* ------------------------------ Kollisionsprüfung ------------------------------ */

export interface Collision {
  level: 'ok' | 'warn' | 'error';
  text: string;
}

export function checkCollisions(e: Enclosure): Collision[] {
  const out: Collision[] = [];
  const lidZ = e.hz;
  for (const part of e.parts) {
    const top = e.pcbZ + 1.6 + part.z1;
    if (top > lidZ - 0.5) out.push({ level: 'error', text: `${part.id} (${part.z1.toFixed(1)} mm hoch) stößt an den Deckel.` });
    for (const b of e.bosses) {
      const r = e.p.domD / 2;
      const nx = Math.max(part.x0, Math.min(b.x, part.x1));
      const ny = Math.max(part.y0, Math.min(b.y, part.y1));
      if (Math.hypot(nx - b.x, ny - b.y) < r - 0.1) {
        out.push({ level: 'warn', text: `${part.id} liegt über einem Schraubdom – Bohrung in der Platine kollidiert mit dem Bauteil.` });
        break;
      }
    }
    if (part.x0 < e.p.wand || part.y0 < e.p.wand || part.x1 > e.ow - e.p.wand || part.y1 > e.oh - e.p.wand) out.push({ level: 'error', text: `${part.id} ragt in die Gehäusewand.` });
  }
  for (let i = 0; i < e.holes.length; i++)
    for (let j = i + 1; j < e.holes.length; j++) {
      const a = e.holes[i];
      const b = e.holes[j];
      if (a.face === b.face && Math.abs(a.u - b.u) < (a.w + b.w) / 2 + 1 && Math.abs(a.v - b.v) < (a.h + b.h) / 2 + 1) out.push({ level: 'warn', text: `Ausschnitte für ${a.why} und ${b.why} überlappen.` });
    }
  if (!out.length) out.push({ level: 'ok', text: `Keine Kollisionen. Höchstes Bauteil ${e.maxPart.toFixed(1)} mm, ${e.p.luftOben} mm Luft bis zum Deckel.` });
  return out;
}

/* ------------------------------ Geometrie ------------------------------ */

type V3 = [number, number, number];
export type Tri = [V3, V3, V3];

/** Platte mit Maske (true = Material) auf einem Raster, extrudiert entlang der Normalen – wasserdicht */
function plate(w: number, h: number, t: number, solid: (u: number, v: number) => boolean, map: (u: number, v: number, n: number) => V3, res = 0.5): Tri[] {
  const nu = Math.max(1, Math.round(w / res));
  const nv = Math.max(1, Math.round(h / res));
  const du = w / nu;
  const dv = h / nv;
  const g = new Uint8Array(nu * nv);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) g[j * nu + i] = solid((i + 0.5) * du, (j + 0.5) * dv) ? 1 : 0;
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= nu || j >= nv ? 0 : g[j * nu + i]);
  const tris: Tri[] = [];
  const quad = (a: V3, b: V3, c: V3, d: V3) => tris.push([a, b, c], [a, c, d]);
  // Ober-/Unterseite zeilenweise zusammengefasst
  for (let j = 0; j < nv; j++) {
    let i = 0;
    while (i < nu) {
      if (!g[j * nu + i]) {
        i++;
        continue;
      }
      const s = i;
      while (i < nu && g[j * nu + i]) i++;
      const u0 = s * du;
      const u1 = i * du;
      const v0 = j * dv;
      const v1 = (j + 1) * dv;
      quad(map(u0, v0, t), map(u1, v0, t), map(u1, v1, t), map(u0, v1, t));
      quad(map(u0, v0, 0), map(u0, v1, 0), map(u1, v1, 0), map(u1, v0, 0));
    }
  }
  // Seitenflächen an Material/Luft-Grenzen
  for (let j = 0; j < nv; j++)
    for (let i = 0; i <= nu; i++) {
      const a = at(i - 1, j);
      const b = at(i, j);
      if (a === b) continue;
      const u = i * du;
      const v0 = j * dv;
      const v1 = (j + 1) * dv;
      if (a) quad(map(u, v0, 0), map(u, v1, 0), map(u, v1, t), map(u, v0, t));
      else quad(map(u, v0, 0), map(u, v0, t), map(u, v1, t), map(u, v1, 0));
    }
  for (let i = 0; i < nu; i++)
    for (let j = 0; j <= nv; j++) {
      const a = at(i, j - 1);
      const b = at(i, j);
      if (a === b) continue;
      const v = j * dv;
      const u0 = i * du;
      const u1 = (i + 1) * du;
      if (a) quad(map(u0, v, 0), map(u0, v, t), map(u1, v, t), map(u1, v, 0));
      else quad(map(u0, v, 0), map(u1, v, 0), map(u1, v, t), map(u0, v, t));
    }
  return tris;
}

function tube(cx: number, cy: number, z0: number, z1: number, ro: number, ri: number, seg = 28): Tri[] {
  const tris: Tri[] = [];
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2;
    const a1 = ((k + 1) / seg) * Math.PI * 2;
    const o0: [number, number] = [cx + ro * Math.cos(a0), cy + ro * Math.sin(a0)];
    const o1: [number, number] = [cx + ro * Math.cos(a1), cy + ro * Math.sin(a1)];
    const i0: [number, number] = [cx + ri * Math.cos(a0), cy + ri * Math.sin(a0)];
    const i1: [number, number] = [cx + ri * Math.cos(a1), cy + ri * Math.sin(a1)];
    tris.push([[o0[0], o0[1], z0], [o1[0], o1[1], z0], [o1[0], o1[1], z1]], [[o0[0], o0[1], z0], [o1[0], o1[1], z1], [o0[0], o0[1], z1]]);
    if (ri > 0) {
      tris.push([[i0[0], i0[1], z0], [i1[0], i1[1], z1], [i1[0], i1[1], z0]], [[i0[0], i0[1], z0], [i0[0], i0[1], z1], [i1[0], i1[1], z1]]);
      tris.push([[o0[0], o0[1], z1], [o1[0], o1[1], z1], [i1[0], i1[1], z1]], [[o0[0], o0[1], z1], [i1[0], i1[1], z1], [i0[0], i0[1], z1]]);
      tris.push([[o0[0], o0[1], z0], [i1[0], i1[1], z0], [o1[0], o1[1], z0]], [[o0[0], o0[1], z0], [i0[0], i0[1], z0], [i1[0], i1[1], z0]]);
    } else {
      tris.push([[cx, cy, z1], [o0[0], o0[1], z1], [o1[0], o1[1], z1]], [[cx, cy, z0], [o1[0], o1[1], z0], [o0[0], o0[1], z0]]);
    }
  }
  return tris;
}

function holeTest(holes: Hole[], face: Hole['face']) {
  const hs = holes.filter((h) => h.face === face);
  return (u: number, v: number) => !hs.some((h) => (h.kind === 'rund' ? Math.hypot(u - h.u, v - h.v) < h.w / 2 : Math.abs(u - h.u) < h.w / 2 && Math.abs(v - h.v) < h.h / 2));
}

export function enclosureMeshes(e: Enclosure): { unterschale: Tri[]; deckel: Tri[]; knoepfe: Tri[] } {
  const { p, ow, oh, hz } = e;
  const base: Tri[] = [];
  // Boden
  base.push(...plate(ow, oh, p.boden, () => true, (u, v, n) => [u, v, n]));
  // Wände (vorne y=0, hinten y=oh-wand, links x=0, rechts x=ow-wand), Höhe ab Boden
  const wh = hz - p.boden;
  const front = holeTest(e.holes, 'vorne');
  const back = holeTest(e.holes, 'hinten');
  const left = holeTest(e.holes, 'links');
  const right = holeTest(e.holes, 'rechts');
  base.push(...plate(ow, wh, p.wand, (u, v) => front(u, v + p.boden), (u, v, n) => [u, n, v + p.boden]));
  base.push(...plate(ow, wh, p.wand, (u, v) => back(u, v + p.boden), (u, v, n) => [u, oh - p.wand + n, v + p.boden]));
  base.push(...plate(oh - 2 * p.wand, wh, p.wand, (u, v) => left(u + p.wand, v + p.boden), (u, v, n) => [n, u + p.wand, v + p.boden]));
  base.push(...plate(oh - 2 * p.wand, wh, p.wand, (u, v) => right(u + p.wand, v + p.boden), (u, v, n) => [ow - p.wand + n, u + p.wand, v + p.boden]));
  for (const b of e.bosses) base.push(...tube(b.x, b.y, p.boden, e.pcbZ, p.domD / 2, p.lochD / 2));
  // Deckel mit Zentrierrand
  const top = holeTest(e.holes, 'deckel');
  const lid: Tri[] = [...plate(ow, oh, p.deckel, top, (u, v, n) => [u, v, hz + n])];
  const lip = 1.2;
  const lw = ow - 2 * p.wand - 0.4;
  const lh = oh - 2 * p.wand - 0.4;
  lid.push(...plate(lw, lh, 3, (u, v) => u < lip || v < lip || u > lw - lip || v > lh - lip, (u, v, n) => [p.wand + 0.2 + u, p.wand + 0.2 + v, hz - 3 + n]));
  // Knopf-Verlängerungen (separat drucken)
  const knoepfe: Tri[] = [];
  for (const b of e.buttons) {
    knoepfe.push(...tube(b.x, b.y, b.z0, b.z1, 2.9, 0));
    knoepfe.push(...tube(b.x, b.y, b.z0, b.z0 + 1.2, 4.5, 0));
  }
  return { unterschale: base, deckel: lid, knoepfe };
}

export function stlBinary(tris: Tri[], name = 'ohm-studio'): Uint8Array {
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  const head = new TextEncoder().encode(`Ohm Studio by Nodaris - ${name}`.slice(0, 79));
  new Uint8Array(buf).set(head, 0);
  dv.setUint32(80, tris.length, true);
  let o = 84;
  for (const [a, b, c] of tris) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (const v of [nx, ny, nz, ...a, ...b, ...c]) {
      dv.setFloat32(o, v, true);
      o += 4;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return new Uint8Array(buf);
}

/** STEP: Gehäuse als Quader-Zerlegung (runde Ausschnitte als Treppe mit 0,5 mm) */
export function enclosureStep(project: Project, e: Enclosure): string {
  const boxes: StepBox[] = [];
  const { p, ow, oh, hz } = e;
  const addPlate = (w: number, h: number, solid: (u: number, v: number) => boolean, toBox: (u0: number, v0: number, u1: number, v1: number) => StepBox, res = 0.5) => {
    const nu = Math.round(w / res);
    const nv = Math.round(h / res);
    const du = w / nu;
    const dv = h / nv;
    for (let j = 0; j < nv; j++) {
      let i = 0;
      while (i < nu) {
        if (!solid((i + 0.5) * du, (j + 0.5) * dv)) {
          i++;
          continue;
        }
        const s = i;
        while (i < nu && solid((i + 0.5) * du, (j + 0.5) * dv)) i++;
        // gleiche Zeilen darüber zusammenfassen
        let j1 = j + 1;
        const rowSame = (jj: number) => {
          for (let k = 0; k < nu; k++) if (solid((k + 0.5) * du, (jj + 0.5) * dv) !== solid((k + 0.5) * du, (j + 0.5) * dv)) return false;
          return true;
        };
        while (j1 < nv && rowSame(j1)) j1++;
        boxes.push(toBox(s * du, j * dv, i * du, j1 * dv));
        if (j1 > j + 1 && i >= nu) {
          j = j1 - 1;
        }
      }
    }
  };
  boxes.push({ x0: 0, y0: 0, z0: 0, x1: ow, y1: oh, z1: p.boden, name: 'Boden' });
  const wh = hz - p.boden;
  const front = holeTest(e.holes, 'vorne');
  const back = holeTest(e.holes, 'hinten');
  const left = holeTest(e.holes, 'links');
  const right = holeTest(e.holes, 'rechts');
  addPlate(ow, wh, (u, v) => front(u, v + p.boden), (u0, v0, u1, v1) => ({ x0: u0, y0: 0, z0: v0 + p.boden, x1: u1, y1: p.wand, z1: v1 + p.boden, name: 'Wand vorne' }), 1);
  addPlate(ow, wh, (u, v) => back(u, v + p.boden), (u0, v0, u1, v1) => ({ x0: u0, y0: oh - p.wand, z0: v0 + p.boden, x1: u1, y1: oh, z1: v1 + p.boden, name: 'Wand hinten' }), 1);
  addPlate(oh - 2 * p.wand, wh, (u, v) => left(u + p.wand, v + p.boden), (u0, v0, u1, v1) => ({ x0: 0, y0: u0 + p.wand, z0: v0 + p.boden, x1: p.wand, y1: u1 + p.wand, z1: v1 + p.boden, name: 'Wand links' }), 1);
  addPlate(oh - 2 * p.wand, wh, (u, v) => right(u + p.wand, v + p.boden), (u0, v0, u1, v1) => ({ x0: ow - p.wand, y0: u0 + p.wand, z0: v0 + p.boden, x1: ow, y1: u1 + p.wand, z1: v1 + p.boden, name: 'Wand rechts' }), 1);
  const top = holeTest(e.holes, 'deckel');
  addPlate(ow, oh, top, (u0, v0, u1, v1) => ({ x0: u0, y0: v0, z0: hz + 10, x1: u1, y1: v1, z1: hz + 10 + p.deckel, name: 'Deckel' }), 0.5);
  for (const b of e.bosses) boxes.push({ x0: b.x - p.domD / 2, y0: b.y - p.domD / 2, z0: p.boden, x1: b.x + p.domD / 2, y1: b.y + p.domD / 2, z1: e.pcbZ, name: 'Dom' });
  return stepBoxes(`${project.name} Gehaeuse`, boxes);
}
