import { BASIC_PARTS } from './library/basic';
import { BOARD_PARTS } from './library/boardParts';
import { MODULE_PARTS } from './library/modules';
import { IC_PARTS } from './library/ics';
import { EXTRA_PARTS } from './library/extra';
import { BOARD_ALIASES } from './boards';
import type { PartDef, PinDef } from './types';
import { parseValue } from '../lib/units';
import { searchCatalog } from './catalog';

export const ALL_PARTS: PartDef[] = [...BOARD_PARTS, ...BASIC_PARTS, ...MODULE_PARTS, ...IC_PARTS, ...EXTRA_PARTS];

const norm = (s: string) =>
  String(s)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[\s_]+/g, '-');

const index = new Map<string, PartDef>();
for (const p of ALL_PARTS) {
  index.set(norm(p.type), p);
  for (const a of p.aliases ?? []) if (!index.has(norm(a))) index.set(norm(a), p);
}
for (const [a, t] of Object.entries(BOARD_ALIASES)) {
  const p = index.get(norm(t));
  if (p && !index.has(norm(a))) index.set(norm(a), p);
}

/** Bauteil zur Laufzeit registrieren (eigene Bauteile aus Projekten oder dem Datenblatt-Leser) */
export function registerPart(def: PartDef) {
  const k = norm(def.type);
  const old = index.get(k);
  if (old) ALL_PARTS.splice(ALL_PARTS.indexOf(old), 1);
  ALL_PARTS.push(def);
  index.set(k, def);
}

export function getPart(type: string): PartDef | undefined {
  return index.get(norm(type));
}

/** ähnliche Typen für Fehlermeldungen („Meintest du …?“) */
export function suggestTypes(type: string, n = 3): string[] {
  const t = norm(type);
  const scored = [...index.keys()].map((k) => ({ k, d: levenshtein(t, k) - (k.includes(t) || t.includes(k) ? 3 : 0) }));
  scored.sort((a, b) => a.d - b.d);
  const out: string[] = [];
  for (const s of scored) {
    const p = index.get(s.k)!;
    if (!out.includes(p.type)) out.push(p.type);
    if (out.length >= n) break;
  }
  return out;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

export interface SearchHit {
  part: PartDef;
  score: number;
  /** Bezeichnung einer Katalogvariante */
  variant?: string;
  /** vorbelegte Eigenschaften aus der Suche (z. B. „widerstand 1k“) */
  preset?: Record<string, unknown>;
}

export function searchParts(q: string): SearchHit[] {
  const tokens = norm(q)
    .split(/[-\s]+/)
    .filter(Boolean);
  if (!tokens.length) return ALL_PARTS.map((p) => ({ part: p, score: 0 }));
  const hits: SearchHit[] = [];
  for (const p of ALL_PARTS) {
    const hay = norm(`${p.type} ${p.name} ${(p.aliases ?? []).join(' ')} ${p.keywords ?? ''} ${p.category}`);
    let score = 0;
    let preset: Record<string, unknown> | undefined;
    let ok = true;
    for (const t of tokens) {
      if (hay.includes(t)) {
        score += norm(p.name).includes(t) || norm(p.type).includes(t) ? 3 : 1;
        if (norm(p.type) === t) score += 5;
        continue;
      }
      // Wert-Token wie „1k“, „100uf“, „5mm“
      if (/^\d/.test(t) && !/^0\d{3}$/.test(t) && p.props?.some((pp) => pp.type === 'value')) {
        const pp = p.props.find((x) => x.type === 'value')!;
        const v = parseValue(t, NaN);
        if (Number.isFinite(v)) {
          preset = { ...(preset ?? {}), [pp.key]: t };
          score += 1;
          continue;
        }
      }
      // Farbe für LEDs
      if (p.type === 'led' && ['rot', 'gruen', 'blau', 'gelb', 'weiss', 'orange', 'red', 'green', 'blue'].includes(t)) {
        preset = { ...(preset ?? {}), farbe: t };
        score += 1;
        continue;
      }
      ok = false;
      break;
    }
    if (ok) hits.push({ part: p, score, preset });
  }
  hits.sort((a, b) => b.score - a.score);
  // Konkrete Bestellvarianten aus dem Katalog (über 10 000)
  if (tokens.length >= 2 || (tokens[0] && /\d/.test(tokens[0]))) {
    for (const e of searchCatalog(q, 25)) {
      const def = getPart(e.type);
      if (def) hits.push({ part: def, score: 0, preset: e.preset, variant: `${e.name} · ${e.mpn}` });
    }
  }
  return hits;
}

/** Pin eines Bauteils anhand von Name/Alias finden (Groß-/Kleinschreibung egal) */
export function findPin(def: PartDef, props: Record<string, unknown>, name: string): PinDef | undefined {
  const pins = def.pins(props);
  const n = String(name).toUpperCase();
  return (
    pins.find((p) => p.id.toUpperCase() === n) ??
    pins.find((p) => (p.aliases ?? []).some((a) => a.toUpperCase() === n)) ??
    pins.find((p) => (p.label ?? '').toUpperCase() === n) ??
    // GPIO-Zahl direkt
    (/^\d+$/.test(n) ? pins.find((p) => p.gpio === Number(n) && !p.power) : undefined)
  );
}

export function partDefaults(def: PartDef, preset?: Record<string, unknown>): Record<string, unknown> {
  return { ...def.defaults, ...(preset ?? {}) };
}
