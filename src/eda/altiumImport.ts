/**
 * Import von Altium-Schaltplänen (.SchDoc) – binär (OLE-Verbunddatei) und als ASCII gespeichert.
 * Gelesen werden Bauteile, Pins, Leitungen, Verbindungspunkte, Netz-Labels, Versorgungssymbole und Ports.
 * Bauteile werden über Bibliotheksnamen/Bezeichner (R…, C…, LED…) auf Ohm-Bauteile abgebildet; alles andere wird
 * aufgelistet und weggelassen.
 *
 * Grenzen (ehrlich): Altium-Platinen (.PcbDoc), Unterblätter/Harnesses, Busse und Altium-Simulationsmodelle werden
 * nicht übernommen. Geprüft gegen echte Altium-Dateien, aber nicht gegen eine Netzliste aus Altium selbst.
 */
import type { Project } from '../ohm/model';
import { emptyProject } from '../ohm/model';
import { autoPlace } from '../ohm/format';
import { getPart } from '../parts/registry';
import type { ImportReport, ImportResult } from './kicadImport';
import { kicadValue } from './kicadImport';

/* ------------------------------ OLE-Verbunddatei (Compound File Binary) ------------------------------ */

/** Einen Datenstrom (z. B. „FileHeader“) aus einer OLE-Verbunddatei lesen */
export function cfbStream(buf: Uint8Array, want: string): Uint8Array | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0xe011cfd0) return null;
  const secSize = 1 << dv.getUint16(0x1e, true);
  const miniSize = 1 << dv.getUint16(0x20, true);
  const firstDir = dv.getInt32(0x30, true);
  const cutoff = dv.getUint32(0x38, true);
  const firstMiniFat = dv.getInt32(0x3c, true);
  const firstDifat = dv.getInt32(0x44, true);
  const off = (s: number) => (s + 1) * secSize;
  // FAT-Sektoren aus der DIFAT
  const fatSecs: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = dv.getInt32(0x4c + i * 4, true);
    if (s >= 0) fatSecs.push(s);
  }
  let d = firstDifat;
  let guard = 0;
  while (d >= 0 && guard++ < 10000) {
    const per = secSize / 4 - 1;
    for (let i = 0; i < per; i++) {
      const s = dv.getInt32(off(d) + i * 4, true);
      if (s >= 0) fatSecs.push(s);
    }
    d = dv.getInt32(off(d) + per * 4, true);
  }
  const fat: number[] = [];
  for (const s of fatSecs) for (let i = 0; i < secSize / 4; i++) fat.push(dv.getInt32(off(s) + i * 4, true));
  const chain = (start: number, table: number[]) => {
    const out: number[] = [];
    let s = start;
    const seen = new Set<number>();
    while (s >= 0 && !seen.has(s) && out.length < 1e6) {
      seen.add(s);
      out.push(s);
      s = table[s] ?? -2;
    }
    return out;
  };
  const read = (start: number, size: number) => {
    const out = new Uint8Array(size);
    let pos = 0;
    for (const s of chain(start, fat)) {
      const n = Math.min(secSize, size - pos);
      if (n <= 0) break;
      out.set(buf.subarray(off(s), off(s) + n), pos);
      pos += n;
    }
    return out;
  };
  // Verzeichnis
  const dirSecs = chain(firstDir, fat);
  const dir = new Uint8Array(dirSecs.length * secSize);
  dirSecs.forEach((s, i) => dir.set(buf.subarray(off(s), off(s) + secSize), i * secSize));
  const ddv = new DataView(dir.buffer);
  const entries: { name: string; type: number; start: number; size: number }[] = [];
  for (let e = 0; e + 128 <= dir.length; e += 128) {
    const nlen = ddv.getUint16(e + 0x40, true);
    let name = '';
    for (let i = 0; i + 2 < nlen; i += 2) name += String.fromCharCode(ddv.getUint16(e + i, true));
    entries.push({ name, type: dir[e + 0x42], start: ddv.getInt32(e + 0x74, true), size: ddv.getUint32(e + 0x78, true) });
  }
  const root = entries[0];
  const ent = entries.find((x) => x.type === 2 && x.name === want);
  if (!ent) return null;
  if (ent.size >= cutoff) return read(ent.start, ent.size);
  // kleiner Strom: im Mini-Stream
  const miniFat: number[] = [];
  for (const s of chain(firstMiniFat, fat)) for (let i = 0; i < secSize / 4; i++) miniFat.push(dv.getInt32(off(s) + i * 4, true));
  const ministream = read(root.start, root.size);
  const out = new Uint8Array(ent.size);
  let pos = 0;
  for (const s of chain(ent.start, miniFat)) {
    const n = Math.min(miniSize, ent.size - pos);
    if (n <= 0) break;
    out.set(ministream.subarray(s * miniSize, s * miniSize + n), pos);
    pos += n;
  }
  return out;
}

/* ------------------------------ Datensätze ------------------------------ */

type Rec = Record<string, string>;

function parseRecordText(t: string): Rec {
  const r: Rec = {};
  for (const part of t.split('|')) {
    const i = part.indexOf('=');
    if (i > 0) r[part.slice(0, i).toUpperCase()] = part.slice(i + 1);
  }
  return r;
}

/** Alle Datensätze (binär: Längenpräfix je Satz; ASCII: eine Zeile bzw. „|RECORD=“-Abschnitt je Satz) */
export function altiumRecords(data: Uint8Array): Rec[] {
  const dec = new TextDecoder('latin1');
  const stream = cfbStream(data, 'FileHeader');
  const out: Rec[] = [];
  if (stream) {
    const dv = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
    let p = 0;
    while (p + 4 <= stream.length) {
      const raw = dv.getUint32(p, true);
      const len = raw & 0xffffff;
      const binary = raw >>> 24 !== 0;
      p += 4;
      if (p + len > stream.length) break;
      if (!binary) out.push(parseRecordText(dec.decode(stream.subarray(p, p + len)).replace(/\0+$/, '')));
      p += len;
    }
    return out;
  }
  const text = dec.decode(data);
  if (!/^\|?HEADER=Protel|RECORD=/i.test(text.slice(0, 200))) throw new Error('Das ist keine Altium-Schaltplandatei (.SchDoc).');
  // ASCII: Datensätze beginnen mit „|RECORD=“ (der Kopf ohne RECORD ist der erste Satz)
  const parts = text.split(/(?=\|RECORD=)/);
  for (const part of parts) out.push(parseRecordText(part.trim()));
  return out;
}

/* ------------------------------ Import ------------------------------ */

const coord = (r: Rec, k: string) => Number(r[k] ?? 0) + Number(r[`${k}_FRAC`] ?? 0) / 100000;

function mapAltium(lib: string, designator: string, value: string): { typ: string; pin: (num: string, name: string) => string | null; props?: Record<string, unknown> } | null {
  const l = `${lib} ${designator}`.toUpperCase();
  const pre = designator.replace(/\d.*$/, '').toUpperCase();
  const n2 = (a: string, b: string) => (num: string) => (num === '1' ? a : num === '2' ? b : null);
  if (/LED/.test(l)) return { typ: 'led', pin: (num, name) => (/^(K|C|CATHODE|-)$/i.test(name) ? 'K' : /^(A|ANODE|\+)$/i.test(name) ? 'A' : num === '1' ? 'A' : 'K'), props: { farbe: 'rot' } };
  if (pre === 'R' || /^RES/.test(lib.toUpperCase())) return { typ: 'widerstand', pin: n2('1', '2'), props: { wert: kicadValue(value || '1k') } };
  if (/CAP.*POL|ELKO|ELECTRO/.test(l)) return { typ: 'elko', pin: n2('+', '-'), props: { wert: kicadValue(value || '10u') } };
  if (pre === 'C' || /^CAP/.test(lib.toUpperCase())) return { typ: 'kondensator', pin: n2('1', '2'), props: { wert: kicadValue(value || '100n') } };
  if (pre === 'L' || /^IND/.test(lib.toUpperCase())) return { typ: 'spule', pin: n2('1', '2'), props: { wert: kicadValue(value || '10u') } };
  if (pre === 'D' && /ZEN/.test(l)) return { typ: 'zener', pin: (num, name) => (/^(K|C)/i.test(name) || num === '1' ? 'K' : 'A') };
  if (pre === 'D') return { typ: '1n4148', pin: (num, name) => (/^(K|C)/i.test(name) || num === '1' ? 'K' : 'A') };
  if (pre === 'Q' && /NPN|BC54|2N2222|2N3904/.test(l)) return { typ: 'BC547', pin: (_n, name) => ({ C: 'C', B: 'B', E: 'E' })[name.toUpperCase()] ?? null };
  if (pre === 'Q' && /PNP|BC55|2N3906/.test(l)) return { typ: 'BC557', pin: (_n, name) => ({ C: 'C', B: 'B', E: 'E' })[name.toUpperCase()] ?? null };
  if (pre === 'SW' || pre === 'S') return { typ: 'taster', pin: n2('1', '2') };
  return null;
}

export function importAltiumSch(data: Uint8Array, fileName = 'schaltplan.SchDoc'): ImportResult {
  const recs = altiumRecords(data);
  const binary = !!cfbStream(data, 'FileHeader');
  const report: ImportReport = { quelle: fileName, version: `Altium ${binary ? 'SchDoc (binär)' : 'SchDoc (ASCII)'}`, teile: [], ausgelassen: [], hinweise: [], netze: 0 };
  // Index: Datensätze ab dem ersten RECORD (der Kopf zählt nicht) – OWNERINDEX bezieht sich darauf
  const list = recs.filter((r) => r.RECORD !== undefined);

  const parent = new Map<string, string>();
  const find = (a: string): string => {
    if (!parent.has(a)) parent.set(a, a);
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(a, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const key = (x: number, y: number) => `p:${Math.round(x * 100)},${Math.round(y * 100)}`;

  const wires: { a: [number, number]; b: [number, number] }[] = [];
  const onWire = (x: number, y: number) => {
    for (const w of wires) {
      const [ax, ay] = w.a;
      const [bx, by] = w.b;
      if (x < Math.min(ax, bx) - 1e-3 || x > Math.max(ax, bx) + 1e-3 || y < Math.min(ay, by) - 1e-3 || y > Math.max(ay, by) + 1e-3) continue;
      if (Math.abs((bx - ax) * (y - ay) - (by - ay) * (x - ax)) < 1e-3) union(key(x, y), key(ax, ay));
    }
  };
  for (const r of list) {
    if (r.RECORD === '27') {
      const n = Number(r.LOCATIONCOUNT ?? 0);
      const pts: [number, number][] = [];
      for (let i = 1; i <= n; i++) pts.push([coord(r, `X${i}`), coord(r, `Y${i}`)]);
      for (let i = 1; i < pts.length; i++) {
        wires.push({ a: pts[i - 1], b: pts[i] });
        union(key(...pts[i - 1]), key(...pts[i]));
      }
    }
  }
  for (const w of wires) {
    onWire(...w.a);
    onWire(...w.b);
  }
  const names = new Map<string, string>();
  for (const r of list) {
    const x = coord(r, 'LOCATION.X');
    const y = coord(r, 'LOCATION.Y');
    if (r.RECORD === '29') onWire(x, y);
    // Netz-Label (25), Versorgungssymbol (17), Port (18) verbinden über den Namen
    if ((r.RECORD === '25' || r.RECORD === '17' || r.RECORD === '18') && (r.TEXT || r.NAME)) {
      const name = (r.TEXT || r.NAME).replace(/^\\/, '');
      union(key(x, y), `n:${name}`);
      onWire(x, y);
      names.set(`n:${name}`, name);
    }
  }
  if (list.some((r) => r.RECORD === '15')) report.hinweise.push('Unterblätter (Sheet Symbols) werden nicht importiert – nur dieses Blatt. Ports gleichen Namens sind verbunden.');
  if (list.some((r) => r.RECORD === '215' || r.RECORD === '216')) report.hinweise.push('Harnesses werden nicht übernommen.');

  // Bauteile mit Bezeichner und Wert
  const comps = new Map<number, { rec: Rec; designator: string; value: string; pins: { num: string; name: string; x: number; y: number }[] }>();
  list.forEach((r, i) => {
    if (r.RECORD === '1') comps.set(i, { rec: r, designator: '', value: '', pins: [] });
  });
  for (const r of list) {
    const owner = comps.get(Number(r.OWNERINDEX));
    if (!owner) continue;
    if (r.RECORD === '34') owner.designator = r.TEXT ?? '';
    if (r.RECORD === '41' && /^(VALUE|COMMENT)$/i.test(r.NAME ?? '') && r.TEXT && !r.TEXT.startsWith('=')) owner.value = owner.value || r.TEXT;
    if (r.RECORD === '2') {
      const part = Number(r.OWNERPARTID ?? -1);
      const cur = Number(owner.rec.CURRENTPARTID ?? 1);
      if (part !== -1 && part !== cur) continue;
      if ((r.OWNERPARTDISPLAYMODE ?? '0') !== (owner.rec.DISPLAYMODE ?? '0')) continue;
      // Elektrischer Anschluss: am Ende des Pins (Basis + Länge in Pinrichtung)
      const conglo = Number(r.PINCONGLOMERATE ?? 0);
      const dir = conglo & 3;
      const len = coord(r, 'PINLENGTH');
      const bx = coord(r, 'LOCATION.X');
      const by = coord(r, 'LOCATION.Y');
      const [dx, dy] = [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ][dir];
      owner.pins.push({ num: r.DESIGNATOR ?? '', name: r.NAME ?? '', x: bx + dx * len, y: by + dy * len });
    }
  }

  const project = emptyProject();
  project.name = fileName.replace(/\.SchDoc$/i, '');
  const pinRefs: { ref: string; p: string }[] = [];
  const raw: { ref: string; p: string }[] = [];
  const used = new Set<string>();
  let anon = 0;
  for (const c of comps.values()) {
    const lib = c.rec.LIBREFERENCE ?? c.rec.DESIGNITEMID ?? '';
    const des = c.designator || `U?${++anon}`;
    for (const p of c.pins) {
      const k = key(p.x, p.y);
      find(k);
      onWire(p.x, p.y);
      raw.push({ ref: `${des}.${p.num}`, p: k });
    }
    const m = mapAltium(lib, des, c.value);
    if (!m) {
      report.ausgelassen.push({ ref: des, symbol: lib, grund: 'kein Simulationsmodell in Ohm Studio' });
      continue;
    }
    let id = /^[A-Za-z]\w*$/.test(des) ? des : `${getPart(m.typ)?.prefix ?? 'X'}${++anon}`;
    while (used.has(id)) id = `${id}_${++anon}`;
    used.add(id);
    project.parts.push({ id, type: m.typ, props: m.props ?? {}, x: 0, y: 0, rot: 0, auto: true });
    report.teile.push({ ref: id, symbol: lib, typ: m.typ });
    for (const p of c.pins) {
      const o = m.pin(p.num, p.name);
      if (o) pinRefs.push({ ref: `${id}.${o}`, p: key(p.x, p.y) });
    }
  }
  const groups = new Map<string, string[]>();
  for (const pr of pinRefs) {
    const r = find(pr.p);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(pr.ref);
  }
  const nameOf = new Map<string, string>();
  for (const [k, n] of names) nameOf.set(find(k), n);
  let auto = 0;
  const taken = new Set<string>();
  for (const [r, refs] of groups) {
    const uniq = [...new Set(refs)];
    if (uniq.length < 2) continue;
    let name = (nameOf.get(r) ?? `N${++auto}`).replace(/[^\w+.-]/g, '_');
    if (/^(GND|AGND|DGND|0V)$/i.test(name)) name = 'GND';
    while (taken.has(name)) name = `${name}_${++auto}`;
    taken.add(name);
    project.nets.push({ name, pins: uniq });
  }
  const rawMap = new Map<string, Set<string>>();
  for (const r of raw) {
    const k = find(r.p);
    if (!rawMap.has(k)) rawMap.set(k, new Set());
    rawMap.get(k)!.add(r.ref);
  }
  report.rohNetze = [...rawMap.values()].map((x) => [...x].sort());
  const rawNames = new Map<string, string>();
  for (const [k, n] of names) rawNames.set(find(k), n);
  (report as ImportReport & { netzNamen?: Record<string, string> }).netzNamen = Object.fromEntries(
    [...rawMap.entries()].filter(([k]) => rawNames.has(k)).flatMap(([k, set]) => [...set].map((p) => [p, rawNames.get(k)!])),
  );
  report.netze = project.nets.length;
  if (!project.parts.length) report.hinweise.push('Kein Bauteil ließ sich einem Simulationsmodell zuordnen – die Verbindungen wurden gelesen, aber es gibt nichts zu simulieren.');
  autoPlace(project);
  return { project: project as Project, report };
}
