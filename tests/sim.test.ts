import { describe, it, expect } from 'vitest';
import { Circuit, Resistor, Source, Diode, diodeFromVf, Capacitor, Bjt } from '../src/sim/mna';

describe('MNA-Löser', () => {
  it('Spannungsteiler', () => {
    const c = new Circuit(2);
    c.add(new Source(0, -1, 10, 0.001));
    c.add(new Resistor(0, 1, 1000));
    c.add(new Resistor(1, -1, 1000));
    c.solve(Infinity);
    expect(c.x[1]).toBeCloseTo(5, 2);
  });
  it('LED mit 220 Ω an 5 V ≈ 14 mA', () => {
    const c = new Circuit(2);
    c.add(new Source(0, -1, 5, 0.01));
    c.add(new Resistor(0, 1, 220));
    const d = c.add(new Diode(1, -1, { ...diodeFromVf(2.0, 0.02, 2.2, 5), rs: 6 }));
    const r = c.solve(Infinity);
    expect(r.ok).toBe(true);
    expect(d.i).toBeGreaterThan(0.011);
    expect(d.i).toBeLessThan(0.016);
  });
  it('RC-Ladekurve: nach τ ≈ 63 %', () => {
    const c = new Circuit(2);
    c.add(new Source(0, -1, 5, 0.001));
    c.add(new Resistor(0, 1, 1000));
    const cap = c.add(new Capacitor(1, -1, 1e-3, 0));
    const dt = 1e-3;
    for (let t = 0; t < 1.0 - 1e-9; t += dt) c.solve(dt);
    expect(cap.v / 5).toBeGreaterThan(0.6);
    expect(cap.v / 5).toBeLessThan(0.66);
  });
  it('NPN schaltet durch', () => {
    const c = new Circuit(3);
    c.add(new Source(0, -1, 5, 0.001));
    c.add(new Resistor(0, 1, 100)); // Last
    c.add(new Resistor(2, -1, 1e9));
    const q = c.add(new Bjt(1, 2, -1, { pnp: false, is: 1e-14, bf: 200, br: 4 }));
    c.add(new Source(2, -1, 3.3, 1000)); // Basis über 1k
    c.solve(Infinity);
    expect(c.x[1]).toBeLessThan(0.3);
    expect(q.ic).toBeGreaterThan(0.04);
  });
});
