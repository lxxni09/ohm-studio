/**
 * Fertigungsdaten: Pick-and-Place, Bestückungszeichnung (PDF), IPC-2581, ODB++ (Grundumfang),
 * STEP (3D), Testpunkte und das komplette Fertigungspaket.
 */
import { computePcb, type PcbLayout } from '../views/pcbLayout';
import { getPart } from '../parts/registry';
import { parseValue, formatValue } from '../lib/units';
import type { Project } from '../ohm/model';
import { bomCsv } from './bom';
import { gerberFiles, zip } from './exporters';

const U = 0.254;

function valueOf(project: Project, id: string): string {
  const p = project.parts.find((x) => x.id === id)!;
  if (p.props.wert !== undefined) {
    const unit = p.type === 'widerstand' || p.type === 'potentiometer' ? 'Ω' : /kondensator|elko/.test(p.type) ? 'F' : p.type === 'spule' ? 'H' : '';
    return unit ? formatValue(parseValue(p.props.wert, 0), unit).replace(' ', '') : String(p.props.wert);
  }
  return getPart(p.type)?.name ?? p.type;
}

function packageOf(type: string): string {
  const map: Record<string, string> = {
    widerstand: 'AXIAL-0.4', led: 'LED-5MM', kondensator: 'C-DISC-2.5', elko: 'CP-RADIAL-2.5', taster: 'SW-TACT-6x6', S8050: 'TO-92', BC547: 'TO-92', '2N2222': 'TO-92',
    ne555: 'DIP-8', lm358: 'DIP-8', '74hc595': 'DIP-16', IRLZ44N: 'TO-220', LM7805: 'TO-220', AO3400: 'SOT-23', summer: 'BUZZER-12MM', '1n4148': 'DO-35', '1n4007': 'DO-41',
  };
  const def = getPart(type);
  if (map[type]) return map[type];
  if (def?.board) return `MODULE-${def.board.id.toUpperCase()}`;
  return 'THT-MODULE';
}

/** Bestückungsdaten (Centroid) für den Bestückungsautomaten */
export function pickPlaceCsv(project: Project, L: PcbLayout = computePcb(project)): string {
  const lines = ['Designator,Val,Package,Mid X,Mid Y,Rotation,Layer'];
  for (const f of L.footprints) lines.push([f.id, `"${valueOf(project, f.id)}"`, packageOf(f.kind), ((f.x + f.w / 2) * U).toFixed(3) + 'mm', ((L.h - f.y - f.h / 2) * U).toFixed(3) + 'mm', f.rot, 'Top'].join(','));
  return lines.join('\r\n') + '\r\n';
}

/** Testpunkte: je Netz ein Pad, Koordinaten für den Nadelbettadapter */
export function testPoints(project: Project, L: PcbLayout = computePcb(project)): { net: string; x: number; y: number; ref: string }[] {
  const out: { net: string; x: number; y: number; ref: string }[] = [];
  for (const n of project.nets) {
    const pad = L.footprints.flatMap((f) => f.pads).find((p) => p.net === n.name);
    if (pad) out.push({ net: n.name, x: pad.x * U, y: (L.h - pad.y) * U, ref: pad.ref });
  }
  return out;
}

export function testPointsCsv(project: Project): string {
  return ['Testpunkt,Netz,Pad,X (mm),Y (mm),Seite', ...testPoints(project).map((t, i) => `TP${i + 1},${t.net},${t.ref},${t.x.toFixed(3)},${t.y.toFixed(3)},Unten`)].join('\r\n') + '\r\n';
}

/* ------------------------------ PDF ------------------------------ */

/** Minimaler PDF-Schreiber (Vektorlinien, Rechtecke, Kreise, Text in Helvetica) */
class Pdf {
  private ops: string[] = [];
  constructor(public w: number, public h: number) {}
  line(x1: number, y1: number, x2: number, y2: number, lw = 0.5, gray = 0) {
    this.ops.push(`${gray} G ${lw} w ${x1.toFixed(2)} ${(this.h - y1).toFixed(2)} m ${x2.toFixed(2)} ${(this.h - y2).toFixed(2)} l S`);
  }
  rect(x: number, y: number, w: number, h: number, lw = 0.5, fill?: number) {
    this.ops.push(fill !== undefined ? `${fill} g ${x.toFixed(2)} ${(this.h - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f` : `0 G ${lw} w ${x.toFixed(2)} ${(this.h - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
  }
  circle(x: number, y: number, r: number, fill = 0.2) {
    const k = 0.5523 * r;
    const Y = this.h - y;
    this.ops.push(`${fill} g ${x + r} ${Y} m ${x + r} ${Y + k} ${x + k} ${Y + r} ${x} ${Y + r} c ${x - k} ${Y + r} ${x - r} ${Y + k} ${x - r} ${Y} c ${x - r} ${Y - k} ${x - k} ${Y - r} ${x} ${Y - r} c ${x + k} ${Y - r} ${x + r} ${Y - k} ${x + r} ${Y} c f`);
  }
  text(x: number, y: number, s: string, size = 8, gray = 0) {
    const t = s.replace(/[\\()]/g, (c) => '\\' + c).replace(/[^\x20-\x7e]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss', '×': 'x', '–': '-', 'Ω': 'Ohm', 'µ': 'u' } as Record<string, string>)[c] ?? '?');
    this.ops.push(`BT ${gray} g /F1 ${size} Tf ${x.toFixed(2)} ${(this.h - y).toFixed(2)} Td (${t}) Tj ET`);
  }
  build(): Uint8Array {
    const content = this.ops.join('\n');
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.w} ${this.h}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let out = '%PDF-1.4\n';
    const offs: number[] = [];
    objs.forEach((o, i) => {
      offs.push(out.length);
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new TextEncoder().encode(out);
  }
}

/** Bestückungszeichnung als PDF (A4 quer) */
export function assemblyPdf(project: Project, L: PcbLayout = computePcb(project)): Uint8Array {
  const pdf = new Pdf(842, 595);
  const margin = 40;
  const s = Math.min((842 - 2 * margin - 200) / L.w, (595 - 2 * margin - 40) / L.h);
  const ox = margin;
  const oy = margin + 30;
  pdf.text(margin, margin, `Bestueckungszeichnung - ${project.name}`, 16);
  pdf.text(margin, margin + 16, `Ohm Studio by Nodaris - ${new Date().toLocaleDateString('de-DE')} - Platine ${(L.w * U).toFixed(1)} x ${(L.h * U).toFixed(1)} mm, ${L.layers} Lagen`, 8, 0.4);
  pdf.rect(ox, oy, L.w * s, L.h * s, 1.2);
  for (const f of L.footprints) {
    pdf.rect(ox + f.x * s, oy + f.y * s, f.w * s, f.h * s, 0.6);
    pdf.text(ox + f.x * s + 2, oy + f.y * s + 9, f.id, 7);
    for (const p of f.pads) pdf.circle(ox + p.x * s, oy + p.y * s, Math.max(1, (p.d / 2) * s), p.square ? 0 : 0.35);
  }
  // Legende / Stückliste
  let y = oy;
  const lx = 842 - margin - 190;
  pdf.text(lx, y, 'Bauteile', 11);
  y += 14;
  for (const f of L.footprints) {
    if (y > 595 - margin) break;
    pdf.text(lx, y, `${f.id}`, 8);
    pdf.text(lx + 40, y, valueOf(project, f.id).slice(0, 26), 8, 0.3);
    y += 11;
  }
  return pdf.build();
}

/* ------------------------------ IPC-2581 ------------------------------ */

export function ipc2581(project: Project, L: PcbLayout = computePcb(project)): string {
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
  const mm = (v: number) => (v * U).toFixed(4);
  const layerNames = L.layers >= 2 ? ['TOP', 'BOTTOM'] : ['TOP'];
  const comps = L.footprints
    .map((f) => `      <Component refDes="${esc(f.id)}" packageRef="${packageOf(f.kind)}" layerRef="TOP" part="${esc(valueOf(project, f.id))}"><Xform rotation="${f.rot}"/><Location x="${mm(f.x + f.w / 2)}" y="${mm(L.h - f.y - f.h / 2)}"/></Component>`)
    .join('\n');
  const nets = project.nets.map((n) => `      <LogicalNet name="${esc(n.name)}">${L.footprints.flatMap((f) => f.pads).filter((p) => p.net === n.name).map((p) => `<PinRef componentRef="${esc(p.ref.split('.')[0])}" pin="${esc(p.ref.split('.')[1])}"/>`).join('')}</LogicalNet>`).join('\n');
  const traces = L.traces
    .map((t) => `          <Set net="${esc(t.net)}"><Features><Polyline><PolyBegin x="${mm(t.pts[0].x)}" y="${mm(L.h - t.pts[0].y)}"/>${t.pts.slice(1).map((p) => `<PolyStepSegment x="${mm(p.x)}" y="${mm(L.h - p.y)}"/>`).join('')}<LineDescRef id="W${t.width}"/></Polyline></Features></Set>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<IPC-2581 revision="C" xmlns="http://webstds.ipc.org/2581">
  <Content roleRef="Owner">
    <FunctionMode mode="FABRICATION"/>
    <StepRef name="${esc(project.name)}"/>
${layerNames.map((l) => `    <LayerRef name="${l}"/>`).join('\n')}
    <DictionaryLineDesc units="MILLIMETER">${[...new Set(L.traces.map((t) => t.width))].map((w) => `<EntryLineDesc id="W${w}"><LineDesc lineEnd="ROUND" lineWidth="${mm(w)}"/></EntryLineDesc>`).join('')}</DictionaryLineDesc>
  </Content>
  <LogisticHeader><Role id="Owner" roleFunction="SENDER"/><Enterprise id="Nodaris" code="NONE"/></LogisticHeader>
  <Bom name="BOM">
${L.footprints.map((f) => `    <BomItem OEMDesignNumberRef="${esc(valueOf(project, f.id))}" quantity="1"><RefDes name="${esc(f.id)}" populate="true" layerRef="TOP"/></BomItem>`).join('\n')}
  </Bom>
  <Ecad name="${esc(project.name)}">
    <CadHeader units="MILLIMETER"/>
    <CadData>
${layerNames.map((l, i) => `      <Layer name="${l}" layerFunction="SIGNAL" side="${i === 0 ? 'TOP' : 'BOTTOM'}" polarity="POSITIVE"/>`).join('\n')}
      <Step name="${esc(project.name)}">
        <Profile><Polygon><PolyBegin x="0" y="0"/><PolyStepSegment x="${mm(L.w)}" y="0"/><PolyStepSegment x="${mm(L.w)}" y="${mm(L.h)}"/><PolyStepSegment x="0" y="${mm(L.h)}"/><PolyStepSegment x="0" y="0"/></Polygon></Profile>
${comps}
${nets}
        <LayerFeature layerRef="TOP">
${traces}
        </LayerFeature>
      </Step>
    </CadData>
  </Ecad>
</IPC-2581>
`;
}

/* ------------------------------ ODB++ (Grundumfang) ------------------------------ */

export function odbFiles(project: Project, L: PcbLayout = computePcb(project)): { name: string; data: string }[] {
  const job = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'ohm';
  const mm = (v: number) => (v * U).toFixed(4);
  const layers = L.layers >= 2 ? ['top', 'bottom'] : ['top'];
  const files: { name: string; data: string }[] = [];
  files.push({ name: `${job}/matrix/matrix`, data: `STEP {\n   COL=1\n   NAME=PCB\n}\n${layers.map((l, i) => `LAYER {\n   ROW=${i + 1}\n   CONTEXT=BOARD\n   TYPE=SIGNAL\n   NAME=${l.toUpperCase()}\n   POLARITY=POSITIVE\n}`).join('\n')}\nLAYER {\n   ROW=${layers.length + 1}\n   CONTEXT=BOARD\n   TYPE=DRILL\n   NAME=DRILL\n   POLARITY=POSITIVE\n}\n` });
  files.push({ name: `${job}/misc/info`, data: `JOB_NAME=${job}\nODB_VERSION_MAJOR=8\nODB_VERSION_MINOR=1\nODB_SOURCE=Ohm Studio by Nodaris\nCREATION_DATE=${new Date().toISOString().slice(0, 10).replace(/-/g, '')}\nUNITS=MM\n` });
  files.push({ name: `${job}/steps/pcb/profile`, data: `UNITS=MM\nOB ${mm(0)} ${mm(0)} I\nOS ${mm(L.w)} ${mm(0)}\nOS ${mm(L.w)} ${mm(L.h)}\nOS ${mm(0)} ${mm(L.h)}\nOE\n` });
  for (const l of layers) {
    const syms: string[] = [];
    const sym = (n: string) => {
      if (!syms.includes(n)) syms.push(n);
      return syms.indexOf(n);
    };
    const feats: string[] = [];
    for (const p of L.footprints.flatMap((f) => f.pads)) feats.push(`P ${mm(p.x)} ${mm(L.h - p.y)} ${sym(`${p.square ? 's' : 'r'}${Math.round(p.d * U * 1000)}`)} P 0 0`);
    for (const t of L.traces.filter((tr) => tr.layer === l))
      for (let i = 1; i < t.pts.length; i++) feats.push(`L ${mm(t.pts[i - 1].x)} ${mm(L.h - t.pts[i - 1].y)} ${mm(t.pts[i].x)} ${mm(L.h - t.pts[i].y)} ${sym(`r${Math.round(t.width * U * 1000)}`)} P 0`);
    files.push({ name: `${job}/steps/pcb/layers/${l}/features`, data: `UNITS=MM\n#\n${syms.map((s, i) => `$${i} ${s}`).join('\n')}\n#\n${feats.join('\n')}\n` });
  }
  files.push({ name: `${job}/steps/pcb/layers/drill/features`, data: `UNITS=MM\n$0 r900\n#\n${L.footprints.flatMap((f) => f.pads).map((p) => `P ${mm(p.x)} ${mm(L.h - p.y)} 0 P 0 0`).join('\n')}\n` });
  files.push({ name: `${job}/steps/pcb/eda/data`, data: `HDR Ohm Studio by Nodaris\n${project.nets.map((n, i) => `NET ${n.name.replace(/\s/g, '_')} ;ID=${i}`).join('\n')}\n` });
  return files;
}

/* ------------------------------ STEP (3D) ------------------------------ */

/** STEP AP214 mit Platine und Bauteilkörpern als Quader */
export function stepModel(project: Project, L: PcbLayout = computePcb(project)): string {
  const boxes: StepBox[] = [{ x0: 0, y0: 0, z0: -1.6, x1: L.w * U, y1: L.h * U, z1: 0, name: 'PCB' }];
  for (const f of L.footprints) boxes.push({ x0: f.x * U, y0: (L.h - f.y - f.h) * U, z0: 0, x1: (f.x + f.w) * U, y1: (L.h - f.y) * U, z1: Math.max(1, f.height), name: f.id });
  return stepBoxes(project.name, boxes);
}

export interface StepBox {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  name: string;
}

/** STEP AP214 aus achsparallelen Quadern (mm) */
export function stepBoxes(title: string, list: StepBox[]): string {
  const project = { name: title };
  let id = 10;
  const lines: string[] = [];
  const e = (s: string) => {
    lines.push(`#${id}=${s};`);
    return id++;
  };
  const solids: number[] = [];
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, name: string) => {
    const P = (x: number, y: number, z: number) => e(`CARTESIAN_POINT('',(${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}))`);
    const V = (p: number) => e(`VERTEX_POINT('',#${p})`);
    const c = [P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0), P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)];
    const v = c.map(V);
    const dir = (x: number, y: number, z: number) => e(`DIRECTION('',(${x},${y},${z}))`);
    const edge = (a: number, b: number) => {
      const pa = c[a];
      const vec = e(`VECTOR('',#${dir(0, 0, 1)},1.)`);
      const ln = e(`LINE('',#${pa},#${vec})`);
      return e(`EDGE_CURVE('',#${v[a]},#${v[b]},#${ln},.T.)`);
    };
    const faceDef: [number[], [number, number, number]][] = [
      [[0, 1, 2, 3], [0, 0, -1]],
      [[4, 5, 6, 7], [0, 0, 1]],
      [[0, 1, 5, 4], [0, -1, 0]],
      [[1, 2, 6, 5], [1, 0, 0]],
      [[2, 3, 7, 6], [0, 1, 0]],
      [[3, 0, 4, 7], [-1, 0, 0]],
    ];
    const faces = faceDef.map(([idx, n]) => {
      const oes = idx.map((a, k) => e(`ORIENTED_EDGE('',*,*,#${edge(a, idx[(k + 1) % 4])},.T.)`));
      const loop = e(`EDGE_LOOP('',(${oes.map((o) => '#' + o).join(',')}))`);
      const bound = e(`FACE_OUTER_BOUND('',#${loop},.T.)`);
      const ax = e(`AXIS2_PLACEMENT_3D('',#${c[idx[0]]},#${dir(...n)},#${dir(n[2] !== 0 ? 1 : 0, 0, n[2] !== 0 ? 0 : 1)})`);
      const pl = e(`PLANE('',#${ax})`);
      return e(`ADVANCED_FACE('',(#${bound}),#${pl},.T.)`);
    });
    const shell = e(`CLOSED_SHELL('',(${faces.map((f) => '#' + f).join(',')}))`);
    solids.push(e(`MANIFOLD_SOLID_BREP('${name}',#${shell})`));
  };
  for (const b of list) box(b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, b.name.replace(/'/g, ''));
  const ctx = e(`(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNIT_ASSIGNED_CONTEXT((#1,#2,#3)) REPRESENTATION_CONTEXT('',''))`);
  e(`ADVANCED_BREP_SHAPE_REPRESENTATION('${project.name.replace(/'/g, '')}',(${solids.map((s) => '#' + s).join(',')}),#${ctx})`);
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Ohm Studio by Nodaris 3D-Export'),'2;1');
FILE_NAME('${project.name.replace(/'/g, '')}.step','${new Date().toISOString().slice(0, 19)}',('Nodaris'),('Nodaris'),'Ohm Studio','Ohm Studio 2.0','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
#1=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));
#2=(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.));
#3=(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT());
${lines.join('\n')}
ENDSEC;
END-ISO-10303-21;
`;
}

/* ------------------------------ Fertigungspaket ------------------------------ */

export function fabPackage(project: Project): Blob {
  const L = computePcb(project);
  const files: { name: string; data: string | Uint8Array }[] = [
    ...gerberFiles(project).map((f) => ({ name: `gerber/${f.name}`, data: f.data })),
    { name: 'bestueckung/pick-and-place.csv', data: pickPlaceCsv(project, L) },
    { name: 'bestueckung/bestueckungszeichnung.pdf', data: assemblyPdf(project, L) },
    { name: 'bestueckung/stueckliste.csv', data: bomCsv(project) },
    { name: 'pruefung/testpunkte.csv', data: testPointsCsv(project) },
    { name: 'daten/ipc-2581.xml', data: ipc2581(project, L) },
    { name: 'daten/platine.step', data: stepModel(project, L) },
    ...odbFiles(project, L).map((f) => ({ name: `daten/odb/${f.name}`, data: f.data })),
    {
      name: 'LIESMICH.txt',
      data: `Fertigungsdokumentation – ${project.name}\nErstellt mit Ohm Studio by Nodaris am ${new Date().toLocaleString('de-DE')}\n\ngerber/        Gerber X2 + Excellon-Bohrdaten (Leiterplattenfertigung)\nbestueckung/   Pick-and-Place, Bestückungszeichnung (PDF), Stückliste mit Bestelllinks\npruefung/      Testpunkte für Nadelbettadapter (je Netz ein Pad)\ndaten/         IPC-2581 (Rev. C), ODB++ (Grundumfang), 3D-Modell (STEP AP214)\n\nPlatine: ${(L.w * U).toFixed(1)} × ${(L.h * U).toFixed(1)} mm, ${L.layers} Lagen, ${L.footprints.length} Bauteile, ${L.vias.length} Vias.\n`,
    },
  ];
  return zip(files);
}

/* ------------------------------ Preisschätzung Fertiger ------------------------------ */

export interface FabQuote {
  fab: string;
  url: string;
  qty: number;
  price: number;
  days: string;
  note: string;
}

/** Richtpreise aus öffentlichen Preislisten (Stand 2026, ohne Versand/MwSt.) */
export function fabQuotes(project: Project, qty = 5): FabQuote[] {
  const L = computePcb(project);
  const area = (L.w * U * L.h * U) / 100; // cm²
  const layers = L.layers;
  const lf = layers <= 2 ? 1 : layers <= 4 ? 3.2 : layers <= 6 ? 6 : 10;
  const color = project.views.platine?.farbe ?? 'gruen';
  const surf = project.views.platine?.oberflaeche ?? 'enig';
  const jl = Math.max(2, (layers <= 2 && L.w * U <= 100 && L.h * U <= 100 && qty <= 10 ? 2 : 0.04 * area * qty) * lf) + (surf === 'enig' ? 15 : 0) + (color !== 'gruen' && color !== 'schwarz' ? 0 : 0);
  return [
    { fab: 'JLCPCB', url: 'https://cart.jlcpcb.com/quote', qty, price: jl, days: '2–4 Tage + Versand', note: layers <= 2 && area <= 100 && qty <= 10 ? 'Aktionspreis für bis 10×10 cm und bis 10 Stück' : 'Flächenpreis' },
    { fab: 'PCBWay', url: 'https://www.pcbway.com/orderonline.aspx', qty, price: Math.max(5, 0.05 * area * qty * lf) + (surf === 'enig' ? 20 : 0), days: '3–5 Tage + Versand', note: 'Schätzung' },
    { fab: 'Aisler', url: 'https://aisler.net/', qty: 3, price: (layers > 4 ? NaN : (layers <= 2 ? 0.37 : 0.82) * area * 3) + 0, days: '6–9 Tage (DE)', note: 'Made in Germany, inkl. ENIG' },
    { fab: 'Eurocircuits', url: 'https://www.eurocircuits.com/', qty, price: Math.max(60, 1.1 * area * qty * (lf / 1.4)), days: '5–8 Tage', note: 'Europäische Fertigung' },
    { fab: 'Würth Elektronik', url: 'https://www.wedirekt.de/', qty, price: Math.max(90, 1.3 * area * qty * (lf / 1.4)), days: '5–10 Tage', note: 'Industriequalität' },
  ].filter((q) => Number.isFinite(q.price));
}
