import { describe, expect, it } from 'vitest';
import { parseOhm } from '../src/ohm/format';
import { EXAMPLES } from '../src/examples';
import { KURS } from '../src/learn/course';
import { grade } from '../src/learn/grading';
import { getPart } from '../src/parts/registry';

const ex = (k: string) => parseOhm(EXAMPLES[k] ?? EXAMPLES[k + '.ohm']).project;

describe('Kurs', () => {
  it('30 Lektionen, alle Bauteiltypen existieren', () => {
    expect(KURS.length).toBe(30);
    for (const l of KURS) for (const k of l.kriterien) if (k.art === 'teil' || k.art === 'aktiv') expect(getPart(k.typ), `${l.nr}: ${k.typ}`).toBeTruthy();
  });
  it('Lektionen mit Startprojekt sind mit dem Beispiel lösbar', () => {
    for (const l of KURS.filter((x) => x.start)) {
      const g = grade(ex(l.start!), l.kriterien);
      expect(g.details.filter((d) => !d.ok).map((d) => `${l.nr}: ${d.text}`)).toEqual([]);
    }
  });
  it('leeres Projekt besteht nichts', () => {
    const g = grade(parseOhm('name: leer').project, KURS[0].kriterien);
    expect(g.ok).toBe(false);
    expect(g.punkte).toBe(0);
  });
});
