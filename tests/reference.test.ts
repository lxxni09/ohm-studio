/**
 * Vergleich mit analytischen bzw. SPICE-Referenzwerten (ngspice, gleiche Modellparameter).
 */
import { describe, expect, it } from 'vitest';
import { Engine } from '../src/sim/engine';
import { emptyProject, type Project } from '../src/ohm/model';

function rc(): Project {
  const p = emptyProject('RC');
  p.parts = [
    { id: 'V1', type: 'labornetzteil', props: { spannung: 5 }, x: 0, y: 0, rot: 0 },
    { id: 'R1', type: 'widerstand', props: { wert: '1k' }, x: 100, y: 0, rot: 0 },
    { id: 'C1', type: 'elko', props: { wert: '100uF', spannung: '16V' }, x: 200, y: 0, rot: 0 },
  ];
  p.nets = [
    { name: 'VIN', pins: ['V1.+', 'R1.1'] },
    { name: 'VC', pins: ['R1.2', 'C1.+'] },
    { name: 'GND', pins: ['C1.-', 'V1.-'] },
  ];
  return p;
}

describe('Referenzwerte', () => {
  it('RC-Ladekurve: U(τ) = 63,2 %, U(3τ) = 95 % (τ = 100 ms)', () => {
    const e = new Engine(rc());
    e.start();
    const v = () => e.pinVoltage('C1', '+')! - e.pinVoltage('C1', '-')!;
    for (let i = 0; i < 1000; i++) e.step(0.0001);
    expect(v()).toBeGreaterThan(5 * 0.632 * 0.97);
    expect(v()).toBeLessThan(5 * 0.632 * 1.03);
    for (let i = 0; i < 2000; i++) e.step(0.0001);
    expect(v()).toBeGreaterThan(5 * 0.95 * 0.98);
  });
  it('Spannungsteiler 10k/4,7k an 12 V = 3,837 V', () => {
    const p = emptyProject('T');
    p.parts = [
      { id: 'V1', type: 'labornetzteil', props: { spannung: 12 }, x: 0, y: 0, rot: 0 },
      { id: 'R1', type: 'widerstand', props: { wert: '10k' }, x: 100, y: 0, rot: 0 },
      { id: 'R2', type: 'widerstand', props: { wert: '4,7k' }, x: 200, y: 0, rot: 0 },
    ];
    p.nets = [
      { name: 'A', pins: ['V1.+', 'R1.1'] },
      { name: 'M', pins: ['R1.2', 'R2.1'] },
      { name: 'GND', pins: ['R2.2', 'V1.-'] },
    ];
    const e = new Engine(p);
    e.start();
    e.step(0.001);
    expect(e.pinVoltage('R2', '1')!).toBeCloseTo((12 * 4.7) / 14.7, 2);
  });
  it('Rote LED an 5 V über 220 Ω: 13–15 mA (SPICE-Referenz 14,1 mA bei Vf ≈ 1,9 V)', () => {
    const p = emptyProject('L');
    p.parts = [
      { id: 'V1', type: 'labornetzteil', props: { spannung: 5 }, x: 0, y: 0, rot: 0 },
      { id: 'R1', type: 'widerstand', props: { wert: '220' }, x: 100, y: 0, rot: 0 },
      { id: 'D1', type: 'led', props: { farbe: 'rot' }, x: 200, y: 0, rot: 0 },
    ];
    p.nets = [
      { name: 'A', pins: ['V1.+', 'R1.1'] },
      { name: 'B', pins: ['R1.2', 'D1.A'] },
      { name: 'GND', pins: ['D1.K', 'V1.-'] },
    ];
    const e = new Engine(p);
    e.start();
    for (let i = 0; i < 10; i++) e.step(0.001);
    const i = e.states.get('D1')!.i * 1000;
    expect(i).toBeGreaterThan(12.5);
    expect(i).toBeLessThan(15.5);
  });
});
