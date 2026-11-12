/**
 * Grundbauteile: Passive, Halbleiter, Stromversorgung, Ein-/Ausgabe, Steckbrett.
 */
import { a11y } from '../../a11y';
import { Bjt, Capacitor, CurrentSource, Diode, diodeFromVf, Inductor, Mosfet, Regulator, Resistor, Source, Switch, VT, type Device } from '../../sim/mna';
import { formatValue, parseValue, resistorBands, nearestE24 } from '../../lib/units';
import { Glow, HeaderPins, Label, Lead, Pcb, Smoke, TactButton, shade, Chip, Pad } from '../svg';
import { PITCH, type BuildCtx, type PartDef } from '../types';

/* ------------------------------------------------------------------ */
/* Hilfen                                                              */
/* ------------------------------------------------------------------ */

const two = (len: number, y = 0, a = '1', b = '2') => () => [
  { id: a, x: 0, y, label: a },
  { id: b, x: len, y, label: b },
];

export const LED_COLORS: Record<string, { hex: string; vf: number; body: string; nm?: string }> = {
  rot: { hex: '#ff2a1f', vf: 1.9, body: '#ff5a50', nm: '625 nm' },
  gruen: { hex: '#30ff5a', vf: 2.1, body: '#66e888', nm: '570 nm' },
  'echt-gruen': { hex: '#2bff9a', vf: 3.0, body: '#5cf0b2', nm: '525 nm' },
  blau: { hex: '#2f6bff', vf: 3.0, body: '#6f9bff', nm: '470 nm' },
  gelb: { hex: '#ffd21f', vf: 2.0, body: '#ffe066', nm: '590 nm' },
  orange: { hex: '#ff8a1f', vf: 2.0, body: '#ffaa55', nm: '605 nm' },
  weiss: { hex: '#f4f8ff', vf: 3.0, body: '#f2f4f7' },
  warmweiss: { hex: '#ffe2b0', vf: 3.0, body: '#fbf3e4' },
  violett: { hex: '#b04bff', vf: 3.2, body: '#c58bff', nm: '405 nm' },
  infrarot: { hex: '#5a1010', vf: 1.25, body: '#a9a5b8', nm: '940 nm' },
  uv: { hex: '#8b5cff', vf: 3.3, body: '#d6d0ff', nm: '395 nm' },
};
const COLOR_ALIASES: Record<string, string> = { red: 'rot', green: 'gruen', grün: 'gruen', blue: 'blau', yellow: 'gelb', white: 'weiss', weiß: 'weiss', ir: 'infrarot', purple: 'violett' };
export function ledColor(c: string) {
  const k = COLOR_ALIASES[String(c).toLowerCase()] ?? String(c).toLowerCase();
  return LED_COLORS[k] ?? LED_COLORS.rot;
}

function ledModel(color: string) {
  const c = ledColor(color);
  return diodeFromVf(c.vf, 0.02, 2.2, 5);
}

/** Bauteil, das bei Überlast „stirbt“ */
function overload(ctx: BuildCtx, cond: boolean, dt: number, after: number, msg: string, key = 'burnt') {
  if (!ctx.realism && key !== 'burnt') return;
  if (cond) {
    ctx.state._over = (ctx.state._over ?? 0) + dt;
    if (ctx.state._over > after && !ctx.state[key]) {
      ctx.state[key] = true;
      ctx.state.smokeUntil = ctx.time + 2.5;
      ctx.warn(msg, 'error');
      ctx.invalidate();
    }
  } else ctx.state._over = Math.max(0, (ctx.state._over ?? 0) - dt * 0.5);
}

const E = (v: string) => (v === undefined ? '' : v);
void E;

/* ------------------------------------------------------------------ */
/* Passive Bauteile                                                    */
/* ------------------------------------------------------------------ */

const resistor: PartDef = {
  type: 'widerstand',
  aliases: ['resistor', 'r', 'widerstand-metall'],
  name: 'Widerstand',
  category: 'Passiv',
  keywords: 'resistor ohm r kohm vorwiderstand pullup pulldown',
  prefix: 'R',
  defaults: { wert: '220', leistung: '0.25W', ringe: 4, toleranz: '5%' },
  props: [
    { key: 'wert', label: 'Widerstand', type: 'value', unit: 'Ω', hint: 'z. B. 220, 4k7, 1M' },
    { key: 'ringe', label: 'Farbringe', type: 'select', options: ['4', '5'] },
    { key: 'leistung', label: 'Belastbarkeit', type: 'select', options: ['0.125W', '0.25W', '0.5W', '1W', '2W'] },
  ],
  size: () => ({ w: 40, h: 10 }),
  pins: two(40, 5),
  render: ({ props, state }) => {
    const ohm = parseValue(props.wert, 220);
    const five = String(props.ringe) === '5';
    const bands = resistorBands(ohm, five);
    const body = five ? '#7fb0de' : '#e6c99a';
    const hot = Math.min(1, state.heat ?? 0);
    const len = 25;
    const x0 = 20 - len / 2;
    return (
      <g>
        <Lead x1={0} y1={5} x2={40} y2={5} />
        <g filter="url(#f-shadow)">
          <path d={`M${x0 + 3} 1.2 h${len - 6} q3 0 3 3.8 q0 3.8 -3 3.8 h-${len - 6} q-3 0 -3 -3.8 q0 -3.8 3 -3.8z`} fill={body} />
          <path d={`M${x0} 5 q0 -4.4 3.5 -4.4 h2 q1 0 1 1 v6.8 q0 1 -1 1 h-2 q-3.5 0 -3.5 -4.4z`} fill={body} />
          <path d={`M${x0 + len} 5 q0 -4.4 -3.5 -4.4 h-2 q-1 0 -1 1 v6.8 q0 1 1 1 h2 q3.5 0 3.5 -4.4z`} fill={body} />
          {bands.map((c, i) => {
            const pos = five ? [4.2, 7.6, 11, 14.4, 20.5][i] : [4.4, 8.4, 12.4, 19.8][i];
            return <rect key={i} x={x0 + pos} y={i === 0 || i === bands.length - 1 ? 0.8 : 1.4} width={2.4} height={i === 0 || i === bands.length - 1 ? 8.4 : 7.2} fill={c} />;
          })}
          <rect x={x0} y={0.6} width={len} height={8.8} rx={4} fill="url(#g-cyl)" />
          {hot > 0 && <rect x={x0} y={0.6} width={len} height={8.8} rx={4} fill="#3a1a00" opacity={hot * 0.6} />}
        </g>
        {a11y.colorblind && (
          <text x={20} y={-2.5} fontSize={5} textAnchor="middle" fill="currentColor" style={{ fontWeight: 600 }}>
            {formatValue(ohm, 'Ω').replace(' ', '')}
          </text>
        )}
        {state.smokeUntil > (state.now ?? 0) && <Smoke x={20} y={2} />}
      </g>
    );
  },
  symbol: 'resistor',
  build(ctx) {
    if (ctx.state.burnt) return;
    const r = ctx.add(new Resistor(ctx.node('1'), ctx.node('2'), Math.max(parseValue(ctx.props.wert, 220), 1e-3)));
    const rating = parseValue(ctx.props.leistung, 0.25);
    return {
      post(c, dt) {
        const i = r.current(c.circuit.x);
        const p = i * i * r.r;
        c.state.i = i;
        c.state.p = p;
        c.state.heat = Math.max(0, (p / rating - 0.8) / 2);
        overload(c, p > rating * 2.5, dt, 0.6, `${c.id} (${formatValue(r.r, 'Ω')}) überhitzt: ${formatValue(p, 'W')} bei max. ${formatValue(rating, 'W')}. Nimm einen größeren Widerstandswert oder einen Typ mit höherer Leistung.`);
      },
    };
  },
  info: 'Begrenzt den Strom nach dem Ohmschen Gesetz U = R · I. Farbringe zeigen den Wert (z. B. rot-rot-braun = 220 Ω).',
  price: 0.05,
  bom: (p) => `Widerstand ${formatValue(parseValue(p.wert, 220), 'Ω')} ${p.leistung ?? '0.25W'}`,
  height3d: 2.5,
};

const potentiometer: PartDef = {
  type: 'potentiometer',
  aliases: ['poti', 'pot', 'potentiometer-10k'],
  name: 'Potentiometer',
  category: 'Passiv',
  keywords: 'poti drehwiderstand regler knob',
  prefix: 'RV',
  defaults: { wert: '10k', position: 0.5, kurve: 'linear' },
  props: [
    { key: 'wert', label: 'Gesamtwiderstand', type: 'value', unit: 'Ω' },
    { key: 'position', label: 'Stellung', type: 'range', min: 0, max: 1, step: 0.01, live: true },
    { key: 'kurve', label: 'Kennlinie', type: 'select', options: ['linear', 'logarithmisch'] },
  ],
  size: () => ({ w: 60, h: 64 }),
  pins: () => [
    { id: '1', x: 10, y: 60, label: '1' },
    { id: '2', x: 30, y: 60, label: 'S', aliases: ['W', 'S', 'SCHLEIFER', 'WIPER'] },
    { id: '3', x: 50, y: 60, label: '3' },
  ],
  interaction: { kind: 'drag', area: { x: 6, y: 2, w: 48, h: 48 }, label: 'Drehen' },
  render: ({ props }) => {
    const pos = Number(props.position ?? 0.5);
    const ang = -135 + pos * 270;
    return (
      <g>
        {[10, 30, 50].map((x) => (
          <Lead key={x} x1={x} y1={44} x2={x} y2={60} />
        ))}
        <g filter="url(#f-shadow)">
          <rect x={4} y={18} width={52} height={30} rx={3} fill="#2a64c8" />
          <circle cx={30} cy={26} r={22} fill="url(#g-metal)" />
          <circle cx={30} cy={26} r={15} fill="#2b2d30" />
          <g transform={`rotate(${ang} 30 26)`}>
            {Array.from({ length: 18 }, (_, i) => (
              <line key={i} x1={30} y1={11.5} x2={30} y2={13.5} stroke="#555" strokeWidth={1} transform={`rotate(${i * 20} 30 26)`} />
            ))}
            <rect x={28.6} y={12} width={2.8} height={10} rx={1.4} fill="#f2f2f2" />
          </g>
          <circle cx={30} cy={26} r={15} fill="url(#g-dome)" opacity={0.35} />
        </g>
      </g>
    );
  },
  symbol: 'pot',
  build(ctx) {
    const total = Math.max(parseValue(ctx.props.wert, 10000), 1);
    const r1 = ctx.add(new Resistor(ctx.node('1'), ctx.node('2'), 1));
    const r2 = ctx.add(new Resistor(ctx.node('2'), ctx.node('3'), 1));
    const apply = (c: BuildCtx) => {
      let p = Math.min(1, Math.max(0, Number(c.props.position ?? 0.5)));
      if (c.props.kurve === 'logarithmisch') p = (Math.pow(10, p * 2) - 1) / 99;
      const a = Math.max(total * p, 0.5);
      const b = Math.max(total * (1 - p), 0.5);
      if (a !== r1.r || b !== r2.r) {
        r1.r = a;
        r2.r = b;
        c.engine.markDirty();
      }
    };
    apply(ctx);
    return { pre: apply };
  },
  info: 'Einstellbarer Spannungsteiler: Der Schleifer (Mitte) greift eine Spannung zwischen den Außenanschlüssen ab. Während der Simulation am Knopf ziehen.',
  price: 0.6,
  bom: (p) => `Potentiometer ${formatValue(parseValue(p.wert, 10000), 'Ω')} ${p.kurve ?? 'linear'}`,
  height3d: 12,
};

const trimmer: PartDef = {
  ...potentiometer,
  type: 'trimmer',
  aliases: ['trimpoti', 'trimmpoti'],
  name: 'Trimmer',
  keywords: 'trimmpoti einstellregler',
  size: () => ({ w: 30, h: 30 }),
  pins: () => [
    { id: '1', x: 5, y: 25, label: '1' },
    { id: '2', x: 15, y: 5, label: 'S', aliases: ['W', 'S'] },
    { id: '3', x: 25, y: 25, label: '3' },
  ],
  interaction: { kind: 'drag', area: { x: 3, y: 3, w: 24, h: 24 }, label: 'Drehen' },
  render: ({ props }) => {
    const ang = -135 + Number(props.position ?? 0.5) * 270;
    return (
      <g filter="url(#f-shadow)">
        <rect x={1} y={1} width={28} height={28} rx={2} fill="#2563eb" />
        <circle cx={15} cy={15} r={10} fill="#f5f5f5" />
        <g transform={`rotate(${ang} 15 15)`}>
          <rect x={14} y={6} width={2} height={18} fill="#9aa0a6" />
          <rect x={6} y={14} width={18} height={2} fill="#9aa0a6" />
        </g>
      </g>
    );
  },
  info: 'Kleiner Einstellwiderstand für einmalige Justierung (z. B. LCD-Kontrast).',
  price: 0.3,
  height3d: 5,
};

const ldr: PartDef = {
  type: 'ldr',
  aliases: ['fotowiderstand', 'photoresistor', 'gl5528'],
  name: 'Fotowiderstand (LDR)',
  category: 'Passiv',
  keywords: 'licht helligkeit lichtsensor ldr gl5528',
  prefix: 'R',
  defaults: { lux: 300, r10lux: '10k', gamma: 0.7 },
  props: [
    { key: 'lux', label: 'Helligkeit', type: 'range', min: 0, max: 2000, step: 1, unit: 'lx', live: true },
    { key: 'r10lux', label: 'R bei 10 lx', type: 'value', unit: 'Ω' },
  ],
  size: () => ({ w: 30, h: 20 }),
  pins: two(30, 15),
  render: ({ props }) => (
    <g>
      <Lead x1={0} y1={15} x2={30} y2={15} />
      <g filter="url(#f-shadow)">
        <circle cx={15} cy={8} r={8} fill="#c2410c" />
        <path d="M9 5 h12 M9 8 h12 M9 11 h12" stroke="#f6d27a" strokeWidth={1.1} />
        <path d="M10 5 v6 M20 5 v6" stroke="#e8e0cc" strokeWidth={0.8} opacity={0.5} />
        <circle cx={15} cy={8} r={8} fill="url(#g-dome)" opacity={0.5} />
      </g>
      <Label x={15} y={-4} size={4} color="var(--muted)">
        {Math.round(props.lux)} lx
      </Label>
    </g>
  ),
  symbol: 'resistor',
  build(ctx) {
    const r = ctx.add(new Resistor(ctx.node('1'), ctx.node('2'), 1e4));
    const apply = (c: BuildCtx) => {
      const lux = Math.max(0.01, Number(c.props.lux ?? 300));
      const rv = Math.min(2e6, parseValue(c.props.r10lux, 1e4) * Math.pow(10 / lux, Number(c.props.gamma ?? 0.7)));
      if (Math.abs(rv - r.r) > 1e-6 * rv) {
        r.r = rv;
        c.engine.markDirty();
      }
    };
    apply(ctx);
    return { pre: apply };
  },
  info: 'Widerstand sinkt bei Licht: ~10 kΩ bei 10 lx, ~1 MΩ im Dunkeln. Mit Festwiderstand als Spannungsteiler an einen Analog-Pin.',
  price: 0.15,
  height3d: 4,
};

const ntc: PartDef = {
  type: 'ntc',
  aliases: ['thermistor', 'ntc-10k'],
  name: 'NTC-Thermistor',
  category: 'Passiv',
  keywords: 'temperatur heißleiter thermistor',
  prefix: 'RT',
  defaults: { wert: '10k', beta: 3950, temperatur: 25 },
  props: [
    { key: 'wert', label: 'R25', type: 'value', unit: 'Ω' },
    { key: 'beta', label: 'B-Wert', type: 'number' },
    { key: 'temperatur', label: 'Temperatur', type: 'range', min: -30, max: 120, step: 0.5, unit: '°C', live: true },
  ],
  size: () => ({ w: 30, h: 16 }),
  pins: two(30, 13),
  render: ({ props }) => (
    <g>
      <Lead x1={0} y1={13} x2={30} y2={13} />
      <g filter="url(#f-shadow)">
        <ellipse cx={15} cy={6} rx={6} ry={5.5} fill="#1d1d1f" />
        <ellipse cx={15} cy={6} rx={6} ry={5.5} fill="url(#g-dome)" opacity={0.5} />
      </g>
      <Label x={15} y={-4} size={4} color="var(--muted)">
        {Number(props.temperatur).toFixed(1)} °C
      </Label>
    </g>
  ),
  symbol: 'resistor',
  build(ctx) {
    const r = ctx.add(new Resistor(ctx.node('1'), ctx.node('2'), 1e4));
    const apply = (c: BuildCtx) => {
      const t = Number(c.props.temperatur ?? 25) + 273.15;
      const ptc = c.props.ptc;
      const r25 = parseValue(c.props.wert, 1e4);
      const b = Number(c.props.beta ?? 3950);
      const rv = ptc ? r25 * Math.exp((t - 298.15) * 0.04) : r25 * Math.exp(b * (1 / t - 1 / 298.15));
      if (rv !== r.r) {
        r.r = rv;
        c.engine.markDirty();
      }
    };
    apply(ctx);
    return { pre: apply };
  },
  info: 'Heißleiter: Widerstand sinkt mit steigender Temperatur (R = R25 · e^(B·(1/T − 1/298 K))).',
  price: 0.2,
  height3d: 4,
};

const ptc: PartDef = { ...ntc, type: 'ptc', aliases: ['kaltleiter'], name: 'PTC-Kaltleiter', keywords: 'kaltleiter ptc temperatur', defaults: { wert: '100', temperatur: 25, ptc: true }, info: 'Kaltleiter: Widerstand steigt mit der Temperatur – z. B. als selbstrückstellende Sicherung.' };

function ceramicRender(color: string, label: string) {
  return (
    <g>
      <Lead x1={0} y1={18} x2={6} y2={8} />
      <Lead x1={10} y1={18} x2={4} y2={8} />
      <g filter="url(#f-shadow)">
        <ellipse cx={5} cy={5} rx={6.5} ry={5.5} fill={color} />
        <ellipse cx={5} cy={5} rx={6.5} ry={5.5} fill="url(#g-dome)" opacity={0.5} />
        <Label x={5} y={5} size={3} color="#222" weight={700}>
          {label}
        </Label>
      </g>
    </g>
  );
}

function capCode(f: number): string {
  const pf = f * 1e12;
  if (pf < 100) return String(Math.round(pf));
  const exp = Math.floor(Math.log10(pf)) - 1;
  return `${Math.round(pf / 10 ** exp)}${exp}`;
}

const ceramic: PartDef = {
  type: 'kondensator',
  aliases: ['keramik', 'capacitor', 'c', 'kerko', 'kondensator-keramik'],
  name: 'Keramikkondensator',
  category: 'Passiv',
  keywords: 'kondensator keramik 100n entstörung capacitor',
  prefix: 'C',
  defaults: { wert: '100nF', spannung: '50V', farbe: 'orange' },
  props: [
    { key: 'wert', label: 'Kapazität', type: 'value', unit: 'F' },
    { key: 'farbe', label: 'Farbe', type: 'select', options: ['orange', 'blau'] },
  ],
  size: () => ({ w: 10, h: 18 }),
  pins: two(10, 18),
  render: ({ props }) => ceramicRender(props.farbe === 'blau' ? '#3b82f6' : '#e8892b', capCode(parseValue(props.wert, 1e-7))),
  symbol: 'capacitor',
  build(ctx) {
    ctx.add(new Capacitor(ctx.node('1'), ctx.node('2'), parseValue(ctx.props.wert, 1e-7), 0.02));
    ctx.engine.dynamic = true;
  },
  info: 'Kleine, unpolare Kondensatoren (pF bis µF). 100 nF direkt an jeden IC-Versorgungspin gegen Störungen. Aufdruck „104“ = 10·10⁴ pF = 100 nF.',
  price: 0.05,
  bom: (p) => `Keramikkondensator ${formatValue(parseValue(p.wert, 1e-7), 'F')}`,
  height3d: 5,
};

const film: PartDef = {
  ...ceramic,
  type: 'folienkondensator',
  aliases: ['folie', 'film'],
  name: 'Folienkondensator',
  keywords: 'folie mkt kondensator audio',
  defaults: { wert: '1uF', spannung: '63V' },
  props: [{ key: 'wert', label: 'Kapazität', type: 'value', unit: 'F' }],
  size: () => ({ w: 20, h: 20 }),
  pins: two(20, 20),
  render: ({ props }) => (
    <g>
      <Lead x1={0} y1={20} x2={2} y2={10} />
      <Lead x1={20} y1={20} x2={18} y2={10} />
      <g filter="url(#f-shadow)">
        <rect x={-2} y={0} width={24} height={13} rx={2.5} fill="#d9b23a" />
        <rect x={-2} y={0} width={24} height={13} rx={2.5} fill="url(#g-cyl)" opacity={0.6} />
        <Label x={10} y={6.5} size={3.2} color="#3a2a00" weight={700}>
          {formatValue(parseValue(props.wert, 1e-6), 'F')}
        </Label>
      </g>
    </g>
  ),
  info: 'MKT-Folienkondensator: präzise, verlustarm, unpolar – ideal für Audio und Filter.',
  price: 0.25,
};

const elko: PartDef = {
  type: 'elko',
  aliases: ['elektrolytkondensator', 'electrolytic', 'kondensator-elko'],
  name: 'Elektrolytkondensator',
  category: 'Passiv',
  keywords: 'elko kondensator gepolt puffer 100uf 470uf',
  prefix: 'C',
  defaults: { wert: '100uF', spannung: '16V' },
  props: [
    { key: 'wert', label: 'Kapazität', type: 'value', unit: 'F' },
    { key: 'spannung', label: 'Spannungsfestigkeit', type: 'select', options: ['6.3V', '10V', '16V', '25V', '35V', '50V', '63V'] },
  ],
  size: () => ({ w: 20, h: 40 }),
  pins: () => [
    { id: '+', x: 0, y: 40, label: '+', aliases: ['1', 'PLUS', 'A'] },
    { id: '-', x: 20, y: 40, label: '−', aliases: ['2', 'MINUS', 'K'] },
  ],
  render: ({ props, state }) => {
    if (state.burst)
      return (
        <g>
          <Lead x1={0} y1={40} x2={4} y2={26} />
          <Lead x1={20} y1={40} x2={16} y2={26} />
          <path d="M-1 26 v-20 l4 -4 l3 4 l4 -5 l3 5 l4 -4 l4 4 v20z" fill="#1a3a8a" />
          <rect x={-1} y={20} width={22} height={7} fill="#c9ccd1" />
          {state.smokeUntil > (state.now ?? 0) && <Smoke x={10} y={0} />}
        </g>
      );
    const c = parseValue(props.wert, 1e-4);
    return (
      <g>
        <Lead x1={0} y1={40} x2={4} y2={26} />
        <Lead x1={20} y1={40} x2={16} y2={26} />
        <g filter="url(#f-shadow)">
          <rect x={-1} y={0} width={22} height={27} rx={2.5} fill="#1d3f9e" />
          <rect x={14} y={0} width={7} height={27} fill="#b9c3d6" />
          <text x={17.5} y={14} fontSize={6} fill="#1d3f9e" textAnchor="middle" fontWeight={800} dominantBaseline="middle">
            −
          </text>
          <Label x={7} y={10} size={3.1} color="#e8eefc" weight={700}>
            {formatValue(c, 'F', 3).replace(' ', '')}
          </Label>
          <Label x={7} y={16} size={2.8} color="#c8d4f4">
            {String(props.spannung ?? '16V')}
          </Label>
          <rect x={-1} y={0} width={22} height={27} rx={2.5} fill="url(#g-cyl-v)" />
          <path d="M1 1 h18 M10 1 v2" stroke="#9aa6bf" strokeWidth={0.8} />
        </g>
        {state.reverse && <Label x={10} y={-6} size={5} color="#ff453a">⚠</Label>}
      </g>
    );
  },
  symbol: 'elko',
  build(ctx) {
    if (ctx.state.burst) return;
    const cap = ctx.add(new Capacitor(ctx.node('+'), ctx.node('-'), parseValue(ctx.props.wert, 1e-4), 0.2));
    ctx.engine.dynamic = true;
    const vmax = parseValue(ctx.props.spannung, 16);
    return {
      post(c, dt) {
        const v = cap.v;
        c.state.v = v;
        c.state.reverse = v < -0.8;
        if (v < -0.8 && !c.state.warnedRev) {
          c.state.warnedRev = true;
          c.warn(`${c.id} ist falsch herum eingebaut (Minus-Streifen muss an die niedrigere Spannung). Elkos können dabei platzen!`, 'warn');
        }
        overload(c, v < -2.5 || v > vmax * 1.3, dt, 0.4, `${c.id} ist geplatzt! ${v < 0 ? 'Er war verpolt' : `Spannung ${v.toFixed(1)} V über der Nennspannung ${vmax} V`}.`, 'burst');
        if (c.state.burst) c.state.burnt = true;
      },
    };
  },
  info: 'Große Kapazität auf kleinem Raum, aber gepolt: Der Streifen markiert Minus. Puffert Versorgungsspannungen.',
  price: 0.15,
  bom: (p) => `Elko ${formatValue(parseValue(p.wert, 1e-4), 'F')} ${p.spannung ?? '16V'}`,
  height3d: 11,
};

const inductor: PartDef = {
  type: 'spule',
  aliases: ['inductor', 'drossel', 'l'],
  name: 'Spule / Drossel',
  category: 'Passiv',
  keywords: 'induktivität drossel spule henry',
  prefix: 'L',
  defaults: { wert: '100uH' },
  props: [{ key: 'wert', label: 'Induktivität', type: 'value', unit: 'H' }],
  size: () => ({ w: 30, h: 16 }),
  pins: two(30, 14),
  render: () => (
    <g>
      <Lead x1={0} y1={14} x2={8} y2={8} />
      <Lead x1={30} y1={14} x2={22} y2={8} />
      <g filter="url(#f-shadow)">
        <ellipse cx={15} cy={7} rx={10} ry={7} fill="#2c2c2c" />
        {[8, 11, 14, 17, 20].map((x) => (
          <path key={x} d={`M${x} 1.5 q2 5.5 0 11`} stroke="#c87533" strokeWidth={2} fill="none" />
        ))}
        <ellipse cx={15} cy={7} rx={10} ry={7} fill="url(#g-dome)" opacity={0.35} />
      </g>
    </g>
  ),
  symbol: 'inductor',
  build(ctx) {
    ctx.add(new Inductor(ctx.node('1'), ctx.node('2'), parseValue(ctx.props.wert, 1e-4)));
    ctx.engine.dynamic = true;
  },
  info: 'Speichert Energie im Magnetfeld, glättet Ströme – Kernbauteil in Schaltreglern.',
  price: 0.3,
  bom: (p) => `Spule ${formatValue(parseValue(p.wert, 1e-4), 'H')}`,
  height3d: 8,
};

const crystal: PartDef = {
  type: 'quarz',
  aliases: ['crystal', 'xtal', 'quarz-16mhz'],
  name: 'Quarz',
  category: 'Passiv',
  keywords: 'quarz takt 16mhz 32768 oszillator',
  prefix: 'Y',
  defaults: { frequenz: '16MHz' },
  props: [{ key: 'frequenz', label: 'Frequenz', type: 'string' }],
  size: () => ({ w: 20, h: 22 }),
  pins: two(20, 22),
  render: ({ props }) => (
    <g>
      <Lead x1={0} y1={22} x2={4} y2={12} />
      <Lead x1={20} y1={22} x2={16} y2={12} />
      <g filter="url(#f-shadow)">
        <rect x={-3} y={0} width={26} height={13} rx={6.5} fill="url(#g-metal)" stroke="#8a9096" strokeWidth={0.5} />
        <Label x={10} y={6.5} size={3.4} color="#333">
          {String(props.frequenz)}
        </Label>
      </g>
    </g>
  ),
  symbol: 'box',
  build(ctx) {
    ctx.add(new Capacitor(ctx.node('1'), ctx.node('2'), 18e-12));
  },
  info: 'Schwingquarz für einen präzisen Takt (z. B. 16 MHz am ATmega328P, 32,768 kHz für Uhren).',
  price: 0.2,
  height3d: 4,
};

const fuse: PartDef = {
  type: 'sicherung',
  aliases: ['fuse', 'feinsicherung', 'polyfuse'],
  name: 'Sicherung',
  category: 'Passiv',
  keywords: 'sicherung fuse polyfuse schutz',
  prefix: 'F',
  defaults: { strom: '500mA' },
  props: [{ key: 'strom', label: 'Nennstrom', type: 'value', unit: 'A' }],
  size: () => ({ w: 40, h: 12 }),
  pins: two(40, 6),
  render: ({ props, state }) => (
    <g>
      <Lead x1={0} y1={6} x2={40} y2={6} />
      <g filter="url(#f-shadow)">
        <rect x={6} y={0.5} width={28} height={11} rx={2} fill="#e9f1f7" opacity={0.85} stroke="#9aa6b0" strokeWidth={0.5} />
        <rect x={4} y={0} width={5} height={12} fill="url(#g-metal)" />
        <rect x={31} y={0} width={5} height={12} fill="url(#g-metal)" />
        {state.blown ? <path d="M9 6 h8 l2 -2 M21 8 l2 -2 h8" stroke="#555" strokeWidth={0.8} fill="none" /> : <line x1={9} y1={6} x2={31} y2={6} stroke="#8a8f94" strokeWidth={0.8} />}
        <Label x={20} y={-4} size={3.5} color="var(--muted)">
          {String(props.strom)}
        </Label>
      </g>
    </g>
  ),
  symbol: 'fuse',
  build(ctx) {
    const sw = ctx.add(new Switch(ctx.node('1'), ctx.node('2'), !ctx.state.blown, 0.1));
    const rating = parseValue(ctx.props.strom, 0.5);
    return {
      post(c, dt) {
        const i = Math.abs(sw.current(c.circuit.x));
        c.state.i = i;
        overload(c, i > rating * 2, dt, 0.1, `${c.id} hat ausgelöst: ${formatValue(i, 'A')} bei Nennstrom ${formatValue(rating, 'A')}. Irgendwo gibt es einen Kurzschluss oder zu viel Last.`, 'blown');
      },
    };
  },
  info: 'Schützt vor Kurzschluss: Schmilzt bei dauerhaftem Überstrom und unterbricht den Stromkreis.',
  price: 0.2,
  height3d: 6,
};

/* ------------------------------------------------------------------ */
/* Halbleiter                                                          */
/* ------------------------------------------------------------------ */

function diodePart(type: string, name: string, aliases: string[], params: { vf: number; at: number; n: number; bv?: number }, body: string, ring: string, info: string, price: number, symbol: 'diode' | 'zener' | 'schottky', extraProps?: PartDef['props'], defaults?: Record<string, unknown>): PartDef {
  return {
    type,
    aliases,
    name,
    category: 'Halbleiter',
    keywords: `diode ${aliases.join(' ')} gleichrichter`,
    prefix: 'D',
    defaults: { ...(defaults ?? {}) },
    props: extraProps,
    size: () => ({ w: 40, h: 10 }),
    pins: () => [
      { id: 'A', x: 0, y: 5, label: 'A', aliases: ['1', 'ANODE', '+'] },
      { id: 'K', x: 40, y: 5, label: 'K', aliases: ['2', 'KATHODE', 'C', '-'] },
    ],
    render: ({ props }) => (
      <g>
        <Lead x1={0} y1={5} x2={40} y2={5} w={type === '1n4007' ? 2 : 1.4} />
        <g filter="url(#f-shadow)">
          {type === '1n4148' ? (
            <>
              <rect x={12} y={1.5} width={16} height={7} rx={3.5} fill="#ff8a3d" opacity={0.75} />
              <rect x={23} y={1.5} width={2.5} height={7} fill="#222" />
              <rect x={12} y={1.5} width={16} height={7} rx={3.5} fill="url(#g-cyl)" />
            </>
          ) : (
            <>
              <rect x={11} y={0.5} width={18} height={9} rx={2} fill={body} />
              <rect x={24} y={0.5} width={3} height={9} fill={ring} />
              <rect x={11} y={0.5} width={18} height={9} rx={2} fill="url(#g-cyl)" />
            </>
          )}
        </g>
        {props.wert && <Label x={20} y={-4} size={3.5} color="var(--muted)">{String(props.wert)}</Label>}
      </g>
    ),
    symbol,
    build(ctx) {
      const bv = type === 'zener' ? parseValue(ctx.props.wert, 5.1) : params.bv;
      const d = ctx.add(new Diode(ctx.node('A'), ctx.node('K'), { ...diodeFromVf(params.vf, params.at, params.n, bv) }));
      return {
        post(c) {
          c.state.i = d.i;
        },
      };
    },
    info,
    price,
    bom: (p) => `${name}${p.wert ? ' ' + p.wert : ''}`,
    height3d: 3,
  };
}

const d1n4148 = diodePart('1n4148', 'Diode 1N4148', ['signaldiode', 'diode'], { vf: 0.72, at: 0.01, n: 1.9, bv: 100 }, '#ff8a3d', '#222', 'Schnelle Kleinsignaldiode (100 V, 200 mA) – z. B. als Freilaufdiode für kleine Relais.', 0.03, 'diode');
const d1n4007 = diodePart('1n4007', 'Gleichrichterdiode 1N4007', ['1n4001', 'gleichrichter'], { vf: 0.85, at: 0.5, n: 1.8, bv: 1000 }, '#1d1d1f', '#c9ccd1', 'Robuste Gleichrichterdiode (1000 V, 1 A) – Verpolungsschutz und Netzteile.', 0.05, 'diode');
const schottky = diodePart('schottky', 'Schottky-Diode 1N5819', ['1n5819', 'ss14', 'schottkydiode'], { vf: 0.4, at: 0.5, n: 1.3, bv: 40 }, '#1d1d1f', '#c9ccd1', 'Geringe Flussspannung (~0,3–0,45 V) und schnell – ideal für Verpolungsschutz bei Batterien.', 0.1, 'schottky');
const zener = diodePart('zener', 'Z-Diode', ['zenerdiode', 'bzx55'], { vf: 0.75, at: 0.01, n: 1.8 }, '#ff8a3d', '#222', 'Leitet in Sperrrichtung ab der Z-Spannung – einfache Spannungsbegrenzung oder Referenz (immer mit Vorwiderstand).', 0.05, 'zener', [{ key: 'wert', label: 'Z-Spannung', type: 'select', options: ['2.7V', '3.3V', '3.9V', '4.7V', '5.1V', '5.6V', '6.2V', '9.1V', '12V'] }], { wert: '5.1V' });

const led: PartDef = {
  type: 'led',
  aliases: ['leuchtdiode', 'led-5mm', 'led-3mm'],
  name: 'LED',
  category: 'Halbleiter',
  keywords: 'led leuchtdiode licht rot grün blau gelb weiß lampe',
  prefix: 'D',
  defaults: { farbe: 'rot', groesse: '5mm' },
  props: [
    { key: 'farbe', label: 'Farbe', type: 'select', options: Object.keys(LED_COLORS) },
    { key: 'groesse', label: 'Größe', type: 'select', options: ['3mm', '5mm'] },
  ],
  size: (p) => (p.groesse === '3mm' ? { w: 10, h: 34 } : { w: 10, h: 40 }),
  pins: (p) => {
    const h = p.groesse === '3mm' ? 34 : 40;
    return [
      { id: 'A', x: 0, y: h, label: 'A (+)', aliases: ['+', 'ANODE', '1', 'LANG'] },
      { id: 'K', x: 10, y: h, label: 'K (−)', aliases: ['-', 'KATHODE', 'C', '2', 'KURZ'] },
    ];
  },
  render: ({ props, state }) => {
    const c = ledColor(props.farbe);
    const small = props.groesse === '3mm';
    const r = small ? 6 : 8;
    const top = small ? 4 : 2;
    const h = small ? 34 : 40;
    const b = state.burnt ? 0 : Math.min(1, state.brightness ?? 0);
    const domeH = small ? 15 : 20;
    return (
      <g data-brightness={b.toFixed(2)}>
        <Lead x1={0} y1={h} x2={0} y2={top + domeH} />
        <path d={`M10 ${h} V${top + domeH + 6} l-2 -3 V${top + domeH}`} stroke="#8a9096" strokeWidth={1.6} fill="none" />
        <path d={`M10 ${h} V${top + domeH + 6} l-2 -3 V${top + domeH}`} stroke="#dfe3e6" strokeWidth={0.6} fill="none" />
        <g filter="url(#f-shadow)">
          <path d={`M${5 - r} ${top + domeH} V${top + r} a${r} ${r} 0 0 1 ${2 * r} 0 V${top + domeH} z`} fill={state.burnt ? '#555' : c.body} opacity={0.62} />
          <rect x={5 - r - 1} y={top + domeH - 1.5} width={2 * r + 2} height={3} rx={1} fill={state.burnt ? '#444' : c.body} opacity={0.8} />
          {/* Innenleben: Amboss und Pfosten */}
          <path d={`M2 ${top + domeH} V${top + r + 4} h3 v3`} stroke="#c9cdd1" strokeWidth={0.8} fill="none" opacity={0.8} />
          <path d={`M8 ${top + domeH} V${top + r + 2} h-4 l1 3 h3z`} fill="#b5b9bd" opacity={0.85} />
          <path d={`M${5 - r} ${top + domeH} V${top + r} a${r} ${r} 0 0 1 ${2 * r} 0 V${top + domeH} z`} fill="url(#g-dome)" />
          {b > 0.01 && <path d={`M${5 - r} ${top + domeH} V${top + r} a${r} ${r} 0 0 1 ${2 * r} 0 V${top + domeH} z`} fill={c.hex} opacity={0.35 + 0.65 * b} />}
        </g>
        <Glow cx={5} cy={top + r + 1} r={r} color={c.hex} intensity={b} />
        {state.smokeUntil > (state.now ?? 0) && <Smoke x={5} y={top} />}
      </g>
    );
  },
  symbol: 'led',
  build(ctx) {
    if (ctx.state.burnt) return;
    const color = ledColor(ctx.props.farbe);
    const d = ctx.add(new Diode(ctx.node('A'), ctx.node('K'), { ...ledModel(ctx.props.farbe), rs: 6 }));
    return {
      post(c, dt) {
        const i = d.i;
        c.state.i = i;
        c.state.brightness = i > 1e-5 ? Math.min(1.2, Math.pow(i / 0.02, 0.55)) : 0;
        const vrev = c.v('K') - c.v('A');
        overload(
          c,
          i > 0.06 || vrev > 6,
          dt,
          0.05,
          i > 0.06
            ? `${c.id} ist durchgebrannt – Strom ${formatValue(i, 'A')} (erlaubt ca. 20 mA). Tipp: Vorwiderstand einbauen, bei 5 V etwa ${formatValue(nearestE24((5 - color.vf) / 0.015), 'Ω')}, bei 3,3 V etwa ${formatValue(nearestE24(Math.max(3.3 - color.vf, 0.2) / 0.01), 'Ω')}.`
            : `${c.id} wurde mit ${vrev.toFixed(1)} V in Sperrrichtung zerstört (max. 5 V).`,
        );
      },
    };
  },
  info: 'Leuchtet, wenn Strom von Anode (+, langes Bein) zur Kathode (−, kurzes Bein, abgeflachte Seite) fließt. Immer mit Vorwiderstand betreiben: R = (U − U_F) / I.',
  specs: { 'Flussstrom': '20 mA', 'Max. Sperrspannung': '5 V' },
  price: 0.08,
  bom: (p) => `LED ${p.groesse ?? '5mm'} ${p.farbe ?? 'rot'}`,
  height3d: 8.6,
};

const rgbLed: PartDef = {
  type: 'rgb-led',
  aliases: ['led-rgb', 'rgbled'],
  name: 'RGB-LED',
  category: 'Halbleiter',
  keywords: 'rgb led farbe mischen gemeinsame kathode anode',
  prefix: 'D',
  defaults: { gemeinsam: 'kathode' },
  props: [{ key: 'gemeinsam', label: 'Gemeinsamer Pin', type: 'select', options: ['kathode', 'anode'] }],
  size: () => ({ w: 30, h: 44 }),
  pins: (p) => [
    { id: 'R', x: 0, y: 44, label: 'R' },
    { id: 'COM', x: 10, y: 44, label: p.gemeinsam === 'anode' ? '+' : '−', aliases: ['K', 'A', 'GND', 'VCC', 'C'] },
    { id: 'G', x: 20, y: 44, label: 'G' },
    { id: 'B', x: 30, y: 44, label: 'B' },
  ],
  render: ({ state }) => {
    const r = state.r ?? 0;
    const g = state.g ?? 0;
    const b = state.b ?? 0;
    const m = Math.max(r, g, b);
    const col = `rgb(${Math.round(255 * Math.min(1, r / (m || 1)))},${Math.round(255 * Math.min(1, g / (m || 1)))},${Math.round(255 * Math.min(1, b / (m || 1)))})`;
    return (
      <g>
        {[0, 10, 20, 30].map((x) => (
          <Lead key={x} x1={x} y1={44} x2={x * 0.4 + 9} y2={24} />
        ))}
        <g filter="url(#f-shadow)">
          <path d="M7 24 V10 a8 8 0 0 1 16 0 V24z" fill="#eef1f4" opacity={0.75} />
          {m > 0.01 && <path d="M7 24 V10 a8 8 0 0 1 16 0 V24z" fill={col} opacity={0.3 + 0.6 * Math.min(1, m)} />}
          <path d="M7 24 V10 a8 8 0 0 1 16 0 V24z" fill="url(#g-dome)" />
        </g>
        <Glow cx={15} cy={11} r={8} color={col} intensity={Math.min(1, m)} />
      </g>
    );
  },
  symbol: 'box',
  build(ctx) {
    const ca = ctx.props.gemeinsam === 'anode';
    const mk = (pin: string, vf: number) => ctx.add(ca ? new Diode(ctx.node('COM'), ctx.node(pin), { ...diodeFromVf(vf, 0.02, 2.2, 5), rs: 6 }) : new Diode(ctx.node(pin), ctx.node('COM'), { ...diodeFromVf(vf, 0.02, 2.2, 5), rs: 6 }));
    const dr = mk('R', 1.9);
    const dg = mk('G', 2.9);
    const db = mk('B', 3.0);
    return {
      post(c) {
        const f = (i: number) => (i > 1e-5 ? Math.min(1.2, Math.pow(i / 0.02, 0.55)) : 0);
        c.state.r = f(dr.i);
        c.state.g = f(dg.i);
        c.state.b = f(db.i);
      },
    };
  },
  info: 'Drei LEDs (Rot, Grün, Blau) in einem Gehäuse. Mit PWM lassen sich beliebige Farben mischen. Jede Farbe braucht ihren eigenen Vorwiderstand.',
  price: 0.25,
  height3d: 8.6,
};

function to92Render(label: string, pinLabels: string[]) {
  return (
    <g>
      {[0, 10, 20].map((x) => (
        <Lead key={x} x1={x} y1={30} x2={6 + x * 0.4} y2={14} />
      ))}
      <g filter="url(#f-shadow)">
        <path d="M0 14 V4 a10 6 0 0 1 20 0 V14z" fill="#1d1d1f" />
        <path d="M0 14 V4 a10 6 0 0 1 20 0 V14z" fill="url(#g-cyl-v)" opacity={0.7} />
        <Label x={10} y={7} size={3} color="#cfcfcf" weight={500}>
          {label}
        </Label>
      </g>
      {pinLabels.map((l, i) => (
        <Label key={i} x={i * 10} y={36} size={3.4} color="var(--muted)">
          {l}
        </Label>
      ))}
    </g>
  );
}

function to220Render(label: string, pinLabels: string[]) {
  return (
    <g>
      {[0, 10, 20].map((x) => (
        <Lead key={x} x1={x} y1={50} x2={x} y2={30} w={2} />
      ))}
      <g filter="url(#f-shadow)">
        <rect x={-5} y={0} width={30} height={14} rx={1} fill="url(#g-metal)" />
        <circle cx={10} cy={7} r={3.4} fill="var(--canvas)" stroke="#8a9096" />
        <rect x={-5} y={13} width={30} height={18} rx={1} fill="#1d1d1f" />
        <rect x={-5} y={13} width={30} height={9} fill="url(#g-gloss)" />
        <Label x={10} y={22} size={3.6} color="#d4d4d4" weight={500}>
          {label}
        </Label>
      </g>
      {pinLabels.map((l, i) => (
        <Label key={i} x={i * 10} y={55} size={3.4} color="var(--muted)">
          {l}
        </Label>
      ))}
    </g>
  );
}

function transistor(type: string, name: string, aliases: string[], order: ('C' | 'B' | 'E')[], kind: { pnp: boolean; bf: number; darlington?: boolean; is?: number }, info: string, price: number, pkg: 'to92' | 'to220' = 'to92'): PartDef {
  return {
    type,
    aliases,
    name,
    category: 'Halbleiter',
    keywords: `transistor ${kind.pnp ? 'pnp' : 'npn'} schalten verstärker ${aliases.join(' ')}`,
    prefix: 'Q',
    defaults: {},
    size: () => (pkg === 'to92' ? { w: 20, h: 30 } : { w: 20, h: 50 }),
    pins: () => order.map((id, i) => ({ id, x: i * 10, y: pkg === 'to92' ? 30 : 50, label: id, aliases: id === 'C' ? ['COLLECTOR', 'KOLLEKTOR'] : id === 'B' ? ['BASE', 'BASIS'] : ['EMITTER'] })),
    render: () => (pkg === 'to92' ? to92Render(type.toUpperCase(), order) : to220Render(type.toUpperCase(), order)),
    symbol: kind.pnp ? 'pnp' : 'npn',
    build(ctx) {
      const q = ctx.add(new Bjt(ctx.node('C'), ctx.node('B'), ctx.node('E'), { pnp: kind.pnp, is: kind.is ?? 1e-14, bf: kind.bf, br: 4, darlington: kind.darlington }));
      return {
        post(c, dt) {
          c.state.ic = q.ic;
          c.state.ib = q.ib;
          const vce = Math.abs(c.v('C') - c.v('E'));
          const p = Math.abs(q.ic) * vce;
          c.state.p = p;
          overload(c, p > (pkg === 'to92' ? 1.2 : 8), dt, 0.5, `${c.id} ist überhitzt (${formatValue(p, 'W')} Verlustleistung). Basisstrom erhöhen, damit der Transistor ganz durchschaltet, oder einen Kühlkörper/MOSFET verwenden.`);
        },
      };
    },
    info,
    specs: { Typ: kind.pnp ? 'PNP' : 'NPN', Verstärkung: `hFE ≈ ${kind.bf}`, Anschlüsse: order.join('-') },
    price,
    height3d: pkg === 'to92' ? 5 : 15,
  };
}

const s8050 = transistor('S8050', 'NPN-Transistor S8050', ['s8050', 'ss8050'], ['E', 'B', 'C'], { pnp: false, bf: 200 }, 'NPN bis 500 mA (Spitze 1,5 A) – perfekt, um Summer, Relais oder LED-Streifen mit einem Mikrocontroller zu schalten.', 0.05);
const bc547 = transistor('BC547', 'NPN-Transistor BC547', ['bc547', 'bc547b', 'bc548', 'bc337'], ['C', 'B', 'E'], { pnp: false, bf: 290 }, 'Universeller NPN-Kleinsignaltransistor (45 V, 100 mA).', 0.04);
const n2222 = transistor('2N2222', 'NPN-Transistor 2N2222', ['2n2222', 'pn2222', '2n2222a'], ['E', 'B', 'C'], { pnp: false, bf: 150 }, 'Robuster NPN (40 V, 600 mA) – Klassiker zum Schalten.', 0.05);
const n3904 = transistor('2N3904', 'NPN-Transistor 2N3904', ['2n3904'], ['E', 'B', 'C'], { pnp: false, bf: 180 }, 'NPN-Kleinsignaltransistor (40 V, 200 mA).', 0.04);
const bc557 = transistor('BC557', 'PNP-Transistor BC557', ['bc557', 'bc327'], ['C', 'B', 'E'], { pnp: true, bf: 250 }, 'PNP-Gegenstück zum BC547 – schaltet die Plus-Seite.', 0.04);
const s8550 = transistor('S8550', 'PNP-Transistor S8550', ['s8550', 'ss8550'], ['E', 'B', 'C'], { pnp: true, bf: 200 }, 'PNP bis 500 mA – Gegenstück zum S8050.', 0.05);
const n3906 = transistor('2N3906', 'PNP-Transistor 2N3906', ['2n3906'], ['E', 'B', 'C'], { pnp: true, bf: 180 }, 'PNP-Kleinsignaltransistor (40 V, 200 mA).', 0.04);
const tip120 = transistor('TIP120', 'Darlington TIP120', ['tip120', 'tip122'], ['B', 'C', 'E'], { pnp: false, bf: 1000, darlington: true, is: 1e-13 }, 'Darlington-Leistungstransistor (60 V, 5 A, hFE ≥ 1000) für Motoren und Lampen. Achtung: ~1–2 V Sättigungsspannung.', 0.5, 'to220');

function mosfet(type: string, name: string, aliases: string[], order: ('G' | 'D' | 'S')[], p: { pch: boolean; vth: number; k: number; rdsOn: number }, info: string, price: number, pkg: 'to92' | 'to220' | 'sot23'): PartDef {
  return {
    type,
    aliases,
    name,
    category: 'Halbleiter',
    keywords: `mosfet ${p.pch ? 'p-kanal' : 'n-kanal logic level'} schalten ${aliases.join(' ')}`,
    prefix: 'Q',
    defaults: {},
    size: () => (pkg === 'to220' ? { w: 20, h: 50 } : pkg === 'sot23' ? { w: 20, h: 20 } : { w: 20, h: 30 }),
    pins: () =>
      pkg === 'sot23'
        ? [
            { id: 'G', x: 0, y: 20, label: 'G', aliases: ['GATE'] },
            { id: 'S', x: 20, y: 20, label: 'S', aliases: ['SOURCE'] },
            { id: 'D', x: 10, y: 0, label: 'D', aliases: ['DRAIN'] },
          ]
        : order.map((id, i) => ({ id, x: i * 10, y: pkg === 'to220' ? 50 : 30, label: id, aliases: [{ G: 'GATE', D: 'DRAIN', S: 'SOURCE' }[id]] })),
    render: () =>
      pkg === 'to220' ? (
        to220Render(type.toUpperCase(), order)
      ) : pkg === 'sot23' ? (
        <g>
          <Lead x1={0} y1={20} x2={4} y2={13} />
          <Lead x1={20} y1={20} x2={16} y2={13} />
          <Lead x1={10} y1={0} x2={10} y2={7} />
          <g filter="url(#f-shadow)">
            <rect x={2} y={6} width={16} height={8} rx={1} fill="#1d1d1f" />
            <Label x={10} y={10} size={3} color="#ccc">
              {type.slice(0, 6)}
            </Label>
          </g>
        </g>
      ) : (
        to92Render(type.toUpperCase(), order)
      ),
    symbol: p.pch ? 'pmos' : 'nmos',
    build(ctx) {
      const m = ctx.add(new Mosfet(ctx.node('D'), ctx.node('G'), ctx.node('S'), { pch: p.pch, vth: p.vth, k: p.k, rdsOn: p.rdsOn }));
      ctx.add(new Diode(ctx.node(p.pch ? 'D' : 'S'), ctx.node(p.pch ? 'S' : 'D'), diodeFromVf(0.8, 1, 1.5)));
      return {
        post(c, dt) {
          c.state.id = m.id;
          const vgs = Math.abs(c.v('G') - c.v('S'));
          if (vgs > 20) overload(c, true, dt, 0, `${c.id}: Gate-Spannung ${vgs.toFixed(1)} V überschreitet ±20 V – das Gate ist durchgeschlagen.`);
          const vds = Math.abs(c.v('D') - c.v('S'));
          const pw = Math.abs(m.id) * vds;
          c.state.p = pw;
          overload(c, pw > (pkg === 'to220' ? 10 : 0.8), dt, 0.6, `${c.id} überhitzt (${formatValue(pw, 'W')}). Liegt die Gate-Spannung hoch genug (${p.pch ? 'negativ' : 'positiv'} ≥ ${(p.vth + 2).toFixed(1)} V)?`);
        },
      };
    },
    info,
    specs: { Typ: p.pch ? 'P-Kanal' : 'N-Kanal', 'U_GS(th)': `${p.vth} V`, 'R_DS(on)': formatValue(p.rdsOn, 'Ω') },
    price,
    height3d: pkg === 'to220' ? 15 : 3,
  };
}

const irlz44n = mosfet('IRLZ44N', 'MOSFET IRLZ44N', ['irlz44n', 'irlz44'], ['G', 'D', 'S'], { pch: false, vth: 1.6, k: 30, rdsOn: 0.022 }, 'Logic-Level N-Kanal (55 V, 47 A): schaltet schon mit 3,3–5 V am Gate voll durch. Ideal für LED-Streifen und Motoren.', 1.2, 'to220');
const irf520 = mosfet('IRF520', 'MOSFET IRF520', ['irf520', 'irfz44n'], ['G', 'D', 'S'], { pch: false, vth: 3.8, k: 4, rdsOn: 0.27 }, 'Standard-N-Kanal (kein Logic-Level!): braucht ~10 V am Gate. Mit 3,3 V vom ESP32 schaltet er kaum durch – häufiger Anfängerfehler.', 0.8, 'to220');
const ao3400 = mosfet('AO3400', 'MOSFET AO3400 (SOT-23)', ['ao3400', 'si2302'], ['G', 'S', 'D'], { pch: false, vth: 1.05, k: 25, rdsOn: 0.03 }, 'Winziger Logic-Level N-Kanal (30 V, 5,7 A) im SOT-23-Gehäuse.', 0.05, 'sot23');
const n2n7000 = mosfet('2N7000', 'MOSFET 2N7000', ['2n7000', 'bs170'], ['S', 'G', 'D'], { pch: false, vth: 2.1, k: 0.3, rdsOn: 1.8 }, 'Kleiner N-Kanal-MOSFET (60 V, 200 mA) – Pegelwandler und kleine Lasten.', 0.1, 'to92');
const irf9540 = mosfet('IRF9540', 'P-MOSFET IRF9540', ['irf9540', 'ao3401'], ['G', 'D', 'S'], { pch: true, vth: 3, k: 6, rdsOn: 0.2 }, 'P-Kanal-MOSFET zum Schalten der Plus-Seite (High-Side). Gate auf Masse = an.', 1.0, 'to220');

function regulatorPart(type: string, name: string, aliases: string[], vout: number, dropout: number, order: string[], info: string, price: number, pkg: 'to220' | 'sot223'): PartDef {
  return {
    type,
    aliases,
    name,
    category: 'Halbleiter',
    keywords: `spannungsregler ldo ${vout} volt ${aliases.join(' ')}`,
    prefix: 'U',
    defaults: {},
    size: () => (pkg === 'to220' ? { w: 20, h: 50 } : { w: 20, h: 40 }),
    pins: () => order.map((id, i) => ({ id, x: i * 10, y: pkg === 'to220' ? 50 : 40, label: id, aliases: id === 'IN' ? ['VIN', 'EIN', 'I'] : id === 'OUT' ? ['VOUT', 'AUS', 'O'] : ['GND', 'ADJ', 'MASSE'] })),
    render: () =>
      pkg === 'to220' ? (
        to220Render(type.toUpperCase(), order)
      ) : (
        <g>
          {[0, 10, 20].map((x) => (
            <Lead key={x} x1={x} y1={40} x2={x} y2={26} />
          ))}
          <g filter="url(#f-shadow)">
            <rect x={-4} y={2} width={28} height={8} fill="url(#g-metal)" />
            <rect x={-4} y={8} width={28} height={18} rx={1} fill="#1d1d1f" />
            <Label x={10} y={17} size={3.2} color="#ccc">
              {type.toUpperCase()}
            </Label>
          </g>
        </g>
      ),
    symbol: 'box',
    build(ctx) {
      const r = ctx.add(new Regulator(ctx.node('IN'), ctx.node('GND'), ctx.node('OUT'), vout, dropout, 0.005));
      return {
        post(c, dt) {
          const vin = c.v('IN') - c.v('GND');
          const p = Math.max(0, vin - vout) * Math.max(0, r.iout);
          c.state.p = p;
          c.state.iout = r.iout;
          if (vin > 0.5 && vin < vout + dropout - 0.05 && !c.state.warnDrop) {
            c.state.warnDrop = true;
            c.warn(`${c.id}: Eingangsspannung ${vin.toFixed(2)} V ist zu niedrig – der Regler braucht mindestens ${(vout + dropout).toFixed(1)} V für stabile ${vout} V.`, 'info');
          }
          overload(c, p > (pkg === 'to220' ? 2 : 1.2), dt, 1.5, `${c.id} wird zu heiß (${formatValue(p, 'W')}). Linearregler verheizen (U_ein − U_aus) · I. Kühlkörper oder Schaltregler verwenden.`);
        },
      };
    },
    info,
    price,
    height3d: pkg === 'to220' ? 15 : 2,
  };
}

const lm7805 = regulatorPart('LM7805', 'Spannungsregler 7805 (5 V)', ['7805', 'l7805', 'lm7805'], 5, 2, ['IN', 'GND', 'OUT'], 'Klassischer 5-V-Festspannungsregler (bis 1,5 A). Braucht mind. ~7 V Eingang, verheizt den Rest als Wärme.', 0.4, 'to220');
const ams1117 = regulatorPart('AMS1117-3.3', 'LDO AMS1117-3.3', ['ams1117', 'ams1117-3v3', 'ams1117-3.3'], 3.3, 1.1, ['GND', 'OUT', 'IN'], 'Low-Drop-Regler 3,3 V (1 A) – sitzt auf vielen ESP32-Boards. Dropout ca. 1,1 V.', 0.15, 'sot223');
const lm1117_5 = regulatorPart('AMS1117-5.0', 'LDO AMS1117-5.0', ['ams1117-5', 'ams1117-5v'], 5, 1.1, ['GND', 'OUT', 'IN'], 'Low-Drop-Regler 5 V (1 A).', 0.15, 'sot223');
const ht7333 = regulatorPart('HT7333', 'LDO HT7333 (3,3 V, 4 µA)', ['ht7333', 'mcp1700'], 3.3, 0.09, ['GND', 'IN', 'OUT'], 'Extrem sparsamer LDO (nur 4 µA Eigenverbrauch, 250 mA) – ideal für Batterieprojekte.', 0.2, 'to220');

/** Schaltregler (Buck/Boost) als Modul mit Wirkungsgrad */
class SwitchingRegulator implements Device {
  nodes: number[];
  iout = 0;
  constructor(inp: number, gin: number, out: number, gout: number, public vset: number, public boost: boolean, public eta = 0.88, public vmin = 3) {
    this.nodes = [inp, gin, out, gout];
  }
  stampLinear(m: import('../../sim/mna').Matrix) {
    m.G(this.nodes[0], this.nodes[1], 1e-6);
  }
  currents(v: number[]) {
    const vin = v[0] - v[1];
    const on = vin > this.vmin ? Math.min(1, (vin - this.vmin) / 0.3) : 0;
    let tgt = this.vset * on;
    if (!this.boost) tgt = Math.min(tgt, Math.max(0, vin - 0.8));
    else if (on) tgt = Math.max(tgt, vin - 0.4);
    let iout = (tgt - (v[2] - v[3])) / 0.05;
    if (iout < 0) iout *= 1e-5;
    const io = Math.max(iout, 0);
    const pout = io * Math.max(v[2] - v[3], 0);
    const iin = vin > 0.2 ? pout / (this.eta * vin) + (on ? 0.002 : 0) : 0;
    return [iin, -iin, -iout, iout];
  }
  accept(x: Float64Array) {
    const v = this.nodes.map((n) => (n < 0 ? 0 : x[n]));
    this.iout = -this.currents(v)[2];
  }
}

function dcdc(type: string, name: string, boost: boolean, aliases: string[], info: string): PartDef {
  return {
    type,
    aliases,
    name,
    category: 'Stromversorgung',
    keywords: `${boost ? 'boost aufwärtswandler step-up' : 'buck abwärtswandler step-down'} schaltregler dcdc ${aliases.join(' ')}`,
    prefix: 'U',
    defaults: { ausgang: boost ? '5V' : '5V' },
    props: [{ key: 'ausgang', label: 'Ausgangsspannung', type: 'value', unit: 'V' }],
    size: () => ({ w: 90, h: 50 }),
    pins: () => [
      { id: 'IN+', x: 5, y: 10, label: 'IN+', aliases: ['VIN', 'IN'] },
      { id: 'IN-', x: 5, y: 40, label: 'IN−', aliases: ['GND', 'GNDIN'] },
      { id: 'OUT+', x: 85, y: 10, label: 'OUT+', aliases: ['VOUT', 'OUT'] },
      { id: 'OUT-', x: 85, y: 40, label: 'OUT−', aliases: ['GNDOUT'] },
    ],
    render: ({ props }) => (
      <Pcb w={90} h={50} color={boost ? '#1f5fbf' : '#1f5fbf'}>
        {[
          [5, 10],
          [5, 40],
          [85, 10],
          [85, 40],
        ].map(([x, y], i) => (
          <Pad key={i} x={x} y={y} r={4} />
        ))}
        <Chip x={30} y={8} w={16} h={10} label={boost ? 'MT3608' : 'LM2596'} legs={3} />
        <rect x={52} y={22} width={18} height={18} rx={2} fill="#3a3a3a" />
        <circle cx={61} cy={31} r={7} fill="#c87533" opacity={0.7} />
        <rect x={20} y={26} width={10} height={14} rx={1.5} fill="#2563eb" />
        <circle cx={25} cy={30} r={2.5} fill="#e7d9a5" />
        <Label x={45} y={45} size={4} color="#fff">
          {boost ? 'STEP-UP' : 'STEP-DOWN'} {String(props.ausgang)}
        </Label>
      </Pcb>
    ),
    symbol: 'box',
    build(ctx) {
      const r = ctx.add(new SwitchingRegulator(ctx.node('IN+'), ctx.node('IN-'), ctx.node('OUT+'), ctx.node('OUT-'), parseValue(ctx.props.ausgang, 5), boost, 0.88, boost ? 2 : 4));
      return { post: (c) => void (c.state.iout = r.iout) };
    },
    info,
    price: 1.2,
    height3d: 8,
  };
}

const buck = dcdc('buck', 'Abwärtswandler LM2596', false, ['lm2596', 'step-down', 'buck-converter'], 'Schaltregler: wandelt z. B. 12 V effizient (~88 %) auf 5 V. Viel weniger Wärme als ein Linearregler.');
const boost = dcdc('boost', 'Aufwärtswandler MT3608', true, ['mt3608', 'step-up', 'boost-converter'], 'Schaltregler: macht aus einer Li-Ion-Zelle (3,7 V) stabile 5 V oder mehr.');

const optocoupler: PartDef = {
  type: 'pc817',
  aliases: ['optokoppler', 'optocoupler', '4n35'],
  name: 'Optokoppler PC817',
  category: 'Halbleiter',
  keywords: 'optokoppler galvanische trennung pc817',
  prefix: 'U',
  defaults: { ctr: 1.0 },
  size: () => ({ w: 30, h: 40 }),
  pins: () => [
    { id: 'A', x: 0, y: 40, label: 'A' },
    { id: 'K', x: 10, y: 40, label: 'K' },
    { id: 'E', x: 20, y: 40, label: 'E', aliases: ['EMITTER'] },
    { id: 'C', x: 30, y: 40, label: 'C', aliases: ['COLLECTOR'] },
  ],
  render: () => (
    <g>
      {[0, 10, 20, 30].map((x) => (
        <Lead key={x} x1={x} y1={40} x2={x} y2={28} />
      ))}
      <Chip x={-3} y={6} w={36} h={22} label="PC817" legs={0} />
    </g>
  ),
  symbol: 'box',
  build(ctx) {
    const d = ctx.add(new Diode(ctx.node('A'), ctx.node('K'), diodeFromVf(1.2, 0.02, 2)));
    const base = ctx.internal('b');
    const q = ctx.add(new Bjt(ctx.node('C'), base, ctx.node('E'), { pnp: false, is: 1e-14, bf: 200, br: 4 }));
    const ib = ctx.add(new CurrentSource(ctx.node('E'), base, 0));
    ctx.add(new Resistor(base, ctx.node('E'), 1e6));
    void q;
    return {
      pre(c) {
        const want = (Math.max(0, d.i) * Number(c.props.ctr ?? 1)) / 200;
        if (Math.abs(want - ib.i) > 1e-9) {
          ib.i = want;
          c.engine.markDirty();
        }
      },
    };
  },
  info: 'LED und Fototransistor in einem Gehäuse: überträgt Signale ohne elektrische Verbindung (z. B. 230-V-Seite ↔ Mikrocontroller).',
  price: 0.1,
  height3d: 4,
};

/* ------------------------------------------------------------------ */
/* Stromversorgung                                                     */
/* ------------------------------------------------------------------ */

interface Chem {
  name: string;
  /** Leerlaufspannung über Ladezustand (1 → 0) */
  curve: [number, number][];
  cap: number; // Ah
  rint: number;
  color: string;
  w: number;
  h: number;
}

export const CELLS: Record<string, Chem> = {
  AA: { name: 'AA Alkaline', curve: [[1, 1.6], [0.9, 1.5], [0.6, 1.35], [0.3, 1.22], [0.1, 1.1], [0.02, 0.95], [0, 0.8]], cap: 2.5, rint: 0.15, color: '#d9a400', w: 50, h: 14 },
  AAA: { name: 'AAA Alkaline', curve: [[1, 1.6], [0.9, 1.5], [0.6, 1.35], [0.3, 1.22], [0.1, 1.1], [0.02, 0.95], [0, 0.8]], cap: 1.1, rint: 0.25, color: '#2b2b2b', w: 44, h: 10 },
  'AA-NiMH': { name: 'AA NiMH-Akku', curve: [[1, 1.42], [0.9, 1.3], [0.5, 1.25], [0.2, 1.2], [0.05, 1.1], [0, 0.95]], cap: 2.0, rint: 0.03, color: '#1f6fdc', w: 50, h: 14 },
  '18650': { name: '18650 Li-Ion', curve: [[1, 4.2], [0.9, 4.05], [0.7, 3.85], [0.5, 3.7], [0.3, 3.6], [0.1, 3.4], [0.03, 3.1], [0, 2.8]], cap: 3.0, rint: 0.05, color: '#2f9e44', w: 65, h: 18 },
  LiPo: { name: 'LiPo-Akku', curve: [[1, 4.2], [0.9, 4.05], [0.7, 3.85], [0.5, 3.75], [0.3, 3.65], [0.1, 3.5], [0.03, 3.2], [0, 3.0]], cap: 1.0, rint: 0.1, color: '#9aa0a6', w: 50, h: 30 },
  CR2032: { name: 'Knopfzelle CR2032', curve: [[1, 3.2], [0.9, 3.0], [0.5, 2.9], [0.2, 2.8], [0.1, 2.6], [0.03, 2.3], [0, 2.0]], cap: 0.22, rint: 15, color: '#c0c4c8', w: 20, h: 20 },
  '9V': { name: '9-V-Block', curve: [[1, 9.6], [0.9, 9.0], [0.6, 8.2], [0.3, 7.6], [0.1, 7.0], [0, 6.0]], cap: 0.55, rint: 1.5, color: '#2b2b2b', w: 26, h: 48 },
};

export function ocv(chem: Chem, soc: number): number {
  const c = chem.curve;
  for (let i = 0; i < c.length - 1; i++) {
    const [s0, v0] = c[i];
    const [s1, v1] = c[i + 1];
    if (soc <= s0 && soc >= s1) return v1 + ((v0 - v1) * (soc - s1)) / (s0 - s1);
  }
  return soc > c[0][0] ? c[0][1] : c[c.length - 1][1];
}

function parseCells(z: unknown): { n: number; chem: string } {
  const m = /^(\d+)\s*[x×]\s*(.+)$/i.exec(String(z ?? '2xAA'));
  if (!m) return { n: 1, chem: String(z ?? 'AA') };
  let chem = m[2].trim();
  if (/18650/.test(chem)) chem = '18650';
  else if (/aaa/i.test(chem)) chem = 'AAA';
  else if (/nimh/i.test(chem)) chem = 'AA-NiMH';
  else if (/aa/i.test(chem)) chem = 'AA';
  else if (/lipo/i.test(chem)) chem = 'LiPo';
  else if (/2032/.test(chem)) chem = 'CR2032';
  return { n: parseInt(m[1], 10), chem };
}

function batteryBehaviour(ctx: BuildCtx, chemKey: string, n: number, capOverride?: number) {
  const chem = CELLS[chemKey] ?? CELLS.AA;
  if (ctx.state.soc === undefined) ctx.state.soc = Math.min(1, Math.max(0, Number(ctx.props.ladung ?? 100) / 100));
  const cap = (capOverride ?? chem.cap) * 3600;
  const src = ctx.add(new Source(ctx.node('+'), ctx.node('-'), ocv(chem, ctx.state.soc) * n, chem.rint * n));
  ctx.state.capacityAh = cap / 3600;
  return {
    pre(c: BuildCtx) {
      const v = ocv(chem, c.state.soc) * n;
      if (Math.abs(v - src.v) > 1e-4) {
        src.v = v;
        c.engine.markDirty();
      }
    },
    post(c: BuildCtx, dt: number) {
      const i = src.current(c.circuit.x);
      c.state.i = i;
      c.state.v = c.v('+') - c.v('-');
      if (i > 0) c.state.soc = Math.max(0, c.state.soc - (i * dt) / cap);
      if (c.state.soc <= 0.02 && !c.state.warnedEmpty) {
        c.state.warnedEmpty = true;
        c.warn(`${c.id}: Die Batterie ist leer (${c.state.v.toFixed(2)} V).`, 'info');
      }
      if (i > (chemKey === 'CR2032' ? 0.03 : 3) && !c.state.warnedHigh) {
        c.state.warnedHigh = true;
        c.warn(`${c.id}: Sehr hoher Entladestrom (${formatValue(i, 'A')}). ${chemKey === 'CR2032' ? 'Knopfzellen liefern nur wenige mA dauerhaft – die Spannung bricht ein.' : 'Kurzschluss?'}`, 'warn');
      }
    },
  };
}

function cellRender(chemKey: string, soc: number, n = 1) {
  const chem = CELLS[chemKey] ?? CELLS.AA;
  if (chemKey === 'CR2032') {
    return (
      <g filter="url(#f-shadow)">
        <circle cx={10} cy={10} r={10} fill="url(#g-metal)" stroke="#8a9096" />
        <circle cx={10} cy={10} r={8} fill="none" stroke="#fff" strokeOpacity={0.4} />
        <Label x={10} y={8} size={3.2} color="#444">
          CR2032
        </Label>
        <Label x={10} y={13} size={3} color="#444">
          3V +
        </Label>
      </g>
    );
  }
  void n;
  const w = chem.w;
  const h = chem.h;
  return (
    <g filter="url(#f-shadow)">
      <rect x={0} y={0} width={w} height={h} rx={h / 2.6} fill={chem.color} />
      <rect x={w * 0.62} y={0} width={w * 0.38} height={h} rx={h / 2.6} fill={chemKey === 'AA' ? '#2b2b2b' : chem.color} />
      <rect x={w} y={h * 0.3} width={2.5} height={h * 0.4} rx={0.8} fill="url(#g-metal)" />
      <rect x={0} y={0} width={w} height={h} rx={h / 2.6} fill="url(#g-cyl)" />
      <Label x={w * 0.35} y={h / 2} size={Math.min(4, h * 0.36)} color="#fff" weight={700}>
        {chemKey === '18650' ? '18650' : chemKey === 'LiPo' ? 'LiPo' : chemKey.replace('-NiMH', '')}
      </Label>
      <rect x={w * 0.66} y={h * 0.32} width={w * 0.28} height={h * 0.36} rx={1} fill="#000" opacity={0.35} />
      <rect x={w * 0.66} y={h * 0.32} width={w * 0.28 * soc} height={h * 0.36} rx={1} fill={soc > 0.3 ? '#34c759' : soc > 0.1 ? '#ffcc00' : '#ff3b30'} />
    </g>
  );
}

const batteryHolder: PartDef = {
  type: 'batteriehalter',
  aliases: ['battery-holder', 'batteriefach', 'batterien'],
  name: 'Batteriehalter',
  category: 'Stromversorgung',
  keywords: 'batterie halter fach aa aaa 3xaaa 2xaa 4xaa akku',
  prefix: 'BAT',
  defaults: { zellen: '2xAA', ladung: 100 },
  props: [
    { key: 'zellen', label: 'Zellen', type: 'select', options: ['1xAA', '2xAA', '3xAA', '4xAA', '1xAAA', '2xAAA', '3xAAA', '4xAAA', '4xAA-NiMH', '1x18650', '2x18650'] },
    { key: 'ladung', label: 'Ladezustand (Start)', type: 'range', min: 0, max: 100, step: 1, unit: '%' },
  ],
  size: (p) => {
    const { n, chem } = parseCells(p.zellen);
    const c = CELLS[chem] ?? CELLS.AA;
    return { w: c.w + 24, h: n * (c.h + 4) + 16 };
  },
  pins: (p) => {
    const { n, chem } = parseCells(p.zellen);
    const c = CELLS[chem] ?? CELLS.AA;
    const h = n * (c.h + 4) + 16;
    return [
      { id: '+', x: c.w + 24, y: h - 20, label: '+', aliases: ['PLUS', 'VCC', 'V+', 'ROT'] },
      { id: '-', x: c.w + 24, y: h - 10, label: '−', aliases: ['MINUS', 'GND', 'V-', 'SCHWARZ'] },
    ];
  },
  render: ({ props, state }) => {
    const { n, chem } = parseCells(props.zellen);
    const c = CELLS[chem] ?? CELLS.AA;
    const w = c.w + 24;
    const h = n * (c.h + 4) + 16;
    const soc = state.soc ?? Number(props.ladung ?? 100) / 100;
    return (
      <g>
        <g filter="url(#f-shadow)">
          <rect x={0} y={0} width={w - 6} height={h} rx={3} fill="#232325" />
          <rect x={3} y={3} width={w - 12} height={h - 6} rx={2} fill="#141416" />
        </g>
        {Array.from({ length: n }, (_, i) => (
          <g key={i} transform={`translate(${9 + (i % 2 ? 2.5 : 0)} ${8 + i * (c.h + 4)}) ${i % 2 ? `rotate(180 ${c.w / 2} ${c.h / 2})` : ''}`}>
            {cellRender(chem, soc)}
          </g>
        ))}
        <path d={`M${w - 6} ${h - 20} h6`} stroke="#d32f2f" strokeWidth={2.2} />
        <path d={`M${w - 6} ${h - 10} h6`} stroke="#1d1d1f" strokeWidth={2.2} />
        <Label x={(w - 6) / 2} y={h + 6} size={4} color="var(--muted)">
          {(state.v ?? ocv(c, soc) * n).toFixed(2)} V · {Math.round(soc * 100)} %
        </Label>
      </g>
    );
  },
  symbol: 'battery',
  build(ctx) {
    const { n, chem } = parseCells(ctx.props.zellen);
    return batteryBehaviour(ctx, chem, n);
  },
  info: 'Mehrere Zellen in Reihe. Die Spannung sinkt realistisch mit der Entladung (Entladekurve), der Innenwiderstand lässt sie unter Last einbrechen.',
  price: 1.0,
  bom: (p) => `Batteriehalter ${p.zellen}`,
  height3d: 15,
};

function cellPart(key: string, type: string, aliases: string[], extra?: Partial<PartDef>): PartDef {
  const c = CELLS[key];
  const isCoin = key === 'CR2032';
  const w = isCoin ? 20 : key === '9V' ? 26 : c.w + 3;
  const h = isCoin ? 20 : c.h;
  return {
    type,
    aliases,
    name: c.name,
    category: 'Stromversorgung',
    keywords: `batterie akku zelle ${aliases.join(' ')} ${key}`,
    prefix: 'BAT',
    defaults: { ladung: 100, ...(key === 'LiPo' ? { kapazitaet: '1000mAh' } : {}) },
    props: [
      { key: 'ladung', label: 'Ladezustand (Start)', type: 'range', min: 0, max: 100, step: 1, unit: '%' },
      ...(key === 'LiPo' ? [{ key: 'kapazitaet', label: 'Kapazität', type: 'value' as const, unit: 'mAh' }] : []),
    ],
    size: () => ({ w: w + 12, h: h + 16 }),
    pins: () => [
      { id: '+', x: w + 12, y: h + 6, label: '+', aliases: ['PLUS', 'VCC', 'BAT+'] },
      { id: '-', x: w + 12, y: h + 16, label: '−', aliases: ['MINUS', 'GND', 'BAT-'] },
    ],
    render: ({ props, state }) => {
      const soc = state.soc ?? Number(props.ladung ?? 100) / 100;
      return (
        <g>
          <path d={`M${w} ${h * 0.5} C ${w + 8} ${h * 0.5}, ${w + 4} ${h + 6}, ${w + 12} ${h + 6}`} stroke="#d32f2f" strokeWidth={2} fill="none" />
          <path d={`M${2} ${h} C ${2} ${h + 16}, ${w} ${h + 16}, ${w + 12} ${h + 16}`} stroke="#1d1d1f" strokeWidth={2} fill="none" />
          {key === '9V' ? (
            <g filter="url(#f-shadow)">
              <rect x={0} y={4} width={26} height={h - 4} rx={2} fill="#2b2b2b" />
              <rect x={0} y={4} width={26} height={(h - 4) * 0.45} rx={2} fill="#d9a400" />
              <rect x={4} y={0} width={7} height={5} rx={1} fill="url(#g-metal)" />
              <rect x={15} y={0} width={7} height={5} rx={3} fill="url(#g-metal)" />
              <Label x={13} y={24} size={6} color="#fff" weight={800}>
                9V
              </Label>
            </g>
          ) : key === 'LiPo' ? (
            <g filter="url(#f-shadow)">
              <rect x={0} y={0} width={c.w} height={c.h} rx={3} fill="#b7bcc2" />
              <rect x={0} y={0} width={c.w} height={c.h} rx={3} fill="url(#g-gloss)" />
              <Label x={c.w / 2} y={c.h / 2 - 3} size={4.5} color="#333" weight={700}>
                3.7V LiPo
              </Label>
              <Label x={c.w / 2} y={c.h / 2 + 4} size={3.8} color="#333">
                {String(props.kapazitaet ?? '1000mAh')}
              </Label>
            </g>
          ) : (
            cellRender(key, soc)
          )}
          <Label x={w / 2} y={h + 22} size={3.8} color="var(--muted)">
            {(state.v ?? ocv(c, soc)).toFixed(2)} V · {Math.round(soc * 100)} %
          </Label>
        </g>
      );
    },
    symbol: 'battery',
    build(ctx) {
      const capAh = key === 'LiPo' ? parseValue(String(ctx.props.kapazitaet ?? '1000mAh').replace(/mAh/i, 'm'), 1) : undefined;
      return batteryBehaviour(ctx, key, 1, capAh);
    },
    info: `${c.name}: Nennkapazität ${formatValue(c.cap, 'Ah')}, Innenwiderstand ${formatValue(c.rint, 'Ω')}. Spannung voll ${c.curve[0][1]} V, leer ${c.curve[c.curve.length - 1][1]} V.`,
    price: key === '18650' ? 5 : key === 'LiPo' ? 6 : key === '9V' ? 2 : 0.6,
    height3d: isCoin ? 3.2 : h * 0.254,
    ...extra,
  };
}

const usbPower: PartDef = {
  type: 'usb-netzteil',
  aliases: ['usb-power', 'netzteil-5v', 'usb'],
  name: 'USB-Netzteil 5 V',
  category: 'Stromversorgung',
  keywords: 'netzteil usb 5v ladegerät stromversorgung',
  prefix: 'PS',
  defaults: { strom: '2A' },
  props: [{ key: 'strom', label: 'Max. Strom', type: 'select', options: ['0.5A', '1A', '2A', '3A'] }],
  size: () => ({ w: 60, h: 46 }),
  pins: () => [
    { id: '+', x: 60, y: 16, label: '5V', aliases: ['5V', 'VCC', 'VBUS', 'PLUS'] },
    { id: '-', x: 60, y: 30, label: 'GND', aliases: ['GND', 'MINUS'] },
  ],
  render: () => (
    <g>
      <g filter="url(#f-shadow)">
        <rect x={0} y={0} width={44} height={46} rx={7} fill="#f5f5f7" stroke="#d1d1d6" />
        <rect x={0} y={0} width={44} height={20} rx={7} fill="url(#g-gloss)" />
        <rect x={12} y={34} width={20} height={6} rx={1.5} fill="#1d1d1f" />
        <Label x={22} y={18} size={5} color="#8e8e93" weight={600}>
          5V ⎓ 2A
        </Label>
      </g>
      <path d="M44 16 h16" stroke="#d32f2f" strokeWidth={2} />
      <path d="M44 30 h16" stroke="#1d1d1f" strokeWidth={2} />
    </g>
  ),
  symbol: 'battery',
  build(ctx) {
    const s = ctx.add(new Source(ctx.node('+'), ctx.node('-'), 5.1, 0.08));
    const imax = parseValue(ctx.props.strom, 2);
    return {
      post(c) {
        const i = s.current(c.circuit.x);
        c.state.i = i;
        if (i > imax * 1.1 && !c.state.warned) {
          c.state.warned = true;
          c.warn(`${c.id}: Es wird ${formatValue(i, 'A')} gezogen – das Netzteil schafft nur ${formatValue(imax, 'A')}. Die Spannung bricht ein oder das Netzteil schaltet ab.`, 'warn');
        }
      },
    };
  },
  info: 'Stabile 5 V aus der Steckdose über USB. Typisch bis 2 A.',
  price: 6,
  height3d: 20,
};

class LabSupply implements Device {
  nodes: number[];
  i = 0;
  cc = false;
  constructor(a: number, b: number, public v: number, public ilim: number) {
    this.nodes = [a, b];
  }
  stampLinear(m: import('../../sim/mna').Matrix) {
    m.G(this.nodes[0], this.nodes[1], 1e-6);
  }
  currents(v: number[]) {
    const vab = v[0] - v[1];
    const icv = (this.v - vab) / 0.01; // aus + heraus
    // weiches Minimum mit Strombegrenzung
    const k = this.ilim * 0.02 + 1e-4;
    const i = -k * Math.log(Math.exp(-icv / k) + Math.exp(-this.ilim / k));
    const ii = Number.isFinite(i) ? i : Math.min(icv, this.ilim);
    return [-ii, ii];
  }
  accept(x: Float64Array) {
    const v = this.nodes.map((n) => (n < 0 ? 0 : x[n]));
    this.i = -this.currents(v)[0];
    this.cc = this.i > this.ilim * 0.97;
  }
}

const labSupply: PartDef = {
  type: 'labornetzteil',
  aliases: ['lab-power-supply', 'netzteil', 'bench-supply'],
  name: 'Labornetzteil',
  category: 'Stromversorgung',
  keywords: 'labornetzteil einstellbar strombegrenzung cv cc',
  prefix: 'PS',
  defaults: { spannung: 5, strom: 1 },
  props: [
    { key: 'spannung', label: 'Spannung', type: 'range', min: 0, max: 30, step: 0.1, unit: 'V', live: true },
    { key: 'strom', label: 'Strombegrenzung', type: 'range', min: 0.01, max: 5, step: 0.01, unit: 'A', live: true },
  ],
  size: () => ({ w: 130, h: 80 }),
  pins: () => [
    { id: '+', x: 100, y: 80, label: '+', aliases: ['PLUS', 'VCC', 'V+'] },
    { id: '-', x: 120, y: 80, label: '−', aliases: ['MINUS', 'GND', 'V-'] },
  ],
  render: ({ props, state }) => (
    <g>
      <g filter="url(#f-shadow)">
        <rect x={0} y={0} width={130} height={72} rx={6} fill="#2c2c2e" />
        <rect x={0} y={0} width={130} height={18} rx={6} fill="url(#g-gloss)" />
        <rect x={8} y={10} width={74} height={34} rx={3} fill="#0b1a0f" />
        <text x={78} y={25} fontFamily="JetBrains Mono, monospace" fontSize={13} fill="#4cff7a" textAnchor="end">
          {(state.v ?? Number(props.spannung)).toFixed(2)}V
        </text>
        <text x={78} y={40} fontFamily="JetBrains Mono, monospace" fontSize={10} fill={state.cc ? '#ff6b5e' : '#ffd25e'} textAnchor="end">
          {(state.i ?? 0).toFixed(3)}A
        </text>
        <circle cx={98} cy={24} r={9} fill="url(#g-metal)" />
        <circle cx={120} cy={24} r={6} fill="url(#g-metal)" />
        <Label x={98} y={40} size={4} color="#aaa">
          V
        </Label>
        <Label x={120} y={40} size={4} color="#aaa">
          A
        </Label>
        <Label x={45} y={58} size={4.5} color={state.cc ? '#ff6b5e' : '#8e8e93'} weight={700}>
          {state.cc ? 'CC' : 'CV'}
        </Label>
        <circle cx={100} cy={60} r={6} fill="#d32f2f" />
        <circle cx={120} cy={60} r={6} fill="#1d1d1f" stroke="#555" />
      </g>
      <Lead x1={100} y1={64} x2={100} y2={80} w={2} />
      <Lead x1={120} y1={64} x2={120} y2={80} w={2} />
    </g>
  ),
  symbol: 'battery',
  build(ctx) {
    const s = ctx.add(new LabSupply(ctx.node('+'), ctx.node('-'), Number(ctx.props.spannung ?? 5), Number(ctx.props.strom ?? 1)));
    return {
      pre(c) {
        const v = Number(c.props.spannung ?? 5);
        const i = Number(c.props.strom ?? 1);
        if (v !== s.v || i !== s.ilim) {
          s.v = v;
          s.ilim = i;
          c.engine.markDirty();
        }
      },
      post(c) {
        c.state.i = s.i;
        c.state.cc = s.cc;
        c.state.v = c.v('+') - c.v('-');
      },
    };
  },
  info: 'Einstellbare Spannung mit Strombegrenzung (CV/CC). Sicher zum Testen: Bei Kurzschluss fließt höchstens der eingestellte Strom.',
  price: 45,
  noBom: true,
  height3d: 60,
};

const solar: PartDef = {
  type: 'solarzelle',
  aliases: ['solar', 'solarpanel', 'solar-cell'],
  name: 'Solarzelle 6 V',
  category: 'Stromversorgung',
  keywords: 'solar sonne photovoltaik panel',
  prefix: 'PV',
  defaults: { licht: 80, zellen: 12, isc: '0.2A' },
  props: [
    { key: 'licht', label: 'Sonnenlicht', type: 'range', min: 0, max: 100, step: 1, unit: '%', live: true },
    { key: 'isc', label: 'Kurzschlussstrom', type: 'value', unit: 'A' },
  ],
  size: () => ({ w: 110, h: 70 }),
  pins: () => [
    { id: '+', x: 110, y: 20, label: '+' },
    { id: '-', x: 110, y: 50, label: '−' },
  ],
  render: ({ props }) => (
    <g filter="url(#f-shadow)">
      <rect x={0} y={0} width={100} height={70} rx={3} fill="#c0c4c8" />
      <rect x={3} y={3} width={94} height={64} fill="#18233f" />
      {Array.from({ length: 4 }, (_, i) => Array.from({ length: 3 }, (_, j) => <rect key={`${i}${j}`} x={5 + i * 23} y={5 + j * 20.5} width={21.5} height={19} fill="#22335c" stroke="#93a3c8" strokeWidth={0.3} />))}
      <rect x={3} y={3} width={94} height={64} fill="url(#g-gloss)" opacity={0.3 + Number(props.licht) / 200} />
      <path d="M100 20 h10 M100 50 h10" stroke="#555" strokeWidth={2} />
    </g>
  ),
  symbol: 'battery',
  build(ctx) {
    const n = Number(ctx.props.zellen ?? 12);
    const iph = ctx.add(new CurrentSource(ctx.node('-'), ctx.node('+'), 0));
    ctx.add(new Diode(ctx.node('+'), ctx.node('-'), { is: 1e-10, n: 1.5 * n }));
    ctx.add(new Resistor(ctx.node('+'), ctx.node('-'), 2000));
    const apply = (c: BuildCtx) => {
      const i = (parseValue(c.props.isc, 0.2) * Number(c.props.licht ?? 80)) / 100;
      if (i !== iph.i) {
        iph.i = i;
        c.engine.markDirty();
      }
    };
    apply(ctx);
    return { pre: apply, post: (c) => void (c.state.v = c.v('+') - c.v('-')) };
  },
  info: 'Liefert Strom proportional zur Helligkeit; Leerlaufspannung ~6 V. Mit Laderegler (z. B. TP4056) lädt sie Akkus.',
  price: 4,
  height3d: 3,
};

/* ------------------------------------------------------------------ */
/* Ein-/Ausgabe                                                        */
/* ------------------------------------------------------------------ */

const button: PartDef = {
  type: 'taster',
  aliases: ['button', 'pushbutton', 'drucktaster', 'tactile', 'knopf'],
  name: 'Taster 6×6 mm',
  category: 'Ein-/Ausgabe',
  keywords: 'taster knopf button drücken schalter tact',
  prefix: 'SW',
  defaults: { farbe: 'schwarz', groesse: '6x6x6', label: '' },
  props: [
    { key: 'farbe', label: 'Kappe', type: 'select', options: ['schwarz', 'rot', 'blau', 'gelb', 'weiss', 'gruen'] },
    { key: 'label', label: 'Beschriftung', type: 'string' },
  ],
  size: () => ({ w: 20, h: 20 }),
  pins: () => [
    { id: '1', x: 0, y: 20, label: '1', aliases: ['A'] },
    { id: '2', x: 20, y: 20, label: '2', aliases: ['B'] },
  ],
  interaction: { kind: 'press', area: { x: -2, y: -2, w: 24, h: 22 }, label: 'Drücken' },
  render: ({ props, state }) => {
    const caps: Record<string, string> = { schwarz: '#1d1d1f', rot: '#e53935', blau: '#1e63d6', gelb: '#fdd835', weiss: '#f5f5f5', gruen: '#43a047' };
    return (
      <g>
        <Lead x1={0} y1={20} x2={2} y2={14} />
        <Lead x1={20} y1={20} x2={18} y2={14} />
        <g filter="url(#f-shadow)" transform={state.pressed ? 'translate(0 0.6)' : undefined}>
          <TactButton x={-2} y={-4} size={24} capColor={caps[props.farbe] ?? caps.schwarz} pressed={state.pressed} />
        </g>
        {props.label && (
          <Label x={10} y={-9} size={4} color="var(--muted)">
            {String(props.label)}
          </Label>
        )}
      </g>
    );
  },
  symbol: 'button',
  build(ctx) {
    const s = ctx.add(new Switch(ctx.node('1'), ctx.node('2'), !!ctx.state.pressed, 0.08));
    return {
      pre(c) {
        const closed = !!c.state.pressed !== !!c.props.oeffner;
        if (closed !== s.closed) {
          s.closed = closed;
          c.engine.markDirty();
          // Realismus: Prellen
          if (c.realism && closed) c.state.bounce = 3;
        }
        if (c.state.bounce > 0) {
          c.state.bounce--;
          s.closed = !s.closed;
          c.engine.markDirty();
        }
      },
    };
  },
  info: 'Schließt den Kontakt, solange er gedrückt wird. Typisch mit INPUT_PULLUP: Pin gegen GND schalten, gedrückt = LOW.',
  price: 0.05,
  bom: (p) => `Taster 6×6 mm ${p.farbe ?? ''}`,
  height3d: 5,
};

const slideSwitch: PartDef = {
  type: 'schalter',
  aliases: ['switch', 'schiebeschalter', 'slide-switch', 'kippschalter', 'toggle'],
  name: 'Schiebeschalter (Um)',
  category: 'Ein-/Ausgabe',
  keywords: 'schalter schiebeschalter um ein aus kippschalter',
  prefix: 'SW',
  defaults: { an: false },
  props: [{ key: 'an', label: 'Stellung rechts (an)', type: 'bool', live: true }],
  size: () => ({ w: 30, h: 26 }),
  pins: () => [
    { id: '1', x: 0, y: 26, label: '1' },
    { id: 'COM', x: 15, y: 26, label: 'C', aliases: ['2', 'C', 'MITTE'] },
    { id: '3', x: 30, y: 26, label: '3' },
  ],
  interaction: { kind: 'toggle', area: { x: -4, y: 0, w: 38, h: 16 }, label: 'Umschalten' },
  render: ({ props }) => (
    <g>
      {[0, 15, 30].map((x) => (
        <Lead key={x} x1={x} y1={26} x2={x} y2={14} />
      ))}
      <g filter="url(#f-shadow)">
        <rect x={-5} y={2} width={40} height={14} rx={1} fill="url(#g-metal)" stroke="#7d8389" strokeWidth={0.5} />
        <rect x={3} y={5} width={24} height={8} rx={1} fill="#222" />
        <rect x={props.an ? 15 : 3} y={0} width={12} height={12} rx={1.5} fill="#2b2d30" />
        <rect x={props.an ? 15 : 3} y={0} width={12} height={5} rx={1.5} fill="url(#g-gloss)" />
      </g>
    </g>
  ),
  symbol: 'switch',
  build(ctx) {
    const a = ctx.add(new Switch(ctx.node('COM'), ctx.node('1'), !ctx.props.an));
    const b = ctx.add(new Switch(ctx.node('COM'), ctx.node('3'), !!ctx.props.an));
    return {
      pre(c) {
        const on = !!c.props.an;
        if (b.closed !== on) {
          a.closed = !on;
          b.closed = on;
          c.engine.markDirty();
        }
      },
    };
  },
  info: 'Umschalter: Der mittlere Anschluss (C) ist entweder mit 1 oder mit 3 verbunden. Als Ein/Aus-Schalter nur 2 Pins nutzen.',
  price: 0.15,
  height3d: 6,
};

const reed: PartDef = {
  type: 'reedkontakt',
  aliases: ['reed', 'reed-switch', 'reedschalter', 'magnetschalter', 'tuerkontakt'],
  name: 'Reedkontakt',
  category: 'Ein-/Ausgabe',
  keywords: 'reed magnet tür fenster kontakt schalter alarm',
  prefix: 'SW',
  defaults: { normal: 'offen', reichweite: 15 },
  props: [
    { key: 'normal', label: 'Ohne Magnet', type: 'select', options: ['offen', 'geschlossen'] },
    { key: 'reichweite', label: 'Schaltabstand', type: 'number', unit: 'mm' },
  ],
  size: () => ({ w: 50, h: 12 }),
  pins: () => [
    { id: '1', x: 0, y: 6, label: '1' },
    { id: '2', x: 50, y: 6, label: '2' },
  ],
  render: ({ state }) => (
    <g>
      <Lead x1={0} y1={6} x2={50} y2={6} w={1.2} />
      <g filter="url(#f-shadow)">
        <rect x={9} y={1} width={32} height={10} rx={5} fill="#d8eef7" opacity={0.55} stroke="#9fc3d4" strokeWidth={0.4} />
        <path d={state.closed ? 'M10 6 h15 M25 6 h15' : 'M10 6 h14 l2 -1.5 M26 7.5 l2 -1.5 h12'} stroke="#7a6a4a" strokeWidth={1.2} fill="none" />
        <rect x={9} y={1} width={32} height={10} rx={5} fill="url(#g-gloss)" />
      </g>
    </g>
  ),
  symbol: 'switch',
  build(ctx) {
    const s = ctx.add(new Switch(ctx.node('1'), ctx.node('2'), false));
    const apply = (c: BuildCtx) => {
      const d = c.engine.distanceTo(c.id, ['magnet']);
      const range = Number(c.props.reichweite ?? 15) / 0.254;
      const near = d !== null && d < range;
      c.state.magnetNear = near;
      const closed = near !== (c.props.normal === 'geschlossen');
      c.state.closed = closed;
      if (closed !== s.closed) {
        s.closed = closed;
        c.engine.markDirty();
      }
    };
    apply(ctx);
    return { pre: apply };
  },
  info: 'Glasröhrchen mit zwei Metallzungen, die sich bei einem Magneten in der Nähe berühren. Klassischer Tür-/Fensterkontakt. Ziehe den Magneten in der Simulation weg!',
  price: 0.3,
  height3d: 3,
};

const magnet: PartDef = {
  type: 'magnet',
  aliases: ['dauermagnet', 'neodym'],
  name: 'Magnet',
  category: 'Ein-/Ausgabe',
  keywords: 'magnet neodym reed hall',
  prefix: 'MAG',
  defaults: {},
  size: () => ({ w: 30, h: 14 }),
  pins: () => [],
  interaction: { kind: 'drag', label: 'Verschieben' },
  render: () => (
    <g filter="url(#f-shadow)">
      <rect x={0} y={0} width={15} height={14} rx={2} fill="#d93a3a" />
      <rect x={15} y={0} width={15} height={14} rx={2} fill="#3a6fd9" />
      <rect x={0} y={0} width={30} height={14} rx={2} fill="url(#g-gloss)" />
      <Label x={7.5} y={7} size={6} color="#fff" weight={800}>
        N
      </Label>
      <Label x={22.5} y={7} size={6} color="#fff" weight={800}>
        S
      </Label>
    </g>
  ),
  symbol: 'box',
  info: 'Dauermagnet – schaltet Reedkontakte und Hall-Sensoren. In der Simulation einfach mit der Maus verschieben.',
  price: 0.3,
  height3d: 5,
  noBom: false,
};

const buzzer: PartDef = {
  type: 'summer',
  aliases: ['buzzer', 'piezo', 'beeper', 'summer-aktiv', 'summer-passiv'],
  name: 'Summer',
  category: 'Ein-/Ausgabe',
  keywords: 'summer buzzer piezo piepser ton alarm aktiv passiv',
  prefix: 'BZ',
  defaults: { art: 'aktiv', spannung: '5V' },
  props: [
    { key: 'art', label: 'Art', type: 'select', options: ['aktiv', 'passiv'] },
    { key: 'spannung', label: 'Nennspannung', type: 'select', options: ['3V', '5V', '12V'] },
  ],
  size: () => ({ w: 40, h: 46 }),
  pins: () => [
    { id: '+', x: 15, y: 46, label: '+', aliases: ['PLUS', '1', 'VCC'] },
    { id: '-', x: 25, y: 46, label: '−', aliases: ['MINUS', '2', 'GND'] },
  ],
  render: ({ props, state }) => {
    const on = state.sound > 0;
    return (
      <g>
        <Lead x1={15} y1={46} x2={15} y2={36} />
        <Lead x1={25} y1={46} x2={25} y2={36} />
        <g filter="url(#f-shadow)">
          <circle cx={20} cy={18} r={19} fill="#1d1d1f" />
          <circle cx={20} cy={18} r={19} fill="url(#g-dome)" opacity={0.25} />
          <circle cx={20} cy={18} r={4} fill="#000" />
          {props.art === 'aktiv' && <circle cx={20} cy={18} r={13} fill="none" stroke="#333" strokeWidth={0.6} />}
          <Label x={8} y={9} size={5} color="#888">
            +
          </Label>
        </g>
        {on && (
          <g className="sound-waves" stroke="var(--accent)" fill="none" strokeWidth={1.4} strokeLinecap="round" opacity={0.85}>
            <path d="M42 8 q6 10 0 20" />
            <path d="M47 3 q10 15 0 30" />
            <path d="M-2 8 q-6 10 0 20" />
          </g>
        )}
      </g>
    );
  },
  symbol: 'buzzer',
  build(ctx) {
    const active = ctx.props.art !== 'passiv';
    const vnom = parseValue(ctx.props.spannung, 5);
    const r = ctx.add(new Resistor(ctx.node('+'), ctx.node('-'), active ? vnom / 0.025 : 16));
    return {
      post(c) {
        const v = c.v('+') - c.v('-');
        const i = r.current(c.circuit.x);
        c.state.i = i;
        if (active) {
          const loud = v > vnom * 0.45 ? Math.min(1, v / vnom) : 0;
          c.state.sound = loud;
          c.engine.sound(c.id, loud > 0 ? 2700 : 0, loud * 0.5, 'square');
        } else {
          const f = c.engine.toneOnNet(c.id, ['+', '-']);
          c.state.sound = f > 0 ? 1 : 0;
          c.engine.sound(c.id, f, f > 0 ? 0.35 : 0, 'square');
        }
      },
    };
  },
  info: 'Aktiver Summer: piept selbst mit fester Tonhöhe, sobald Spannung anliegt (+ beachten). Passiver Summer: braucht ein Rechtecksignal (tone()) – dafür beliebige Töne. Du hörst ihn wirklich!',
  price: 0.4,
  bom: (p) => `Summer ${p.art ?? 'aktiv'} ${p.spannung ?? '5V'}`,
  height3d: 9,
};

const speaker: PartDef = {
  type: 'lautsprecher',
  aliases: ['speaker', 'lautsprecher-8ohm'],
  name: 'Lautsprecher 8 Ω',
  category: 'Ein-/Ausgabe',
  keywords: 'lautsprecher speaker audio ton musik',
  prefix: 'LS',
  defaults: {},
  size: () => ({ w: 60, h: 66 }),
  pins: () => [
    { id: '+', x: 20, y: 66, label: '+' },
    { id: '-', x: 40, y: 66, label: '−' },
  ],
  render: ({ state }) => (
    <g>
      <Lead x1={20} y1={66} x2={20} y2={54} />
      <Lead x1={40} y1={66} x2={40} y2={54} />
      <g filter="url(#f-shadow)">
        <circle cx={30} cy={28} r={28} fill="url(#g-metal)" />
        <circle cx={30} cy={28} r={23} fill="#1d1d1f" />
        <circle cx={30} cy={28} r={state.sound ? 9.5 : 9} fill="#2b2b2b" stroke="#444" />
      </g>
    </g>
  ),
  symbol: 'buzzer',
  build(ctx) {
    ctx.add(new Resistor(ctx.node('+'), ctx.node('-'), 8));
    return {
      post(c) {
        const f = c.engine.toneOnNet(c.id, ['+', '-']);
        c.state.sound = f > 0 ? 1 : 0;
        c.engine.sound(c.id, f, f > 0 ? 0.4 : 0, 'square');
      },
    };
  },
  info: 'Kleiner 8-Ω-Lautsprecher (0,5 W). Am Mikrocontroller nur über Transistor oder Verstärker betreiben – direkt würde der Pin überlastet.',
  price: 1,
  height3d: 15,
};

const relay: PartDef = {
  type: 'relais',
  aliases: ['relay', 'relaismodul', 'relay-module'],
  name: 'Relaismodul 5 V',
  category: 'Ein-/Ausgabe',
  keywords: 'relais relay schalten 230v lampe modul',
  prefix: 'K',
  defaults: { ausloesen: 'low' },
  props: [{ key: 'ausloesen', label: 'Aktiv bei', type: 'select', options: ['low', 'high'] }],
  size: () => ({ w: 100, h: 54 }),
  pins: () => [
    { id: 'VCC', x: 5, y: 12, label: 'VCC', aliases: ['+', 'DC+'] },
    { id: 'GND', x: 5, y: 22, label: 'GND', aliases: ['-', 'DC-'] },
    { id: 'IN', x: 5, y: 32, label: 'IN', aliases: ['SIG', 'S'] },
    { id: 'NO', x: 95, y: 12, label: 'NO', aliases: ['SCHLIESSER'] },
    { id: 'COM', x: 95, y: 27, label: 'COM' },
    { id: 'NC', x: 95, y: 42, label: 'NC', aliases: ['OEFFNER'] },
  ],
  render: ({ state }) => (
    <Pcb w={100} h={54} color="#1f5fbf">
      <HeaderPins pins={[{ x: 5, y: 12 }, { x: 5, y: 22 }, { x: 5, y: 32 }]} />
      <Label x={15} y={12} size={3.6} anchor="start">VCC</Label>
      <Label x={15} y={22} size={3.6} anchor="start">GND</Label>
      <Label x={15} y={32} size={3.6} anchor="start">IN</Label>
      <rect x={34} y={6} width={40} height={42} rx={2} fill="#1d58c9" stroke="#0e3c96" />
      <rect x={34} y={6} width={40} height={14} fill="url(#g-gloss)" />
      <Label x={54} y={20} size={4} color="#e7eefc">SRD-05VDC</Label>
      <Label x={54} y={28} size={3} color="#c9d6f5">10A 250VAC</Label>
      <rect x={80} y={4} width={18} height={46} rx={1.5} fill="#2f80ed" />
      {[12, 27, 42].map((y) => (
        <g key={y}>
          <circle cx={95} cy={y} r={4} fill="url(#g-metal)" />
          <path d={`M93 ${y - 2} l4 4`} stroke="#555" />
        </g>
      ))}
      <circle cx={24} cy={46} r={2.2} fill={state.on ? '#ff3b30' : '#5a1010'} />
      {state.on && <Glow cx={24} cy={46} r={2.5} color="#ff3b30" intensity={0.8} />}
    </Pcb>
  ),
  symbol: 'box',
  build(ctx) {
    // Ansteuerung: Optokoppler/Transistor auf dem Modul; Last ~70 mA an VCC
    const coil = ctx.add(new Resistor(ctx.node('VCC'), ctx.node('GND'), 1e6));
    const inLoad = ctx.add(new Resistor(ctx.node('IN'), ctx.props.ausloesen === 'high' ? ctx.node('GND') : ctx.node('VCC'), 4700));
    void inLoad;
    const no = ctx.add(new Switch(ctx.node('COM'), ctx.node('NO'), !!ctx.state.on, 0.03));
    const nc = ctx.add(new Switch(ctx.node('COM'), ctx.node('NC'), !ctx.state.on, 0.03));
    return {
      pre(c) {
        const vcc = c.v('VCC') - c.v('GND');
        const vin = c.v('IN') - c.v('GND');
        const powered = vcc > 3.5;
        const act = c.props.ausloesen === 'high' ? vin > 2.0 : vcc - vin > 2.0 && vin < vcc * 0.5;
        const on = powered && act;
        const coilR = on ? 70 : 1e5;
        if (on !== !!c.state.on || coil.r !== coilR) {
          if (on !== !!c.state.on) c.engine.sound(c.id + ':click', 0, 0, 'click');
          c.state.on = on;
          no.closed = on;
          nc.closed = !on;
          coil.r = coilR;
          c.engine.markDirty();
        }
      },
    };
  },
  info: 'Schaltet mit kleinem Steuerstrom große Lasten (bis 10 A / 250 V) über einen echten Kontakt. Viele Module sind LOW-aktiv. Klickt hörbar.',
  price: 1.5,
  height3d: 16,
};

const dcMotor: PartDef = {
  type: 'motor',
  aliases: ['dc-motor', 'gleichstrommotor', 'motor-dc'],
  name: 'DC-Motor',
  category: 'Ein-/Ausgabe',
  keywords: 'motor gleichstrom dc antrieb lüfter',
  prefix: 'M',
  defaults: { nennspannung: '6V' },
  props: [{ key: 'nennspannung', label: 'Nennspannung', type: 'select', options: ['3V', '6V', '12V'] }],
  size: () => ({ w: 60, h: 40 }),
  pins: () => [
    { id: '+', x: 0, y: 30, label: '+', aliases: ['1', 'A'] },
    { id: '-', x: 0, y: 40, label: '−', aliases: ['2', 'B'] },
  ],
  render: ({ state }) => (
    <g>
      <path d="M0 30 h8 M0 40 h6 q4 0 4 -6" stroke="#d32f2f" strokeWidth={1.5} fill="none" />
      <g filter="url(#f-shadow)">
        <rect x={8} y={4} width={40} height={30} rx={8} fill="url(#g-metal)" />
        <rect x={8} y={4} width={10} height={30} rx={4} fill="#e9e9e9" />
        <rect x={48} y={17} width={10} height={4} fill="#9aa0a6" />
        <g transform={`rotate(${state.angle ?? 0} 60 19)`}>
          <rect x={58} y={9} width={3} height={20} rx={1.5} fill="#f2c94c" />
        </g>
      </g>
    </g>
  ),
  symbol: 'motor',
  build(ctx) {
    const vnom = parseValue(ctx.props.nennspannung, 6);
    const r = ctx.add(new Resistor(ctx.node('+'), ctx.node('-'), vnom / 0.25));
    ctx.add(new Inductor(ctx.node('+'), ctx.internal('l'), 1e-3, 1e6));
    return {
      post(c, dt) {
        const i = r.current(c.circuit.x);
        c.state.i = i;
        const rpm = (Math.max(-1.5, Math.min(1.5, (c.v('+') - c.v('-')) / vnom)) * 9000);
        c.state.rpm = rpm;
        c.state.angle = ((c.state.angle ?? 0) + rpm * 6 * dt * 0.05) % 360;
        c.engine.sound(c.id, Math.abs(rpm) > 300 ? 80 + Math.abs(rpm) / 60 : 0, Math.min(0.12, Math.abs(rpm) / 50000), 'sawtooth');
      },
    };
  },
  info: 'Dreht sich proportional zur Spannung; Umpolen ändert die Richtung. Zieht viel Strom – nie direkt an einen GPIO, sondern über Transistor/MOSFET oder Motortreiber (mit Freilaufdiode!).',
  price: 1.5,
  height3d: 20,
};

const vibration: PartDef = {
  ...dcMotor,
  type: 'vibrationsmotor',
  aliases: ['vibration-motor', 'vibrationmotor'],
  name: 'Vibrationsmotor',
  keywords: 'vibration motor handy rütteln',
  defaults: { nennspannung: '3V' },
  size: () => ({ w: 24, h: 30 }),
  pins: () => [
    { id: '+', x: 0, y: 30, label: '+' },
    { id: '-', x: 24, y: 30, label: '−' },
  ],
  render: ({ state }) => (
    <g transform={Math.abs(state.rpm ?? 0) > 500 ? `translate(${Math.sin((state.angle ?? 0) / 3) * 1.2} 0)` : undefined}>
      <path d="M12 20 q-12 0 -12 10 M12 20 q12 0 12 10" stroke="#d32f2f" strokeWidth={1.2} fill="none" />
      <g filter="url(#f-shadow)">
        <circle cx={12} cy={10} r={10} fill="url(#g-metal)" />
        <circle cx={12} cy={10} r={7} fill="#c9cdd1" stroke="#999" strokeWidth={0.4} />
      </g>
    </g>
  ),
  info: 'Münzförmiger Vibrationsmotor (3 V, ~80 mA) für haptisches Feedback.',
  price: 0.6,
  height3d: 3,
};

/* ------------------------------------------------------------------ */
/* Steckbrett                                                          */
/* ------------------------------------------------------------------ */

export function breadboardHoles(half: boolean) {
  const cols = half ? 30 : 63;
  const holes: { id: string; x: number; y: number; strip: string }[] = [];
  const x0 = 20;
  const rows = 'abcdefghij';
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < 10; r++) {
      const y = 50 + r * PITCH + (r >= 5 ? PITCH * 2 : 0);
      holes.push({ id: `${rows[r]}${c + 1}`, x: x0 + c * PITCH, y, strip: `${r < 5 ? 'L' : 'R'}${c + 1}` });
    }
  }
  // Stromschienen: 2 oben, 2 unten, in 5er-Gruppen
  const railY = [10, 20, 190, 200];
  const railName = ['T-', 'T+', 'B-', 'B+'];
  for (let k = 0; k < 4; k++) {
    for (let c = 0; c < cols; c++) {
      if (c % 6 === 5) continue;
      holes.push({ id: `${railName[k]}${c + 1}`, x: x0 + c * PITCH + 5, y: railY[k], strip: railName[k] });
    }
  }
  return { holes, w: x0 * 2 + (cols - 1) * PITCH + 10, h: 210 };
}

const breadboard = (half: boolean): PartDef => ({
  type: half ? 'steckbrett-halb' : 'steckbrett',
  aliases: half ? ['breadboard-half', 'breadboard-400'] : ['breadboard', 'breadboard-830', 'steckplatine'],
  name: half ? 'Steckbrett (400 Kontakte)' : 'Steckbrett (830 Kontakte)',
  category: 'Aufbau',
  keywords: 'steckbrett breadboard aufbau steckplatine',
  prefix: 'BB',
  defaults: {},
  size: () => {
    const b = breadboardHoles(half);
    return { w: b.w, h: b.h };
  },
  pins: () => [],
  render: () => {
    const b = breadboardHoles(half);
    return (
      <g>
        <g filter="url(#f-shadow)">
          <rect x={0} y={0} width={b.w} height={b.h} rx={4} fill="#f4f2ec" />
          <rect x={0} y={0} width={b.w} height={b.h} rx={4} fill="url(#g-gloss)" opacity={0.6} />
        </g>
        <rect x={6} y={100} width={b.w - 12} height={10} rx={2} fill="#e6e3da" />
        {[4, 26, 184, 206].map((y, i) => (
          <line key={i} x1={12} x2={b.w - 12} y1={y} y2={y} stroke={i % 2 === 0 ? '#2b6fd6' : '#d93a3a'} strokeWidth={0.9} opacity={0.8} />
        ))}
        {b.holes.map((h) => (
          <rect key={h.id} x={h.x - 2} y={h.y - 2} width={4} height={4} rx={0.8} fill="#3a3a3a" />
        ))}
        {Array.from({ length: half ? 30 : 63 }, (_, c) =>
          c % 5 === 4 || c === 0 ? (
            <g key={c}>
              <Label x={20 + c * PITCH} y={42} size={3.2} color="#9a978f" weight={500}>
                {c + 1}
              </Label>
              <Label x={20 + c * PITCH} y={168} size={3.2} color="#9a978f" weight={500}>
                {c + 1}
              </Label>
            </g>
          ) : null,
        )}
        {'abcdefghij'.split('').map((r, i) => (
          <Label key={r} x={9} y={50 + i * PITCH + (i >= 5 ? PITCH * 2 : 0)} size={3.4} color="#9a978f" weight={500}>
            {r}
          </Label>
        ))}
      </g>
    );
  },
  symbol: 'box',
  info: 'Lötfreies Steckbrett: Die fünf Löcher einer Spalte (a–e bzw. f–j) sind verbunden, die Stromschienen (+/−) laufen längs. Teile rasten beim Ablegen ein.',
  price: half ? 2 : 3,
  noBom: false,
  height3d: 8,
});

const wireBridge: PartDef = {
  type: 'drahtbruecke',
  aliases: ['jumper', 'bruecke', 'steckbruecke'],
  name: 'Drahtbrücke',
  category: 'Aufbau',
  keywords: 'brücke jumper draht steckbrücke',
  prefix: 'J',
  defaults: { laenge: 4, farbe: 'rot' },
  props: [
    { key: 'laenge', label: 'Länge (Raster)', type: 'number', min: 1, max: 20 },
    { key: 'farbe', label: 'Farbe', type: 'select', options: ['rot', 'schwarz', 'blau', 'gelb', 'gruen', 'orange', 'weiss'] },
  ],
  size: (p) => ({ w: Number(p.laenge ?? 4) * PITCH, h: 6 }),
  pins: (p) => [
    { id: '1', x: 0, y: 3 },
    { id: '2', x: Number(p.laenge ?? 4) * PITCH, y: 3 },
  ],
  render: ({ props }) => {
    const L = Number(props.laenge ?? 4) * PITCH;
    const col: Record<string, string> = { rot: '#d93a3a', schwarz: '#222', blau: '#2b6fd6', gelb: '#f2c94c', gruen: '#2f9e44', orange: '#f07c1b', weiss: '#eee' };
    return (
      <g>
        <Lead x1={0} y1={3} x2={L} y2={3} />
        <line x1={3} y1={3} x2={L - 3} y2={3} stroke={col[props.farbe] ?? col.rot} strokeWidth={3.4} strokeLinecap="round" />
        <line x1={3} y1={2} x2={L - 3} y2={2} stroke="#fff" strokeOpacity={0.3} strokeWidth={1} strokeLinecap="round" />
      </g>
    );
  },
  symbol: 'box',
  build(ctx) {
    ctx.add(new Resistor(ctx.node('1'), ctx.node('2'), 0.01));
  },
  info: 'Kurze, flach liegende Drahtbrücke für saubere Steckbrettaufbauten.',
  price: 0.02,
  height3d: 1,
};

/* ------------------------------------------------------------------ */

export const BASIC_PARTS: PartDef[] = [
  resistor,
  potentiometer,
  trimmer,
  ldr,
  ntc,
  ptc,
  ceramic,
  film,
  elko,
  inductor,
  crystal,
  fuse,
  d1n4148,
  d1n4007,
  schottky,
  zener,
  led,
  rgbLed,
  s8050,
  bc547,
  n2222,
  n3904,
  bc557,
  s8550,
  n3906,
  tip120,
  irlz44n,
  irf520,
  ao3400,
  n2n7000,
  irf9540,
  lm7805,
  ams1117,
  lm1117_5,
  ht7333,
  optocoupler,
  batteryHolder,
  cellPart('AA', 'batterie-aa', ['aa', 'mignon', 'battery-aa']),
  cellPart('AAA', 'batterie-aaa', ['aaa', 'micro-batterie', 'battery-aaa']),
  cellPart('18650', 'akku-18650', ['18650', 'li-ion', 'liion']),
  cellPart('LiPo', 'lipo', ['lipo-akku', 'lipo-1000mah', 'akku-lipo']),
  cellPart('CR2032', 'cr2032', ['knopfzelle', 'coin-cell']),
  cellPart('9V', 'batterie-9v', ['9v', '9v-block', 'battery-9v']),
  usbPower,
  labSupply,
  solar,
  buck,
  boost,
  button,
  slideSwitch,
  reed,
  magnet,
  buzzer,
  speaker,
  relay,
  dcMotor,
  vibration,
  breadboard(false),
  breadboard(true),
  wireBridge,
];

void VT;
void shade;
