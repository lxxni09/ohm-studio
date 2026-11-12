/**
 * Exporte: Gerber (+ Bohrdatei, als ZIP), KiCad-Netzliste, Wokwi diagram.json, SPICE-Netzliste.
 */
import { computePcb, mountHoles, MOUNT_HOLE_MM } from '../views/pcbLayout';
import { getPart, findPin } from '../parts/registry';
import { parseValue } from '../lib/units';
import { splitRef, type Project } from '../ohm/model';
import { ledColor } from '../parts/library/basic';

/* ------------------------------ ZIP ------------------------------ */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: { name: string; data: string | Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  // DOS-Datum/-Uhrzeit (sonst zeigen Entpackprogramme 1980)
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const name = enc.encode(f.name);
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true);
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const csize = central.reduce((a, c) => a + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, csize, true);
  end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: 'application/zip' });
}

/* ------------------------------ Gerber ------------------------------ */

const U = 0.254; // mm pro Einheit

export interface PanelOptions {
  nx: number;
  ny: number;
  /** Abstand zwischen den Platinen in mm (Fräskanal) */
  gap: number;
  /** Randstreifen mit Fiducials/Werkzeuglöchern in mm */
  rail: number;
}

/**
 * Gerber X2 (mit Dateiattributen) + Excellon.
 * Optional als Fertigungsnutzen: mehrere Platinen, Randstreifen, Fiducials, Werkzeuglöcher.
 */
export function gerberFiles(project: Project, panel?: PanelOptions): { name: string; data: string }[] {
  const L = computePcb(project);
  const nx = panel?.nx ?? 1;
  const ny = panel?.ny ?? 1;
  const gapU = (panel?.gap ?? 2) / U;
  const railU = panel ? panel.rail / U : 0;
  const PW = nx * L.w + (nx - 1) * gapU + 2 * railU;
  const PH = ny * L.h + (ny - 1) * gapU + 2 * railU;
  const offs: { x: number; y: number }[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) offs.push({ x: railU + i * (L.w + gapU), y: railU + j * (L.h + gapU) });
  const mm = (v: number) => Math.round(v * U * 1e6);
  const XY = (x: number, y: number) => `X${mm(x)}Y${mm(PH - y)}`;
  const head = (name: string, func: string) => [
    `G04 Ohm Studio by Nodaris – ${name}*`,
    `%TF.GenerationSoftware,Nodaris,Ohm Studio,2.0*%`,
    `%TF.CreationDate,${new Date().toISOString().slice(0, 19)}*%`,
    `%TF.ProjectId,${project.name.replace(/[^A-Za-z0-9 _-]/g, '')},0,1*%`,
    `%TF.FileFunction,${func}*%`,
    '%FSLAX46Y46*%',
    '%MOMM*%',
    '%LPD*%',
  ];
  const apertures = new Map<string, number>();
  const ap = (def: string) => {
    if (!apertures.has(def)) apertures.set(def, 10 + apertures.size);
    return apertures.get(def)!;
  };
  const padsAll = L.footprints.flatMap((f) => f.pads);
  const flashPads = (extra: number, body: string[], filter?: (p: (typeof padsAll)[number]) => boolean) => {
    for (const o of offs)
      for (const p of padsAll.filter(filter ?? (() => true))) {
        const d = ((p.d + extra) * U).toFixed(4);
        body.push(`D${ap(p.square ? `R,${d}X${d}` : `C,${d}`)}*`, `${XY(o.x + p.x, o.y + p.y)}D03*`);
      }
  };
  const drawTraces = (layer: 'top' | 'bottom', body: string[], widen = 0, filter?: (t: (typeof L.traces)[number]) => boolean) => {
    for (const o of offs)
      for (const t of L.traces.filter((tr) => tr.layer === layer && (filter ? filter(tr) : true))) {
        body.push(`D${ap(`C,${((t.width + widen) * U).toFixed(4)}`)}*`, `${XY(o.x + t.pts[0].x, o.y + t.pts[0].y)}D02*`);
        for (const p of t.pts.slice(1)) body.push(`${XY(o.x + p.x, o.y + p.y)}D01*`);
      }
  };
  const copper = (layer: 'top' | 'bottom') => {
    apertures.clear();
    const body: string[] = [];
    // Massefläche: dunkle Region, dann Freistellungen (LPC), dann wieder Kupfer
    if (L.pour && L.pour.layers.includes(layer)) {
      const gnd = L.pour.net;
      const c = L.pour.clearance;
      for (const o of offs) body.push('G36*', `${XY(o.x + 5, o.y + 5)}D02*`, `${XY(o.x + L.w - 5, o.y + 5)}D01*`, `${XY(o.x + L.w - 5, o.y + L.h - 5)}D01*`, `${XY(o.x + 5, o.y + L.h - 5)}D01*`, `${XY(o.x + 5, o.y + 5)}D01*`, 'G37*');
      body.push('%LPC*%');
      flashPads(c * 2, body, (p) => p.net !== gnd);
      drawTraces(layer, body, c * 2, (t) => t.net !== gnd);
      body.push('%LPD*%');
    }
    flashPads(0, body);
    drawTraces(layer, body);
    for (const o of offs) for (const v of L.vias) body.push(`D${ap('C,1.3000')}*`, `${XY(o.x + v.x, o.y + v.y)}D03*`);
    if (panel) {
      // Fiducials auf dem Rand
      for (const [fx, fy] of [[railU / 2, railU / 2], [PW - railU / 2, railU / 2], [railU / 2, PH - railU / 2]]) body.push(`D${ap('C,1.0000')}*`, `${XY(fx + 8, fy)}D03*`);
    }
    return [...[...apertures.entries()].map(([d, n]) => `%ADD${n}${d}*%`), ...body];
  };
  const mask = (_layer: 'top' | 'bottom') => {
    apertures.clear();
    const body: string[] = [];
    flashPads(1.5, body);
    if (panel) for (const [fx, fy] of [[railU / 2, railU / 2], [PW - railU / 2, railU / 2], [railU / 2, PH - railU / 2]]) body.push(`D${ap('C,2.0000')}*`, `${XY(fx + 8, fy)}D03*`);
    return [...[...apertures.entries()].map(([d, n]) => `%ADD${n}${d}*%`), ...body];
  };
  const files: { name: string; data: string }[] = [];
  const base = panel ? 'ohm-nutzen' : 'ohm';
  files.push({ name: `${base}-F_Cu.gtl`, data: [...head('Kupfer oben', 'Copper,L1,Top'), ...copper('top'), 'M02*'].join('\n') });
  if (L.layers >= 2) files.push({ name: `${base}-B_Cu.gbl`, data: [...head('Kupfer unten', `Copper,L${L.layers},Bot`), ...copper('bottom'), 'M02*'].join('\n') });
  files.push({ name: `${base}-F_Mask.gts`, data: [...head('Lötstopp oben', 'Soldermask,Top'), ...mask('top'), 'M02*'].join('\n') });
  files.push({ name: `${base}-B_Mask.gbs`, data: [...head('Lötstopp unten', 'Soldermask,Bot'), ...mask('bottom'), 'M02*'].join('\n') });
  // Bestückungsdruck: Umrisse
  const silk: string[] = ['%ADD10C,0.1500*%', 'D10*'];
  for (const o of offs)
    for (const f of L.footprints) {
      const pts = [[f.x, f.y], [f.x + f.w, f.y], [f.x + f.w, f.y + f.h], [f.x, f.y + f.h], [f.x, f.y]];
      silk.push(`${XY(o.x + pts[0][0], o.y + pts[0][1])}D02*`);
      for (const p of pts.slice(1)) silk.push(`${XY(o.x + p[0], o.y + p[1])}D01*`);
    }
  files.push({ name: `${base}-F_SilkS.gto`, data: [...head('Bestückungsdruck', 'Legend,Top'), ...silk, 'M02*'].join('\n') });
  // Umriss (Nutzen: Außenkontur + Einzelplatinen mit Fräskanälen)
  const edge = ['%ADD10C,0.1000*%', 'D10*'];
  const rect = (x0: number, y0: number, x1: number, y1: number) => edge.push(`${XY(x0, y0)}D02*`, `${XY(x1, y0)}D01*`, `${XY(x1, y1)}D01*`, `${XY(x0, y1)}D01*`, `${XY(x0, y0)}D01*`);
  if (panel) rect(0, 0, PW, PH);
  for (const o of offs) rect(o.x, o.y, o.x + L.w, o.y + L.h);
  files.push({ name: `${base}-Edge_Cuts.gm1`, data: [...head('Umriss', 'Profile,NP'), ...edge, 'M02*'].join('\n') });
  // Bohrdatei (Excellon)
  const tools = new Map<string, { x: number; y: number }[]>();
  const add = (d: number, x: number, y: number) => {
    const k = d.toFixed(3);
    if (!tools.has(k)) tools.set(k, []);
    tools.get(k)!.push({ x, y });
  };
  for (const o of offs) {
    for (const p of padsAll) add(p.drill * U, o.x + p.x, o.y + p.y);
    for (const v of L.vias) add(0.4, o.x + v.x, o.y + v.y);
    for (const m of mountHoles(L.w, L.h)) add(MOUNT_HOLE_MM, o.x + m.x, o.y + m.y);
  }
  if (panel) for (const [hx, hy] of [[railU / 2, railU / 2 + 0], [PW - railU / 2, PH - railU / 2]]) add(2.0, hx, hy);
  const keys = [...tools.keys()];
  const drl: string[] = ['M48', '; Ohm Studio by Nodaris – Bohrdatei', 'FMAT,2', 'METRIC,TZ', ...keys.map((d, i) => `T${i + 1}C${d}`), 'G90', '%', 'G05'];
  keys.forEach((d, i) => {
    drl.push(`T${i + 1}`);
    for (const h of tools.get(d)!) drl.push(`X${(h.x * U).toFixed(3)}Y${((PH - h.y) * U).toFixed(3)}`);
  });
  drl.push('M30');
  files.push({ name: `${base}.drl`, data: drl.join('\n') });
  files.push({
    name: 'LIESMICH.txt',
    data: `Gerber-X2-Daten aus Ohm Studio by Nodaris\n\nProjekt: ${project.name}\nPlatine: ${(L.w * U).toFixed(1)} × ${(L.h * U).toFixed(1)} mm, ${L.layers} Lagen${panel ? `\nNutzen: ${nx} × ${ny} Platinen, ${(PW * U).toFixed(1)} × ${(PH * U).toFixed(1)} mm, Fräskanal ${panel.gap} mm, Rand ${panel.rail} mm mit Fiducials und Werkzeuglöchern` : ''}\nLötstopplack: ${L.maskName}, Oberfläche: ${L.surface.toUpperCase()}\nMassefläche: ${L.pour ? L.pour.net + ' auf ' + L.pour.layers.join(' + ') : 'keine'}\n\nDiese ZIP-Datei kann direkt bei Platinenherstellern wie JLCPCB, PCBWay, Aisler, Eurocircuits oder Würth hochgeladen werden.\nHinweis: Bitte vor der Bestellung die Gerber-Vorschau des Herstellers prüfen.\n`,
  });
  return files;
}

/* ------------------------------ KiCad ------------------------------ */

const KICAD_FP: Record<string, string> = {
  widerstand: 'Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal',
  led: 'LED_THT:LED_D5.0mm',
  kondensator: 'Capacitor_THT:C_Disc_D5.0mm_W2.5mm_P2.50mm',
  elko: 'Capacitor_THT:CP_Radial_D6.3mm_P2.50mm',
  taster: 'Button_Switch_THT:SW_PUSH_6mm',
  '1n4148': 'Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal',
  '1n4007': 'Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal',
  S8050: 'Package_TO_SOT_THT:TO-92_Inline',
  BC547: 'Package_TO_SOT_THT:TO-92_Inline',
  '2N2222': 'Package_TO_SOT_THT:TO-92_Inline',
  ne555: 'Package_DIP:DIP-8_W7.62mm',
  lm358: 'Package_DIP:DIP-8_W7.62mm',
  '74hc595': 'Package_DIP:DIP-16_W7.62mm',
  summer: 'Buzzer_Beeper:Buzzer_12x9.5RM7.6',
  IRLZ44N: 'Package_TO_SOT_THT:TO-220-3_Vertical',
  LM7805: 'Package_TO_SOT_THT:TO-220-3_Vertical',
};

export function kicadNetlist(project: Project): string {
  const q = (s: string) => `"${String(s).replace(/"/g, "'")}"`;
  const comps = project.parts
    .filter((p) => getPart(p.type) && !getPart(p.type)!.noBom && !p.type.startsWith('steckbrett'))
    .map((p) => {
      const def = getPart(p.type)!;
      const n = def.pins(p.props).filter((x) => x.x > -100).length;
      const fp = KICAD_FP[p.type] ?? `Connector_PinHeader_2.54mm:PinHeader_1x${String(Math.max(1, n)).padStart(2, '0')}_P2.54mm_Vertical`;
      const val = p.props.wert ?? def.name;
      return `    (comp (ref ${q(p.id)}) (value ${q(String(val))}) (footprint ${q(fp)}) (libsource (lib "OhmStudio") (part ${q(p.type)})))`;
    });
  const nets = project.nets.map((n, i) => {
    const nodes = n.pins
      .map((r) => {
        const [pid, pn] = splitRef(r);
        const inst = project.parts.find((p) => p.id === pid);
        const def = inst && getPart(inst.type);
        const pin = def && findPin(def, inst!.props, pn);
        if (!pin) return null;
        const idx = def!.pins(inst!.props).indexOf(pin) + 1;
        return `      (node (ref ${q(pid)}) (pin ${q(String(idx))}) (pinfunction ${q(pin.id)}))`;
      })
      .filter(Boolean);
    return `    (net (code ${q(String(i + 1))}) (name ${q(n.name)})\n${nodes.join('\n')})`;
  });
  return `(export (version "E")\n  (design (source ${q(project.name + '.ohm')}) (date ${q(new Date().toISOString())}) (tool "Ohm Studio by Nodaris"))\n  (components\n${comps.join('\n')})\n  (nets\n${nets.join('\n')}))\n`;
}

/* ------------------------------ Wokwi ------------------------------ */

const WOKWI: Record<string, { type: string; pin: (p: string) => string; attrs?: (props: Record<string, any>) => Record<string, string> }> = {
  'arduino-uno': { type: 'wokwi-arduino-uno', pin: (p) => (p.startsWith('GND') ? `GND.${p.includes('_') ? p.split('_')[1] : 1}` : p.replace(/^D(\d+)$/, '$1')) },
  'arduino-nano': { type: 'wokwi-arduino-nano', pin: (p) => (p.startsWith('GND') ? `GND.${p.includes('_') ? p.split('_')[1] : 1}` : p.replace(/^D(\d+)$/, '$1')) },
  'arduino-mega': { type: 'wokwi-arduino-mega', pin: (p) => (p.startsWith('GND') ? `GND.${p.includes('_') ? p.split('_')[1] : 1}` : p.replace(/^D(\d+)$/, '$1')) },
  'esp32-devkit': { type: 'board-esp32-devkit-c-v4', pin: (p) => (p.startsWith('GND') ? `GND.${p.includes('_') ? p.split('_')[1] : 1}` : p.replace(/^IO/, '')) },
  'esp32-c3-devkit': { type: 'board-esp32-c3-devkitm-1', pin: (p) => (p.startsWith('GND') ? `GND.${p.includes('_') ? p.split('_')[1] : 1}` : p.replace(/^IO/, '')) },
  'esp32-c3-supermini': { type: 'board-esp32-c3-devkitm-1', pin: (p) => (p.startsWith('GND') ? 'GND.1' : p.replace(/^IO/, '')) },
  'esp32-s3-devkit': { type: 'board-esp32-s3-devkitc-1', pin: (p) => (p.startsWith('GND') ? 'GND.1' : p.replace(/^IO/, '')) },
  pico: { type: 'wokwi-pi-pico', pin: (p) => (p.startsWith('GND') ? `GND.${p.includes('_') ? p.split('_')[1] : 1}` : p) },
  'pico-w': { type: 'board-pi-pico-w', pin: (p) => (p.startsWith('GND') ? 'GND.1' : p) },
  widerstand: { type: 'wokwi-resistor', pin: (p) => p, attrs: (pr) => ({ value: String(parseValue(pr.wert, 220)) }) },
  led: { type: 'wokwi-led', pin: (p) => (p === 'K' ? 'C' : p), attrs: (pr) => ({ color: ({ rot: 'red', gruen: 'green', blau: 'blue', gelb: 'yellow', weiss: 'white', orange: 'orange', violett: 'purple' } as Record<string, string>)[pr.farbe] ?? 'red' }) },
  taster: { type: 'wokwi-pushbutton', pin: (p) => (p === '1' ? '1.l' : '2.l'), attrs: () => ({ color: 'green' }) },
  summer: { type: 'wokwi-buzzer', pin: (p) => (p === '+' ? '2' : '1') },
  potentiometer: { type: 'wokwi-potentiometer', pin: (p) => (p === '1' ? 'GND' : p === '2' ? 'SIG' : 'VCC') },
  ssd1306: { type: 'board-ssd1306', pin: (p) => p },
  lcd1602: { type: 'wokwi-lcd1602', pin: (p) => p, attrs: () => ({ pins: 'i2c' }) },
  dht22: { type: 'wokwi-dht22', pin: (p) => (p === 'DATA' ? 'SDA' : p) },
  'hc-sr04': { type: 'wokwi-hc-sr04', pin: (p) => p },
  servo: { type: 'wokwi-servo', pin: (p) => (p === 'SIG' ? 'PWM' : p) },
  pir: { type: 'wokwi-pir-motion-sensor', pin: (p) => p },
  '74hc595': { type: 'wokwi-74hc595', pin: (p) => ({ SER: 'DS', SRCLK: 'SHCP', RCLK: 'STCP', SRCLR: 'MR', OE: 'OE', QA: 'Q0', QB: 'Q1', QC: 'Q2', QD: 'Q3', QE: 'Q4', QF: 'Q5', QG: 'Q6', QH: 'Q7', "QH'": 'Q7S' } as Record<string, string>)[p] ?? p },
  schalter: { type: 'wokwi-slide-switch', pin: (p) => (p === 'COM' ? '2' : p) },
  ldr: { type: 'wokwi-photoresistor-sensor', pin: (p) => (p === '1' ? 'VCC' : 'AO') },
  'ws2812': { type: 'wokwi-neopixel', pin: (p) => p },
  mpu6050: { type: 'wokwi-mpu6050', pin: (p) => p },
  'drehencoder': { type: 'wokwi-ky-040', pin: (p) => p },
  'keypad-4x4': { type: 'wokwi-membrane-keypad', pin: (p) => p },
  'rgb-led': { type: 'wokwi-rgb-led', pin: (p) => p },
  ds18b20: { type: 'board-ds18b20', pin: (p) => p },
  'ntc': { type: 'wokwi-ntc-temperature-sensor', pin: (p) => p },
  max7219: { type: 'wokwi-max7219-matrix', pin: (p) => p },
  relais: { type: 'wokwi-relay-module', pin: (p) => p },
};

export function wokwiDiagram(project: Project): { json: string; skipped: string[] } {
  const skipped: string[] = [];
  const parts: unknown[] = [];
  const idOf = (id: string) => id.toLowerCase();
  for (const p of project.parts) {
    const w = WOKWI[p.type];
    if (!w) {
      if (!p.type.startsWith('steckbrett')) skipped.push(`${p.id} (${p.type})`);
      continue;
    }
    parts.push({ type: w.type, id: idOf(p.id), top: Math.round(p.y * 0.6), left: Math.round(p.x * 0.6), rotate: p.rot || undefined, attrs: w.attrs?.(p.props) ?? {} });
  }
  const conns: unknown[] = [];
  for (const n of project.nets) {
    const refs = n.pins
      .map((r) => {
        const [pid, pn] = splitRef(r);
        const inst = project.parts.find((p) => p.id === pid);
        const w = inst && WOKWI[inst.type];
        const def = inst && getPart(inst.type);
        const pin = def && findPin(def, inst!.props, pn);
        if (!w || !pin) return null;
        return `${idOf(pid)}:${w.pin(pin.id)}`;
      })
      .filter((x): x is string => !!x);
    const col = /GND/i.test(n.name) ? 'black' : /VCC|5V|3V3|VBAT|VIN/i.test(n.name) ? 'red' : 'green';
    for (let i = 1; i < refs.length; i++) conns.push([refs[0], refs[i], col, []]);
  }
  const json = JSON.stringify({ version: 1, author: project.autor ?? '', editor: 'wokwi', parts, connections: conns, dependencies: {} }, null, 2);
  return { json, skipped };
}

/* ------------------------------ SPICE ------------------------------ */

export function spiceNetlist(project: Project): string {
  const nodeName = new Map<string, string>();
  for (const n of project.nets) {
    const name = /^(GND|MASSE)$/i.test(n.name) ? '0' : n.name.replace(/[^A-Za-z0-9_]/g, '_');
    for (const r of n.pins) {
      const [pid, pn] = splitRef(r);
      const inst = project.parts.find((p) => p.id === pid);
      const def = inst && getPart(inst.type);
      const pin = def && findPin(def, inst!.props, pn);
      if (pin) nodeName.set(`${pid}.${pin.id}`, name);
    }
  }
  let nc = 0;
  const N = (id: string, pin: string) => nodeName.get(`${id}.${pin}`) ?? `NC${++nc}`;
  const lines = [`* ${project.name} – exportiert aus Ohm Studio by Nodaris`, '* Für ngspice: Mikrocontroller sind als Kommentar aufgeführt.', ''];
  const models = new Set<string>();
  for (const p of project.parts) {
    const t = p.type;
    if (t === 'widerstand') lines.push(`R${p.id} ${N(p.id, '1')} ${N(p.id, '2')} ${parseValue(p.props.wert, 220)}`);
    else if (t === 'kondensator' || t === 'folienkondensator') lines.push(`C${p.id} ${N(p.id, '1')} ${N(p.id, '2')} ${parseValue(p.props.wert, 1e-7)}`);
    else if (t === 'elko') lines.push(`C${p.id} ${N(p.id, '+')} ${N(p.id, '-')} ${parseValue(p.props.wert, 1e-4)}`);
    else if (t === 'spule') lines.push(`L${p.id} ${N(p.id, '1')} ${N(p.id, '2')} ${parseValue(p.props.wert, 1e-4)}`);
    else if (t === 'led') {
      const c = ledColor(p.props.farbe);
      const m = `LED_${String(p.props.farbe).toUpperCase()}`;
      models.add(`.model ${m} D(IS=${(0.02 / Math.exp(c.vf / (2.2 * 0.02585))).toExponential(3)} N=2.2 RS=6 BV=5)`);
      lines.push(`D${p.id} ${N(p.id, 'A')} ${N(p.id, 'K')} ${m}`);
    } else if (['1n4148', '1n4007', 'schottky', 'zener'].includes(t)) {
      models.add(`.model D${t.toUpperCase()} D(IS=2.5n N=1.8${t === 'zener' ? ` BV=${parseValue(p.props.wert, 5.1)}` : ''})`);
      lines.push(`D${p.id} ${N(p.id, 'A')} ${N(p.id, 'K')} D${t.toUpperCase()}`);
    } else if (['S8050', 'BC547', '2N2222', '2N3904', 'TIP120'].includes(t)) {
      models.add(`.model Q${t} NPN(IS=1e-14 BF=${t === 'TIP120' ? 1000 : 200})`);
      lines.push(`Q${p.id} ${N(p.id, 'C')} ${N(p.id, 'B')} ${N(p.id, 'E')} Q${t}`);
    } else if (['BC557', 'S8550', '2N3906'].includes(t)) {
      models.add(`.model Q${t} PNP(IS=1e-14 BF=200)`);
      lines.push(`Q${p.id} ${N(p.id, 'C')} ${N(p.id, 'B')} ${N(p.id, 'E')} Q${t}`);
    } else if (['IRLZ44N', 'AO3400', '2N7000', 'IRF520'].includes(t)) {
      models.add(`.model M${t} NMOS(VTO=1.6 KP=30)`);
      lines.push(`M${p.id} ${N(p.id, 'D')} ${N(p.id, 'G')} ${N(p.id, 'S')} ${N(p.id, 'S')} M${t}`);
    } else if (t === 'batteriehalter' || t.startsWith('batterie') || t === 'cr2032' || t === 'akku-18650' || t === 'lipo') {
      lines.push(`V${p.id} ${N(p.id, '+')} ${N(p.id, '-')} DC ${p.type === 'batteriehalter' ? 4.5 : 3.7}`);
    } else if (t === 'usb-netzteil') lines.push(`V${p.id} ${N(p.id, '+')} ${N(p.id, '-')} DC 5`);
    else if (t === 'labornetzteil') lines.push(`V${p.id} ${N(p.id, '+')} ${N(p.id, '-')} DC ${p.props.spannung}`);
    else if (t === 'potentiometer' || t === 'trimmer') {
      const r = parseValue(p.props.wert, 1e4);
      const pos = Number(p.props.position ?? 0.5);
      lines.push(`R${p.id}a ${N(p.id, '1')} ${N(p.id, '2')} ${Math.max(1, r * pos)}`, `R${p.id}b ${N(p.id, '2')} ${N(p.id, '3')} ${Math.max(1, r * (1 - pos))}`);
    } else lines.push(`* ${p.id}: ${getPart(t)?.name ?? t} (nicht als SPICE-Modell verfügbar)`);
  }
  lines.push('', ...models, '', '.op', '.tran 1m 1', '.end', '');
  return lines.join('\n');
}
