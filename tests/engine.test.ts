import { describe, it, expect } from 'vitest';
import { Engine } from '../src/sim/engine';
import { emptyProject, type Project } from '../src/ohm/model';

function blinkProject(): Project {
  const p = emptyProject('Blink');
  p.parts = [
    { id: 'U1', type: 'arduino-uno', props: { usb: true }, x: 0, y: 0, rot: 0 },
    { id: 'R1', type: 'widerstand', props: { wert: '220' }, x: 300, y: 0, rot: 0 },
    { id: 'D1', type: 'led', props: { farbe: 'rot' }, x: 300, y: 60, rot: 0 },
  ];
  p.nets = [
    { name: 'N1', pins: ['U1.D13', 'R1.1'] },
    { name: 'N2', pins: ['R1.2', 'D1.A'] },
    { name: 'GND', pins: ['D1.K', 'U1.GND'] },
  ];
  return p;
}

const BLINK = `
const int LED = 13;
int n = 0;
void setup() {
  pinMode(LED, OUTPUT);
  Serial.begin(9600);
  Serial.println("Start");
}
void loop() {
  digitalWrite(LED, HIGH);
  delay(500);
  digitalWrite(LED, LOW);
  delay(500);
  n++;
  Serial.print("n=");
  Serial.println(n);
}
`;

describe('Engine + Arduino', () => {
  it('lässt eine LED blinken und gibt seriell aus', () => {
    const e = new Engine(blinkProject());
    let out = '';
    e.onSerial = (_id, t) => (out += t);
    e.setCode('U1', BLINK);
    e.start();
    const st = () => e.states.get('D1')!;
    // 0,25 s → an
    for (let i = 0; i < 250; i++) e.step(0.001);
    expect(st().brightness).toBeGreaterThan(0.5);
    expect(st().i).toBeGreaterThan(0.01);
    for (let i = 0; i < 500; i++) e.step(0.001);
    expect(st().brightness).toBeLessThan(0.05);
    for (let i = 0; i < 1500; i++) e.step(0.001);
    expect(out).toContain('Start');
    expect(out).toContain('n=2');
    expect(e.messages.filter((m) => m.level === 'error')).toEqual([]);
  });

  it('erklärt Compilerfehler verständlich', () => {
    const e = new Engine(blinkProject());
    const err = e.setCode('U1', 'void setup() { pinMode(13, OUTPUT) }\nvoid loop() {}');
    e.start();
    const msg = e.messages.map((m) => m.text).join('\n');
    expect(msg).toMatch(/Semikolon/);
    void err;
  });

  it('LED ohne Vorwiderstand brennt durch', () => {
    const p = blinkProject();
    p.parts = p.parts.filter((x) => x.id !== 'R1');
    p.nets = [
      { name: 'N1', pins: ['U1.5V', 'D1.A'] },
      { name: 'GND', pins: ['D1.K', 'U1.GND'] },
    ];
    const e = new Engine(p);
    e.start();
    for (let i = 0; i < 200; i++) e.step(0.001);
    expect(e.states.get('D1')!.burnt).toBe(true);
    expect(e.messages.some((m) => /durchgebrannt/.test(m.text))).toBe(true);
  });

  it('Taster mit INPUT_PULLUP wird gelesen', () => {
    const p = blinkProject();
    p.parts.push({ id: 'SW1', type: 'taster', props: {}, x: 400, y: 0, rot: 0 });
    p.nets.push({ name: 'BTN', pins: ['U1.D2', 'SW1.1'] }, { name: 'GND2', pins: ['SW1.2', 'U1.GND_2'] });
    const e = new Engine(p);
    let out = '';
    e.onSerial = (_id, t) => (out += t);
    e.setCode('U1', `void setup(){ pinMode(2, INPUT_PULLUP); Serial.begin(9600);} void loop(){ Serial.println(digitalRead(2)); delay(100);} `);
    e.start();
    for (let i = 0; i < 150; i++) e.step(0.001);
    expect(out.trim().split(/\s+/)[0]).toBe('1');
    e.states.get('SW1')!.pressed = true;
    out = '';
    for (let i = 0; i < 250; i++) e.step(0.001);
    expect(out).toContain('0');
  });
});
