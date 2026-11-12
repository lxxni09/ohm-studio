/**
 * Bauteilkatalog: über 10 000 konkrete Bestellvarianten (E-Reihen, Gehäuse, Spannungen, Toleranzen, Farben)
 * auf Basis der simulierbaren Grundtypen. Jede Variante setzt die passenden Eigenschaften und trägt eine
 * herstellertypische Teilenummer für Stückliste und Einkauf.
 */
export interface CatalogEntry {
  /** Grundtyp (simulierbar) */
  type: string;
  preset: Record<string, unknown>;
  name: string;
  mpn: string;
  pkg: string;
  price: number;
}

const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
const E96 = [100, 102, 105, 107, 110, 113, 115, 118, 121, 124, 127, 130, 133, 137, 140, 143, 147, 150, 154, 158, 162, 165, 169, 174, 178, 182, 187, 191, 196, 200, 205, 210, 215, 221, 226, 232, 237, 243, 249, 255, 261, 267, 274, 280, 287, 294, 301, 309, 316, 324, 332, 340, 348, 357, 365, 374, 383, 392, 402, 412, 422, 432, 442, 453, 464, 475, 487, 499, 511, 523, 536, 549, 562, 576, 590, 604, 619, 634, 649, 665, 681, 698, 715, 732, 750, 768, 787, 806, 825, 845, 866, 887, 909, 931, 953, 976].map((x) => x / 100);
const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
const E6 = [1.0, 1.5, 2.2, 3.3, 4.7, 6.8];

function eng(v: number, unit: string): string {
  const pre: [number, string][] = [
    [1e6, 'M'],
    [1e3, 'k'],
    [1, ''],
    [1e-3, 'm'],
    [1e-6, 'u'],
    [1e-9, 'n'],
    [1e-12, 'p'],
  ];
  for (const [f, p] of pre)
    if (v >= f * 0.999) {
      const n = Math.round((v / f) * 100) / 100;
      return `${String(n).replace('.', unit === 'Ω' && !p ? 'R' : ',')}${p}${unit === 'Ω' ? '' : unit}`;
    }
  return `${v}${unit}`;
}

let cache: CatalogEntry[] | null = null;

export function catalog(): CatalogEntry[] {
  if (cache) return cache;
  const out: CatalogEntry[] = [];
  // Widerstände: E24 (5 %) und E96 (1 %) × 1 Ω … 9,76 MΩ × 8 Bauformen
  const rPk: [string, string, number][] = [
    ['0.25W', 'THT 0207', 0.02],
    ['0.5W', 'THT 0309', 0.04],
    ['1W', 'THT 0414', 0.08],
    ['0.125W', 'SMD 0402', 0.004],
    ['0.125W', 'SMD 0603', 0.005],
    ['0.125W', 'SMD 0805', 0.006],
    ['0.25W', 'SMD 1206', 0.01],
    ['1W', 'SMD 2512', 0.05],
  ];
  for (let dec = 0; dec <= 6; dec++)
    for (const tol of ['1%', '5%'])
      for (const m of tol === '1%' ? E96 : E24)
        for (const [p, pkg, price] of rPk) {
          const v = m * 10 ** dec;
          const val = eng(v, 'Ω');
          out.push({ type: 'widerstand', preset: { wert: val.replace('R', ',').replace(/,$/, ''), leistung: p, toleranz: tol, ringe: tol === '1%' ? 5 : 4 }, name: `Widerstand ${val} ${tol} ${pkg}`, mpn: `${pkg.startsWith('SMD') ? 'RC' + pkg.slice(4) : 'MFR' + pkg.slice(4)}-${tol === '1%' ? 'F' : 'J'}-${val}`, pkg, price: price * (tol === '1%' ? 1.3 : 1) });
        }
  // Keramikkondensatoren: E12 × 1 pF … 8,2 µF × 3 Spannungen × 3 Bauformen
  for (let dec = -12; dec <= -6; dec++)
    for (const m of E12)
      for (const u of ['16V', '50V', '100V'])
        for (const pkg of ['SMD 0603', 'SMD 0805', 'THT 2,54'])
          for (const d of ['X7R', 'C0G']) {
            const v = m * 10 ** dec;
            if (v > 1e-5 || (d === 'C0G' && v > 1e-7)) continue;
            const val = eng(v, 'F');
            out.push({ type: 'kondensator', preset: { wert: val, spannung: u }, name: `Kondensator ${val} ${u} ${d} ${pkg}`, mpn: `CL-${pkg.slice(-4)}-${d}-${val}-${u}`, pkg, price: 0.01 + (v > 1e-7 ? 0.03 : 0) + (d === 'C0G' ? 0.01 : 0) });
          }
  // Elkos: E6 × 0,1 µF … 6,8 mF × 7 Spannungen × 2 Temperaturklassen
  for (let dec = -7; dec <= -3; dec++)
    for (const m of E6)
      for (const u of ['6.3V', '10V', '16V', '25V', '35V', '50V', '63V'])
        for (const t of ['85°C', '105°C'])
          for (const ser of ['Standard', 'Low-ESR']) {
            const v = m * 10 ** dec;
            const val = eng(v, 'F');
            out.push({ type: 'elko', preset: { wert: val, spannung: u }, name: `Elko ${val} ${u} ${t} ${ser}`, mpn: `EEU-${ser === 'Low-ESR' ? (t === '105°C' ? 'FM' : 'FC') : t === '105°C' ? 'FR' : 'EB'}${u.replace('.', 'V')}-${val}`, pkg: 'radial', price: (0.05 + v * 20) * (ser === 'Low-ESR' ? 1.6 : 1) });
          }
  // Folienkondensatoren
  for (let dec = -9; dec <= -6; dec++)
    for (const m of E6)
      for (const u of ['63V', '100V', '250V', '400V']) {
        const val = eng(m * 10 ** dec, 'F');
        out.push({ type: 'folienkondensator', preset: { wert: val, spannung: u }, name: `Folienkondensator ${val} ${u}`, mpn: `MKS2-${u}-${val}`, pkg: 'RM5', price: 0.15 });
      }
  // Spulen
  for (let dec = -6; dec <= -2; dec++)
    for (const m of E12)
      for (const pkg of ['axial', 'radial', 'SMD 1210']) {
        const val = eng(m * 10 ** dec, 'H');
        out.push({ type: 'spule', preset: { wert: val }, name: `Spule ${val} ${pkg}`, mpn: `744-${pkg.slice(0, 3)}-${val}`, pkg, price: 0.2 });
      }
  // LEDs: Farben × Größen × Helligkeitsklassen
  const colors = ['rot', 'gruen', 'echt-gruen', 'blau', 'gelb', 'orange', 'weiss', 'warmweiss', 'violett', 'infrarot', 'uv'];
  for (const f of colors)
    for (const g of ['3mm', '5mm'])
      for (const k of ['Standard', 'superhell', 'diffus'])
        out.push({ type: 'led', preset: { farbe: f, groesse: g }, name: `LED ${g} ${f} ${k}`, mpn: `LED-${g}-${f.toUpperCase()}-${k[0]}`, pkg: g, price: 0.05 + (k === 'superhell' ? 0.05 : 0) });
  // Potentiometer/Trimmer
  for (let dec = 2; dec <= 6; dec++)
    for (const m of [1, 2.2, 4.7])
      for (const k of ['linear', 'logarithmisch'])
        for (const pkg of ['Dreh-Poti 6 mm', 'Dreh-Poti 4 mm']) {
          const val = eng(m * 10 ** dec, 'Ω');
          out.push({ type: 'potentiometer', preset: { wert: val, kurve: k }, name: `Potentiometer ${val} ${k} ${pkg}`, mpn: `RV09-${k[0].toUpperCase()}-${val}`, pkg, price: 0.4 });
        }
  // Zener-Dioden (BZX55 / BZX84 / 1N47xx) – Wert nach Option, Simulation mit nächster verfügbaren Spannung
  const zv = [2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1, 10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56, 62, 68, 75];
  const zsim = [2.7, 3.3, 3.9, 4.7, 5.1, 5.6, 6.2, 9.1, 12];
  for (const v of zv)
    for (const [ser, pkg, pw] of [
      ['BZX55C', 'DO-35', '0,5 W'],
      ['BZX85C', 'DO-41', '1,3 W'],
      ['BZX84C', 'SOT-23', '0,3 W'],
      ['MMSZ', 'SOD-123', '0,5 W'],
    ] as const) {
      const near = zsim.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
      out.push({ type: 'zener', preset: { wert: `${near}V` }, name: `Z-Diode ${String(v).replace('.', ',')} V ${pw} ${pkg}`, mpn: `${ser}${String(v).replace('.', 'V')}`, pkg, price: 0.04 });
    }
  // Quarze
  for (const f of ['4MHz', '6MHz', '8MHz', '10MHz', '11.0592MHz', '12MHz', '14.7456MHz', '16MHz', '20MHz', '24MHz', '25MHz', '27MHz', '32MHz', '40MHz', '48MHz', '32.768kHz'])
    for (const pkg of ['HC-49/US', 'HC-49/SMD', 'SMD 3225', 'SMD 2520'])
      for (const cl of ['12pF', '18pF', '20pF'])
        out.push({ type: 'quarz', preset: { frequenz: f }, name: `Quarz ${f} ${pkg} CL ${cl}`, mpn: `XT-${f}-${pkg.replace(/\W/g, '')}-${cl}`, pkg, price: 0.25 });
  // Sicherungen
  for (const i of ['50mA', '100mA', '160mA', '200mA', '250mA', '315mA', '400mA', '500mA', '630mA', '800mA', '1A', '1.25A', '1.6A', '2A', '2.5A', '3.15A', '4A', '5A', '6.3A', '8A', '10A'])
    for (const [k, pkg] of [
      ['flink', '5×20 mm'],
      ['träge', '5×20 mm'],
      ['rückstellend (PTC)', 'Radial'],
      ['SMD', '1206'],
    ] as const)
      out.push({ type: 'sicherung', preset: { strom: i }, name: `Sicherung ${i} ${k} ${pkg}`, mpn: `F-${k[0].toUpperCase()}-${i}`, pkg, price: 0.15 });
  // NTC / LDR / Trimmer
  for (const v of ['1k', '2.2k', '4.7k', '10k', '22k', '47k', '100k'])
    for (const b of [3435, 3950, 4250])
      for (const pkg of ['bedrahtet', 'SMD 0603', 'Edelstahlfühler'])
        out.push({ type: 'ntc', preset: { wert: v, beta: b }, name: `NTC ${v} B${b} ${pkg}`, mpn: `NTC-${v}-${b}-${pkg.slice(0, 3)}`, pkg, price: 0.3 });
  for (const r of ['2k', '5k', '10k', '20k', '50k', '100k'])
    for (const pkg of ['5 mm', '12 mm'])
      out.push({ type: 'ldr', preset: { r10lux: r }, name: `Fotowiderstand GL55 ${r} @10 lx ${pkg}`, mpn: `GL55-${r}-${pkg.replace(' ', '')}`, pkg, price: 0.15 });
  for (let dec = 2; dec <= 6; dec++)
    for (const m of [1, 2, 2.5, 5])
      for (const pkg of ['Trimmer liegend', 'Trimmer stehend', 'Spindeltrimmer 25 Gänge', 'SMD-Trimmer 3 mm'])
        out.push({ type: 'trimmer', preset: { wert: eng(m * 10 ** dec, 'Ω') }, name: `Trimmer ${eng(m * 10 ** dec, 'Ω')} ${pkg}`, mpn: `3296-${eng(m * 10 ** dec, 'Ω')}-${pkg.slice(0, 4)}`, pkg, price: 0.3 });
  // Taster-Varianten
  for (const f of ['schwarz', 'rot', 'blau', 'gelb', 'weiss', 'gruen'])
    for (const g of ['6x6x4.3', '6x6x5', '6x6x7', '6x6x9', '6x6x13', '12x12x7.3'])
      out.push({ type: 'taster', preset: { farbe: f }, name: `Taster ${g} mm Kappe ${f}`, mpn: `TS-${g}-${f.slice(0, 2).toUpperCase()}`, pkg: g, price: 0.08 });
  cache = out;
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/,/g, '.');

/** Volltextsuche im Katalog (Namen, MPN, Gehäuse) */
export function searchCatalog(q: string, limit = 30): CatalogEntry[] {
  const tokens = norm(q).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const out: CatalogEntry[] = [];
  for (const e of catalog()) {
    const words = norm(`${e.name} ${e.mpn} ${e.pkg}`).split(/[\s\-/·]+/);
    if (tokens.every((t) => words.some((w) => w.startsWith(t)))) {
      out.push(e);
      if (out.length >= limit) break;
    }
  }
  return out;
}
