import { describe, it, expect } from 'vitest';
import { Engine, computeConnectivity } from '../src/sim/engine';
import { emptyProject } from '../src/ohm/model';
import { breadboardHoles } from '../src/parts/library/basic';
import { compileSketch } from '../src/mcu/compiler';

describe('Steckbrett', () => {
  it('verbindet Pins, die in derselben Spalte stecken', () => {
    const p = emptyProject();
    const { holes } = breadboardHoles(false);
    const a = holes.find((h) => h.id === 'a5')!;
    p.parts = [
      { id: 'BB1', type: 'steckbrett', props: {}, x: 0, y: 0, rot: 0 },
      // Widerstand: Pin 1 bei (0,5) lokal → in Loch a5 setzen
      { id: 'R1', type: 'widerstand', props: { wert: '1k' }, x: a.x, y: a.y - 5, rot: 0 },
      { id: 'R2', type: 'widerstand', props: { wert: '1k' }, x: a.x, y: a.y + 20 - 5, rot: 0 },
    ];
    const c = computeConnectivity(p);
    expect(c.root.get('R1.1')).toBe(c.root.get('R2.1'));
    expect(c.root.get('R1.2')).not.toBe(c.root.get('R1.1'));
  });
});

describe('NeoPixel', () => {
  it('Farben kommen am Streifen an', () => {
    const p = emptyProject();
    p.parts = [
      { id: 'U1', type: 'esp32-devkit', props: {}, x: 0, y: 0, rot: 0 },
      { id: 'LED1', type: 'ws2812-strip', props: {}, x: 200, y: 0, rot: 0 },
    ];
    p.nets = [
      { name: 'V', pins: ['U1.5V', 'LED1.VCC'] },
      { name: 'GND', pins: ['U1.GND', 'LED1.GND'] },
      { name: 'D', pins: ['U1.IO5', 'LED1.DIN'] },
    ];
    const e = new Engine(p);
    e.setCode('U1', `#include <Adafruit_NeoPixel.h>
Adafruit_NeoPixel s(8, 5, NEO_GRB + NEO_KHZ800);
void setup(){ s.begin(); s.setPixelColor(2, s.Color(255,0,0)); s.show(); }
void loop(){ delay(100); }`);
    e.start();
    for (let i = 0; i < 100; i++) e.step(0.001);
    expect(e.messages.filter((m) => m.level === 'error')).toEqual([]);
    expect(e.states.get('LED1')!.pixels[2][0]).toBeGreaterThan(200);
  });
});

describe('Übersetzer', () => {
  const env = { intBits: 16, constants: { HIGH: 1, LOW: 0 }, classes: [], objects: ['Serial'] };
  it('int ist auf AVR 16 Bit (Überlauf wie in echt)', () => {
    const prog = compileSketch(`int x; void setup(){ x = 300 * 300; } void loop(){}`, env);
    expect(prog.code).toContain('rt.wrap');
  });
  it('Fehlermeldungen sind verständlich', () => {
    expect(() => compileSketch(`void setup(){ foo(); } void loop(){}`, env)).toThrow(/gibt es nicht/);
    expect(() => compileSketch(`void setup(){ int a = b; } void loop(){}`, env)).toThrow(/nicht bekannt/);
    expect(() => compileSketch(`void loop(){}`, env)).toThrow(/setup/);
  });
});

import { erc } from '../src/eda/erc';
import { drc } from '../src/eda/drc';
import { parseOhm } from '../src/ohm/format';
import { readFileSync } from 'node:fs';

describe('ERC/DRC', () => {
  it('ERC findet Pegelkonflikt und fehlende Versorgung', () => {
    const p = emptyProject();
    p.parts = [
      { id: 'U1', type: 'esp32-devkit', props: {}, x: 0, y: 0, rot: 0 },
      { id: 'S1', type: 'hc-sr04', props: {}, x: 300, y: 0, rot: 0 },
    ];
    p.nets = [{ name: 'ECHO', pins: ['U1.IO18', 'S1.ECHO'] }, { name: 'TRIG', pins: ['U1.IO5', 'S1.TRIG'] }];
    const t = erc(p).map((i) => i.text).join('\n');
    expect(t).toMatch(/Pegelkonflikt/);
    expect(t).toMatch(/keine Versorgung|keine Masse/);
  });
  it('DRC der Beispiele ist sauber (JLCPCB)', () => {
    const { project } = parseOhm(readFileSync(new URL('../examples/schluessel-tuerwaechter.ohm', import.meta.url), 'utf8'));
    expect(drc(project, 'jlcpcb').filter((v) => v.level === 'error')).toEqual([]);
  });
});
