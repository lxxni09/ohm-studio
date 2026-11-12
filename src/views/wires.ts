/** Kabelgeometrie, Farben und Stromfluss für die Ansichten */
import { getPart, findPin } from '../parts/registry';
import { pinWorld } from '../sim/engine';
import { splitRef, type Project } from '../ohm/model';

export interface WireSeg {
  net: string;
  a: string;
  b: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  color: string;
}

const PALETTE = ['#2b6fd6', '#f2b705', '#2f9e44', '#f07c1b', '#8e44ad', '#16a2b8', '#e64980', '#9c6b3f', '#5c7cfa'];

export function netColor(name: string, project?: Project): string {
  const c = project?.wireColors?.[name];
  if (c) return c;
  const n = name.toUpperCase();
  if (/^(GND|MASSE|VSS|0V|-)$|GND/.test(n)) return '#26272b';
  if (/^(VCC|VBAT|VIN|5V|3V3|3\.3V|12V|VDD|\+|V\+|VBUS|VSYS|PLUS|BAT)/.test(n)) return '#e03131';
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const partIndex = new WeakMap<Project['parts'], Map<string, Project['parts'][number]>>();
function partById(project: Project, id: string) {
  let m = partIndex.get(project.parts);
  if (!m || m.size !== project.parts.length) {
    m = new Map(project.parts.map((p) => [p.id, p]));
    partIndex.set(project.parts, m);
  }
  const hit = m.get(id);
  return hit && hit.id === id ? hit : project.parts.find((p) => p.id === id);
}

export function pinPos(project: Project, ref: string): { x: number; y: number } | null {
  const [pid, pn] = splitRef(ref);
  const inst = partById(project, pid);
  if (!inst) return null;
  const def = getPart(inst.type);
  if (!def) return null;
  const pin = findPin(def, inst.props, pn);
  if (!pin || pin.x < -100) return null;
  return pinWorld(inst, def, pin);
}

/** Minimaler Spannbaum je Netz → kurze, übersichtliche Kabel */
export function netSegments(project: Project): WireSeg[] {
  const out: WireSeg[] = [];
  for (const net of project.nets) {
    const pts = net.pins.map((r) => ({ r, p: pinPos(project, r) })).filter((x): x is { r: string; p: { x: number; y: number } } => !!x.p);
    if (pts.length < 2) continue;
    const color = netColor(net.name, project);
    // Prim-Algorithmus mit Distanzfeld: O(n²) statt O(n³)
    const n = pts.length;
    const used = new Uint8Array(n);
    const dist = new Float64Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(0);
    used[0] = 1;
    for (let j = 1; j < n; j++) dist[j] = Math.hypot(pts[0].p.x - pts[j].p.x, pts[0].p.y - pts[j].p.y);
    for (let step = 1; step < n; step++) {
      let j = -1;
      let best = Infinity;
      for (let k = 0; k < n; k++) if (!used[k] && dist[k] < best) [best, j] = [dist[k], k];
      if (j < 0) break;
      used[j] = 1;
      const bi = from[j];
      out.push({ net: net.name, a: pts[bi].r, b: pts[j].r, ax: pts[bi].p.x, ay: pts[bi].p.y, bx: pts[j].p.x, by: pts[j].p.y, color });
      for (let k = 0; k < n; k++)
        if (!used[k]) {
          const d = Math.hypot(pts[j].p.x - pts[k].p.x, pts[j].p.y - pts[k].p.y);
          if (d < dist[k]) {
            dist[k] = d;
            from[k] = j;
          }
        }
    }
  }
  return out;
}

/** Hängendes Kabel als Bézierkurve */
export function wirePath(ax: number, ay: number, bx: number, by: number): string {
  const d = Math.hypot(bx - ax, by - ay);
  if (d < 1) return `M${ax} ${ay}`;
  const sag = Math.min(28, d * 0.1) + 4;
  const low = Math.max(ay, by) + sag;
  return `M${ax} ${ay} C ${ax + (bx - ax) * 0.2} ${low}, ${ax + (bx - ax) * 0.8} ${low}, ${bx} ${by}`;
}

/**
 * Strom je Kabelsegment aus den Pinströmen (Baum-Fluss).
 * Positiv = Strom fließt von a nach b.
 */
export function segmentCurrents(segs: WireSeg[], pinI: Map<string, number>, canon: (r: string) => string): Map<WireSeg, number> {
  const res = new Map<WireSeg, number>();
  const byNet = new Map<string, WireSeg[]>();
  for (const s of segs) (byNet.get(s.net) ?? byNet.set(s.net, []).get(s.net)!).push(s);
  for (const list of byNet.values()) {
    const adj = new Map<string, { s: WireSeg; o: string }[]>();
    for (const s of list) {
      (adj.get(s.a) ?? adj.set(s.a, []).get(s.a)!).push({ s, o: s.b });
      (adj.get(s.b) ?? adj.set(s.b, []).get(s.b)!).push({ s, o: s.a });
    }
    // Teilbaumsumme: Strom, der im Teilbaum in die Bauteile fließt
    const root = list[0].a;
    const sub = (node: string, parent: string | null): number => {
      let sum = pinI.get(canon(node)) ?? 0;
      for (const { s, o } of adj.get(node) ?? []) {
        if (o === parent) continue;
        const child = sub(o, node);
        // Strom fließt von node zum Kind, wenn das Kind Strom „verbraucht“
        res.set(s, s.a === node ? child : -child);
        sum += child;
      }
      return sum;
    };
    sub(root, null);
  }
  return res;
}

/** Spannung → Farbe (blau 0 V … rot hoch) */
export function voltColor(v: number, vmax: number): string {
  const t = Math.max(0, Math.min(1, v / Math.max(vmax, 0.5)));
  const h = 220 - 220 * t;
  return `hsl(${h} 85% ${t > 0.5 ? 52 : 55}%)`;
}
