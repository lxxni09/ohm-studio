/**
 * Import von KiCad-Projekten (Version 7, 8 und 9): Schaltplan (.kicad_sch) und Platine (.kicad_pcb).
 *
 * Schaltplan: Bauteile werden über den Symbolnamen (R, C, LED, Q_NPN_CBE, Arduino_UNO_R3 …) auf Ohm-Bauteile
 * abgebildet, Pins über Pin-Namen bzw. -Nummern. Die Verbindungen ergeben sich wie in KiCad aus Leitungen,
 * Verbindungspunkten, Labels und Versorgungssymbolen. Was sich nicht simulieren lässt (z. B. Steckverbinder
 * ohne Gegenstück), wird aufgelistet und weggelassen. Platine: Positionen der Footprints werden übernommen.
 *
 * Grenzen (ehrlich): hierarchische Unterblätter, Busse und SPICE-Modelldateien werden nicht übernommen.
 */
import type { Project } from '../ohm/model';
import { emptyProject } from '../ohm/model';
import { autoPlace } from '../ohm/format';
import { getPart } from '../parts/registry';

/* ------------------------------ S-Ausdrücke ------------------------------ */

export type SExpr = string | SExpr[];

export function parseSExpr(text: string): SExpr {
  let i = 0;
  const n = text.length;
  const stack: SExpr[][] = [];
  let root: SExpr | null = null;
  while (i < n) {
    const c = text[i];
    if (c === '(') {
      const list: SExpr[] = [];
      if (stack.length) stack[stack.length - 1].push(list);
      stack.push(list);
      i++;
    } else if (c === ')') {
      const done = stack.pop();
      if (!stack.length && done) root = done;
      i++;
    } else if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < n && text[j] !== '"') {
        if (text[j] === '\\' && j + 1 < n) {
          const e = text[j + 1];
          s += e === 'n' ? '\n' : e;
          j += 2;
        } else s += text[j++];
      }
      stack[stack.length - 1]?.push(s);
      i = j + 1;
    } else if (c === ' ' || c === '\n' || c === '\r' || c === '\t') i++;
    else {
      let j = i;
      while (j < n && !' \n\r\t()"'.includes(text[j])) j++;
      stack[stack.length - 1]?.push(text.slice(i, j));
      i = j;
    }
  }
  if (!root) throw new Error('Keine gültige KiCad-Datei (S-Ausdruck unvollständig).');
  return root;
}

const isList = (x: SExpr): x is SExpr[] => Array.isArray(x);
const head = (x: SExpr) => (isList(x) ? x[0] : null);
const kids = (x: SExpr, name: string) => (isList(x) ? (x.filter((k) => isList(k) && k[0] === name) as SExpr[][]) : []);
const kid = (x: SExpr, name: string) => kids(x, name)[0];
const num = (x: SExpr | undefined) => (typeof x === 'string' ? Number(x) : NaN);
const prop = (x: SExpr, name: string) => {
  const p = kids(x, 'property').find((k) => k[1] === name);
  return p ? String(p[2]) : '';
};

/* ------------------------------ Ergebnis ------------------------------ */

export interface ImportReport {
  quelle: string;
  version: string;
  teile: { ref: string; symbol: string; typ: string }[];
  ausgelassen: { ref: string; symbol: string; grund: string }[];
  hinweise: string[];
  netze: number;
  /** Verbindungen als KiCad-Pins „Referenz.Pinnummer“ (alle Symbole, für Vergleich mit KiCads eigener Netzliste) */
  rohNetze?: string[][];
}

export interface ImportResult {
  project: Project;
  report: ImportReport;
}

/* ------------------------------ Zuordnung Symbol → Ohm-Bauteil ------------------------------ */

interface Mapping {
  typ: string;
  /** KiCad-Pin (Nummer oder Name) → Ohm-Pin */
  pins: (p: { number: string; name: string }) => string | null;
  props?: (value: string, sym: string) => Record<string, unknown>;
}

const byNumber = (m: Record<string, string>) => (p: { number: string }) => m[p.number] ?? null;
const byName = (m: Record<string, string>) => (p: { name: string; number: string }) => m[p.name.toUpperCase()] ?? null;
/** Pin n (1-basiert) ↔ n-ter Pin des Ohm-Bauteils (für ICs in DIP-Reihenfolge) */
const byIndex = (typ: string) => (p: { number: string }) => {
  const def = getPart(typ);
  const pins = def?.pins({}) ?? [];
  return pins[Number(p.number) - 1]?.id ?? null;
};

/** SPICE-/KiCad-Wert („4k7“, „100n“, „1Meg“, „2.2u“) in einen Ohm-Wert umschreiben */
export function kicadValue(v: string): string {
  let s = v.trim().replace(',', '.');
  s = s.replace(/^(\d+)([kKmMuUnNpPrR])(\d+)$/, (_, a, u, b) => `${a}.${b}${u === 'R' || u === 'r' ? '' : u}`);
  s = s.replace(/meg/i, 'M').replace(/µ/g, 'u');
  return s;
}

function voltageOf(name: string): number | null {
  const m = /^\+?(\d+)(?:V(\d+)?|\.(\d+)V?)$/i.exec(name.replace(/^V(CC|DD)_?/i, ''));
  if (m) return Number(`${m[1]}.${m[2] ?? m[3] ?? '0'}`);
  if (/^(VCC|VDD)$/i.test(name)) return 5;
  return null;
}

/** Zahl mit SI-/SPICE-Vorsatz („1k“, „2.2u“, „1Meg“) */
export function siNumber(v: string): number {
  const m = /^(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)\s*(meg|[TGMkmunpf]?)/i.exec(v.trim());
  if (!m) return NaN;
  const u = m[2];
  const f = /^meg$/i.test(u) ? 1e6 : ({ T: 1e12, G: 1e9, M: 1e6, k: 1e3, K: 1e3, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 } as Record<string, number>)[u] ?? 1;
  return Number(m[1]) * f;
}

function simParam(v: string, name: string): number | null {
  const m = new RegExp(`(?:^|\\s)${name}=([^\\s]+)`, 'i').exec(v);
  return m ? siNumber(m[1]) : null;
}

function spiceDc(v: string): number {
  const m = /(-?\d+(?:\.\d+)?)/.exec(v.replace(/^dc\s*/i, ''));
  return m ? Number(m[1]) : 5;
}

function mapSymbol(sym: string, value: string): Mapping | null {
  const s = sym.split(':').pop()!.replace(/_(Small|US|Pack\d+|Iso)$/i, '');
  if (/^R$|^R_\d+$/.test(s)) return { typ: 'widerstand', pins: byNumber({ 1: '1', 2: '2' }), props: (v) => ({ wert: kicadValue(v) }) };
  if (/^R_Potentiometer/.test(s)) return { typ: 'potentiometer', pins: byNumber({ 1: '1', 2: '2', 3: '3' }), props: (v) => ({ wert: kicadValue(v) }) };
  if (/^R_PHOTO$|^LDR/.test(s)) return { typ: 'ldr', pins: byNumber({ 1: '1', 2: '2' }) };
  if (/^Thermistor_NTC|^NTC/.test(s)) return { typ: 'ntc', pins: byNumber({ 1: '1', 2: '2' }) };
  if (/^CP\d?$|^C_Polarized/.test(s)) return { typ: 'elko', pins: byNumber({ 1: '+', 2: '-' }), props: (v) => ({ wert: kicadValue(v) }) };
  if (/^C$|^C_\d+$/.test(s)) return { typ: 'kondensator', pins: byNumber({ 1: '1', 2: '2' }), props: (v) => ({ wert: kicadValue(v) }) };
  if (/^L$|^L_Core/.test(s)) return { typ: 'spule', pins: byNumber({ 1: '1', 2: '2' }), props: (v) => ({ wert: kicadValue(v) }) };
  if (/^LED/.test(s)) {
    const v = value.toLowerCase();
    const farbe = /red|rot/.test(v) ? 'rot' : /green|gr[uü]n/.test(v) ? 'gruen' : /blue|blau/.test(v) ? 'blau' : /yellow|gelb/.test(v) ? 'gelb' : /white|wei/.test(v) ? 'weiss' : 'rot';
    return { typ: 'led', pins: byName({ K: 'K', A: 'A' }), props: () => ({ farbe }) };
  }
  if (/^D_Zener/.test(s)) return { typ: 'zener', pins: byName({ K: 'K', A: 'A' }) };
  if (/^D_Schottky/.test(s)) return { typ: 'schottky', pins: byName({ K: 'K', A: 'A' }) };
  if (/^D$|^D_\d|^1N400/.test(s)) return { typ: /1N400/i.test(value) ? '1n4007' : '1n4148', pins: (p) => ({ K: 'K', A: 'A' })[p.name.toUpperCase()] ?? ({ 1: 'K', 2: 'A' } as Record<string, string>)[p.number] ?? null };
  if (/^Q_NPN/.test(s)) return { typ: /2N2222/i.test(value) ? '2N2222' : /2N3904/i.test(value) ? '2N3904' : 'BC547', pins: byName({ C: 'C', B: 'B', E: 'E' }) };
  if (/^Q_PNP/.test(s)) return { typ: /2N3906/i.test(value) ? '2N3906' : 'BC557', pins: byName({ C: 'C', B: 'B', E: 'E' }) };
  if (/^Q_NMOS/.test(s)) return { typ: /IRLZ44/i.test(value) ? 'IRLZ44N' : '2N7000', pins: byName({ G: 'G', D: 'D', S: 'S' }) };
  if (/^Q_PMOS/.test(s)) return { typ: 'IRF9540', pins: byName({ G: 'G', D: 'D', S: 'S' }) };
  if (/^SW_Push|^SW_SPST$|^SW_Tactile/.test(s)) return { typ: 'taster', pins: byNumber({ 1: '1', 2: '2' }) };
  if (/^SW_SPDT/.test(s)) return { typ: 'schalter', pins: byNumber({ 1: '1', 2: 'COM', 3: '3' }) };
  if (/^Buzzer/.test(s)) return { typ: 'summer', pins: (p) => (p.name === '+' || p.number === '1' ? '+' : '-'), props: () => ({ art: 'aktiv' }) };
  if (/^Speaker/.test(s)) return { typ: 'lautsprecher', pins: byNumber({ 1: '+', 2: '-' }) };
  if (/^Battery/.test(s)) return { typ: 'batteriehalter', pins: (p) => (p.name === '+' || p.number === '1' ? '+' : '-') };
  if (/^Fuse/.test(s)) return { typ: 'sicherung', pins: byNumber({ 1: '1', 2: '2' }) };
  if (/^Crystal$/.test(s)) return { typ: 'quarz', pins: byNumber({ 1: '1', 2: '2' }) };
  if (/^Motor_DC|^Motor$/.test(s)) return { typ: 'motor', pins: byNumber({ 1: '+', 2: '-' }) };
  if (/^VDC$|^VSOURCE$/.test(s))
    return {
      typ: 'labornetzteil',
      pins: byNumber({ 1: '+', 2: '-' }),
      props: (v) => {
        const p = simParam(v, 'dc');
        return { spannung: Math.abs(p ?? spiceDc(v)), strom: 3 };
      },
    };
  if (/^VSIN$/.test(s))
    return {
      typ: 'funktionsgenerator',
      pins: byNumber({ 1: 'OUT', 2: 'GND' }),
      props: (v) => {
        // KiCad 7+: Sim.Params „dc=0 ampl=1 f=1k“; älter: Value „sin(0 1 1k)“
        const m = /sin\s*\(\s*([-\d.e+]+)\s+([-\d.e+]+[a-z]*)\s+([-\d.e+]+[a-z]*)/i.exec(v);
        const f = simParam(v, 'f') ?? (m ? siNumber(m[3]) : 50);
        return { form: 'sinus', offset: simParam(v, 'dc') ?? (m ? Number(m[1]) : 0), amplitude: simParam(v, 'ampl') ?? (m ? siNumber(m[2]) : 1), frequenz: Math.min(200, Number.isFinite(f) ? f : 50), _quellfrequenz: f };
      },
    };
  if (/^NE555|^LM555|^TLC555|^ICM7555/.test(s)) return { typ: 'ne555', pins: byIndex('ne555') };
  if (/^LM358|^LM2904|^MCP6002|^TL072|^TL082|^NE5532|^LM1458/.test(s)) return { typ: 'lm358', pins: byIndex('lm358') };
  if (/^74HC595|^74xx595|^SN74HC595/i.test(s)) return { typ: '74hc595', pins: byIndex('74hc595') };
  if (/^CD4017|^4017/.test(s)) return { typ: 'cd4017', pins: byIndex('cd4017') };
  if (/^LM7805|^L7805|^MC7805/.test(s)) return { typ: 'LM7805', pins: byNumber({ 1: 'IN', 2: 'GND', 3: 'OUT' }) };
  if (/^AMS1117-3\.3/.test(s)) return { typ: 'AMS1117-3.3', pins: byNumber({ 1: 'GND', 2: 'OUT', 3: 'IN' }) };
  if (/^Arduino_UNO|^Arduino_Uno/i.test(s)) return { typ: 'arduino-uno', pins: (p) => arduinoPin(p.name) };
  if (/^Arduino_Nano/i.test(s)) return { typ: 'arduino-nano', pins: (p) => arduinoPin(p.name) };
  return null;
}

function arduinoPin(name: string): string | null {
  const n = name.toUpperCase().replace(/^~/, '');
  if (/^D\d+/.test(n)) return n.replace(/\/.*$/, '');
  if (/^A\d$/.test(n)) return n;
  if (n === '+5V' || n === '5V') return '5V';
  if (n === '+3V3' || n === '3V3' || n === '3.3V') return '3V3';
  if (n === 'GND') return 'GND';
  if (n === 'VIN') return 'VIN';
  if (n === 'AREF' || n === 'SCL' || n === 'SDA' || n === 'IOREF') return n;
  if (n === '~{RESET}' || n === 'RESET') return 'RESET';
  return null;
}

/* ------------------------------ Schaltplan ------------------------------ */

interface LibPin {
  number: string;
  name: string;
  x: number;
  y: number;
  /** unsichtbarer Versorgungseingang → in KiCad global mit allen gleichnamigen verbunden */
  hiddenPower: boolean;
}

function libPins(libs: Map<string, SExpr[]>, name: string, unit: number, seen = new Set<string>()): LibPin[] {
  const sym = libs.get(name);
  if (!sym || seen.has(name)) return [];
  seen.add(name);
  const ext = kid(sym, 'extends');
  const base = ext ? libPins(libs, String(ext[1]), unit, seen) : [];
  const out: LibPin[] = [...base];
  const collect = (x: SExpr[]) => {
    for (const p of kids(x, 'pin')) {
      const at = kid(p, 'at');
      const hidden = p.includes('hide') || String(kid(p, 'hide')?.[1] ?? '') === 'yes';
      out.push({ number: String(kid(p, 'number')?.[1] ?? ''), name: String(kid(p, 'name')?.[1] ?? ''), x: num(at?.[1]), y: num(at?.[2]), hiddenPower: hidden && p[1] === 'power_in' });
    }
  };
  collect(sym);
  for (const sub of kids(sym, 'symbol')) {
    const m = /_(\d+)_(\d+)$/.exec(String(sub[1]));
    if (!m) continue;
    const u = Number(m[1]);
    const style = Number(m[2]);
    if ((u === 0 || u === unit) && style <= 1) collect(sub);
  }
  return out;
}

/** Pin-Position auf dem Blatt: KiCad-Bibliothek hat y nach oben, das Blatt y nach unten */
export function placePin(px: number, py: number, at: { x: number; y: number; rot: number }, mirror: string | null): { x: number; y: number } {
  let x = px;
  let y = -py;
  const r = (((at.rot % 360) + 360) % 360) * (Math.PI / 180);
  // Drehung (gegen den Uhrzeigersinn auf dem Bildschirm = im Uhrzeigersinn bei y nach unten)
  const c = Math.round(Math.cos(r) * 1e6) / 1e6;
  const s = Math.round(Math.sin(r) * 1e6) / 1e6;
  const rx = x * c + y * s;
  const ry = -x * s + y * c;
  x = rx;
  y = ry;
  if (mirror === 'x') y = -y;
  if (mirror === 'y') x = -x;
  return { x: at.x + x, y: at.y + y };
}

const key = (x: number, y: number) => `${Math.round(x * 100)},${Math.round(y * 100)}`;

export function importKicadSch(text: string, fileName = 'schaltplan.kicad_sch'): ImportResult {
  const root = parseSExpr(text);
  if (head(root) !== 'kicad_sch') throw new Error('Das ist kein KiCad-Schaltplan (.kicad_sch ab KiCad 6).');
  const version = String(kid(root, 'version')?.[1] ?? '?');
  const genVer = String(kid(root, 'generator_version')?.[1] ?? '');
  const report: ImportReport = { quelle: fileName, version: genVer ? `KiCad ${genVer}` : `KiCad (Format ${version})`, teile: [], ausgelassen: [], hinweise: [], netze: 0 };
  if (Number(version) < 20211123) report.hinweise.push('Sehr altes KiCad-Format – bitte in KiCad 7 oder neuer öffnen und speichern, falls etwas fehlt.');

  const libs = new Map<string, SExpr[]>();
  for (const s of kids(kid(root, 'lib_symbols') ?? [], 'symbol')) libs.set(String(s[1]), s);

  // Union-Find über Punkte und Namen
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let r = a;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(a, r);
    return r;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const touch = (a: string) => !parent.has(a) && parent.set(a, a);

  // Leitungen
  const wires: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
  for (const w of kids(root, 'wire')) {
    const pts = kids(kid(w, 'pts') ?? [], 'xy').map((p) => ({ x: num(p[1]), y: num(p[2]) }));
    for (let i = 1; i < pts.length; i++) {
      wires.push({ a: pts[i - 1], b: pts[i] });
      union(`p:${key(pts[i - 1].x, pts[i - 1].y)}`, `p:${key(pts[i].x, pts[i].y)}`);
    }
  }
  // Punkte auf einer Leitung (T-Abzweig, Verbindungspunkt, Pin mitten auf einer Leitung) verbinden
  const onWire = (x: number, y: number) => {
    for (const w of wires) {
      const minx = Math.min(w.a.x, w.b.x) - 1e-3;
      const maxx = Math.max(w.a.x, w.b.x) + 1e-3;
      const miny = Math.min(w.a.y, w.b.y) - 1e-3;
      const maxy = Math.max(w.a.y, w.b.y) + 1e-3;
      if (x < minx || x > maxx || y < miny || y > maxy) continue;
      const cross = (w.b.x - w.a.x) * (y - w.a.y) - (w.b.y - w.a.y) * (x - w.a.x);
      if (Math.abs(cross) < 1e-3) union(`p:${key(x, y)}`, `p:${key(w.a.x, w.a.y)}`);
    }
  };
  for (const w of wires) {
    onWire(w.a.x, w.a.y);
    onWire(w.b.x, w.b.y);
  }
  for (const j of kids(root, 'junction')) {
    const at = kid(j, 'at');
    touch(`p:${key(num(at?.[1]), num(at?.[2]))}`);
    onWire(num(at?.[1]), num(at?.[2]));
  }

  // Labels: gleiche Namen sind verbunden
  const labelNames = new Map<string, string>();
  for (const kind of ['label', 'global_label', 'hierarchical_label']) {
    for (const l of kids(root, kind)) {
      const at = kid(l, 'at');
      const name = String(l[1]);
      const p = `p:${key(num(at?.[1]), num(at?.[2]))}`;
      union(p, `n:${name}`);
      onWire(num(at?.[1]), num(at?.[2]));
      labelNames.set(`n:${name}`, name);
    }
  }
  if (kids(root, 'sheet').length) report.hinweise.push(`${kids(root, 'sheet').length} hierarchische(s) Unterblatt/Unterblätter wurde(n) nicht importiert – nur das oberste Blatt. Tipp: Unterblätter einzeln importieren.`);
  if (kids(root, 'bus').length) report.hinweise.push('Busse werden nicht übernommen; einzelne Leitungen mit Labels funktionieren.');

  // Bauteile
  const project = emptyProject();
  project.name = fileName.replace(/\.kicad_sch$/i, '');
  const pinRefs: { ref: string; p: string }[] = [];
  const rawPins: { ref: string; p: string }[] = [];
  const powerNets = new Map<string, string>(); // Netzname → Spannung
  const usedIds = new Set<string>();
  let anon = 0;
  for (const s of kids(root, 'symbol')) {
    const libId = String(kid(s, 'lib_id')?.[1] ?? '');
    const at0 = kid(s, 'at');
    const at = { x: num(at0?.[1]), y: num(at0?.[2]), rot: num(at0?.[3]) || 0 };
    const mirror = kid(s, 'mirror') ? String(kid(s, 'mirror')[1]) : null;
    const unit = num(kid(s, 'unit')?.[1]) || 1;
    const ref = prop(s, 'Reference');
    const value = prop(s, 'Value');
    const dnp = String(kid(s, 'dnp')?.[1] ?? 'no') === 'yes';
    const pins = libPins(libs, libId, unit).map((p) => ({ ...p, ...placePin(p.x, p.y, at, mirror) }));
    // Versorgungssymbole benennen nur Netze
    // Unsichtbare Versorgungseingänge (älterer KiCad-Stil, auch bei ICs) verbinden global über den Pin-Namen
    for (const p of pins)
      if (p.hiddenPower && p.name) {
        union(`p:${key(p.x, p.y)}`, `n:${p.name}`);
        labelNames.set(`n:${p.name}`, p.name);
      }
    const isPower = libId.startsWith('power:') || (libs.get(libId) && kid(libs.get(libId)!, 'power')) || (ref.startsWith('#') && pins.length > 0 && pins.every((p) => p.hiddenPower));
    if (isPower) {
      const name = value || libId.split(':')[1];
      // PWR_FLAG markiert nur „hier kommt Strom her“ für den ERC – es benennt kein Netz (sonst würden alle Schienen kurzgeschlossen)
      if (/^PWR_FLAG$/i.test(name) || /PWR_FLAG$/i.test(libId)) continue;
      for (const p of pins) {
        union(`p:${key(p.x, p.y)}`, `n:${name}`);
        onWire(p.x, p.y);
      }
      labelNames.set(`n:${name}`, name);
      if (!/^(GND|GNDA|GNDD|GNDREF|Earth|VSS|0)$/i.test(name)) powerNets.set(name, name);
      continue;
    }
    if (dnp) {
      report.ausgelassen.push({ ref, symbol: libId, grund: 'als „nicht bestücken“ markiert' });
      continue;
    }
    const map = mapSymbol(libId, value);
    if (!map) {
      report.ausgelassen.push({ ref, symbol: libId, grund: 'kein Simulationsmodell in Ohm Studio' });
      // Pins trotzdem als Punkte anlegen, damit die Netze vollständig bleiben
      for (const p of pins) {
        touch(`p:${key(p.x, p.y)}`);
        onWire(p.x, p.y);
        rawPins.push({ ref: `${ref}.${p.number}`, p: `p:${key(p.x, p.y)}` });
      }
      continue;
    }
    let id = /^[A-Za-z][\w]*$/.test(ref) && !ref.includes('?') ? ref : `${getPart(map.typ)?.prefix ?? 'X'}${++anon}`;
    while (usedIds.has(id)) id = `${id}_${++anon}`;
    // gleiche Referenz bei mehreren Einheiten (z. B. LM358 A/B) → ein Bauteil
    const existing = project.parts.find((x) => x.id === ref && x.type === map.typ);
    if (!existing) {
      usedIds.add(id);
      const props = map.props?.(`${value} ${prop(s, 'Sim.Params')}`.trim(), libId) ?? {};
      if (typeof props._quellfrequenz === 'number' && props._quellfrequenz > 200)
        report.hinweise.push(`${id}: Die Quelle hat ${props._quellfrequenz >= 1000 ? `${props._quellfrequenz / 1000} kHz` : `${props._quellfrequenz} Hz`} – der Funktionsgenerator in Ohm Studio geht bis 200 Hz und wurde darauf gesetzt.`);
      delete props._quellfrequenz;
      project.parts.push({ id, type: map.typ, props, x: at.x * 4, y: at.y * 4, rot: 0, auto: true });
      report.teile.push({ ref: id, symbol: libId, typ: map.typ });
    } else id = existing.id;
    for (const p of pins) {
      const pk = `p:${key(p.x, p.y)}`;
      touch(pk);
      onWire(p.x, p.y);
      rawPins.push({ ref: `${ref}.${p.number}`, p: pk });
      const ohm = map.pins({ number: p.number, name: p.name });
      if (ohm) pinRefs.push({ ref: `${id}.${ohm}`, p: pk });
      else report.hinweise.push(`${id}: Pin ${p.number}${p.name && p.name !== '~' ? ` (${p.name})` : ''} hat keine Entsprechung und bleibt offen.`);
    }
  }

  // Netze bilden
  const groups = new Map<string, string[]>();
  for (const pr of pinRefs) {
    const r = find(pr.p);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(pr.ref);
  }
  const nameOf = new Map<string, string>();
  for (const [k, name] of labelNames) if (parent.has(k)) nameOf.set(find(k), name);
  let auto = 0;
  const taken = new Set<string>();
  for (const [r, refs] of groups) {
    const uniq = [...new Set(refs)];
    if (uniq.length < 2 && !nameOf.has(r)) continue;
    let name = (nameOf.get(r) ?? `N${++auto}`).replace(/[^\w+.-]/g, '_');
    if (/^(GND|GNDA|GNDD|GNDREF|Earth|VSS|0)$/i.test(name)) name = 'GND';
    while (taken.has(name)) name = `${name}_${++auto}`;
    taken.add(name);
    project.nets.push({ name, pins: uniq });
  }

  // Versorgung ergänzen, wenn Netze wie „+5V“ keine Quelle haben
  const hasSource = (net: { pins: string[] }) =>
    net.pins.some((r) => {
      const t = project.parts.find((p) => p.id === r.split('.')[0])?.type ?? '';
      return ['labornetzteil', 'batteriehalter', 'funktionsgenerator', 'usb-netzteil'].includes(t) || getPart(t)?.board;
    });
  const gnd = project.nets.find((n) => n.name === 'GND');
  for (const name of powerNets.keys()) {
    const net = project.nets.find((n) => n.name === name.replace(/[^\w+.-]/g, '_'));
    if (!net || hasSource(net)) continue;
    const v = voltageOf(name);
    if (v === null) {
      report.hinweise.push(`Netz „${name}“ hat keine Spannungsquelle – bitte selbst eine ergänzen.`);
      continue;
    }
    let id = 'PSU';
    let k = 1;
    while (project.parts.some((p) => p.id === id)) id = `PSU${++k}`;
    project.parts.push({ id, type: 'labornetzteil', props: { spannung: Math.abs(v), strom: 3 }, x: 0, y: 0, rot: 0, auto: true });
    net.pins.push(`${id}.+`);
    if (gnd) gnd.pins.push(`${id}.-`);
    else project.nets.push({ name: 'GND', pins: [`${id}.-`] });
    report.hinweise.push(`Für „${name}“ war keine Quelle im Schaltplan – Labornetzteil ${id} mit ${Math.abs(v)} V ergänzt.`);
  }
  report.netze = project.nets.length;
  const raw = new Map<string, Set<string>>();
  for (const r of rawPins) {
    const k = find(r.p);
    if (!raw.has(k)) raw.set(k, new Set());
    raw.get(k)!.add(r.ref);
  }
  report.rohNetze = [...raw.values()].map((x) => [...x].sort());
  autoPlace(project);
  return { project, report };
}

/* ------------------------------ Platine ------------------------------ */

/** Positionen und Platinengröße aus einer .kicad_pcb übernehmen (passend zu einem importierten Schaltplan) */
export function applyKicadPcb(project: Project, text: string, report: ImportReport) {
  const root = parseSExpr(text);
  if (head(root) !== 'kicad_pcb') throw new Error('Das ist keine KiCad-Platine (.kicad_pcb).');
  const U = 0.254;
  const fps = kids(root, 'footprint').length ? kids(root, 'footprint') : kids(root, 'module');
  const pos: Record<string, { x: number; y: number; rot: number }> = {};
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  // Platinenumriss (Edge.Cuts)
  for (const g of [...kids(root, 'gr_line'), ...kids(root, 'gr_rect'), ...kids(root, 'gr_arc')]) {
    if (kid(g, 'layer')?.[1] !== 'Edge.Cuts') continue;
    for (const k of ['start', 'end', 'mid']) {
      const p = kid(g, k);
      if (!p) continue;
      minx = Math.min(minx, num(p[1]));
      miny = Math.min(miny, num(p[2]));
      maxx = Math.max(maxx, num(p[1]));
      maxy = Math.max(maxy, num(p[2]));
    }
  }
  let matched = 0;
  for (const f of fps) {
    const ref = prop(f, 'Reference') || String(kids(f, 'fp_text').find((t) => t[1] === 'reference')?.[2] ?? '');
    const at = kid(f, 'at');
    if (!ref || !at) continue;
    if (!project.parts.some((p) => p.id === ref)) continue;
    matched++;
    pos[ref] = { x: (num(at[1]) - (Number.isFinite(minx) ? minx : 0)) / U, y: (num(at[2]) - (Number.isFinite(miny) ? miny : 0)) / U, rot: num(at[3]) || 0 };
  }
  (project as unknown as { pcb?: typeof pos }).pcb = pos;
  if (Number.isFinite(minx)) {
    project.views.platine = { ...(project.views.platine ?? {}), groesse: `${(maxx - minx).toFixed(1)}x${(maxy - miny).toFixed(1)}mm` };
    report.hinweise.push(`Platine ${(maxx - minx).toFixed(1)} × ${(maxy - miny).toFixed(1)} mm übernommen, ${matched} von ${fps.length} Footprints platziert. Leiterbahnen werden neu geroutet (die KiCad-Leiterbahnen werden nicht übernommen).`);
  } else report.hinweise.push(`${matched} von ${fps.length} Footprints platziert (kein Platinenumriss auf Edge.Cuts gefunden).`);
}
