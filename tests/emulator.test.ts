import { describe, it, expect } from 'vitest';
import { Engine } from '../src/sim/engine';
import { emptyProject } from '../src/ohm/model';
import { loadMicroPython } from '../src/mcu/cores/rp2040';

/** Intel-HEX aus 16-Bit-Wörtern erzeugen */
function toHex(words: number[]): string {
  const bytes: number[] = [];
  for (const w of words) bytes.push(w & 0xff, w >> 8);
  const lines: string[] = [];
  for (let a = 0; a < bytes.length; a += 16) {
    const chunk = bytes.slice(a, a + 16);
    const rec = [chunk.length, (a >> 8) & 0xff, a & 0xff, 0, ...chunk];
    const sum = (-rec.reduce((x, y) => x + y, 0)) & 0xff;
    lines.push(':' + [...rec, sum].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase());
  }
  lines.push(':00000001FF');
  return lines.join('\n');
}

describe('Präzisionsmodus: echte Emulatoren', () => {
  it('AVR (avr8js) führt Maschinencode aus: LED an D13 und UART-Ausgabe', () => {
    const p = emptyProject();
    p.parts = [
      { id: 'U1', type: 'arduino-uno', props: {}, x: 0, y: 0, rot: 0 },
      { id: 'R1', type: 'widerstand', props: { wert: '220' }, x: 300, y: 0, rot: 0 },
      { id: 'D1', type: 'led', props: {}, x: 300, y: 60, rot: 0 },
    ];
    p.nets = [
      { name: 'A', pins: ['U1.D13', 'R1.1'] },
      { name: 'B', pins: ['R1.2', 'D1.A'] },
      { name: 'GND', pins: ['D1.K', 'U1.GND'] },
    ];
    // ldi r16,0x20; out DDRB; out PORTB; ldi r16,8; sts UCSR0B; ldi r16,'H'; sts UDR0; rjmp .
    const hex = toHex([0xe200, 0xb904, 0xb905, 0xe008, 0x9300, 0x00c1, 0xe408, 0x9300, 0x00c6, 0xcfff]);
    const e = new Engine(p);
    let out = '';
    e.onSerial = (_i, t) => (out += t);
    e.setCode('U1', hex, 'hex');
    e.start();
    for (let i = 0; i < 50; i++) e.step(0.001);
    expect(e.mcus.get('U1')!.runtime.kind).toBe('avr');
    expect(e.states.get('D1')!.brightness).toBeGreaterThan(0.4);
    expect(out).toContain('H');
    const dbg = e.mcus.get('U1')!.runtime.debug!()!;
    expect(dbg.registers.find((r) => r.name === 'R16')!.value).toBe(0x48);
  });

  it('RP2040 (rp2040js) startet echtes MicroPython und schaltet GP25', async () => {
    await loadMicroPython();
    const p = emptyProject();
    p.parts = [{ id: 'U1', type: 'pico', props: {}, x: 0, y: 0, rot: 0 }];
    const e = new Engine(p);
    let out = '';
    e.onSerial = (_i, t) => (out += t);
    e.setCode('U1', 'from machine import Pin\nled = Pin(25, Pin.OUT)\nprint("Hallo aus MicroPython", 6*7)\nled.value(1)\n', 'micropython');
    await (e.mcus.get('U1')?.runtime as any)?.ready?.();
    e.start();
    await (e.mcus.get('U1')!.runtime as any).ready();
    for (let i = 0; i < 4000 && !out.includes('42'); i++) e.step(0.001);
    expect(out).toContain('Hallo aus MicroPython 42');
    for (let i = 0; i < 50; i++) e.step(0.001);
    expect(e.states.get('U1')!.led25).toBeGreaterThan(0.5);
  }, 120000);
});
