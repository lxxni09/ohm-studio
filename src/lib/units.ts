/** Einheiten: Werte wie „4k7“, „100uF“, „3.3V“, „1M“ verstehen und schön ausgeben. */

const PREFIX: Record<string, number> = {
  p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9, meg: 1e6,
};

export function parseValue(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return fallback;
  let s = v.trim().replace(',', '.').replace(/\s+/g, '');
  // Einheiten am Ende entfernen
  s = s.replace(/(ohm|Ω|Ohm|R$|F$|H$|V$|A$|Hz$|W$|mAh$|Ah$|s$)/, (m) => (m === 'R' ? '' : ''));
  // „4k7“, „4R7“, „3V3“
  const mid = /^(\d+)([pnuµμmkKMGR]|V)(\d+)$/.exec(s);
  if (mid) {
    const mult = mid[2] === 'R' || mid[2] === 'V' ? 1 : PREFIX[mid[2]];
    return parseFloat(`${mid[1]}.${mid[3]}`) * mult;
  }
  const m = /^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)(meg|[pnuµμmkKMG])?$/i.exec(s);
  if (!m) {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : fallback;
  }
  const base = parseFloat(m[1]);
  const p = m[2] ? PREFIX[m[2]] ?? PREFIX[m[2].toLowerCase()] ?? 1 : 1;
  return base * p;
}

export function formatValue(v: number, unit = '', digits = 3): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return `0 ${unit}`.trim();
  const a = Math.abs(v);
  const steps: [number, string][] = [
    [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'],
  ];
  for (const [f, p] of steps) {
    if (a >= f * 0.9995) {
      const n = v / f;
      const str = Number(n.toPrecision(digits)).toString().replace('.', ',');
      return `${str} ${p}${unit}`.trim();
    }
  }
  return `${v.toExponential(2)} ${unit}`;
}

/** Widerstandsfarbcodes */
export const BAND_COLORS = ['#1b1b1b', '#7a4a21', '#d22b2b', '#f07c1b', '#f5d22e', '#2f9e44', '#2563eb', '#7c3aed', '#8a8a8a', '#f5f5f5'];
export const BAND_NAMES = ['schwarz', 'braun', 'rot', 'orange', 'gelb', 'grün', 'blau', 'violett', 'grau', 'weiß'];
export const GOLD = '#c9a227';
export const SILVER = '#c0c4c8';

export function resistorBands(ohms: number, five: boolean): string[] {
  if (!(ohms > 0)) return [BAND_COLORS[0], BAND_COLORS[0], BAND_COLORS[0], GOLD];
  const digits = five ? 3 : 2;
  let exp = Math.floor(Math.log10(ohms)) - (digits - 1);
  let mant = Math.round(ohms / 10 ** exp);
  if (mant >= 10 ** digits) {
    mant = Math.round(mant / 10);
    exp++;
  }
  const ds = String(mant).padStart(digits, '0').split('').map(Number);
  const bands = ds.map((d) => BAND_COLORS[d]);
  if (exp === -1) bands.push(GOLD);
  else if (exp === -2) bands.push(SILVER);
  else bands.push(BAND_COLORS[Math.max(0, Math.min(9, exp))]);
  bands.push(five ? BAND_COLORS[1] : GOLD);
  return bands;
}

export const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];

export function nearestE24(v: number): number {
  if (!(v > 0)) return v;
  const exp = Math.floor(Math.log10(v));
  const m = v / 10 ** exp;
  let best = E24[0];
  for (const e of [...E24, 10]) if (Math.abs(Math.log(e / m)) < Math.abs(Math.log(best / m))) best = e;
  return Number((best * 10 ** exp).toPrecision(3));
}
