/**
 * Das .ohm-Format: Laden, Prüfen, automatisch Platzieren und Speichern.
 */
import YAML from 'yaml';
import { emptyProject, splitRef, type Project, type PartInst, type Net, type CodeBlock } from './model';
import { getPart, suggestTypes, findPin, ALL_PARTS, registerPart } from '../parts/registry';
import { customIc } from '../parts/library/ics';
import { erc } from '../eda/erc';

export type IssueLevel = 'error' | 'warn' | 'info';
export interface Issue {
  level: IssueLevel;
  text: string;
  line?: number;
  part?: string;
}

const MM_PER_UNIT = 0.254;

const KEY_SYNONYMS: Record<string, string> = {
  parts: 'teile',
  components: 'teile',
  bauteile: 'teile',
  nets: 'netze',
  connections: 'verbindungen',
  wires: 'verbindungen',
  project: 'projekt',
  views: 'ansichten',
  tests: 'test',
  type: 'typ',
  value: 'wert',
  position: 'pos',
  rotation: 'dreh',
  name: 'name',
  author: 'autor',
  description: 'beschreibung',
  target: 'ziel',
  language: 'sprache',
  file: 'datei',
  source: 'datei',
  step: 'schritt',
  expect: 'erwartet',
  expected: 'erwartet',
};

function syn(k: string): string {
  return KEY_SYNONYMS[k] ?? KEY_SYNONYMS[k.toLowerCase()] ?? k;
}

function lineOf(doc: YAML.Document.Parsed, path: (string | number)[]): number | undefined {
  try {
    const node = doc.getIn(path, true) as YAML.Node | undefined;
    const range = node?.range;
    if (!range) return undefined;
    return lineFromOffset((doc as any).__src ?? '', range[0]);
  } catch {
    return undefined;
  }
}

// Zeilenanfänge einmal je Quelltext berechnen, dann binär suchen (sonst O(n²) bei großen Projekten)
let lineSrc = '';
let lineStarts: number[] = [0];
function lineFromOffset(src: string, off: number): number {
  if (src !== lineSrc) {
    lineSrc = src;
    lineStarts = [0];
    for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= off) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Prop-Werte aus YAML (z. B. „100uF“, 0.5m) übernehmen */
function cleanProps(raw: Record<string, unknown>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k0, v] of Object.entries(raw)) {
    const k = syn(k0);
    if (['typ', 'pos', 'dreh', 'x', 'y'].includes(k)) continue;
    // „entfernung: 0.5m“ → 0.5
    if (typeof v === 'string' && /^-?\d+(\.\d+)?\s*(m|cm|mm|°C|%|lx|V)$/.test(v.trim()) && ['entfernung', 'temperatur', 'feuchte', 'lux', 'licht'].includes(k)) {
      const n = parseFloat(v);
      out[k] = /cm$/.test(v.trim()) && k === 'entfernung' ? n / 100 : /mm$/.test(v.trim()) ? n / 1000 : n;
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function parseOhm(text: string): { project: Project; issues: Issue[] } {
  const issues: Issue[] = [];
  const project = emptyProject();
  let doc: YAML.Document.Parsed;
  try {
    doc = YAML.parseDocument(text, { prettyErrors: true, uniqueKeys: false });
  } catch (e) {
    issues.push({ level: 'error', text: `Die Datei ist kein gültiges YAML: ${(e as Error).message}` });
    return { project, issues };
  }
  (doc as any).__src = text;
  for (const err of doc.errors) {
    const line = err.linePos?.[0]?.line;
    let msg = err.message.split('\n')[0];
    if (/Implicit keys need to be on a single line/.test(msg)) msg = 'Ein Schlüssel muss in einer Zeile stehen (fehlt ein Doppelpunkt?).';
    else if (/Nested mappings are not allowed in compact mappings/.test(msg)) msg = 'Verschachtelte Werte in einer Zeile sind nicht erlaubt – nutze { … } oder neue Zeilen.';
    else if (/bad indentation/i.test(msg)) msg = 'Die Einrückung stimmt nicht (YAML braucht gleichmäßige Leerzeichen, keine Tabs).';
    else if (/Map keys must be unique/.test(msg)) msg = 'Ein Name kommt doppelt vor.';
    issues.push({ level: 'error', text: `Zeile ${line ?? '?'}: ${msg}`, line });
  }
  if (doc.errors.length) return { project, issues };
  const raw = (doc.toJS() ?? {}) as Record<string, any>;
  const root: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw)) root[syn(k)] = v;

  if (root.ohm === undefined) issues.push({ level: 'warn', text: 'Die Versionsangabe „ohm: 1“ fehlt am Anfang der Datei. Ich nehme Version 1 an.' });
  else if (Number(root.ohm) !== 1) issues.push({ level: 'warn', text: `Unbekannte Formatversion ohm: ${root.ohm}. Diese Ohm-Studio-Version kennt Version 1.` });

  const pj = root.projekt ?? {};
  project.name = String(pj.name ?? root.name ?? 'Unbenanntes Projekt');
  project.autor = pj.autor ?? pj.author;
  project.beschreibung = pj.beschreibung ?? pj.description;

  // Teile
  // Eigene Bauteile zuerst registrieren
  if (Array.isArray(root.bibliothek)) {
    project.library = [];
    for (const b of root.bibliothek) {
      if (!b?.typ || !Array.isArray(b.pins) || !b.pins.length) continue;
      const cp = { typ: String(b.typ), name: String(b.name ?? b.typ), label: String(b.label ?? b.name ?? b.typ), pins: b.pins.map(String), ...(b.vcc ? { vcc: String(b.vcc) } : {}), ...(b.gnd ? { gnd: String(b.gnd) } : {}), ...(b.strom_mA ? { strom_mA: Number(b.strom_mA) } : {}), ...(b.hersteller ? { hersteller: String(b.hersteller) } : {}), ...(b.mpn ? { mpn: String(b.mpn) } : {}) };
      project.library.push(cp);
      registerPart(customIc({ type: cp.typ, name: cp.name, label: cp.label, pins: cp.pins, vcc: cp.vcc, gnd: cp.gnd, strom_mA: cp.strom_mA }));
    }
  }
  const teile = root.teile ?? {};
  if (Array.isArray(teile)) {
    issues.push({ level: 'error', text: '„teile“ muss eine Zuordnung sein (z. B. „R1: { typ: widerstand, wert: 220 }“), keine Liste.' });
  } else {
    for (const [id, val0] of Object.entries(teile as Record<string, any>)) {
      const val: Record<string, any> = typeof val0 === 'string' ? { typ: val0 } : { ...(val0 ?? {}) };
      for (const k of Object.keys(val)) if (syn(k) !== k) val[syn(k)] = val[k];
      const line = lineOf(doc, ['teile', id]) ?? lineOf(doc, [Object.keys(raw).find((k) => syn(k) === 'teile') ?? 'teile', id]);
      if (!val.typ) {
        issues.push({ level: 'error', text: `Teil „${id}“ hat keinen Typ. Beispiel: ${id}: { typ: widerstand, wert: 220 }`, line, part: id });
        continue;
      }
      const def = getPart(String(val.typ));
      if (!def) {
        const sug = suggestTypes(String(val.typ));
        issues.push({ level: 'error', text: `Teil „${id}“: Den Typ „${val.typ}“ kenne ich nicht. Meintest du ${sug.map((s) => `„${s}“`).join(', ')}?`, line, part: id });
        continue;
      }
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(id)) issues.push({ level: 'warn', text: `Der Name „${id}“ sollte nur aus Buchstaben, Ziffern und _ bestehen (z. B. R1, LED_ROT).`, line, part: id });
      const props = { ...def.defaults, ...cleanProps(val) };
      const inst: PartInst = { id, type: def.type, props, x: 0, y: 0, rot: Number(val.dreh ?? 0) || 0, auto: true };
      const pos = val.pos ?? (val.x !== undefined ? [val.x, val.y] : undefined);
      if (Array.isArray(pos) && pos.length >= 2) {
        inst.x = Number(pos[0]) / MM_PER_UNIT;
        inst.y = Number(pos[1]) / MM_PER_UNIT;
        inst.auto = false;
      }
      project.parts.push(inst);
    }
  }

  // Netze
  const netze = root.netze ?? {};
  const addNet = (name: string, pins: unknown, line?: number) => {
    if (!Array.isArray(pins)) {
      issues.push({ level: 'error', text: `Netz „${name}“ muss eine Liste von Pins sein, z. B. ${name}: [R1.1, U1.GND]`, line });
      return;
    }
    const list = pins.map(String);
    if (list.length < 2) issues.push({ level: 'warn', text: `Netz „${name}“ hat nur ${list.length} Pin – ein Netz verbindet mindestens zwei Pins.`, line });
    project.nets.push({ name, pins: list });
  };
  if (Array.isArray(netze)) netze.forEach((n, i) => addNet(String(n?.name ?? `N${i + 1}`), n?.pins ?? n, lineOf(doc, ['netze', i])));
  else for (const [name, pins] of Object.entries(netze as Record<string, unknown>)) addNet(name, pins, lineOf(doc, ['netze', name]));
  // Alternativ: Verbindungen als Paare
  const verb = root.verbindungen;
  if (Array.isArray(verb)) {
    verb.forEach((v: unknown, i: number) => {
      if (Array.isArray(v) && v.length >= 2) project.nets.push({ name: `V${i + 1}`, pins: v.map(String) });
      else if (typeof v === 'string' && v.includes('-')) {
        const [a, b] = v.split(/\s*-{1,2}>?\s*/);
        project.nets.push({ name: `V${i + 1}`, pins: [a, b] });
      }
    });
  }

  // Ansichten
  const av = root.ansichten ?? {};
  project.views = {
    steckbrett: av.steckbrett ?? 'auto',
    platine: { groesse: 'auto', lagen: 2, farbe: 'gruen', ...(av.platine ?? {}) },
    schaltplan: { symbole: 'IEC', ...(av.schaltplan ?? {}) },
    kabel: parseKabel(av.kabel),
  };
  if (root.einstellungen) {
    const e = root.einstellungen;
    if (e.geschwindigkeit) project.settings.speed = Number(e.geschwindigkeit);
    if (e.realismus !== undefined) project.settings.realism = !!e.realismus;
    if (e.zeitschritt) project.settings.dt = Number(e.zeitschritt);
  }

  // Varianten
  if (root.varianten && typeof root.varianten === 'object') {
    project.variants = {};
    for (const [name, v] of Object.entries(root.varianten as Record<string, any>)) project.variants[name] = { ohne: Array.isArray(v?.ohne) ? v.ohne.map(String) : [] };
    if (root.variante && project.variants[String(root.variante)]) project.activeVariant = String(root.variante);
  }

  // Platzierung auf der Platine (mm)
  if (root.platzierung && typeof root.platzierung === 'object') {
    (project as any).pcb = Object.fromEntries(Object.entries(root.platzierung as Record<string, any>).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, { x: Number(v[0]) / MM_PER_UNIT, y: Number(v[1]) / MM_PER_UNIT, rot: Number(v[2] ?? 0) }]));
  }
  // Teamarbeit
  if (Array.isArray(root.team)) project.team = root.team.filter((m: any) => m && m.name).map((m: any) => ({ name: String(m.name), rolle: ['betrachter', 'bearbeiter', 'pruefer', 'admin'].includes(m.rolle) ? m.rolle : 'bearbeiter' }));
  if (root.review && typeof root.review === 'object') {
    const r = root.review;
    project.review = {
      status: ['entwurf', 'in-pruefung', 'freigegeben', 'abgelehnt'].includes(r.status) ? r.status : 'entwurf',
      kommentare: Array.isArray(r.kommentare) ? r.kommentare.map((c: any, i: number) => ({ id: String(c.id ?? `k${i + 1}`), autor: String(c.autor ?? '?'), text: String(c.text ?? ''), wann: String(c.wann ?? ''), ...(c.teil ? { teil: String(c.teil) } : {}), ...(c.erledigt ? { erledigt: true } : {}), ...(Array.isArray(c.antworten) ? { antworten: c.antworten.map((a: any) => ({ autor: String(a.autor ?? '?'), text: String(a.text ?? ''), wann: String(a.wann ?? '') })) } : {}) })) : [],
      entscheidungen: Array.isArray(r.entscheidungen) ? r.entscheidungen.map((d: any) => ({ wer: String(d.wer ?? '?'), rolle: d.rolle ?? 'pruefer', wann: String(d.wann ?? ''), ergebnis: d.ergebnis ?? 'angefordert', ...(d.notiz ? { notiz: String(d.notiz) } : {}) })) : [],
    };
  }

  // Code
  const codeRaw = root.code;
  const codes: CodeBlock[] = [];
  const pushCode = (c: Record<string, any>) => {
    const cc: Record<string, any> = {};
    for (const [k, v] of Object.entries(c ?? {})) cc[syn(k)] = v;
    if (!cc.datei) return;
    let ziel = String(cc.ziel ?? '');
    if (!ziel) {
      const b = project.parts.find((p) => getPart(p.type)?.board);
      ziel = b?.id ?? '';
    }
    codes.push({ ziel, sprache: String(cc.sprache ?? 'arduino'), datei: String(cc.datei) });
  };
  if (Array.isArray(codeRaw)) codeRaw.forEach(pushCode);
  else if (codeRaw) pushCode(codeRaw);
  project.code = codes;

  // Tests
  if (Array.isArray(root.test)) {
    project.tests = root.test.map((t: Record<string, any>) => {
      const tt: Record<string, any> = {};
      for (const [k, v] of Object.entries(t ?? {})) tt[syn(k)] = v;
      return { schritt: String(tt.schritt ?? ''), erwartet: String(tt.erwartet ?? '') };
    });
  }

  issues.push(...validateProject(project, doc));
  autoPlace(project);
  return { project, issues };
}

function parseKabel(k: any): Project['views']['kabel'] {
  const map: Record<string, '90' | '45' | 'direkt' | 'weich'> = { '90': '90', '90°': '90', rechtwinklig: '90', '45': '45', '45°': '45', direkt: 'direkt', gerade: 'direkt', weich: 'weich', bezier: 'weich' };
  const out: NonNullable<Project['views']['kabel']> = { stil: map[String(k?.stil ?? '90')] ?? '90', kreuzungen: k?.kreuzungen === 'keine' ? 'keine' : 'bogen' };
  if (k?.knicke && typeof k.knicke === 'object') {
    out.knicke = {};
    for (const [key, pts] of Object.entries(k.knicke as Record<string, unknown>)) if (Array.isArray(pts)) out.knicke[key] = pts.filter(Array.isArray).map((p: any) => ({ x: Number(p[0]) / MM_PER_UNIT, y: Number(p[1]) / MM_PER_UNIT }));
  }
  if (k?.netze && typeof k.netze === 'object') {
    out.netze = {};
    for (const [n, st] of Object.entries(k.netze as Record<string, unknown>)) if (map[String(st)]) out.netze[n] = map[String(st)];
  }
  return out;
}

/** Prüfungen, die auch nach dem Bearbeiten in der App laufen */
export function validateProject(project: Project, doc?: YAML.Document.Parsed): Issue[] {
  const issues: Issue[] = [];
  const ids = new Set(project.parts.map((p) => p.id));
  const byId = new Map(project.parts.map((p) => [p.id, p]));
  const used = new Map<string, string>();
  for (const net of project.nets) {
    const line = doc ? lineOf(doc, ['netze', net.name]) : undefined;
    for (const ref of net.pins) {
      const [pid, pn] = splitRef(ref);
      if (!pn) {
        issues.push({ level: 'error', text: `Netz „${net.name}“: „${ref}“ ist kein Pin. Pins schreibt man als TEIL.PIN, z. B. R1.1 oder U1.GND.`, line });
        continue;
      }
      if (!ids.has(pid)) {
        issues.push({ level: 'error', text: `Netz „${net.name}“: Das Teil „${pid}“ gibt es nicht. Ist es unter „teile“ definiert?`, line });
        continue;
      }
      const inst = byId.get(pid)!;
      const def = getPart(inst.type)!;
      const pin = findPin(def, inst.props, pn);
      if (!pin) {
        const names = def
          .pins(inst.props)
          .filter((p) => p.x > -100)
          .map((p) => p.id)
          .slice(0, 24);
        issues.push({ level: 'error', text: `Netz „${net.name}“: ${def.name} „${pid}“ hat keinen Pin „${pn}“. Vorhanden: ${names.join(', ')}${def.pins(inst.props).length > 24 ? ' …' : ''}`, line, part: pid });
        continue;
      }
      const k = `${pid}.${pin.id}`;
      if (used.has(k) && used.get(k) !== net.name) issues.push({ level: 'info', text: `${ref} steckt in den Netzen „${used.get(k)}“ und „${net.name}“ – beide werden dadurch verbunden.`, line });
      used.set(k, net.name);
    }
  }
  for (const c of project.code) {
    const target = project.parts.find((p) => p.id === c.ziel);
    if (!target) issues.push({ level: 'error', text: `code.ziel „${c.ziel}“: Dieses Teil gibt es nicht.` });
    else if (!getPart(target.type)?.board) issues.push({ level: 'error', text: `code.ziel „${c.ziel}“ ist kein Mikrocontroller – Code kann nur auf Boards laufen.` });
    if (/\/\/\s*\.\.\.|…|\.\.\.\s*(kompletter|rest)/i.test(c.datei)) issues.push({ level: 'warn', text: `Der Code für ${c.ziel} enthält Platzhalter („…“) – im fertigen Projekt muss der vollständige Sketch stehen.` });
    if (!['arduino', 'c++', 'cpp', 'ino', 'micropython', 'python', 'esp32-echt', 'hex', 'uf2'].includes(c.sprache.toLowerCase())) issues.push({ level: 'warn', text: `Sprache „${c.sprache}“ wird noch nicht simuliert (unterstützt: arduino).` });
  }
  issues.push(...lint(project));
  try {
    issues.push(...erc(project));
  } catch {
    /* ERC darf das Laden nie verhindern */
  }
  return issues;
}

/** Elektrische Plausibilitätsprüfungen („Die LED hat keinen Vorwiderstand“) */
export function lint(project: Project): Issue[] {
  const issues: Issue[] = [];
  const byId = new Map(project.parts.map((p) => [p.id, p]));
  // Index „Teil.Pin“ → Netz (einmal aufbauen statt pro Abfrage alle Netze zu durchsuchen)
  const pinNet = new Map<string, Net>();
  for (const n of project.nets)
    for (const r of n.pins) {
      const [a, b] = splitRef(r);
      const inst = byId.get(a);
      const def = inst && getPart(inst.type);
      const id = (def && findPin(def, inst!.props, b)?.id) ?? b;
      if (!pinNet.has(`${a}.${id}`)) pinNet.set(`${a}.${id}`, n);
    }
  const netOf = (ref: string): Net | undefined => {
    const [pid, pn] = splitRef(ref);
    const inst = byId.get(pid);
    if (!inst) return undefined;
    const def = getPart(inst.type);
    if (!def) return undefined;
    return pinNet.get(`${pid}.${findPin(def, inst.props, pn)?.id ?? pn}`);
  };
  // Versorgungs-/Masseschienen: ein Widerstand dort (z. B. Pull-down eines Sensors) begrenzt den LED-Strom nicht
  const RAIL = /^(GND|0V|MASSE|5V|3V3|3\.3V|VIN|VCC|VDD|VBUS|VBAT|V\+|V-)$/i;
  const isRail = (net: Net) =>
    RAIL.test(net.name) ||
    net.pins.some((r) => {
      const [pid, pn] = splitRef(r);
      const inst = byId.get(pid);
      return !!inst && !!getPart(inst.type)?.board && RAIL.test(pn);
    });
  const limiting = (net: Net | undefined, self: string) =>
    !!net && !isRail(net) &&
    net.pins.some((r) => {
      const [pid] = splitRef(r);
      if (pid === self) return false;
      const t = byId.get(pid)?.type ?? '';
      return ['widerstand', 'potentiometer', 'trimmer', 'ldr', 'ntc', 'ptc', 'S8050', 'BC547', '2N2222', '2N3904', 'BC557', 'S8550', '2N3906', 'TIP120', 'IRLZ44N', 'AO3400', '2N7000', 'IRF520', 'IRF9540', '74hc595', 'l298n', 'drv8833', 'multimeter', 'strommesser', 'max7219', 'tm1637', 'cd4017', 'pc817', 'labornetzteil'].includes(t);
    });
  for (const p of project.parts) {
    if (p.type !== 'led' && p.type !== 'rgb-led') continue;
    const a = netOf(`${p.id}.A`) ?? netOf(`${p.id}.R`);
    const k = netOf(`${p.id}.K`) ?? netOf(`${p.id}.COM`);
    if (!a || !k) {
      if (!a && !k) issues.push({ level: 'info', text: `${p.id} ist nicht angeschlossen.`, part: p.id });
      continue;
    }
    if (!limiting(a, p.id) && !limiting(k, p.id)) issues.push({ level: 'warn', text: `Die LED ${p.id} hat keinen Vorwiderstand – sie würde sofort kaputtgehen. Setze ca. 220 Ω (5 V) bzw. 100 Ω (3,3 V) in Reihe.`, part: p.id });
  }
  // Boards ohne Versorgung
  for (const p of project.parts) {
    const def = getPart(p.type);
    if (!def?.board) continue;
    if (p.props.usb === false) {
      const powered = def.board.pins.filter((x) => x.power && x.power !== 'gnd').some((x) => netOf(`${p.id}.${x.id}`));
      if (!powered) issues.push({ level: 'warn', text: `${p.id} wird weder über USB noch über einen Versorgungspin (5V/3V3/VIN) gespeist.`, part: p.id });
    }
  }
  return issues;
}

/* ------------------------------------------------------------------ */
/* Automatische Platzierung                                            */
/* ------------------------------------------------------------------ */

export function autoPlace(project: Project) {
  const todo = project.parts.filter((p) => p.auto);
  if (!todo.length) return;
  const fixed = project.parts.filter((p) => !p.auto);
  const size = (p: PartInst) => getPart(p.type)!.size(p.props);
  // Nachbarschaft über Netze
  // (große Sammelnetze wie GND/VCC zählen nicht als Nachbarschaft – sonst wäre jedes Teil mit jedem benachbart)
  const adj = new Map<string, Set<string>>();
  const netsOf = new Map<string, Net[]>();
  for (const n of project.nets) {
    const ids = [...new Set(n.pins.map((r) => splitRef(r)[0]))];
    for (const a of ids) (netsOf.get(a) ?? netsOf.set(a, []).get(a)!).push(n);
    if (ids.length > 8) continue;
    for (const a of ids) for (const b of ids) if (a !== b) (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
  }
  const boards = todo.filter((p) => getPart(p.type)?.board);
  const bbs = todo.filter((p) => p.type.startsWith('steckbrett'));
  const rest = todo.filter((p) => !boards.includes(p) && !bbs.includes(p) && !p.props.nahe_an);
  let maxX = fixed.reduce((m, p) => Math.max(m, p.x + size(p).w), 0);
  let x = fixed.length ? maxX + 60 : 40;
  let y = 60;
  // Boards links untereinander
  let boardsW = 0;
  for (const b of boards) {
    const s = size(b);
    b.x = snap(x);
    b.y = snap(y);
    y += s.h + 60;
    boardsW = Math.max(boardsW, s.w);
  }
  // Teile neben den Board-Pin legen, mit dem sie (direkt oder über ein Nachbarteil) verbunden sind
  const boardIds = new Map(boards.map((b) => [b.id, b]));
  const memo = new Map<string, { x: number; y: number; left: boolean } | null>();
  const boardPinOf = (id: string, depth = 0): { x: number; y: number; left: boolean } | null => {
    const key = `${id}|${depth}`;
    if (memo.has(key)) return memo.get(key)!;
    const r = boardPinOfRaw(id, depth);
    memo.set(key, r);
    return r;
  };
  const boardPinOfRaw = (id: string, depth: number): { x: number; y: number; left: boolean } | null => {
    for (const n of netsOf.get(id) ?? []) {
      if (/^(GND|VCC|5V|3V3|VBAT|VIN)$/i.test(n.name) && depth === 0) continue;
      for (const r of n.pins) {
        const [pid, pn] = splitRef(r);
        const b = boardIds.get(pid);
        if (!b) continue;
        const def = getPart(b.type)!;
        const pin = findPin(def, b.props, pn);
        if (!pin || pin.power) continue;
        const sz = def.size(b.props);
        return { x: b.x + pin.x, y: b.y + pin.y, left: pin.x < sz.w / 2 };
      }
    }
    if (depth < 1) for (const nb of adj.get(id) ?? []) {
      if (boardIds.has(nb)) continue;
      const r = boardPinOf(nb, depth + 1);
      if (r) return r;
    }
    return null;
  };
  // Belegte Flächen in einem Raster (Zellen 200 Einheiten) – Kollisionstest in konstanter Zeit
  const CELL = 200;
  const grid = new Map<string, { x: number; y: number; w: number; h: number }[]>();
  const placedList: { x: number; y: number; w: number; h: number }[] = [];
  const placed = {
    push(q: { x: number; y: number; w: number; h: number }) {
      placedList.push(q);
      for (let gx = Math.floor((q.x - 24) / CELL); gx <= Math.floor((q.x + q.w + 24) / CELL); gx++)
        for (let gy = Math.floor((q.y - 24) / CELL); gy <= Math.floor((q.y + q.h + 24) / CELL); gy++) {
          const k = `${gx},${gy}`;
          (grid.get(k) ?? grid.set(k, []).get(k)!).push(q);
        }
    },
    map<T>(f: (q: { x: number; y: number; w: number; h: number }) => T): T[] {
      return placedList.map(f);
    },
  };
  for (const p of [...boards, ...fixed]) placed.push({ x: p.x, y: p.y, ...size(p) });
  const free = (x: number, y: number, w: number, h: number) => {
    for (let gx = Math.floor(x / CELL); gx <= Math.floor((x + w) / CELL); gx++)
      for (let gy = Math.floor(y / CELL); gy <= Math.floor((y + h) / CELL); gy++)
        for (const q of grid.get(`${gx},${gy}`) ?? []) if (x < q.x + q.w + 24 && x + w + 24 > q.x && y < q.y + q.h + 24 && y + h + 24 > q.y) return false;
    return true;
  };
  const leftCount = new Map<number, number>();
  const unanchored: PartInst[] = [];
  const anchored = rest.map((p) => ({ p, a: boardPinOf(p.id) }));
  anchored.sort((u, v) => (u.a?.y ?? 1e9) - (v.a?.y ?? 1e9));
  for (const { p, a } of anchored) {
    if (!a) {
      unanchored.push(p);
      continue;
    }
    const s = size(p);
    const bw = boardsW;
    const col = leftCount.get(a.left ? 0 : 1) ?? 0;
    void col;
    let px = a.left ? a.x - 90 - s.w : a.x + 80;
    let py = a.y - s.h / 2;
    let tries = 0;
    while (!free(px, py, s.w, s.h) && tries++ < 60) {
      if (tries % 6 === 0) {
        px += a.left ? -(s.w + 40) : s.w + 40;
        py = a.y - s.h / 2;
      } else py += 30;
    }
    void bw;
    p.x = snap(px);
    p.y = snap(py);
    placed.push({ x: p.x, y: p.y, ...s });
  }
  // nicht zuordenbare Teile in Spalten rechts daneben
  let cx = Math.max(x + boardsW + 120, ...placed.map((q) => q.x + q.w + 80));
  let cy = 60;
  let colW = 0;
  const maxH = Math.max(520, ...boards.map((b) => size(b).h + 120));
  for (const p of unanchored) {
    const s = size(p);
    if (cy + s.h > maxH && cy > 60) {
      cx += colW + 90;
      cy = 60;
      colW = 0;
    }
    p.x = snap(cx);
    p.y = snap(cy);
    cy += s.h + 70;
    colW = Math.max(colW, s.w);
    placed.push({ x: p.x, y: p.y, ...s });
  }
  maxX = Math.max(...placed.map((q) => q.x + q.w), x + boardsW);
  // alles in den positiven Bereich verschieben
  const minX = Math.min(...todo.map((p) => p.x), ...placed.map((q) => q.x));
  const minY = Math.min(...todo.map((p) => p.y), ...placed.map((q) => q.y));
  if (minX < 40 || minY < 40) for (const p of todo) {
    p.x += minX < 40 ? 40 - minX : 0;
    p.y += minY < 40 ? 40 - minY : 0;
  }
  // Teile „nahe_an“ ein anderes Teil
  for (const p of todo.filter((t) => t.props.nahe_an)) {
    const ref = project.parts.find((q) => q.id === p.props.nahe_an);
    if (ref) {
      const rs = size(ref);
      p.x = snap(ref.x + rs.w / 2 - size(p).w / 2);
      p.y = snap(ref.y + rs.h + 8);
    } else {
      p.x = snap(maxX + 40);
      p.y = 60;
    }
  }
  // Steckbretter darunter
  let by = Math.max(maxH, ...project.parts.filter((p) => !bbs.includes(p)).map((p) => p.y + size(p).h)) + 80;
  for (const b of bbs) {
    b.x = snap(40);
    b.y = snap(by);
    by += size(b).h + 40;
  }
  for (const p of todo) p.auto = false;
}

function snap(v: number) {
  return Math.round(v / 10) * 10;
}

/* ------------------------------------------------------------------ */
/* Speichern                                                           */
/* ------------------------------------------------------------------ */

export function serializeOhm(project: Project): string {
  const teile: Record<string, any> = {};
  for (const p of project.parts) {
    const def = getPart(p.type);
    const o: Record<string, any> = { typ: p.type };
    for (const [k, v] of Object.entries(p.props)) {
      if (def && def.defaults[k] === v && !['wert', 'farbe'].includes(k)) continue;
      o[k] = v;
    }
    o.pos = [round(p.x * MM_PER_UNIT), round(p.y * MM_PER_UNIT)];
    if (p.rot) o.dreh = p.rot;
    teile[p.id] = o;
  }
  const netze: Record<string, string[]> = {};
  for (const n of project.nets) netze[n.name] = n.pins;
  const doc: Record<string, any> = {
    ohm: 1,
    projekt: { name: project.name, ...(project.autor ? { autor: project.autor } : {}), ...(project.beschreibung ? { beschreibung: project.beschreibung } : {}) },
    teile,
    netze,
    ansichten: {
      ...project.views,
      kabel: project.views.kabel
        ? {
            stil: project.views.kabel.stil ?? '90',
            ...(project.views.kabel.kreuzungen === 'keine' ? { kreuzungen: 'keine' } : {}),
            ...(project.views.kabel.netze && Object.keys(project.views.kabel.netze).length ? { netze: project.views.kabel.netze } : {}),
            ...(project.views.kabel.knicke && Object.keys(project.views.kabel.knicke).length
              ? { knicke: Object.fromEntries(Object.entries(project.views.kabel.knicke).map(([k, pts]) => [k, pts.map((p) => [round(p.x * MM_PER_UNIT), round(p.y * MM_PER_UNIT)])])) }
              : {}),
          }
        : undefined,
    },
  };
  if (project.settings.realism || project.settings.speed !== 1 || project.settings.dt !== 0.001) doc.einstellungen = { geschwindigkeit: project.settings.speed, realismus: project.settings.realism, zeitschritt: project.settings.dt };
  if (project.variants && Object.keys(project.variants).length) {
    doc.varianten = project.variants;
    if (project.activeVariant) doc.variante = project.activeVariant;
  }
  const pl = (project as any).pcb as Record<string, { x: number; y: number; rot: number }> | undefined;
  if (pl && Object.keys(pl).length) doc.platzierung = Object.fromEntries(Object.entries(pl).map(([k, v]) => [k, [round(v.x * MM_PER_UNIT), round(v.y * MM_PER_UNIT), v.rot]]));
  if (project.library?.length) doc.bibliothek = project.library;
  if (project.team?.length) doc.team = project.team;
  if (project.review && (project.review.kommentare.length || project.review.entscheidungen.length || project.review.status !== 'entwurf')) doc.review = project.review;
  if (project.code.length === 1) doc.code = project.code[0];
  else if (project.code.length) doc.code = project.code;
  if (project.tests.length) doc.test = project.tests;
  const d = new YAML.Document(doc);
  // Teile kompakt in einer Zeile, Code als Block
  YAML.visit(d, {
    Pair(_k, pair) {
      const key = (pair.key as YAML.Scalar)?.value;
      if (key === 'datei' && YAML.isScalar(pair.value)) (pair.value as YAML.Scalar).type = 'BLOCK_LITERAL';
    },
    Map(_k, map, path) {
      const parent = path[path.length - 1] as YAML.Pair | undefined;
      const grand = path[path.length - 3] as YAML.Pair | undefined;
      const gk = grand && YAML.isPair(grand) ? (grand.key as YAML.Scalar)?.value : undefined;
      if (parent && YAML.isPair(parent) && gk === 'teile') map.flow = true;
    },
    Seq(_k, seq, path) {
      const parent = path[path.length - 1] as YAML.Pair | undefined;
      const key = parent && YAML.isPair(parent) ? (parent.key as YAML.Scalar)?.value : undefined;
      if (key === 'pos' || key !== undefined) {
        const gp = path[path.length - 3] as YAML.Pair | undefined;
        const gk = gp && YAML.isPair(gp) ? (gp.key as YAML.Scalar)?.value : undefined;
        if (gk === 'netze' || key === 'pos') seq.flow = true;
      }
    },
  });
  const header = `# Ohm Studio Projekt – öffne diese Datei in Ohm Studio\n# Format: https://ohm.studio/format (Version 1)\n`;
  return header + d.toString({ lineWidth: 0, flowCollectionPadding: true });
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}

/** Liste aller Bauteiltypen (für `ohm types` und KIs) */
export function typeList(): { typ: string; name: string; kategorie: string; pins: string[]; eigenschaften: string[] }[] {
  return ALL_PARTS.map((p) => ({
    typ: p.type,
    name: p.name,
    kategorie: p.category,
    pins: p
      .pins(p.defaults)
      .filter((x) => x.x > -100)
      .map((x) => x.id),
    eigenschaften: (p.props ?? []).map((x) => x.key),
  }));
}
