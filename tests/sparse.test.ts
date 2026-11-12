import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { parseOhm } from '../src/ohm/format';
import { Engine } from '../src/sim/engine';
import { setSparseThreshold, solveSparse } from '../src/sim/mna';

function run(file: string) {
  const p = parseOhm(readFileSync(`examples/${file}`, 'utf8')).project;
  const e = new Engine(p);
  for (const c of p.code) e.setCode(c.ziel, c.datei, c.sprache ?? 'arduino');
  e.start();
  for (let i = 0; i < 300; i++) e.step(0.001);
  return p.nets.map((n) => e.netVoltage(n.pins[0]) ?? 0);
}

describe('Dünnbesetzter Löser', () => {
  it('liefert dieselben Spannungen wie der dichte Löser', () => {
    for (const f of ['ampel.ohm', 'timer555.ohm', 'nachtlicht.ohm', 'lauflicht-595.ohm']) {
      setSparseThreshold(1e9);
      const dense = run(f);
      setSparseThreshold(2);
      const sparse = run(f);
      setSparseThreshold(48);
      sparse.forEach((v, i) => expect(v, `${f} Netz ${i}`).toBeCloseTo(dense[i], 3));
    }
  });
  it('löst ein zufälliges diagonaldominantes System', () => {
    const n = 60;
    const A = new Float64Array(n * n);
    const b = new Float64Array(n);
    let s = 1;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      b[i] = rnd();
      for (let j = 0; j < n; j++) if (i !== j && rnd() < 0.05) A[i * n + j] = -rnd();
      A[i * n + i] = 5;
    }
    const x = new Float64Array(n);
    expect(solveSparse(n, A, b, x)).toBe(true);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let j = 0; j < n; j++) acc += A[i * n + j] * x[j];
      expect(acc).toBeCloseTo(b[i], 9);
    }
  });
});
