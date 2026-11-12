/**
 * Einkauf: Herstellerteilenummern, Lebenszyklus, RoHS/REACH, Alternativen, Staffelpreise.
 * Offline-Daten sind Richtwerte. Live-Preise werden nur nach ausdrücklicher Zustimmung
 * und mit eigenem API-Schlüssel abgefragt (es werden nur Teilenummern gesendet, keine Projektdaten).
 */
import type { Project } from '../ohm/model';
import { bomRows, type BomRow } from './bom';
import { catalog } from '../parts/catalog';
import { parseValue } from '../lib/units';

export type Lifecycle = 'aktiv' | 'nrnd' | 'abgekuendigt' | 'unbekannt';

export interface Sourcing {
  mpn: string;
  hersteller: string;
  lcsc?: string;
  lifecycle: Lifecycle;
  rohs: boolean;
  reach: boolean;
  alternativen: string[];
}

const DB: Record<string, Sourcing> = {
  widerstand: { mpn: 'MFR-25FBF52', hersteller: 'Yageo', lcsc: 'C2930027', lifecycle: 'aktiv', rohs: true, reach: true, alternativen: ['Vishay MBA02040', 'TE CFR16'] },
  led: { mpn: 'WP7113ID', hersteller: 'Kingbright', lcsc: 'C2895477', lifecycle: 'aktiv', rohs: true, reach: true, alternativen: ['Lite-On LTL-4221N', 'Würth 151051RS11000'] },
  kondensator: { mpn: 'K104K15X7RF5TL2', hersteller: 'Vishay', lcsc: 'C254075', lifecycle: 'aktiv', rohs: true, reach: true, alternativen: ['KEMET C320C104K5R5TA'] },
  elko: { mpn: 'EEU-FR1C101', hersteller: 'Panasonic', lcsc: 'C99113', lifecycle: 'aktiv', rohs: true, reach: true, alternativen: ['Nichicon UVR1C101MDD', 'Würth 860010472005'] },
  taster: { mpn: 'B3F-1000', hersteller: 'Omron', lcsc: 'C231329', lifecycle: 'aktiv', rohs: true, reach: true, alternativen: ['TE FSM4JH', 'C&K PTS645'] },
  ne555: { mpn: 'NE555P', hersteller: 'Texas Instruments', lcsc: 'C46749', lifecycle: 'aktiv', rohs: true, reach: true, alternativen: ['TLC555CP (CMOS)', 'ICM7555'] },
  lm358: { mpn: 'LM358P', hersteller: 'Texas Instruments', lcsc: 'C7950', lifecycle: 'aktiv', rohs: true, reach: true, alternativen: ['LM358N (onsemi)', 'MCP6002 (Rail-to-Rail)'] },
  '74hc595': { mpn: 'SN74HC595N', hersteller: 'Texas Instruments', lcsc: 'C5947', lifecycle: 'aktiv', rohs: true, reach: true, alternativen: ['74HC595N (Nexperia)'] },
  BC547: { mpn: 'BC547B', hersteller: 'onsemi', lcsc: 'C8586', lifecycle: 'nrnd', rohs: true, reach: true, alternativen: ['BC547C (Diotec)', '2N3904'] },
  '2N2222': { mpn: 'PN2222A', hersteller: 'onsemi', lcsc: 'C171990', lifecycle: 'aktiv', rohs: true, reach: true, alternativen: ['2N3904', 'BC337'] },
  S8050: { mpn: 'S8050', hersteller: 'Changjiang', lcsc: 'C2146', lifecycle: 'aktiv', rohs: true, reach: true, alternativen: ['BC337', 'SS8050'] },
  IRLZ44N: { mpn: 'IRLZ44NPBF', hersteller: 'Infineon', lcsc: 'C33378', lifecycle: 'aktiv', rohs: true, reach: true, alternativen: ['IRLB8721', 'FQP30N06L'] },
  LM7805: { mpn: 'L7805CV', hersteller: 'STMicroelectronics', lcsc: 'C58069', lifecycle: 'aktiv', rohs: true, reach: true, alternativen: ['LM7805CT', 'R-78E5.0-0.5 (Schaltregler)'] },
  '1n4148': { mpn: '1N4148', hersteller: 'Vishay', lcsc: 'C14516', lifecycle: 'aktiv', rohs: true, reach: true, alternativen: ['1N914', 'BAV21'] },
  '1n4007': { mpn: '1N4007-E3/54', hersteller: 'Vishay', lcsc: 'C1438', lifecycle: 'aktiv', rohs: true, reach: true, alternativen: ['UF4007', 'M7 (SMD)'] },
  'arduino-uno': { mpn: 'A000066', hersteller: 'Arduino', lifecycle: 'aktiv', rohs: true, reach: true, alternativen: ['Arduino Uno R4 Minima (ABX00080)'] },
  'arduino-nano': { mpn: 'A000005', hersteller: 'Arduino', lifecycle: 'aktiv', rohs: true, reach: true, alternativen: ['Arduino Nano Every (ABX00028)'] },
  pico: { mpn: 'SC0915', hersteller: 'Raspberry Pi', lifecycle: 'aktiv', rohs: true, reach: true, alternativen: ['Raspberry Pi Pico 2 (SC1631)'] },
  esp32: { mpn: 'ESP32-DEVKITC-32E', hersteller: 'Espressif', lifecycle: 'aktiv', rohs: true, reach: true, alternativen: ['ESP32-S3-DevKitC-1'] },
  dht11: { mpn: 'DHT11', hersteller: 'Aosong', lifecycle: 'nrnd', rohs: true, reach: false, alternativen: ['DHT22/AM2302', 'SHT31 (I²C, genauer)'] },
  'hc-sr04': { mpn: 'HC-SR04', hersteller: 'diverse', lifecycle: 'unbekannt', rohs: false, reach: false, alternativen: ['HC-SR04P (3,3 V)', 'VL53L0X (ToF)'] },
};

export function sourcingFor(type: string): Sourcing {
  return DB[type] ?? { mpn: '—', hersteller: '—', lifecycle: 'unbekannt', rohs: true, reach: true, alternativen: [] };
}

export const TIERS = [1, 100, 1000, 10000] as const;
/** Mengenrabatt-Faktoren (typisch für Distributoren) */
const TIER_FACTOR: Record<number, number> = { 1: 1, 100: 0.55, 1000: 0.32, 10000: 0.21 };

export interface SourcedRow extends BomRow {
  type: string;
  src: Sourcing;
  tiers: Record<number, number>;
  live?: { distributor: string; price: number; stock: number };
}

export function sourcedBom(project: Project): SourcedRow[] {
  return bomRows(project).map((r) => {
    const inst = project.parts.find((p) => p.id === r.refs[0]);
    const type = inst?.type ?? '';
    const tiers: Record<number, number> = {};
    for (const t of TIERS) tiers[t] = r.preis * TIER_FACTOR[t];
    let src = sourcingFor(type);
    // Genaue Bestellvariante aus dem Katalog (Wert, Bauform), falls vorhanden
    const v = inst?.props.wert !== undefined ? parseValue(inst.props.wert, NaN) : NaN;
    const hit = catalog().find((e) => e.type === type && (Number.isFinite(v) ? Math.abs(parseValue(e.preset.wert, NaN) / v - 1) < 1e-6 && (!inst?.props.leistung || e.preset.leistung === inst.props.leistung) && (!inst?.props.toleranz || e.preset.toleranz === undefined || e.preset.toleranz === inst.props.toleranz) && (!inst?.props.spannung || e.preset.spannung === inst.props.spannung) : Object.entries(e.preset).every(([k, x]) => inst?.props[k] === x)));
    if (hit) src = { ...src, mpn: hit.mpn };
    return { ...r, type, src, tiers };
  });
}

export function bomTotal(rows: SourcedRow[], qty: number): number {
  const tier = [...TIERS].reverse().find((t) => qty >= t) ?? 1;
  return rows.reduce((a, r) => a + (r.live && tier === 1 ? r.live.price : r.tiers[tier]) * r.anzahl * qty, 0);
}

export interface BomWarning {
  ref: string;
  text: string;
  level: 'warn' | 'error';
}

/** Bestückungs- und Beschaffungsprüfung */
export function bomCheck(rows: SourcedRow[]): BomWarning[] {
  const out: BomWarning[] = [];
  for (const r of rows) {
    const ref = r.refs.join(', ');
    if (r.src.lifecycle === 'abgekuendigt') out.push({ ref, level: 'error', text: `${r.bezeichnung} ist abgekündigt – Alternative: ${r.src.alternativen[0] ?? 'keine bekannt'}.` });
    if (r.src.lifecycle === 'nrnd') out.push({ ref, level: 'warn', text: `${r.bezeichnung} wird nicht mehr für Neuentwicklungen empfohlen (NRND). Alternativen: ${r.src.alternativen.join(', ')}.` });
    if (!r.src.rohs) out.push({ ref, level: 'warn', text: `${r.bezeichnung}: RoHS-Konformität nicht belegt – für den EU-Verkauf nicht geeignet.` });
    if (r.live && r.live.stock < r.anzahl) out.push({ ref, level: 'error', text: `${r.bezeichnung}: nur ${r.live.stock} Stück bei ${r.live.distributor} auf Lager.` });
  }
  return out;
}

/* ------------------- Live-Preise (opt-in) ------------------- */

export interface LiveConfig {
  provider: 'nexar' | 'mouser' | 'digikey';
  key: string;
}

export function liveConsent(): boolean {
  try {
    return localStorage.getItem('ohm.liveprices') === 'ja';
  } catch {
    return false;
  }
}

/**
 * Fragt Preise/Lagerbestand ab. Gesendet werden ausschließlich Herstellerteilenummern.
 * Ohne Zustimmung oder Schlüssel passiert nichts.
 */
export async function fetchLivePrices(rows: SourcedRow[], cfg: LiveConfig): Promise<SourcedRow[]> {
  if (!liveConsent() || !cfg.key) return rows;
  const out: SourcedRow[] = [];
  for (const r of rows) {
    if (r.src.mpn === '—') {
      out.push(r);
      continue;
    }
    try {
      if (cfg.provider === 'mouser') {
        const res = await fetch(`https://api.mouser.com/api/v1/search/partnumber?apiKey=${encodeURIComponent(cfg.key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ SearchByPartRequest: { mouserPartNumber: r.src.mpn } }),
        });
        const j = await res.json();
        const part = j?.SearchResults?.Parts?.[0];
        const price = parseFloat(String(part?.PriceBreaks?.[0]?.Price ?? '').replace(/[^\d,.]/g, '').replace(',', '.'));
        out.push(part ? { ...r, live: { distributor: 'Mouser', price: Number.isFinite(price) ? price : r.preis, stock: parseInt(part.AvailabilityInStock ?? '0', 10) || 0 } } : r);
      } else {
        // Nexar (Octopart) bzw. DigiKey benötigen OAuth – Abfrage über den Nexar-GraphQL-Endpunkt mit Bearer-Token
        const res = await fetch('https://api.nexar.com/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
          body: JSON.stringify({ query: `query{supSearchMpn(q:"${r.src.mpn.replace(/"/g, '')}",limit:1){results{part{sellers{company{name} offers{inventoryLevel prices{quantity price currency}}}}}}}` }),
        });
        const j = await res.json();
        const sellers = j?.data?.supSearchMpn?.results?.[0]?.part?.sellers ?? [];
        let best: { distributor: string; price: number; stock: number } | undefined;
        for (const s of sellers)
          for (const o of s.offers ?? []) {
            const p = o.prices?.find((x: { quantity: number }) => x.quantity === 1)?.price;
            if (p && (!best || p < best.price)) best = { distributor: s.company.name, price: p, stock: o.inventoryLevel ?? 0 };
          }
        out.push(best ? { ...r, live: best } : r);
      }
    } catch {
      out.push(r);
    }
  }
  return out;
}

export function sourcedBomCsv(rows: SourcedRow[]): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const n = (v: number) => v.toFixed(3).replace('.', ',');
  const lines = ['Pos;Referenzen;Anzahl;Bauteil;Hersteller;MPN;LCSC;Lebenszyklus;RoHS;REACH;Preis @1;@100;@1000;@10000;Alternativen'];
  rows.forEach((r, i) =>
    lines.push([i + 1, q(r.refs.join(', ')), r.anzahl, q(r.bezeichnung), q(r.src.hersteller), q(r.src.mpn), r.src.lcsc ?? '', r.src.lifecycle, r.src.rohs ? 'ja' : 'nein', r.src.reach ? 'ja' : 'nein', ...TIERS.map((t) => n(r.tiers[t])), q(r.src.alternativen.join(' | '))].join(';')),
  );
  return '﻿' + lines.join('\r\n');
}
