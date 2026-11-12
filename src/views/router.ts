/**
 * Kabel-Router: A*-Wegsuche auf einem Raster.
 * Kabel weichen Bauteilen aus, vermeiden Kreuzungen und halten Abstand zu anderen Kabeln.
 */
import { getPart } from '../parts/registry';
import type { Project } from '../ohm/model';
import type { WireSeg } from './wires';

export type WireStyle = '90' | '45' | 'direkt' | 'weich';

export interface Pt {
  x: number;
  y: number;
}

export interface RoutedWire extends WireSeg {
  pts: Pt[];
  style: WireStyle;
  manual: boolean;
  key: string;
}

export function segKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

class Heap {
  private a: number[] = [];
  private f: Float64Array;
  constructor(f: Float64Array) {
    this.f = f;
  }
  get size() {
    return this.a.length;
  }
  push(i: number) {
    const a = this.a;
    a.push(i);
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.f[a[p]] <= this.f[a[k]]) break;
      [a[p], a[k]] = [a[k], a[p]];
      k = p;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < a.length && this.f[a[l]] < this.f[a[m]]) m = l;
        if (r < a.length && this.f[a[r]] < this.f[a[m]]) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]];
        k = m;
      }
    }
    return top;
  }
}

const DIRS8 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export interface RouteOptions {
  style: WireStyle;
  grid?: number;
  /** eigene Knickpunkte je Segment */
  manual?: Record<string, Pt[]>;
  /** Stil je Netz */
  netStyle?: Record<string, WireStyle>;
  /** schnelle Vorschau (z. B. beim Ziehen): nur L-Formen */
  fast?: boolean;
}

/** Grob-Cache: gleiche Geometrie → gleiche Wege */
let cache: { key: string; result: RoutedWire[] } | null = null;

export function routeAll(project: Project, segs: WireSeg[], opt: RouteOptions): RoutedWire[] {
  const G = opt.grid ?? 5;
  const geomKey = JSON.stringify([opt, segs.map((s) => [s.a, s.b, s.ax, s.ay, s.bx, s.by]), project.parts.map((p) => [p.id, p.x, p.y, p.rot])]);
  if (cache && cache.key === geomKey) return cache.result;
  // Hindernisse: Bauteil-Rechtecke
  const boxes = project.parts
    .filter((p) => !p.type.startsWith('steckbrett'))
    .map((p) => {
      const d = getPart(p.type);
      const s = d ? d.size(p.props) : { w: 0, h: 0 };
      const sw = p.rot % 180 ? s.h : s.w;
      const sh = p.rot % 180 ? s.w : s.h;
      const cx = p.x + s.w / 2;
      const cy = p.y + s.h / 2;
      return { x0: cx - sw / 2, y0: cy - sh / 2, x1: cx + sw / 2, y1: cy + sh / 2 };
    });
  let X0 = Infinity;
  let Y0 = Infinity;
  let X1 = -Infinity;
  let Y1 = -Infinity;
  for (const b of boxes) {
    X0 = Math.min(X0, b.x0);
    Y0 = Math.min(Y0, b.y0);
    X1 = Math.max(X1, b.x1);
    Y1 = Math.max(Y1, b.y1);
  }
  for (const s of segs) {
    X0 = Math.min(X0, s.ax, s.bx);
    Y0 = Math.min(Y0, s.ay, s.by);
    X1 = Math.max(X1, s.ax, s.bx);
    Y1 = Math.max(Y1, s.ay, s.by);
  }
  const pad = 60;
  X0 = Math.floor((X0 - pad) / G) * G;
  Y0 = Math.floor((Y0 - pad) / G) * G;
  const W = Math.ceil((X1 - X0 + pad) / G) + 1;
  const H = Math.ceil((Y1 - Y0 + pad) / G) + 1;
  const N = W * H;
  if (!Number.isFinite(N) || N > 2_000_000) return segs.map((s) => direct(s, opt.style));
  const block = new Float32Array(N);
  for (const b of boxes) {
    const gx0 = Math.max(0, Math.floor((b.x0 - X0) / G) - 1);
    const gx1 = Math.min(W - 1, Math.ceil((b.x1 - X0) / G) + 1);
    const gy0 = Math.max(0, Math.floor((b.y0 - Y0) / G) - 1);
    const gy1 = Math.min(H - 1, Math.ceil((b.y1 - Y0) / G) + 1);
    for (let y = gy0; y <= gy1; y++) for (let x = gx0; x <= gx1; x++) block[y * W + x] = 25;
  }
  // Belegung durch bereits verlegte Kabel (je Netz)
  const occNet = new Int32Array(N).fill(-1);
  const near = new Float32Array(N);
  const netIds = new Map<string, number>();
  const result: RoutedWire[] = [];
  const g = new Float64Array(N);
  const f = new Float64Array(N);
  const from = new Int32Array(N);
  const dirIn = new Int8Array(N);
  const stamp = new Int32Array(N);
  let run = 0;
  // längere Verbindungen zuerst? Kurze zuerst ergibt aufgeräumtere Bündel
  const order = segs.map((s, i) => ({ s, i, d: Math.abs(s.ax - s.bx) + Math.abs(s.ay - s.by) })).sort((a, b) => a.d - b.d);
  const out: (RoutedWire | null)[] = new Array(segs.length).fill(null);
  for (const { s, i } of order) {
    const key = segKey(s.a, s.b);
    const style = opt.netStyle?.[s.net] ?? opt.style;
    const manual = opt.manual?.[key];
    if (!netIds.has(s.net)) netIds.set(s.net, netIds.size);
    const nid = netIds.get(s.net)!;
    let pts: Pt[];
    if (manual && manual.length) {
      const first = s.a < s.b ? { x: s.ax, y: s.ay } : { x: s.bx, y: s.by };
      const last = s.a < s.b ? { x: s.bx, y: s.by } : { x: s.ax, y: s.ay };
      pts = [first, ...manual, last];
      if (!(s.a < s.b)) pts.reverse();
    } else if (opt.fast) {
      pts = style === 'direkt' || style === 'weich' ? [{ x: s.ax, y: s.ay }, { x: s.bx, y: s.by }] : lShape(s);
    } else if (style === 'direkt' || style === 'weich') {
      pts = [
        { x: s.ax, y: s.ay },
        { x: s.bx, y: s.by },
      ];
    } else {
      run++;
      const diag = style === '45';
      const sx = Math.round((s.ax - X0) / G);
      const sy = Math.round((s.ay - Y0) / G);
      const tx = Math.round((s.bx - X0) / G);
      const ty = Math.round((s.by - Y0) / G);
      const start = sy * W + sx;
      const goal = ty * W + tx;
      const h = (x: number, y: number) => {
        const dx = Math.abs(x - tx);
        const dy = Math.abs(y - ty);
        return diag ? Math.max(dx, dy) + 0.414 * Math.min(dx, dy) : dx + dy;
      };
      const heap = new Heap(f);
      g[start] = 0;
      f[start] = h(sx, sy);
      from[start] = -1;
      dirIn[start] = -1;
      stamp[start] = run;
      heap.push(start);
      const closed = new Uint8Array(0);
      void closed;
      let found = false;
      let iter = 0;
      const nd = diag ? 8 : 4;
      while (heap.size && iter++ < 200000) {
        const c = heap.pop();
        if (c === goal) {
          found = true;
          break;
        }
        const cx = c % W;
        const cy = (c - cx) / W;
        const distS = Math.abs(cx - sx) + Math.abs(cy - sy);
        const distT = Math.abs(cx - tx) + Math.abs(cy - ty);
        for (let d = 0; d < nd; d++) {
          const nx = cx + DIRS8[d][0];
          const ny = cy + DIRS8[d][1];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          let cost = d < 4 ? 1 : 1.414;
          // Bauteile meiden (nahe den eigenen Pins erlaubt)
          const nearEnd = distS < 4 || distT < 4 || Math.abs(nx - tx) + Math.abs(ny - ty) < 4;
          if (!nearEnd) cost += block[n];
          // Kreuzungen und Nähe zu fremden Kabeln vermeiden
          const o = occNet[n];
          if (o >= 0 && o !== nid) cost += 30;
          else if (o === nid) cost -= 0.3;
          cost += near[n] * 2;
          // Knicke kosten
          if (dirIn[c] >= 0 && dirIn[c] !== d) cost += 3;
          const ng = g[c] + Math.max(0.2, cost);
          if (stamp[n] !== run || ng < g[n]) {
            stamp[n] = run;
            g[n] = ng;
            f[n] = ng + h(nx, ny);
            from[n] = c;
            dirIn[n] = d;
            heap.push(n);
          }
        }
      }
      if (!found) {
        pts = lShape(s);
      } else {
        const cells: number[] = [];
        for (let c = goal; c !== -1; c = from[c]) cells.push(c);
        cells.reverse();
        // markieren
        for (const c of cells) {
          occNet[c] = nid;
          const cx = c % W;
          const cy = (c - cx) / W;
          for (const [dx, dy] of DIRS8.slice(0, 4)) {
            const nn = (cy + dy) * W + (cx + dx);
            if (nn >= 0 && nn < N) near[nn] = Math.min(near[nn] + 1, 3);
          }
        }
        pts = cells.map((c) => ({ x: X0 + (c % W) * G, y: Y0 + Math.floor(c / W) * G }));
        pts[0] = { x: s.ax, y: s.ay };
        pts[pts.length - 1] = { x: s.bx, y: s.by };
        // Endpunkte exakt anschließen (Rasterversatz ausgleichen)
        if (pts.length > 2) {
          const p1 = pts[1];
          if (p1.x !== s.ax && p1.y !== s.ay) pts.splice(1, 0, { x: s.ax, y: p1.y });
          const q = pts[pts.length - 2];
          if (q.x !== s.bx && q.y !== s.by) pts.splice(pts.length - 1, 0, { x: s.bx, y: q.y });
        }
        pts = simplify(pts);
      }
    }
    out[i] = { ...s, pts, style, manual: !!manual?.length, key };
  }
  for (const r of out) if (r) result.push(r);
  cache = { key: geomKey, result };
  return result;
}

function lShape(s: WireSeg): Pt[] {
  return simplify([
    { x: s.ax, y: s.ay },
    { x: s.ax, y: s.ay + (s.by - s.ay) / 2 },
    { x: s.bx, y: s.ay + (s.by - s.ay) / 2 },
    { x: s.bx, y: s.by },
  ]);
}

function direct(s: WireSeg, style: WireStyle): RoutedWire {
  return { ...s, pts: style === 'direkt' || style === 'weich' ? [{ x: s.ax, y: s.ay }, { x: s.bx, y: s.by }] : lShape(s), style, manual: false, key: segKey(s.a, s.b) };
}

/** kollineare Punkte entfernen */
export function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    if (out.length && Math.abs(out[out.length - 1].x - p.x) < 0.01 && Math.abs(out[out.length - 1].y - p.y) < 0.01) continue;
    while (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      const cross = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x);
      if (Math.abs(cross) < 0.01) out.pop();
      else break;
    }
    out.push(p);
  }
  return out;
}

/** Polylinie mit leicht abgerundeten Ecken als SVG-Pfad */
export function roundedPath(pts: Pt[], r = 2): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1];
    const c = pts[i];
    const n = pts[i + 1];
    const l1 = Math.hypot(c.x - p.x, c.y - p.y);
    const l2 = Math.hypot(n.x - c.x, n.y - c.y);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const a = { x: c.x - ((c.x - p.x) / l1) * rr, y: c.y - ((c.y - p.y) / l1) * rr };
    const b = { x: c.x + ((n.x - c.x) / l2) * rr, y: c.y + ((n.y - c.y) / l2) * rr };
    d += ` L${a.x} ${a.y} Q${c.x} ${c.y} ${b.x} ${b.y}`;
  }
  const l = pts[pts.length - 1];
  return d + ` L${l.x} ${l.y}`;
}

/** Kreuzungen zweier Kabel verschiedener Netze (für Brückenbögen) */
export function crossings(wires: RoutedWire[]): { x: number; y: number; wire: RoutedWire; horiz: boolean }[] {
  // Senkrechte Segmente nach x sortieren, dann je waagrechtem Segment nur die passenden x-Bereiche prüfen
  const vert: { x: number; y0: number; y1: number; net: string }[] = [];
  const horiz: { y: number; x0: number; x1: number; w: RoutedWire }[] = [];
  for (const w of wires)
    for (let i = 0; i < w.pts.length - 1; i++) {
      const a = w.pts[i];
      const b = w.pts[i + 1];
      if (Math.abs(a.x - b.x) < 0.01) vert.push({ x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y), net: w.net });
      else if (Math.abs(a.y - b.y) < 0.01) horiz.push({ y: a.y, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), w });
    }
  vert.sort((p, q) => p.x - q.x);
  const xs = vert.map((v) => v.x);
  const lower = (x: number) => {
    let lo = 0;
    let hi = xs.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (xs[m] <= x) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  const out: { x: number; y: number; wire: RoutedWire; horiz: boolean }[] = [];
  for (const h of horiz)
    for (let j = lower(h.x0 + 2); j < vert.length && vert[j].x < h.x1 - 2; j++) {
      const v = vert[j];
      if (v.net === h.w.net) continue;
      if (h.y > v.y0 + 2 && h.y < v.y1 - 2) out.push({ x: v.x, y: h.y, wire: h.w, horiz: true });
    }
  return out;
}

/** Kreuzungen je Leitung gruppieren (statt für jede Leitung alle Kreuzungen zu filtern) */
export function hopsByWire(hops: { x: number; y: number; wire: RoutedWire }[]): Map<RoutedWire, { x: number; y: number }[]> {
  const m = new Map<RoutedWire, { x: number; y: number }[]>();
  for (const h of hops) (m.get(h.wire) ?? m.set(h.wire, []).get(h.wire)!).push(h);
  return m;
}

/** horizontale Segmente mit Brückenbögen an Kreuzungen */
export function pathWithHops(pts: Pt[], hops: { x: number; y: number }[], r = 2, hr = 3.2): string {
  if (!hops.length) return roundedPath(pts, r);
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (Math.abs(a.y - b.y) < 0.01) {
      const dir = Math.sign(b.x - a.x);
      const hs = hops.filter((h) => Math.abs(h.y - a.y) < 0.01 && (h.x - a.x) * dir > hr && (b.x - h.x) * dir > hr).sort((p, q) => (p.x - q.x) * dir);
      for (const h of hs) d += ` L${h.x - dir * hr} ${a.y} A${hr} ${hr} 0 0 ${dir > 0 ? 1 : 0} ${h.x + dir * hr} ${a.y}`;
    }
    d += ` L${b.x} ${b.y}`;
  }
  return d;
}
