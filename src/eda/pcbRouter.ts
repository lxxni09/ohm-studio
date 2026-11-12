/**
 * PCB-Autorouter: A* auf einem Raster (0,635 mm) über bis zu zwei Lagen mit Vias.
 * Sperrzonen um fremde Pads (Pad-Radius + Abstand + halbe Bahnbreite) und fremde Bahnen.
 */
export interface RPad {
  x: number;
  y: number;
  d: number;
  net: string | null;
}
export interface RTrace {
  net: string;
  layer: 'top' | 'bottom';
  pts: { x: number; y: number }[];
  width: number;
}
export interface RVia {
  x: number;
  y: number;
  net: string;
}

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, 1.414],
  [1, -1, 1.414],
  [-1, 1, 1.414],
  [-1, -1, 1.414],
];

export function autoroute(
  w: number,
  h: number,
  pads: RPad[],
  connections: { net: string; a: RPad; b: RPad; width: number }[],
  layers: number,
  clearance = 0.2 / 0.254,
  grid = 2.5,
): { traces: RTrace[]; vias: RVia[]; failed: number } {
  const W = Math.ceil(w / grid) + 1;
  const H = Math.ceil(h / grid) + 1;
  const L = layers >= 2 ? 2 : 1;
  const N = W * H;
  // Belegung je Lage: Netz-ID (−1 frei, −2 Rand)
  const occ = [new Int32Array(N).fill(-1), new Int32Array(N).fill(-1)];
  const netId = new Map<string, number>();
  const id = (n: string | null) => {
    if (!n) return -3;
    if (!netId.has(n)) netId.set(n, netId.size);
    return netId.get(n)!;
  };
  const edge = Math.ceil(5 / grid);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (x < edge || y < edge || x >= W - edge || y >= H - edge) for (const o of occ) o[y * W + x] = -2;
  const stamp = (cx: number, cy: number, r: number, nid: number, layer: number | 'both') => {
    const gr = Math.ceil(r / grid);
    const gx = Math.round(cx / grid);
    const gy = Math.round(cy / grid);
    for (let y = gy - gr; y <= gy + gr; y++)
      for (let x = gx - gr; x <= gx + gr; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (Math.hypot(x * grid - cx, y * grid - cy) > r) continue;
        for (let l = 0; l < L; l++) {
          if (layer !== 'both' && l !== layer) continue;
          const c = y * W + x;
          if (occ[l][c] === -1 || occ[l][c] === nid) occ[l][c] = nid;
          else if (occ[l][c] !== nid) occ[l][c] = -4; // Konflikt zweier Netze → gesperrt
        }
      }
  };
  const maxHalf = Math.max(...connections.map((c) => c.width / 2), 0.7);
  for (const p of pads) stamp(p.x, p.y, p.d / 2 + clearance + maxHalf, id(p.net), 'both');
  const traces: RTrace[] = [];
  const vias: RVia[] = [];
  let failed = 0;
  const g = new Float64Array(N * 2);
  const f = new Float64Array(N * 2);
  const from = new Int32Array(N * 2);
  const seen = new Int32Array(N * 2);
  let run = 0;
  const order = [...connections].sort((a, b) => Math.hypot(a.a.x - a.b.x, a.a.y - a.b.y) - Math.hypot(b.a.x - b.b.x, b.a.y - b.b.y));
  for (const c of order) {
    run++;
    const nid = id(c.net);
    const sx = Math.round(c.a.x / grid);
    const sy = Math.round(c.a.y / grid);
    const tx = Math.round(c.b.x / grid);
    const ty = Math.round(c.b.y / grid);
    const heap: number[] = [];
    const push = (s: number) => {
      heap.push(s);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (f[heap[p]] <= f[heap[k]]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1;
          const r = l + 1;
          let m = k;
          if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l;
          if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    const hcost = (x: number, y: number) => {
      const dx = Math.abs(x - tx);
      const dy = Math.abs(y - ty);
      return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
    };
    let goal = -1;
    for (let l = 0; l < L; l++) {
      const s = l * N + sy * W + sx;
      g[s] = l * 0.5;
      f[s] = g[s] + hcost(sx, sy);
      from[s] = -1;
      seen[s] = run;
      push(s);
    }
    let iter = 0;
    while (heap.length && iter++ < 400000) {
      const s = pop();
      const l = s >= N ? 1 : 0;
      const cell = s - l * N;
      const x = cell % W;
      const y = (cell - x) / W;
      if (x === tx && y === ty) {
        goal = s;
        break;
      }
      const tryMove = (ns: number, cost: number) => {
        const ng = g[s] + cost;
        if (seen[ns] !== run || ng < g[ns]) {
          seen[ns] = run;
          g[ns] = ng;
          f[ns] = ng + hcost(ns % N % W, Math.floor((ns % N) / W));
          from[ns] = s;
          push(ns);
        }
      };
      for (const [dx, dy, dc] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nc = ny * W + nx;
        const o = occ[l][nc];
        const isEnd = (nx === tx && ny === ty) || (nx === sx && ny === sy);
        if (!isEnd && o !== -1 && o !== nid) continue;
        // Richtungswechsel leicht bestrafen
        const prev = from[s];
        let turn = 0;
        if (prev >= 0) {
          const pc = prev % N;
          const px = pc % W;
          const py = (pc - px) / W;
          if (x - px !== dx || y - py !== dy) turn = 0.4;
        }
        tryMove(l * N + nc, dc + turn + (o === nid ? -0.2 : 0) + (l === 1 ? 0.05 : 0));
      }
      // Via
      if (L === 2) {
        const other = 1 - l;
        const o = occ[other][cell];
        if (o === -1 || o === nid) tryMove(other * N + cell, 8);
      }
    }
    if (goal < 0) {
      failed++;
      continue;
    }
    // Pfad zurückverfolgen und in Lagen-Abschnitte zerlegen
    const path: { x: number; y: number; l: number }[] = [];
    for (let s = goal; s !== -1; s = from[s]) {
      const l = s >= N ? 1 : 0;
      const cell = s - l * N;
      path.push({ x: (cell % W) * grid, y: Math.floor(cell / W) * grid, l });
    }
    path.reverse();
    path[0] = { ...path[0], x: c.a.x, y: c.a.y };
    path[path.length - 1] = { ...path[path.length - 1], x: c.b.x, y: c.b.y };
    let cur: { x: number; y: number }[] = [];
    let curL = path[0].l;
    const flush = () => {
      if (cur.length >= 2) traces.push({ net: c.net, layer: curL === 0 ? 'top' : 'bottom', pts: simplifyPts(cur), width: c.width });
    };
    for (const p of path) {
      if (p.l !== curL) {
        flush();
        vias.push({ x: p.x, y: p.y, net: c.net });
        stamp(p.x, p.y, 2.2 + clearance + maxHalf, nid, 'both');
        cur = [cur[cur.length - 1] ?? p];
        curL = p.l;
      }
      cur.push({ x: p.x, y: p.y });
    }
    flush();
    // Belegung eintragen (Bahn + Abstand)
    for (const p of path) stamp(p.x, p.y, c.width / 2 + clearance + maxHalf, nid, p.l);
  }
  return { traces, vias, failed };
}

function simplifyPts(pts: { x: number; y: number }[]) {
  const out: { x: number; y: number }[] = [];
  for (const p of pts) {
    if (out.length && out[out.length - 1].x === p.x && out[out.length - 1].y === p.y) continue;
    while (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      if (Math.abs((b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x)) < 1e-6) out.pop();
      else break;
    }
    out.push(p);
  }
  return out;
}
