import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseOhm, serializeOhm } from '../src/ohm/format';
import { netSegments } from '../src/views/wires';
import { routeAll } from '../src/views/router';

const src = readFileSync(new URL('../examples/schluessel-tuerwaechter.ohm', import.meta.url), 'utf8');

describe('Kabel-Router', () => {
  it('verlegt alle Kabel rechtwinklig', () => {
    const { project } = parseOhm(src);
    const segs = netSegments(project);
    const r = routeAll(project, segs, { style: '90' });
    expect(r.length).toBe(segs.length);
    for (const w of r)
      for (let i = 0; i < w.pts.length - 1; i++) {
        const a = w.pts[i];
        const b = w.pts[i + 1];
        expect(Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01).toBe(true);
      }
  });
  it('alte v1-Dateien bekommen gerade Kabel, Knickpunkte bleiben beim Speichern erhalten', () => {
    const { project } = parseOhm(src);
    expect(project.views.kabel?.stil).toBe('90');
    project.views.kabel!.knicke = { 'R1.1|U1.3V3': [{ x: 100, y: 50 }] };
    const again = parseOhm(serializeOhm(project)).project;
    expect(again.views.kabel?.knicke?.['R1.1|U1.3V3'][0].x).toBeCloseTo(100, 0);
  });
});
