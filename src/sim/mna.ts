/**
 * Ohm Studio – analoger Simulationskern (Modified Nodal Analysis).
 *
 * Alle Quellen werden als Norton-Ersatzschaltungen (Leitwert + Stromquelle)
 * eingetragen, deshalb braucht das Gleichungssystem nur Knotenspannungen.
 * Nichtlineare Bauteile (Dioden, Transistoren, Regler, OpAmps) werden mit
 * Newton-Raphson linearisiert; die Jacobi-Matrix wird numerisch bestimmt.
 */

export const VT = 0.025852; // Temperaturspannung bei 300 K

export interface Device {
  /** Knotenindizes (-1 = Masse) */
  nodes: number[];
  /** Linearer Anteil, wird bei jeder Iteration gleich eingetragen */
  stampLinear?(m: Matrix, dt: number): void;
  /** Ströme, die in die Anschlüsse hineinfließen (aus dem Knoten heraus), als Funktion der Spannungen */
  currents?(v: number[]): number[];
  /** Spannungsbegrenzung je Newton-Iteration (wie pnjlim in SPICE) */
  limitVoltages?(v: number[]): number[];
  /** Begrenzungszustand zurücksetzen (neuer Lösungsversuch) */
  resetLimit?(): void;
  /** nach erfolgreichem Zeitschritt aufgerufen */
  accept?(x: Float64Array, dt: number): void;
}

export class Matrix {
  n: number;
  /** dicht (kleine Schaltungen) */
  A: Float64Array;
  /** dünnbesetzt (große Schaltungen): Zeile → Spalte → Wert */
  rows: Map<number, number>[] | null;
  b: Float64Array;
  constructor(n: number) {
    this.n = n;
    this.rows = n >= SPARSE_THRESHOLD ? Array.from({ length: n }, () => new Map<number, number>()) : null;
    this.A = this.rows ? new Float64Array(0) : new Float64Array(n * n);
    this.b = new Float64Array(n);
  }
  clear() {
    if (this.rows) for (const r of this.rows) r.clear();
    else this.A.fill(0);
    this.b.fill(0);
  }
  add(r: number, c: number, v: number) {
    if (r < 0 || c < 0) return;
    if (this.rows) {
      const row = this.rows[r];
      row.set(c, (row.get(c) ?? 0) + v);
    } else this.A[r * this.n + c] += v;
  }
  /** als dichte Matrix (Rückfallebene) */
  dense(): Float64Array {
    if (!this.rows) return this.A;
    const A = new Float64Array(this.n * this.n);
    this.rows.forEach((row, i) => row.forEach((v, j) => (A[i * this.n + j] = v)));
    return A;
  }
  solve(x: Float64Array): boolean {
    if (this.rows) return solveSparseRows(this.n, this.rows, this.b, x) || solveDense(this.n, this.dense(), this.b, x);
    return solveLinear(this.n, this.A, this.b, x);
  }
  /** Leitwert g zwischen Knoten a und b */
  G(a: number, b: number, g: number) {
    this.add(a, a, g);
    this.add(b, b, g);
    this.add(a, b, -g);
    this.add(b, a, -g);
  }
  /** Stromquelle: Strom i fließt in Knoten a hinein und aus Knoten b heraus */
  I(a: number, b: number, i: number) {
    if (a >= 0) this.b[a] += i;
    if (b >= 0) this.b[b] -= i;
  }
  /** Norton-Quelle: Spannung v (a gegenüber b) mit Innenwiderstand r */
  V(a: number, b: number, v: number, r: number) {
    const g = 1 / Math.max(r, 1e-4);
    this.G(a, b, g);
    this.I(a, b, v * g);
  }
}

/** Ab dieser Knotenzahl wird der dünnbesetzte Löser verwendet */
export let SPARSE_THRESHOLD = 48;
export function setSparseThreshold(n: number) {
  SPARSE_THRESHOLD = n;
}

/**
 * Dünnbesetzte Gauß-Elimination mit Minimum-Degree-Reihenfolge (Knoten mit wenigen Verbindungen zuerst,
 * Sammelknoten wie GND/VCC zuletzt) – vermeidet Auffüllung, Aufwand ~ O(n · Nachbarn²) statt O(n³).
 */
export function solveSparse(n: number, A: Float64Array, b: Float64Array, x: Float64Array): boolean {
  const rows: Map<number, number>[] = new Array(n);
  for (let i = 0; i < n; i++) {
    rows[i] = new Map();
    const off = i * n;
    for (let j = 0; j < n; j++) if (A[off + j] !== 0) rows[i].set(j, A[off + j]);
  }
  return solveSparseRows(n, rows, b, x);
}

function solveSparseRows(n: number, src: Map<number, number>[], b: Float64Array, x: Float64Array): boolean {
  const rows: Map<number, number>[] = new Array(n);
  const cols: Set<number>[] = new Array(n);
  for (let i = 0; i < n; i++) cols[i] = new Set();
  for (let i = 0; i < n; i++) {
    rows[i] = new Map();
    for (const [j, v] of src[i])
      if (v !== 0) {
        rows[i].set(j, v);
        cols[j].add(i);
      }
  }
  const r = b.slice();
  const done = new Uint8Array(n);
  const order: number[] = [];
  const heap = new MinHeap();
  for (let i = 0; i < n; i++) heap.push([rows[i].size + cols[i].size, i]);
  const piv = new Float64Array(n);
  for (let step = 0; step < n; step++) {
    // Kandidat mit kleinstem Grad und brauchbarem Diagonalelement (Heap mit verzögerter Aktualisierung)
    let k = -1;
    const skipped: number[] = [];
    while (heap.size()) {
      const [deg, i] = heap.pop()!;
      if (done[i] || deg !== rows[i].size + cols[i].size) continue;
      const d = Math.abs(rows[i].get(i) ?? 0);
      let mx = 0;
      for (const v of rows[i].values()) mx = Math.max(mx, Math.abs(v));
      if (d === 0 || d < 1e-9 * mx) {
        skipped.push(i);
        continue;
      }
      k = i;
      break;
    }
    for (const i of skipped) heap.push([rows[i].size + cols[i].size + 1, i]);
    if (k < 0) return false;
    const rk = rows[k];
    const d = rk.get(k)!;
    piv[k] = d;
    done[k] = 1;
    order.push(k);
    for (const i of [...cols[k]]) {
      if (done[i]) continue;
      const ri = rows[i];
      const aik = ri.get(k);
      if (aik === undefined) continue;
      const f = aik / d;
      ri.delete(k);
      cols[k].delete(i);
      if (f === 0) continue;
      for (const [j, v] of rk) {
        if (j === k) continue;
        const nv = (ri.get(j) ?? 0) - f * v;
        if (nv === 0) {
          ri.delete(j);
          cols[j].delete(i);
        } else {
          if (!ri.has(j)) cols[j].add(i);
          ri.set(j, nv);
        }
      }
      r[i] -= f * r[k];
      heap.push([ri.size + cols[i].size, i]);
    }
  }
  for (let s = n - 1; s >= 0; s--) {
    const k = order[s];
    let acc = r[k];
    for (const [j, v] of rows[k]) if (j !== k) acc -= v * x[j];
    x[k] = acc / piv[k];
    if (!Number.isFinite(x[k])) return false;
  }
  return true;
}

class MinHeap {
  private a: [number, number][] = [];
  size() {
    return this.a.length;
  }
  push(e: [number, number]) {
    const a = this.a;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Lösen von A·x = b mit Gauß-Elimination und Spaltenpivotisierung. Liefert false bei Singularität. */
export function solveLinear(n: number, A: Float64Array, b: Float64Array, x: Float64Array): boolean {
  if (n >= SPARSE_THRESHOLD && solveSparse(n, A, b, x)) return true;
  return solveDense(n, A, b, x);
}

function solveDense(n: number, A: Float64Array, b: Float64Array, x: Float64Array): boolean {
  const M = A.slice();
  const r = b.slice();
  for (let k = 0; k < n; k++) {
    let piv = k;
    let max = Math.abs(M[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(M[i * n + k]);
      if (v > max) {
        max = v;
        piv = i;
      }
    }
    if (max < 1e-18) return false;
    if (piv !== k) {
      for (let j = k; j < n; j++) {
        const t = M[k * n + j];
        M[k * n + j] = M[piv * n + j];
        M[piv * n + j] = t;
      }
      const t = r[k];
      r[k] = r[piv];
      r[piv] = t;
    }
    const d = M[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const f = M[i * n + k] / d;
      if (f === 0) continue;
      for (let j = k; j < n; j++) M[i * n + j] -= f * M[k * n + j];
      r[i] -= f * r[k];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = r[i];
    for (let j = i + 1; j < n; j++) s -= M[i * n + j] * x[j];
    x[i] = s / M[i * n + i];
  }
  return true;
}

export interface SolveResult {
  ok: boolean;
  iterations: number;
}

export class Circuit {
  nodeCount: number;
  devices: Device[] = [];
  x: Float64Array;
  private m: Matrix;
  gmin = 1e-9;

  constructor(nodeCount: number) {
    this.nodeCount = nodeCount;
    this.x = new Float64Array(nodeCount);
    this.m = new Matrix(nodeCount);
  }

  resize(n: number) {
    const old = this.x;
    this.nodeCount = n;
    this.x = new Float64Array(n);
    if (old.length === n) this.x.set(old);
    this.m = new Matrix(n);
  }

  add<T extends Device>(d: T): T {
    this.devices.push(d);
    return d;
  }

  voltage(node: number): number {
    return node < 0 ? 0 : this.x[node];
  }

  /** Ein Zeitschritt (dt in Sekunden, dt = Infinity für Arbeitspunkt) */
  solve(dt: number, maxIter = 80, commit = true): SolveResult {
    const n = this.nodeCount;
    if (n === 0) {
      if (commit) for (const d of this.devices) d.accept?.(this.x, dt);
      return { ok: true, iterations: 0 };
    }
    const m = this.m;
    const xNew = new Float64Array(n);
    const nonlinear = this.devices.filter((d) => d.currents);
    let ok = false;
    let it = 0;
    let lim = 1.0;
    const x0 = this.x.slice();
    let prevSign: Int8Array | null = null;
    const sign = new Int8Array(n);
    for (; it < maxIter; it++) {
      m.clear();
      for (let i = 0; i < n; i++) m.add(i, i, this.gmin);
      for (const d of this.devices) d.stampLinear?.(m, dt);
      for (const d of nonlinear) stampNonlinear(m, d, this.x);
      if (!m.solve(xNew)) {
        // Notfall: stärkere Erdung, dann noch einmal versuchen
        for (let i = 0; i < n; i++) m.add(i, i, 1e-6);
        if (!m.solve(xNew)) break;
      }
      let maxDelta = 0;
      for (let i = 0; i < n; i++) {
        const dlt = xNew[i] - this.x[i];
        if (!Number.isFinite(dlt)) {
          xNew[i] = this.x[i];
          continue;
        }
        maxDelta = Math.max(maxDelta, Math.abs(dlt));
      }
      if (nonlinear.length === 0) {
        this.x.set(xNew);
        ok = true;
        it++;
        break;
      }
      // Dämpfung: große Sprünge begrenzen; bei Hin-und-her-Springen Schrittweite halbieren
      let flips = 0;
      for (let i = 0; i < n; i++) {
        const dl = xNew[i] - this.x[i];
        sign[i] = Math.abs(dl) < 1e-3 ? 0 : dl > 0 ? 1 : -1;
        if (prevSign && sign[i] !== 0 && prevSign[i] === -sign[i]) flips++;
      }
      if (flips > 0 && maxDelta > 0.01) lim = Math.max(0.005, lim * 0.5);
      else lim = Math.min(2, lim * 1.6);
      prevSign = prevSign ?? new Int8Array(n);
      prevSign.set(sign);
      const scale = maxDelta > lim ? lim / maxDelta : 1;
      for (let i = 0; i < n; i++) this.x[i] += (xNew[i] - this.x[i]) * scale;
      if (maxDelta < 1e-6) {
        ok = true;
        it++;
        break;
      }
    }
    if (!ok) {
      let bad = false;
      for (let i = 0; i < n; i++) if (!Number.isFinite(this.x[i]) || Math.abs(this.x[i]) > 1e4) bad = true;
      if (bad) this.x.set(x0);
    }
    if (commit) for (const d of this.devices) d.accept?.(this.x, dt);
    return { ok, iterations: it };
  }
}

/** SPICE-artige Begrenzung der Sperrschichtspannung */
export function pnjlim(vnew: number, vold: number, vt: number, vcrit: number): number {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      return arg > 0 ? vold + vt * Math.log(arg) : vcrit;
    }
    return vt * Math.log(Math.max(vnew / vt, 1e-30));
  }
  return vnew;
}

const H = 1e-6;
function stampNonlinear(m: Matrix, d: Device, x: Float64Array) {
  const k = d.nodes.length;
  let v = d.nodes.map((nd) => (nd < 0 ? 0 : x[nd]));
  if (d.limitVoltages) v = d.limitVoltages(v);
  const i0 = d.currents!(v);
  // Effizienter: zweiter Durchlauf mit gespeicherter Jacobi-Matrix
  const J: number[][] = [];
  for (let j = 0; j < k; j++) {
    J.push(new Array(k).fill(0));
  }
  for (let j = 0; j < k; j++) {
    const vj = v[j];
    v[j] = vj + H;
    const i1 = d.currents!(v);
    v[j] = vj;
    for (let r = 0; r < k; r++) {
      const g = (i1[r] - i0[r]) / H;
      J[r][j] = g;
      if (g !== 0 && d.nodes[j] >= 0) m.add(d.nodes[r], d.nodes[j], g);
    }
  }
  for (let r = 0; r < k; r++) {
    const row = d.nodes[r];
    if (row < 0) continue;
    // Linearisierung um den (ggf. begrenzten) Punkt v: I ≈ i0 + J·(x − v); Masse hat x = 0
    let jv = 0;
    for (let j = 0; j < k; j++) jv += J[r][j] * v[j];
    m.b[row] -= i0[r] - jv;
  }
}

/* ------------------------------------------------------------------ */
/* Bauteilmodelle                                                      */
/* ------------------------------------------------------------------ */

export class Resistor implements Device {
  nodes: number[];
  constructor(a: number, b: number, public r: number) {
    this.nodes = [a, b];
  }
  stampLinear(m: Matrix) {
    m.G(this.nodes[0], this.nodes[1], 1 / Math.max(this.r, 1e-4));
  }
  current(x: Float64Array) {
    const [a, b] = this.nodes;
    return ((a < 0 ? 0 : x[a]) - (b < 0 ? 0 : x[b])) / Math.max(this.r, 1e-4);
  }
}

/** Spannungsquelle mit Innenwiderstand (Norton) – v = V(a) − V(b) */
export class Source implements Device {
  nodes: number[];
  constructor(a: number, b: number, public v: number, public r: number) {
    this.nodes = [a, b];
  }
  stampLinear(m: Matrix) {
    m.V(this.nodes[0], this.nodes[1], this.v, this.r);
  }
  /** Strom, der aus Klemme a heraus in die Schaltung fließt */
  current(x: Float64Array) {
    const [a, b] = this.nodes;
    const vab = (a < 0 ? 0 : x[a]) - (b < 0 ? 0 : x[b]);
    return (this.v - vab) / Math.max(this.r, 1e-4);
  }
}

export class CurrentSource implements Device {
  nodes: number[];
  /** Strom i fließt von a durch die Quelle nach b (verlässt Knoten a) */
  constructor(a: number, b: number, public i: number) {
    this.nodes = [a, b];
  }
  stampLinear(m: Matrix) {
    m.I(this.nodes[1], this.nodes[0], this.i);
  }
}

export class Capacitor implements Device {
  nodes: number[];
  vPrev = 0;
  v = 0;
  i = 0;
  constructor(a: number, b: number, public c: number, public esr = 0.01) {
    this.nodes = [a, b];
  }
  stampLinear(m: Matrix, dt: number) {
    if (!Number.isFinite(dt)) return; // Gleichstrom: offen
    const g = this.c / dt;
    // Reihen-ESR berücksichtigt: Thevenin → Norton
    const geff = 1 / (1 / g + this.esr);
    m.G(this.nodes[0], this.nodes[1], geff);
    m.I(this.nodes[0], this.nodes[1], geff * this.vPrev);
  }
  accept(x: Float64Array, dt: number) {
    const [a, b] = this.nodes;
    const vab = (a < 0 ? 0 : x[a]) - (b < 0 ? 0 : x[b]);
    if (!Number.isFinite(dt)) {
      this.vPrev = this.v = vab;
      return;
    }
    const g = this.c / dt;
    const geff = 1 / (1 / g + this.esr);
    const i = geff * (vab - this.vPrev);
    this.i = i;
    this.v = this.vPrev + i / g;
    this.vPrev = this.v;
  }
}

export class Inductor implements Device {
  nodes: number[];
  iPrev = 0;
  constructor(a: number, b: number, public l: number, public rs = 0.05) {
    this.nodes = [a, b];
  }
  stampLinear(m: Matrix, dt: number) {
    if (!Number.isFinite(dt)) {
      m.G(this.nodes[0], this.nodes[1], 1 / this.rs);
      return;
    }
    const g = 1 / (this.l / dt + this.rs);
    m.G(this.nodes[0], this.nodes[1], g);
    // Strom fließt weiter von a nach b
    m.I(this.nodes[1], this.nodes[0], this.iPrev * (this.l / dt) * g);
  }
  accept(x: Float64Array, dt: number) {
    const [a, b] = this.nodes;
    const vab = (a < 0 ? 0 : x[a]) - (b < 0 ? 0 : x[b]);
    if (!Number.isFinite(dt)) {
      this.iPrev = vab / this.rs;
      return;
    }
    const g = 1 / (this.l / dt + this.rs);
    this.iPrev = g * vab + this.iPrev * (this.l / dt) * g;
  }
}

/** sichere Exponentialfunktion mit linearer Fortsetzung */
export function limexp(x: number): number {
  const XL = 90;
  if (x < XL) return Math.exp(x);
  const e = Math.exp(XL);
  return e * (1 + x - XL);
}

export interface DiodeParams {
  is: number;
  n: number;
  rs?: number;
  /** Zener-/Durchbruchspannung (positiv) */
  bv?: number;
}

/** Diodenparameter aus gewünschter Flussspannung bei gegebenem Strom ableiten */
export function diodeFromVf(vf: number, atCurrent: number, n: number, bv?: number): DiodeParams {
  return { is: atCurrent / Math.exp(vf / (n * VT)), n, bv };
}

export class Diode implements Device {
  nodes: number[];
  i = 0;
  private vdLast = 0;
  private vcrit: number;
  constructor(anode: number, cathode: number, public p: DiodeParams) {
    this.nodes = [anode, cathode];
    const nvt = p.n * VT;
    this.vcrit = nvt * Math.log(nvt / (Math.SQRT2 * p.is));
  }
  limitVoltages(v: number[]) {
    const vd = v[0] - v[1];
    const nvt = this.p.n * VT;
    let vl = pnjlim(vd, this.vdLast, nvt, this.vcrit);
    // Durchbruch spiegelbildlich begrenzen
    if (this.p.bv && vl < -this.p.bv && this.vdLast < 0 && Math.abs(vl - this.vdLast) > 0.5) vl = this.vdLast - 0.5 * Math.sign(this.vdLast - vl);
    this.vdLast = vl;
    return vl === vd ? v : [v[1] + vl, v[1]];
  }
  stampLinear(m: Matrix) {
    m.G(this.nodes[0], this.nodes[1], 1e-12);
  }
  currents(v: number[]) {
    const vd = v[0] - v[1];
    const i = diodeI(this.p, vd);
    return [i, -i];
  }
  accept(x: Float64Array) {
    const [a, k] = this.nodes;
    this.i = diodeI(this.p, (a < 0 ? 0 : x[a]) - (k < 0 ? 0 : x[k]));
  }
}

export function diodeI(p: DiodeParams, vd: number): number {
  const nvt = p.n * VT;
  let i = p.is * (limexp(vd / nvt) - 1);
  if (p.bv && vd < -p.bv * 0.5) {
    // weicher Durchbruch: ~5 Ω oberhalb der Durchbruchspannung
    const s = 0.04;
    const x = (-vd - p.bv) / s;
    const sp = x > 30 ? x : Math.log1p(Math.exp(x));
    i -= (sp * s) / 5;
  }
  // Serienwiderstand näherungsweise: Strom bei hohen Werten begrenzen
  if (p.rs && i > 0) {
    const ilim = Math.max(vd, 0) / p.rs;
    i = (i * ilim) / (i + ilim + 1e-30);
  }
  return i;
}

export interface BjtParams {
  pnp: boolean;
  is: number;
  bf: number;
  br: number;
  /** Darlington: doppelte Flussspannung */
  darlington?: boolean;
}

/** Ebers-Moll-Transportmodell. Knoten: C, B, E */
export class Bjt implements Device {
  nodes: number[];
  ic = 0;
  ib = 0;
  private vbeLast = 0;
  private vbcLast = 0;
  constructor(c: number, b: number, e: number, public p: BjtParams) {
    this.nodes = [c, b, e];
  }
  limitVoltages(v: number[]) {
    const s = this.p.pnp ? -1 : 1;
    const nvt = (this.p.darlington ? 2 : 1) * VT;
    const vcrit = nvt * Math.log(nvt / (Math.SQRT2 * this.p.is));
    const vbe = s * (v[1] - v[2]);
    const vbc = s * (v[1] - v[0]);
    const lbe = pnjlim(vbe, this.vbeLast, nvt, vcrit);
    const lbc = pnjlim(vbc, this.vbcLast, nvt, vcrit);
    this.vbeLast = lbe;
    this.vbcLast = lbc;
    if (lbe === vbe && lbc === vbc) return v;
    // Basis festhalten, C und E so verschieben, dass die begrenzten Spannungen gelten
    return [v[1] - s * lbc, v[1], v[1] - s * lbe];
  }
  stampLinear(m: Matrix) {
    m.G(this.nodes[0], this.nodes[2], 1e-10);
    m.G(this.nodes[1], this.nodes[2], 1e-12);
  }
  currents(v: number[]) {
    const s = this.p.pnp ? -1 : 1;
    const vbe = s * (v[1] - v[2]);
    const vbc = s * (v[1] - v[0]);
    const nf = this.p.darlington ? 2 : 1;
    const iF = this.p.is * (limexp(vbe / (nf * VT)) - 1);
    const iR = this.p.is * (limexp(vbc / (nf * VT)) - 1);
    const bf = this.p.bf;
    const br = this.p.br;
    const ic = iF - iR - iR / br;
    const ib = iF / bf + iR / br;
    // Ströme in die Klemmen hinein (aus dem Knoten heraus): C, B, E
    return [s * ic, s * ib, -s * (ic + ib)];
  }
  accept(x: Float64Array) {
    const v = this.nodes.map((nd) => (nd < 0 ? 0 : x[nd]));
    const c = this.currents(v);
    const s = this.p.pnp ? -1 : 1;
    this.ic = s * c[0];
    this.ib = s * c[1];
  }
}

export interface MosParams {
  pch: boolean;
  vth: number;
  k: number; // A/V²
  lambda?: number;
  rdsOn?: number;
}

/** Quadratisches MOSFET-Modell. Knoten: D, G, S */
export class Mosfet implements Device {
  nodes: number[];
  id = 0;
  constructor(d: number, g: number, s: number, public p: MosParams) {
    this.nodes = [d, g, s];
  }
  stampLinear(m: Matrix) {
    m.G(this.nodes[0], this.nodes[2], 1e-9);
  }
  currents(v: number[]) {
    const sg = this.p.pch ? -1 : 1;
    let vd = sg * v[0];
    const vg = sg * v[1];
    let vs = sg * v[2];
    let flip = 1;
    if (vd < vs) {
      const t = vd;
      vd = vs;
      vs = t;
      flip = -1;
    }
    const vgs = vg - vs;
    const vds = vd - vs;
    const vov = vgs - this.p.vth;
    let id = 0;
    // weicher Übergang unterhalb der Schwelle
    const vovs = vov > 0 ? vov : 0;
    const sub = 1e-7 * Math.exp(Math.min(vov, 0) / (2 * VT));
    if (vovs <= 0) id = sub * (1 - Math.exp(-vds / VT));
    else if (vds < vovs) id = this.p.k * (vovs * vds - (vds * vds) / 2) + sub;
    else id = (this.p.k / 2) * vovs * vovs * (1 + (this.p.lambda ?? 0.01) * vds) + sub;
    if (this.p.rdsOn && vovs > 0) {
      const imax = vds / this.p.rdsOn;
      if (vds < vovs) id = Math.min(id, imax + sub);
    }
    const i = sg * flip * id;
    return [i, 0, -i];
  }
  accept(x: Float64Array) {
    const v = this.nodes.map((nd) => (nd < 0 ? 0 : x[nd]));
    this.id = this.currents(v)[0] * (this.p.pch ? -1 : 1);
  }
}

/** Spannungsregler (Linearregler). Knoten: IN, GND, OUT */
export class Regulator implements Device {
  nodes: number[];
  iout = 0;
  constructor(inp: number, gnd: number, out: number, public vset: number, public dropout = 1.1, public iq = 0.005, public rout = 0.05) {
    this.nodes = [inp, gnd, out];
  }
  stampLinear(m: Matrix) {
    m.G(this.nodes[0], this.nodes[1], 1e-7);
  }
  currents(v: number[]) {
    const vin = v[0] - v[1];
    const avail = vin - this.dropout;
    // weiches Minimum zwischen Sollwert und verfügbarer Spannung
    const k = 0.05;
    const tgt = Math.max(0, -k * Math.log(Math.exp(-this.vset / k) + Math.exp(-Math.max(avail, -5) / k)));
    let iout = (tgt - (v[2] - v[1])) / this.rout; // aus OUT heraus in die Schaltung
    // Linearregler können kaum Strom aufnehmen (nur liefern)
    if (iout < 0) iout *= 1e-5;
    const iSrc = Math.max(iout, 0);
    const iq = vin > 0.5 ? this.iq : 0;
    // in Klemmen hinein: IN zieht iSrc+iq, OUT liefert iout, GND nimmt den Rest
    return [iSrc + iq, -(iSrc + iq) + iout, -iout];
  }
  accept(x: Float64Array) {
    const v = this.nodes.map((nd) => (nd < 0 ? 0 : x[nd]));
    this.iout = -this.currents(v)[2];
  }
}

/** Operationsverstärker (Verhaltensmodell). Knoten: IN+, IN−, OUT, V+, V− */
export class OpAmp implements Device {
  nodes: number[];
  constructor(p: number, n: number, out: number, vp: number, vn: number, public gain = 2e4, public headroom = 1.5) {
    this.nodes = [p, n, out, vp, vn];
  }
  stampLinear(m: Matrix) {
    m.G(this.nodes[0], this.nodes[4], 1e-9);
    m.G(this.nodes[1], this.nodes[4], 1e-9);
  }
  currents(v: number[]) {
    const lo = v[4] + 0.02;
    const hi = Math.max(lo, v[3] - this.headroom);
    const mid = (hi + lo) / 2;
    const half = Math.max((hi - lo) / 2, 1e-3);
    const tgt = mid + half * Math.tanh((this.gain * (v[0] - v[1])) / half);
    const iout = (tgt - v[2]) / 50; // aus OUT heraus
    const isup = Math.abs(iout) + 0.0007;
    return [0, 0, -iout, isup, -isup + iout];
  }
}

/** Komparator mit Open-Collector-ähnlichem Ausgang als Hilfsmodell */
export class Switch implements Device {
  nodes: number[];
  constructor(a: number, b: number, public closed: boolean, public ron = 0.05, public roff = 1e9) {
    this.nodes = [a, b];
  }
  stampLinear(m: Matrix) {
    m.G(this.nodes[0], this.nodes[1], 1 / (this.closed ? this.ron : this.roff));
  }
  current(x: Float64Array) {
    const [a, b] = this.nodes;
    return ((a < 0 ? 0 : x[a]) - (b < 0 ? 0 : x[b])) / (this.closed ? this.ron : this.roff);
  }
}

/** Ströme in die Anschlüsse eines Bauelements (für Lernmodus/Strompfeile) */
export function terminalCurrents(d: Device, x: Float64Array): number[] {
  const v = d.nodes.map((n) => (n < 0 ? 0 : x[n]));
  if (d.currents) return d.currents(v);
  if (d instanceof Resistor) {
    const i = (v[0] - v[1]) / Math.max(d.r, 1e-4);
    return [i, -i];
  }
  if (d instanceof Source) {
    const i = d.current(x);
    return [-i, i];
  }
  if (d instanceof CurrentSource) return [d.i, -d.i];
  if (d instanceof Capacitor) return [d.i, -d.i];
  if (d instanceof Inductor) return [d.iPrev, -d.iPrev];
  if (d instanceof Switch) {
    const i = d.current(x);
    return [i, -i];
  }
  return d.nodes.map(() => 0);
}
