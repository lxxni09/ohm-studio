import { describe, expect, it } from 'vitest';
import { costs, enclosureSummary, offlineQuestions, orderSteps, pcbSummary, selfCheck, templateFor } from '../src/ai/idea';
import { EXAMPLES } from '../src/examples';

describe('Idee rein, Platine raus (ohne KI)', () => {
  it('stellt höchstens 3 sinnvolle Rückfragen', () => {
    expect(offlineQuestions('Ein Nachtlicht').length).toBeGreaterThan(0);
    expect(offlineQuestions('Ein Nachtlicht mit ESP32 am USB')).toEqual([]);
  });
  it('wählt die passende Vorlage', () => {
    const b = templateFor('Pflanze gießen erinnern', {});
    expect(b.quelle).toBe('vorlage');
    expect(b.text).toMatch(/Pflanzen/i);
  });
  it('Selbstprüfung: Beispiel besteht, kaputte Datei fällt durch', () => {
    const ok = selfCheck(EXAMPLES['blink']);
    expect(ok.fehler).toEqual([]);
    expect(ok.ok).toBe(true);
    const bad = selfCheck('name: x\nteile:\n  - id: R1\n    typ: gibtsnicht\n');
    expect(bad.ok).toBe(false);
    expect(bad.fehler.length).toBeGreaterThan(0);
  });
  it('Platine, Gehäuse, Kosten, Bestellschritte', () => {
    const p = selfCheck(EXAMPLES['ampel']).project!;
    const pcb = pcbSummary(p);
    expect(pcb.breiteMm).toBeGreaterThan(10);
    expect(pcb.ungeroutet).toBe(0);
    expect(enclosureSummary(p).aussen.x).toBeGreaterThan(pcb.breiteMm);
    const c = costs(p);
    expect(c.map((r) => r.stueck)).toEqual([1, 5, 100]);
    expect(c[2].proStueck).toBeLessThan(c[0].proStueck);
    expect(orderSteps(p).some((s) => /Eltern/.test(s.text))).toBe(true);
  });
});

describe('Selbstprüfung erkennt echte Fehler', () => {
  const led = (vor: string) => `ohm: 1\nname: LED\nteile:\n  U1: { typ: arduino-uno }\n  D1: { typ: led, farbe: rot }\n${vor}netze:\n  A: [U1.D13, ${vor ? 'R1.1]\n  B: [R1.2, D1.A]' : 'D1.A]'}\n  GND: [U1.GND, D1.K]\ncode:\n  ziel: U1\n  datei: |\n    void setup(){ pinMode(13, OUTPUT); digitalWrite(13, HIGH); }\n    void loop(){}\n`;
  it('LED ohne Vorwiderstand fällt durch, mit Vorwiderstand nicht', () => {
    const bad = selfCheck(led(''));
    expect(bad.ok).toBe(false);
    expect(bad.fehler.join(' ')).toMatch(/Vorwiderstand|mA/);
    const good = selfCheck(led('  R1: { typ: widerstand, wert: 220 }\n'));
    expect(good.fehler).toEqual([]);
  });
  it('alle 10 Beispiele bestehen die Selbstprüfung (keine Fehlalarme)', () => {
    for (const [k, t] of Object.entries(EXAMPLES)) expect([k, selfCheck(t).fehler]).toEqual([k, []]);
  }, 60000);
});

describe('Kosten', () => {
  it('100 Platinen kosten mehr als 5 (Aktionspreis nur bis 10 Stück)', () => {
    const c = costs(selfCheck(EXAMPLES['ampel']).project!);
    expect(c[2].platine).toBeGreaterThan(c[1].platine);
  });
});
