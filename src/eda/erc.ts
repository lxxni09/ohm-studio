/**
 * ERC – Electrical Rule Check.
 * Findet offene Eingänge, fehlende Versorgung, Kurzschlüsse zwischen Quellen,
 * Pegelkonflikte (5 V an 3,3-V-Pins), Ausgang-gegen-Ausgang und lose Netze.
 */
import { getPart, findPin } from '../parts/registry';
import { computeConnectivity } from '../sim/engine';
import { splitRef, type Project } from '../ohm/model';
import type { Issue } from '../ohm/format';
import type { PinDef } from '../parts/types';

interface PinInfo {
  part: string;
  type: string;
  pin: PinDef;
  ref: string;
}

/** Spannung, die ein Pin als Quelle treibt (V), oder null */
function sourceVoltage(type: string, pin: PinDef, props: Record<string, any>): number | null {
  const def = getPart(type);
  if (!def) return null;
  if (def.board) {
    if (pin.power === '5v') return def.board.vcc === 5 || props.usb !== false ? 5 : null;
    if (pin.power === '3v3') return 3.3;
    return null;
  }
  if (def.category === 'Stromversorgung' && (pin.id === '+' || pin.id === 'OUT+')) {
    if (type === 'usb-netzteil') return 5;
    if (type === 'labornetzteil') return Number(props.spannung ?? 5);
    return -1; // Quelle unbekannter Spannung (Batterie)
  }
  if (/^(LM7805|AMS1117|HT7333)/.test(def.type) && pin.id === 'OUT') return def.type.includes('3.3') || def.type === 'HT7333' ? 3.3 : 5;
  return null;
}

/** Eingänge von ICs/Modulen, die nicht offen bleiben dürfen */
function isCriticalInput(type: string, pinId: string): boolean {
  if (/^74hc/.test(type)) return /^\dA$|^\dB$|^SER$|^SRCLK$|^RCLK$|^OE$|^SRCLR$/.test(pinId);
  if (type === 'lm358') return /IN\d[+-]/.test(pinId);
  if (type === 'ne555') return ['TRIG', 'THR', 'RESET'].includes(pinId);
  if (type === 'cd4017') return ['CLK', 'EN', 'MR'].includes(pinId);
  if (['l298n', 'drv8833', 'a4988'].includes(type)) return /^(IN\d|AIN\d|BIN\d|STEP|DIR)$/.test(pinId);
  return false;
}

function isPowerIn(def: ReturnType<typeof getPart>, pin: PinDef): boolean {
  if (!def || def.board) return false;
  if (def.category === 'Stromversorgung' || def.category === 'Messgeräte' || def.category === 'Aufbau') return false;
  return /^(VCC|VDD|VIN|V\+|3\.3V|\+5V|5V|12V|VM|VMOT)$/i.test(pin.id) || pin.id === 'GND' || pin.id === 'VSS';
}

export function erc(project: Project): Issue[] {
  const issues: Issue[] = [];
  const conn = computeConnectivity(project);
  const byId = new Map(project.parts.map((p) => [p.id, p]));
  const pinsByRoot = new Map<string, PinInfo[]>();
  for (const inst of project.parts) {
    const def = getPart(inst.type);
    if (!def) continue;
    for (const pin of def.pins(inst.props)) {
      if (pin.x < -100) continue;
      const ref = `${inst.id}.${pin.id}`;
      const root = conn.root.get(ref);
      if (!root) continue;
      if (!pinsByRoot.has(root)) pinsByRoot.set(root, []);
      pinsByRoot.get(root)!.push({ part: inst.id, type: inst.type, pin, ref });
    }
  }
  // Anzahl verschiedener Teile je Netz (einmal berechnet – sonst O(n²) bei großen GND-/VCC-Netzen)
  const partsInRoot = new Map<string, Set<string>>();
  for (const [r, ps] of pinsByRoot) partsInRoot.set(r, new Set(ps.map((q) => q.part)));
  const isolated = (p: PinInfo) => {
    const set = partsInRoot.get(conn.root.get(p.ref)!);
    return !set || set.size === 0 || (set.size === 1 && set.has(p.part));
  };
  const netName = (p: PinInfo) => conn.names.get(conn.root.get(p.ref)!) ?? 'unbenannt';
  for (const inst of project.parts) {
    const def = getPart(inst.type);
    if (!def || inst.type.startsWith('steckbrett')) continue;
    const pins = def.pins(inst.props).filter((p) => p.x > -100);
    const used = pins.filter((p) => !isolated({ part: inst.id, type: inst.type, pin: p, ref: `${inst.id}.${p.id}` }));
    if (!used.length) continue; // Teil gar nicht angeschlossen → Lint meldet das bereits
    for (const pin of pins) {
      const info = { part: inst.id, type: inst.type, pin, ref: `${inst.id}.${pin.id}` };
      if (!isolated(info)) continue;
      if (isPowerIn(def, pin)) issues.push({ level: 'error', text: `ERC: ${inst.id}.${pin.id} ist nicht angeschlossen – ${def.name} bekommt keine ${pin.id === 'GND' || pin.id === 'VSS' ? 'Masse' : 'Versorgung'}.`, part: inst.id });
      else if (isCriticalInput(inst.type, pin.id)) issues.push({ level: 'warn', text: `ERC: Eingang ${inst.id}.${pin.id} ist offen. Offene CMOS-Eingänge schwingen und erzeugen zufällige Zustände – auf GND oder VCC legen.`, part: inst.id });
    }
  }
  for (const [, pins] of pinsByRoot) {
    // Mehrere feste Spannungsquellen im selben Netz
    const sources = pins
      .map((p) => ({ p, v: sourceVoltage(p.type, p.pin, byId.get(p.part)!.props) }))
      .filter((x) => x.v !== null) as { p: PinInfo; v: number }[];
    const fixed = sources.filter((s) => s.v > 0);
    const distinct = [...new Set(fixed.map((s) => s.v))];
    if (distinct.length > 1) issues.push({ level: 'error', text: `ERC: Kurzschluss zwischen Spannungsquellen im Netz „${netName(pins[0])}“: ${fixed.map((s) => `${s.p.ref} (${s.v} V)`).join(', ')}.`, part: fixed[0].p.part });
    // Versorgung direkt auf Masse
    const gnd = pins.some((p) => p.pin.power === 'gnd' || (p.pin.id === '-' && getPart(p.type)?.category === 'Stromversorgung'));
    if (gnd && sources.length) issues.push({ level: 'error', text: `ERC: ${sources[0].p.ref} ist direkt mit Masse verbunden – das ist ein Kurzschluss.`, part: sources[0].p.part });
    // Ausgang gegen Ausgang: zwei MCU-GPIOs
    const gpios = pins.filter((p) => getPart(p.type)?.board && p.pin.gpio !== undefined && !p.pin.power);
    if (gpios.length > 1 && new Set(gpios.map((g) => g.part)).size > 1) issues.push({ level: 'warn', text: `ERC: GPIOs zweier Mikrocontroller sind direkt verbunden (${gpios.map((g) => g.ref).join(', ')}). Wenn beide Ausgang sind, entsteht ein Kurzschluss – Vorwiderstand einplanen.`, part: gpios[0].part });
    // Pegel: 5-V-Signale an 3,3-V-Mikrocontrollern
    const low = pins.filter((p) => getPart(p.type)?.board?.vcc === 3.3 && p.pin.gpio !== undefined && !p.pin.power);
    if (low.length) {
      const five = pins.filter((p) => {
        const def = getPart(p.type);
        if (def?.board?.vcc === 5 && p.pin.gpio !== undefined && !p.pin.power) return true;
        if (sourceVoltage(p.type, p.pin, byId.get(p.part)!.props) === 5) return true;
        return p.type === 'hc-sr04' && p.pin.id === 'ECHO';
      });
      if (five.length) issues.push({ level: 'warn', text: `ERC: Pegelkonflikt – ${five.map((f) => f.ref).join(', ')} liefert 5 V an ${low.map((l) => l.ref).join(', ')} (nur 3,3 V verträglich). Pegelwandler oder Spannungsteiler einsetzen.`, part: low[0].part });
    }
  }
  // Netze mit nur einem Pin
  for (const n of project.nets) {
    const real = n.pins.filter((r) => {
      const [pid, pn] = splitRef(r);
      const inst = byId.get(pid);
      const def = inst && getPart(inst.type);
      return def && findPin(def, inst!.props, pn);
    });
    if (real.length === 1) issues.push({ level: 'warn', text: `ERC: Netz „${n.name}“ hat nur einen Anschluss (${real[0]}).` });
  }
  return issues;
}
