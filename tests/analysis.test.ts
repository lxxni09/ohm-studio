import { describe, expect, it } from 'vitest';
import { parseOhm } from '../src/ohm/format';
import { EXAMPLES } from '../src/examples';
import { emptyProject } from '../src/ohm/model';
import { runProject } from '../src/analysis/runner';
import { emcCheck, fmea, ipc2221Current, lifetime, monteCarlo, powerIntegrity, signalIntegrity, thermalAnalysis } from '../src/analysis/analyses';

function divider() {
  const p = emptyProject('Teiler');
  p.parts = [
    { id: 'V1', type: 'labornetzteil', props: { spannung: 10 }, x: 0, y: 0, rot: 0 },
    { id: 'R1', type: 'widerstand', props: { wert: '100' }, x: 200, y: 0, rot: 0 },
    { id: 'R2', type: 'widerstand', props: { wert: '100' }, x: 200, y: 100, rot: 0 },
  ];
  p.nets = [
    { name: 'VIN', pins: ['V1.+', 'R1.1'] },
    { name: 'MITTE', pins: ['R1.2', 'R2.1'] },
    { name: 'GND', pins: ['R2.2', 'V1.-'] },
  ];
  return p;
}

describe('Analysen', () => {
  it('Wärme: 100-Ω-Teiler an 10 V → 0,25 W je Widerstand = Überlast-Warnung', () => {
    const p = divider();
    const m = runProject(p);
    expect(m.nets.MITTE).toBeCloseTo(5, 1);
    const th = thermalAnalysis(p, m);
    const r1 = th.find((r) => r.id === 'R1')!;
    expect(r1.p).toBeCloseTo(0.25, 2);
    expect(r1.level).not.toBe('ok');
    expect(r1.t).toBeGreaterThan(70);
  });
  it('Monte Carlo streut im Toleranzband und ist reproduzierbar', async () => {
    const p = divider();
    const a = await monteCarlo(p, 60);
    const mid = a.metrics.find((x) => x.key === 'net:MITTE')!;
    expect(mid.mean).toBeCloseTo(5, 1);
    expect(mid.sd).toBeGreaterThan(0.01);
    expect(mid.max).toBeLessThan(5.3);
    const w = a.worst.find((x) => x.key === 'net:MITTE')!;
    expect(w.low).toBeLessThan(4.85);
    expect(w.high).toBeGreaterThan(5.15);
    const b = await monteCarlo(p, 60);
    expect(b.metrics[0].values).toEqual(a.metrics[0].values);
  });
  it('FMEA findet LED-Ausfall bei offenem Vorwiderstand', async () => {
    const p = parseOhm(EXAMPLES['blink.ohm'] ?? Object.values(EXAMPLES).find((t) => /blink/i.test(t))!).project;
    const rows = await fmea(p);
    const open = rows.find((r) => r.type === 'widerstand' && r.mode === 'Unterbrechung');
    expect(open?.effect).toMatch(/fällt aus/);
    expect(rows.every((r) => r.rpn === r.s * r.o * r.d)).toBe(true);
  });
  it('Lebensdauer, PI, SI, EMV liefern plausible Werte', () => {
    expect(ipc2221Current(0.25)).toBeGreaterThan(0.5);
    expect(ipc2221Current(1)).toBeGreaterThan(ipc2221Current(0.25));
    const p = parseOhm(Object.values(EXAMPLES)[1]).project;
    const m = runProject(p);
    const l = lifetime(p, m);
    expect(l.fit).toBeGreaterThan(0);
    expect(l.mtbf).toBeGreaterThan(1000);
    expect(Array.isArray(powerIntegrity(p, m))).toBe(true);
    expect(signalIntegrity(p).every((r) => r.z0 > 20 && r.z0 < 200)).toBe(true);
    expect(emcCheck(p).length).toBeGreaterThan(0);
  });
});
