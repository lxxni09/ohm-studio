import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { altiumRecords, cfbStream, importAltiumSch } from '../src/eda/altiumImport';
import { serializeOhm } from '../src/ohm/format';
import { selfCheck } from '../src/ai/idea';

const DIR = join(__dirname, 'fixtures', 'altium');
const load = (f: string) => new Uint8Array(readFileSync(join(DIR, f)));

describe('Altium-Import', () => {
  it('liest binäre SchDoc (OLE) – Datenstrom byte-gleich wie Pythons olefile', async () => {
    const { createHash } = await import('node:crypto');
    const sha = (f: string) => createHash('sha256').update(cfbStream(load(f), 'FileHeader')!).digest('hex').slice(0, 16);
    // Referenzwerte mit olefile 0.47 ermittelt
    expect(sha('issue16903_sub_sheet.SchDoc')).toBe('c9f51a64cf31d622');
    expect(sha('issue22908_3_mpcie.SchDoc')).toBe('6a42314882ac75ae');
    expect(sha('issue24861_Channel.SchDoc')).toBe('e5076598beaea7c0');
  });
  it('liest ASCII-SchDoc', () => {
    const recs = altiumRecords(load('ticket1303_pagea.SchDoc'));
    expect(recs.some((r) => r.RECORD === '25' && r.TEXT === 'ONLY_A')).toBe(true);
  });
  it('echtes Projekt (mPCIe-Blatt): Pins liegen auf Leitungen, alle GND-Pins im GND-Netz', () => {
    const r = importAltiumSch(load('issue22908_3_mpcie.SchDoc'), '3_mpcie.SchDoc');
    const named = (r.report as unknown as { netzNamen: Record<string, string> }).netzNamen;
    const pins = r.report.rohNetze!.flat();
    expect(pins.length).toBe(156);
    const connected = r.report.rohNetze!.filter((g) => g.length > 1).flat().length + Object.keys(named).length;
    expect(connected).toBeGreaterThan(90);
    expect(new Set(Object.values(named))).toContain('VCC_3V3');
    // alle Pins mit Namen GND landen im Netz GND (unabhängige Plausibilitätsprüfung)
    const recs = altiumRecords(load('issue22908_3_mpcie.SchDoc')).filter((x) => x.RECORD !== undefined);
    const des = new Map<number, string>();
    for (const x of recs) if (x.RECORD === '34') des.set(Number(x.OWNERINDEX), x.TEXT);
    const gnd = recs.filter((x) => x.RECORD === '2' && x.NAME === 'GND').map((x) => `${des.get(Number(x.OWNERINDEX))}.${x.DESIGNATOR}`);
    expect(gnd.length).toBe(30);
    for (const g of gnd) expect(named[g]).toBe('GND');
  });
  it('Widerstände und Kondensatoren werden zu Ohm-Bauteilen, der Rest wird aufgelistet; Ergebnis ist eine gültige .ohm-Datei', () => {
    const r = importAltiumSch(load('issue22908_3_mpcie.SchDoc'), '3_mpcie.SchDoc');
    expect(r.report.teile.length + r.report.ausgelassen.length).toBe(24);
    expect(r.report.teile.some((t) => t.typ === 'kondensator' || t.typ === 'widerstand')).toBe(true);
    const c = selfCheck(serializeOhm(r.project));
    expect(c.fehler.filter((f) => /^Datei/.test(f))).toEqual([]);
  });
});
