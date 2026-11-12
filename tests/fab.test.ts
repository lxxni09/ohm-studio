import { describe, expect, it } from 'vitest';
import { parseOhm } from '../src/ohm/format';
import { EXAMPLES } from '../src/examples';
import { assemblyPdf, fabPackage, ipc2581, odbFiles, pickPlaceCsv, stepModel, testPoints, fabQuotes } from '../src/export/fab';
import { bomCheck, bomTotal, sourcedBom, sourcedBomCsv } from '../src/export/sourcing';

const project = parseOhm(EXAMPLES[Object.keys(EXAMPLES)[0]]).project!;

describe('Fertigung', () => {
  it('Pick & Place listet alle Footprints', () => {
    const csv = pickPlaceCsv(project);
    expect(csv.split('\r\n')[0]).toContain('Designator');
    expect(csv.trim().split('\r\n').length).toBeGreaterThan(1);
  });
  it('PDF ist gültig aufgebaut', () => {
    const s = new TextDecoder().decode(assemblyPdf(project));
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s).toContain('startxref');
    const xref = parseInt(/startxref\n(\d+)/.exec(s)![1], 10);
    expect(s.slice(xref, xref + 4)).toBe('xref');
  });
  it('IPC-2581, ODB++, STEP', () => {
    expect(ipc2581(project)).toContain('<IPC-2581');
    expect(odbFiles(project).some((f) => f.name.endsWith('matrix/matrix'))).toBe(true);
    const st = stepModel(project);
    expect(st).toContain('MANIFOLD_SOLID_BREP');
    expect(st.trim().endsWith('END-ISO-10303-21;')).toBe(true);
    expect(testPoints(project).length).toBeGreaterThan(0);
    expect(fabPackage(project).size).toBeGreaterThan(1000);
    expect(fabQuotes(project).length).toBeGreaterThan(2);
  });
  it('Einkaufs-Stückliste mit Staffelpreisen', () => {
    const rows = sourcedBom(project);
    expect(rows.length).toBeGreaterThan(0);
    expect(bomTotal(rows, 1000) / 1000).toBeLessThan(bomTotal(rows, 1));
    expect(sourcedBomCsv(rows)).toContain('MPN');
    expect(Array.isArray(bomCheck(rows))).toBe(true);
  });
});
