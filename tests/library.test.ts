import { describe, expect, it } from 'vitest';
import { catalog, searchCatalog } from '../src/parts/catalog';
import { ALL_PARTS, getPart, searchParts } from '../src/parts/registry';
import { DICT, CATEGORY_DICT, LANGS } from '../src/i18n/dict';
import { CATEGORIES } from '../src/parts/types';
import { Engine } from '../src/sim/engine';
import { emptyProject } from '../src/ohm/model';

describe('Bibliothek & Sprachen', () => {
  it('über 10 000 Bestellvarianten, alle auf existierende Grundtypen', () => {
    expect(catalog().length + ALL_PARTS.length).toBeGreaterThanOrEqual(10000);
    for (const t of new Set(catalog().map((e) => e.type))) expect(getPart(t), t).toBeTruthy();
    expect(new Set(catalog().map((e) => e.mpn)).size).toBeGreaterThan(9000);
  });
  it('Katalogsuche liefert passende Varianten', () => {
    const r = searchCatalog('widerstand 4,7k 5% 0603');
    expect(r[0].preset.wert).toBe('4,7k');
    expect(searchParts('elko 470u 25v').some((h) => h.variant?.includes('470uF'))).toBe(true);
  });
  it('alle Typen eindeutig, neue Teile simulieren ohne Fehler', () => {
    expect(new Set(ALL_PARTS.map((p) => p.type)).size).toBe(ALL_PARTS.length);
    const p = emptyProject('x');
    p.parts = [
      { id: 'V1', type: 'labornetzteil', props: { spannung: 5 }, x: 0, y: 0, rot: 0 },
      { id: 'U1', type: 'max485', props: {}, x: 100, y: 0, rot: 0 },
      { id: 'M1', type: 'luefter-5v', props: {}, x: 200, y: 0, rot: 0 },
    ];
    p.nets = [
      { name: '5V', pins: ['V1.+', 'U1.VCC', 'M1.+'] },
      { name: 'GND', pins: ['V1.-', 'U1.GND', 'M1.-'] },
    ];
    const e = new Engine(p);
    e.start();
    for (let i = 0; i < 20; i++) e.step(0.001);
    expect(e.states.get('M1')?.speed).toBeGreaterThan(0.9);
  });
  it('10 Sprachen, jede Übersetzung vollständig', () => {
    expect(LANGS.length).toBe(10);
    for (const row of [...Object.values(DICT), ...Object.values(CATEGORY_DICT)]) {
      expect(row.length).toBe(9);
      expect(row.every((x) => x.length > 0)).toBe(true);
    }
    for (const c of CATEGORIES) expect(CATEGORY_DICT[c], c).toBeTruthy();
  });
});
