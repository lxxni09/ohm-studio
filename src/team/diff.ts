/**
 * Visueller Vergleich zweier Projektstände: Teile, Werte, Positionen, Verbindungen, Code.
 */
import type { Project } from '../ohm/model';

export type ChangeKind = 'neu' | 'entfernt' | 'geaendert' | 'verschoben';

export interface PartChange {
  id: string;
  kind: ChangeKind;
  details: string[];
}

export interface ProjectDiff {
  parts: PartChange[];
  netsAdded: string[];
  netsRemoved: string[];
  netsChanged: { name: string; added: string[]; removed: string[] }[];
  code: { ziel: string; lines: DiffLine[] }[];
  meta: string[];
  empty: boolean;
}

export interface DiffLine {
  op: ' ' | '+' | '-';
  text: string;
}

/** Zeilen-Diff über die längste gemeinsame Teilfolge */
export function lineDiff(a: string, b: string): DiffLine[] {
  const A = a.split('\n');
  const B = b.split('\n');
  const n = A.length;
  const m = B.length;
  if (n * m > 4_000_000) return [...A.map((t) => ({ op: '-' as const, text: t })), ...B.map((t) => ({ op: '+' as const, text: t }))];
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ op: ' ', text: A[i] });
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: '-', text: A[i++] });
    else out.push({ op: '+', text: B[j++] });
  }
  while (i < n) out.push({ op: '-', text: A[i++] });
  while (j < m) out.push({ op: '+', text: B[j++] });
  return out;
}

const fmt = (v: unknown) => (typeof v === 'object' ? JSON.stringify(v) : String(v));

export function diffProjects(a: Project, b: Project): ProjectDiff {
  const parts: PartChange[] = [];
  const am = new Map(a.parts.map((p) => [p.id, p]));
  const bm = new Map(b.parts.map((p) => [p.id, p]));
  for (const p of b.parts) if (!am.has(p.id)) parts.push({ id: p.id, kind: 'neu', details: [p.type] });
  for (const p of a.parts) if (!bm.has(p.id)) parts.push({ id: p.id, kind: 'entfernt', details: [p.type] });
  for (const p of b.parts) {
    const o = am.get(p.id);
    if (!o) continue;
    const d: string[] = [];
    if (o.type !== p.type) d.push(`Typ ${o.type} → ${p.type}`);
    for (const k of new Set([...Object.keys(o.props), ...Object.keys(p.props)])) if (fmt(o.props[k]) !== fmt(p.props[k])) d.push(`${k}: ${o.props[k] ?? '—'} → ${p.props[k] ?? '—'}`);
    if (d.length) parts.push({ id: p.id, kind: 'geaendert', details: d });
    else if (Math.hypot(o.x - p.x, o.y - p.y) > 0.5 || o.rot !== p.rot) parts.push({ id: p.id, kind: 'verschoben', details: [o.rot !== p.rot ? `gedreht ${o.rot}° → ${p.rot}°` : 'verschoben'] });
  }
  const an = new Map(a.nets.map((n) => [n.name, new Set(n.pins)]));
  const bn = new Map(b.nets.map((n) => [n.name, new Set(n.pins)]));
  const netsAdded = [...bn.keys()].filter((k) => !an.has(k));
  const netsRemoved = [...an.keys()].filter((k) => !bn.has(k));
  const netsChanged: ProjectDiff['netsChanged'] = [];
  for (const [k, pins] of bn) {
    const o = an.get(k);
    if (!o) continue;
    const added = [...pins].filter((p) => !o.has(p));
    const removed = [...o].filter((p) => !pins.has(p));
    if (added.length || removed.length) netsChanged.push({ name: k, added, removed });
  }
  const code: ProjectDiff['code'] = [];
  const ac = new Map(a.code.map((c) => [c.ziel, c.datei]));
  for (const c of b.code) {
    const old = ac.get(c.ziel) ?? '';
    if (old !== c.datei) code.push({ ziel: c.ziel, lines: lineDiff(old, c.datei) });
  }
  for (const c of a.code) if (!b.code.some((x) => x.ziel === c.ziel)) code.push({ ziel: c.ziel, lines: lineDiff(c.datei, '') });
  const meta: string[] = [];
  if (a.name !== b.name) meta.push(`Name: ${a.name} → ${b.name}`);
  if (fmt(a.views.platine) !== fmt(b.views.platine)) meta.push('Platineneinstellungen geändert');
  if (fmt(a.variants) !== fmt(b.variants)) meta.push('Varianten geändert');
  return { parts, netsAdded, netsRemoved, netsChanged, code, meta, empty: !parts.length && !netsAdded.length && !netsRemoved.length && !netsChanged.length && !code.length && !meta.length };
}

export function diffSummary(d: ProjectDiff): string {
  if (d.empty) return 'keine Änderungen';
  const c = (k: ChangeKind) => d.parts.filter((p) => p.kind === k).length;
  const bits = [c('neu') && `${c('neu')} neu`, c('entfernt') && `${c('entfernt')} entfernt`, c('geaendert') && `${c('geaendert')} geändert`, c('verschoben') && `${c('verschoben')} verschoben`, d.netsAdded.length + d.netsRemoved.length + d.netsChanged.length && `${d.netsAdded.length + d.netsRemoved.length + d.netsChanged.length} Netze`, d.code.length && 'Code'].filter(Boolean);
  return bits.join(' · ');
}
