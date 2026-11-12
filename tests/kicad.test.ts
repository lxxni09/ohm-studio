import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyKicadPcb, importKicadSch, kicadValue } from '../src/eda/kicadImport';
import { selfCheck } from '../src/ai/idea';
import { serializeOhm } from '../src/ohm/format';

const DIR = join(__dirname, 'fixtures', 'kicad');
const DEMOS = ['rectifier', 'ecc83-pp', 'pic_programmer', 'sallen_key', 'laser_driver'];

/** KiCads eigene Netzliste (mit KiCad 7 erzeugt) als Mengen „Referenz.Pin“ */
function kicadNets(name: string): string[][] {
  const xml = readFileSync(join(DIR, 'v7', `${name}.kicad7-netzliste.xml`), 'utf8');
  const out: string[][] = [];
  for (const m of xml.matchAll(/<net code="\d+" name="([^"]*)"[^>]*>([\s\S]*?)<\/net>/g)) {
    const pins = [...m[2].matchAll(/<node ref="([^"]+)" pin="([^"]+)"/g)].map((x) => `${x[1]}.${x[2]}`).filter((x) => !x.startsWith('#')).sort();
    if (pins.length) out.push(pins);
  }
  return out;
}

function compare(version: string, name: string) {
  const r = importKicadSch(readFileSync(join(DIR, version, `${name}.kicad_sch`), 'utf8'), `${name}.kicad_sch`);
  const mine = new Map<string, string>();
  for (const g of r.report.rohNetze!) for (const p of g) mine.set(p, g.join(' '));
  const diff = kicadNets(name).filter((g) => mine.get(g[0]) !== g.join(' '));
  return { r, diff };
}

describe('KiCad-Import: gleiche Verbindungen wie KiCad selbst', () => {
  for (const v of ['v7', 'v8'])
    for (const d of DEMOS)
      it(`${v}/${d}`, () => {
        expect(compare(v, d).diff).toEqual([]);
      });
  it('neuestes Format (master): gleiche Netze, außer der dort neu gezeichneten Quelle V1 im Gleichrichter', () => {
    for (const d of DEMOS) {
      const { diff } = compare('v9', d);
      if (d === 'rectifier') expect(diff.every((g) => g.some((p) => p.startsWith('V1.')))).toBe(true);
      else expect(diff).toEqual([]);
    }
  });
});

describe('KiCad-Import: simulierbares Projekt', () => {
  it('Gleichrichter wird zu einem simulierbaren Ohm-Projekt', () => {
    const { r } = compare('v9', 'rectifier');
    expect(r.report.teile.map((t) => t.typ).sort()).toEqual(['1n4148', 'funktionsgenerator', 'kondensator', 'widerstand', 'widerstand']);
    const v1 = r.project.parts.find((p) => p.type === 'funktionsgenerator')!;
    expect(v1.props).toMatchObject({ form: 'sinus', amplitude: 1, offset: 0, frequenz: 200 });
    expect(r.report.hinweise.join(' ')).toMatch(/1 kHz.*200 Hz/);
    const check = selfCheck(serializeOhm(r.project));
    expect(check.fehler).toEqual([]);
  });
  it('Sallen-Key mit OPV, Laser-Treiber: nicht abbildbare Teile werden ehrlich aufgelistet', () => {
    for (const d of ['sallen_key', 'laser_driver', 'ecc83-pp']) {
      const { r } = compare('v8', d);
      for (const a of r.report.ausgelassen) expect(a.grund).toMatch(/Simulationsmodell|bestücken/);
    }
    expect(compare('v8', 'ecc83-pp').r.report.ausgelassen.map((a) => a.ref)).toContain('U1');
  });
  it('Platine: Footprint-Positionen und Größe aus .kicad_pcb', () => {
    const { r } = compare('v9', 'ecc83-pp');
    applyKicadPcb(r.project, readFileSync(join(DIR, 'v9', 'ecc83-pp.kicad_pcb'), 'utf8'), r.report);
    const pcb = (r.project as unknown as { pcb: Record<string, unknown> }).pcb;
    expect(Object.keys(pcb).length).toBeGreaterThan(3);
    expect(String(r.project.views.platine?.groesse)).toMatch(/^\d+(\.\d)?x\d+(\.\d)?mm$/);
  });
  it('Werte wie in KiCad/SPICE', () => {
    expect(kicadValue('4k7')).toBe('4.7k');
    expect(kicadValue('1Meg')).toBe('1M');
    expect(kicadValue('2R2')).toBe('2.2');
    expect(kicadValue('100n')).toBe('100n');
  });
});
