import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseOhm, serializeOhm } from '../src/ohm/format';
import { Engine } from '../src/sim/engine';

const src = readFileSync(new URL('../examples/schluessel-tuerwaechter.ohm', import.meta.url), 'utf8');

describe('.ohm-Format', () => {
  it('lädt das Beispiel ohne Fehler', () => {
    const { project, issues } = parseOhm(src);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(project.parts.length).toBe(13);
    expect(project.code[0].ziel).toBe('U1');
    expect(project.parts.find((p) => p.id === 'TAG1')!.props.entfernung).toBe(0.5);
  });

  it('erklärt Fehler verständlich', () => {
    const bad = `ohm: 1\nteile:\n  R1: { typ: wiederstand, wert: 1k }\n  D1: { typ: led }\nnetze:\n  A: [R1.1, D1.X]\n`;
    const { issues } = parseOhm(bad);
    const txt = issues.map((i) => i.text).join('\n');
    expect(txt).toMatch(/Meintest du „widerstand“/);
  });

  it('Speichern und erneut Laden ergibt dasselbe Projekt', () => {
    const { project } = parseOhm(src);
    const again = parseOhm(serializeOhm(project));
    expect(again.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(again.project.parts.map((p) => p.id)).toEqual(project.parts.map((p) => p.id));
    expect(again.project.nets.length).toBe(project.nets.length);
    expect(again.project.code[0].datei).toBe(project.code[0].datei);
  });

  it('Türwächter: Lernen und Alarm funktionieren in der Simulation', () => {
    const { project } = parseOhm(src);
    const e = new Engine(project);
    let out = '';
    e.onSerial = (_id, t) => (out += t);
    e.setCode('U1', project.code[0].datei);
    e.start();
    const run = (s: number) => {
      for (let i = 0; i < s * 1000; i++) e.step(0.001);
    };
    run(0.5);
    expect(e.messages.filter((m) => m.level === 'error').map((m) => m.text)).toEqual([]);
    // Schritt 1: SW2 drücken, Anhänger ganz nah
    const tag = project.parts.find((p) => p.id === 'TAG1')!;
    tag.props.entfernung = 0.1;
    e.states.get('SW2')!.pressed = true;
    let blinks = 0;
    let last = 0;
    for (let i = 0; i < 6000; i++) {
      e.step(0.001);
      if (i === 300) e.states.get('SW2')!.pressed = false;
      const b = (e.states.get('D1')!.brightness ?? 0) > 0.3 ? 1 : 0;
      if (b && !last) blinks++;
      last = b;
    }
    expect(out).toContain('Gelernt: aa:bb:cc:dd:ee:ff');
    expect(blinks).toBe(5);
    // Lernfenster abwarten → Deep-Sleep
    run(6);
    expect(out).toContain('Gehe schlafen');
    // Schritt 2: Magnet wegziehen, Anhänger weit weg
    const mag = project.parts.find((p) => p.id === 'MAG1')!;
    mag.x += 400;
    tag.props.entfernung = 20;
    let beepAt = -1;
    for (let i = 0; i < 3000; i++) {
      e.step(0.001);
      if (beepAt < 0 && (e.states.get('BZ1')!.sound ?? 0) > 0) beepAt = i;
    }
    expect(out).toContain('ALARM');
    expect(beepAt).toBeGreaterThan(0);
    expect(beepAt).toBeLessThan(3000);
  });
});
