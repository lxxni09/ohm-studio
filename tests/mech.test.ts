import { describe, expect, it } from 'vitest';
import { parseOhm } from '../src/ohm/format';
import { EXAMPLES } from '../src/examples';
import { checkCollisions, designEnclosure, enclosureMeshes, enclosureStep, stlBinary, DEFAULT_ENCLOSURE, type Tri } from '../src/mech/enclosure';

/** jede Kante muss genau zweimal in entgegengesetzter Richtung vorkommen → wasserdicht (je Teilkörper) */
function openEdges(tris: Tri[]): number {
  const k = (a: number[], b: number[]) => `${a.map((x) => x.toFixed(3)).join(',')}|${b.map((x) => x.toFixed(3)).join(',')}`;
  const m = new Map<string, number>();
  for (const t of tris) for (let i = 0; i < 3; i++) {
    const a = t[i];
    const b = t[(i + 1) % 3];
    m.set(k(a, b), (m.get(k(a, b)) ?? 0) + 1);
  }
  let open = 0;
  for (const [key, n] of m) {
    const [a, b] = key.split('|');
    if ((m.get(`${b}|${a}`) ?? 0) !== n) open++;
  }
  return open;
}

describe('Gehäuse', () => {
  const p = parseOhm(EXAMPLES['ampel.ohm'] ?? Object.values(EXAMPLES)[1]).project;
  const e = designEnclosure(p);
  it('Maße, Ausschnitte, Dome', () => {
    expect(e.ow).toBeCloseTo(e.pcbW + 2 * (DEFAULT_ENCLOSURE.wand + DEFAULT_ENCLOSURE.spiel), 5);
    expect(e.holes.some((h) => h.why.startsWith('LED'))).toBe(true);
    expect(e.holes.some((h) => h.why.startsWith('USB'))).toBe(true);
    expect(e.bosses.length).toBe(4);
    expect(checkCollisions(e).every((c) => c.level !== 'error')).toBe(true);
  });
  it('Deckel-Platte ist wasserdicht, STL und STEP gültig', () => {
    const m = enclosureMeshes(e);
    expect(m.unterschale.length).toBeGreaterThan(100);
    const stl = stlBinary(m.deckel);
    expect(new DataView(stl.buffer).getUint32(80, true)).toBe(m.deckel.length);
    expect(stl.length).toBe(84 + 50 * m.deckel.length);
    expect(openEdges(m.knoepfe)).toBe(0);
    const step = enclosureStep(p, e);
    expect(step).toContain('MANIFOLD_SOLID_BREP');
  });
  it('zu hohes Bauteil kollidiert mit dem Deckel', () => {
    const tight = designEnclosure(p, { ...DEFAULT_ENCLOSURE, luftOben: -5 });
    expect(checkCollisions(tight).some((c) => c.level === 'error')).toBe(true);
  });
});
