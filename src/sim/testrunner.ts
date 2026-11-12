/**
 * Führt die Testschritte aus der .ohm-Datei automatisch aus.
 * Versteht einfache deutsche Sätze wie „SW2 drücken“, „TAG1.entfernung = 0.1m“,
 * „MAG1 wegziehen“ und Erwartungen wie „D1 blinkt 5x“, „BZ1 piept innerhalb von 3s“.
 */
import { Engine } from './engine';
import type { Project, TestStep } from '../ohm/model';

export interface TestResult {
  ok: boolean | null;
  detail: string;
}

function clone(p: Project): Project {
  return JSON.parse(JSON.stringify(p));
}

function parseNum(v: string): number | string | boolean {
  const s = v.trim().replace(/^["']|["']$/g, '');
  if (s === 'true' || s === 'an' || s === 'ja') return true;
  if (s === 'false' || s === 'aus' || s === 'nein') return false;
  const m = /^(-?\d+(?:[.,]\d+)?)\s*(m|cm|mm|s|ms|°C|%|lx|V)?$/.exec(s);
  if (m) {
    let n = parseFloat(m[1].replace(',', '.'));
    if (m[2] === 'cm') n /= 100;
    if (m[2] === 'mm') n /= 1000;
    return n;
  }
  return s;
}

export function runTests(project: Project, tests: TestStep[] = project.tests): TestResult[] {
  const p = clone(project);
  const e = new Engine(p);
  let serial = '';
  e.onSerial = (_id, t) => (serial += t);
  for (const c of p.code) e.setCode(c.ziel, c.datei);
  e.start();
  const run = (sec: number, each?: () => void) => {
    const n = Math.round(sec / p.settings.dt);
    for (let i = 0; i < n; i++) {
      e.step(p.settings.dt);
      each?.();
    }
  };
  run(0.3);
  const results: TestResult[] = [];
  for (const t of tests) {
    const releases: (() => void)[] = [];
    let understood = true;
    const actions = t.schritt.split(/,|\bund\b|;/).map((s) => s.trim()).filter(Boolean);
    serial = '';
    for (const a of actions) {
      let m: RegExpExecArray | null;
      if ((m = /^(\w+)\.(\w+)\s*=\s*(.+)$/.exec(a))) {
        const inst = p.parts.find((x) => x.id === m![1]);
        if (inst) {
          inst.props[m[2]] = parseNum(m[3]);
          e.markDirty();
        } else understood = false;
      } else if ((m = /^(\w+)\s+(drücken|druecken|gedrückt halten|drücken und halten)/i.exec(a))) {
        const id = m[1];
        const hold = /halten/.test(m[2]);
        e.stateOf(id).pressed = true;
        e.markDirty();
        if (!hold) releases.push(() => void (e.stateOf(id).pressed = false));
      } else if ((m = /^(\w+)\s+(wegziehen|entfernen|wegnehmen)/i.exec(a))) {
        const inst = p.parts.find((x) => x.id === m![1]);
        if (inst) inst.x += 500;
        else understood = false;
      } else if ((m = /^(\w+)\s+(heranziehen|annähern|hinlegen|zurück)/i.exec(a))) {
        const inst = p.parts.find((x) => x.id === m![1]);
        const orig = project.parts.find((x) => x.id === m![1]);
        if (inst && orig) {
          inst.x = orig.x;
          inst.y = orig.y;
        } else understood = false;
      } else if ((m = /^(\w+)\s+(einschalten|anschalten|an)$/i.exec(a))) {
        const inst = p.parts.find((x) => x.id === m![1]);
        if (inst) inst.props.an = true;
      } else if ((m = /^(\w+)\s+(ausschalten|aus)$/i.exec(a))) {
        const inst = p.parts.find((x) => x.id === m![1]);
        if (inst) inst.props.an = false;
      } else if ((m = /warte\w*\s+(\d+(?:[.,]\d+)?)\s*s/i.exec(a))) {
        run(parseFloat(m[1].replace(',', '.')));
      } else if (/^(simulation starten|start|nichts tun|einschalten)$/i.test(a)) {
        // nichts zu tun
      } else if (/\(.*\)/.test(a)) {
        // Kommentar in Klammern
      } else understood = false;
    }
    // Erwartung auswerten
    const exp = t.erwartet;
    let m: RegExpExecArray | null;
    let res: TestResult;
    const within = /innerhalb von\s*(\d+(?:[.,]\d+)?)\s*s/i.exec(exp);
    const T = within ? parseFloat(within[1].replace(',', '.')) : 8;
    if ((m = /(\w+)\s+blinkt\s+(mindestens\s+)?(\d+)\s*(x|mal)/i.exec(exp))) {
      const id = m[1];
      const atLeast = !!m[2];
      const want = Number(m[3]);
      let blinks = 0;
      let last = 0;
      let k = 0;
      run(within ? T : T + 2, () => {
        if (k++ === 300) releases.forEach((r) => r());
        const b = (e.states.get(id)?.brightness ?? 0) > 0.3 ? 1 : 0;
        if (b && !last) blinks++;
        last = b;
      });
      res = { ok: atLeast ? blinks >= want : blinks === want, detail: `${id} hat ${blinks}× geblinkt (erwartet ${atLeast ? 'mindestens ' : ''}${want}×)` };
    } else if ((m = /(\w+)\s+(piept|summt|klingelt|ertönt)/i.exec(exp))) {
      const id = m[1];
      let at = -1;
      let tt = 0;
      let k = 0;
      run(T, () => {
        if (k++ === 300) releases.forEach((r) => r());
        tt += p.settings.dt;
        if (at < 0 && (e.states.get(id)?.sound ?? 0) > 0) at = tt;
      });
      res = { ok: at >= 0, detail: at >= 0 ? `${id} piept nach ${at.toFixed(2)} s` : `${id} hat innerhalb von ${T} s nicht gepiept` };
    } else if ((m = /(\w+)\s+(leuchtet|ist an|geht an)/i.exec(exp))) {
      const id = m[1];
      let on = false;
      run(within ? T : 3, () => {
        if ((e.states.get(id)?.brightness ?? 0) > 0.3) on = true;
      });
      releases.forEach((r) => r());
      res = { ok: on, detail: on ? `${id} leuchtet` : `${id} leuchtet nicht` };
    } else if ((m = /(\w+)\s+(ist aus|leuchtet nicht|bleibt aus|geht aus)/i.exec(exp))) {
      const id = m[1];
      let on = false;
      run(Math.min(T, 3), () => {
        if ((e.states.get(id)?.brightness ?? 0) > 0.3) on = true;
      });
      releases.forEach((r) => r());
      res = { ok: !on, detail: on ? `${id} leuchtet (sollte aus sein)` : `${id} bleibt aus` };
    } else if ((m = /(?:serial|serieller monitor|ausgabe)\D*?["„“](.+?)["“”]/i.exec(exp))) {
      const txt = m[1];
      let found = false;
      run(T, () => {
        if (!found && serial.includes(txt)) found = true;
      });
      releases.forEach((r) => r());
      res = { ok: found, detail: found ? `„${txt}“ erschien im seriellen Monitor` : `„${txt}“ kam nicht` };
    } else if ((m = /(\w+)\s+zeigt\s+["„“]?(.+?)["“”]?$/i.exec(exp))) {
      const id = m[1];
      const txt = m[2];
      let found = false;
      run(T, () => {
        const st = e.states.get(id);
        const shown = [...(st?.lines ?? []), st?.text ?? ''].join('\n');
        if (shown.includes(txt)) found = true;
      });
      releases.forEach((r) => r());
      res = { ok: found, detail: found ? `${id} zeigt „${txt}“` : `${id} zeigt „${txt}“ nicht` };
    } else {
      run(Math.min(T, 3));
      releases.forEach((r) => r());
      res = { ok: null, detail: 'Diese Erwartung kann ich (noch) nicht automatisch prüfen – bitte selbst beobachten.' };
    }
    if (!understood) res.detail += ' · Hinweis: Nicht alle Schritte wurden verstanden.';
    results.push(res);
  }
  return results;
}
