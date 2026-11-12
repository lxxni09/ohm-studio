/**
 * ICs, Treiber, Servos, Schrittmotoren und Messgeräte.
 */
import { Diode, diodeFromVf, Mosfet, OpAmp, Resistor, Source, Switch } from '../../sim/mna';
import { formatValue, parseValue } from '../../lib/units';
import { Chip, Glow, Label, Lead } from '../svg';
import { modulePart } from './modules';
import { PITCH, type BuildCtx, type PartDef } from '../types';

/* ------------------------------------------------------------------ */
/* DIP-Gehäuse                                                          */
/* ------------------------------------------------------------------ */

function dipPins(names: string[]) {
  const n = names.length;
  const half = n / 2;
  return names.map((id, i) => {
    const bottom = i < half;
    const x = bottom ? i * PITCH : (n - 1 - i) * PITCH;
    return { id, x, y: bottom ? 30 : 0, label: id, aliases: [String(i + 1)] };
  });
}

function dipRender(n: number, label: string, sub?: string) {
  const half = n / 2;
  const L = (half - 1) * PITCH;
  return (
    <g>
      {Array.from({ length: half }, (_, i) => (
        <g key={i}>
          <rect x={i * PITCH - 1.6} y={-1} width={3.2} height={6} fill="#c9cdd1" />
          <rect x={i * PITCH - 1.6} y={25} width={3.2} height={6} fill="#c9cdd1" />
        </g>
      ))}
      <g filter="url(#f-shadow)">
        <rect x={-6} y={4} width={L + 12} height={22} rx={1.5} fill="url(#g-chip)" />
        <rect x={-6} y={4} width={L + 12} height={10} rx={1.5} fill="url(#g-gloss)" />
        <path d="M-6 11 a4 4 0 0 1 0 8" fill="#0a0a0a" />
        <circle cx={-1} cy={22} r={1.3} fill="#0a0a0a" />
        <Label x={L / 2} y={sub ? 12.5 : 15} size={Math.min(5, (L + 6) / (label.length * 0.62))} color="#d4d4d4" weight={500}>
          {label}
        </Label>
        {sub && (
          <Label x={L / 2} y={19.5} size={3} color="#9a9a9a" weight={400}>
            {sub}
          </Label>
        )}
      </g>
    </g>
  );
}

function dip(def: Omit<PartDef, 'size' | 'pins' | 'render' | 'prefix'> & { names: string[]; label: string; sub?: string; prefix?: string }): PartDef {
  const { names, label, sub, ...rest } = def;
  const pins = dipPins(names);
  return {
    prefix: 'U',
    ...rest,
    size: () => ({ w: (names.length / 2 - 1) * PITCH, h: 30 }),
    pins: () => pins,
    render: () => dipRender(names.length, label, sub),
    symbol: 'box',
    height3d: 4,
  };
}

/** Logikpegel lesen (digitale Ansteuerung durch MCU sofort, sonst Spannung) */
function logic(c: BuildCtx, pin: string, vcc: number): number {
  return c.engine.logic(c.id, pin, vcc);
}

function outputs(ctx: BuildCtx, pins: string[], gnd: string, r = 50) {
  const srcs = new Map(pins.map((p) => [p, ctx.add(new Source(ctx.node(p), ctx.node(gnd), 0, r))]));
  return (c: BuildCtx, pin: string, v: number, hiZ = false) => {
    const s = srcs.get(pin)!;
    const nr = hiZ ? 1e9 : r;
    if (Math.abs(s.v - v) > 1e-4 || s.r !== nr) {
      s.v = v;
      s.r = nr;
      c.engine.markDirty();
    }
  };
}

const ne555 = dip({
  type: 'ne555',
  aliases: ['555', 'timer-555', 'lm555'],
  name: 'Timer NE555',
  category: 'ICs',
  keywords: '555 timer blinker oszillator astabil monostabil',
  names: ['GND', 'TRIG', 'OUT', 'RESET', 'CTRL', 'THR', 'DIS', 'VCC'],
  label: 'NE555P',
  defaults: {},
  build(ctx) {
    const vcc = ctx.node('VCC');
    const gnd = ctx.node('GND');
    const mid = ctx.internal('third');
    ctx.add(new Resistor(vcc, ctx.node('CTRL'), 5000));
    ctx.add(new Resistor(ctx.node('CTRL'), mid, 5000));
    ctx.add(new Resistor(mid, gnd, 5000));
    const out = ctx.add(new Source(ctx.node('OUT'), gnd, 0, 10));
    const dis = ctx.add(new Switch(ctx.node('DIS'), gnd, true, 5));
    ctx.add(new Resistor(vcc, gnd, 5 / 0.003));
    ctx.engine.dynamic = true;
    let q = false;
    return {
      post(c) {
        const v = c.v('VCC') - c.v('GND');
        const ctrl = c.v('CTRL');
        const third = c.circuit.voltage(mid);
        const trig = c.v('TRIG') < third;
        const thr = c.v('THR') > ctrl;
        const rst = c.v('RESET') - c.v('GND') < 0.7;
        if (rst) q = false;
        else if (trig) q = true;
        else if (thr) q = false;
        const vout = q && v > 4 ? v - 1.6 : 0.1;
        if (Math.abs(out.v - vout) > 1e-3 || dis.closed === q) {
          out.v = vout + c.v('GND');
          dis.closed = !q;
          c.engine.markDirty();
        }
        c.state.q = q;
      },
    };
  },
  info: 'Der Klassiker: Erzeugt Takte (astabil, f ≈ 1,44 / ((R1 + 2·R2)·C)) oder einmalige Pulse (monostabil). 4,5–16 V.',
  price: 0.3,
});

const lm358 = dip({
  type: 'lm358',
  aliases: ['opamp', 'operationsverstaerker', 'lm358n', 'lm324'],
  name: 'Operationsverstärker LM358',
  category: 'ICs',
  keywords: 'opamp operationsverstärker komparator verstärker lm358',
  names: ['OUT1', 'IN1-', 'IN1+', 'GND', 'IN2+', 'IN2-', 'OUT2', 'VCC'],
  label: 'LM358N',
  defaults: {},
  build(ctx) {
    ctx.add(new OpAmp(ctx.node('IN1+'), ctx.node('IN1-'), ctx.node('OUT1'), ctx.node('VCC'), ctx.node('GND')));
    ctx.add(new OpAmp(ctx.node('IN2+'), ctx.node('IN2-'), ctx.node('OUT2'), ctx.node('VCC'), ctx.node('GND')));
  },
  info: 'Zwei Operationsverstärker, auch mit nur einer Versorgung (3–32 V). Ausgang erreicht nicht ganz VCC (ca. VCC − 1,5 V).',
  price: 0.25,
});

const hc595 = dip({
  type: '74hc595',
  aliases: ['595', 'schieberegister', 'shift-register', 'sn74hc595'],
  name: 'Schieberegister 74HC595',
  category: 'ICs',
  keywords: 'schieberegister 595 ausgänge erweitern shift register',
  names: ['QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH', 'GND', "QH'", 'SRCLR', 'SRCLK', 'RCLK', 'OE', 'SER', 'QA', 'VCC'],
  label: '74HC595',
  defaults: {},
  build(ctx) {
    const qs = ['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH'];
    const set = outputs(ctx, [...qs, "QH'"], 'GND', 60);
    ctx.add(new Resistor(ctx.node('VCC'), ctx.node('GND'), 1e5));
    let sr = 0;
    let latch = 0;
    const apply = (c: BuildCtx) => {
      const vcc = c.v('VCC') - c.v('GND');
      const oe = logic(c, 'OE', vcc) === 0;
      qs.forEach((q, i) => set(c, q, (latch >> i) & 1 ? vcc : 0, !oe));
      set(c, "QH'", (sr >> 7) & 1 ? vcc : 0);
      c.state.latch = latch;
    };
    ctx.engine.onEdge(ctx.id, ['SRCLK', 'RCLK', 'SRCLR'], (c: BuildCtx, pin: string, lvl: number) => {
      const vcc = c.v('VCC') - c.v('GND');
      if (pin === 'SRCLR' && !lvl) sr = 0;
      if (pin === 'SRCLK' && lvl) sr = ((sr << 1) | logic(c, 'SER', vcc)) & 255;
      if (pin === 'RCLK' && lvl) {
        latch = sr;
        apply(c);
      }
    });
    return { pre: apply };
  },
  info: 'Macht aus 3 Pins 8 Ausgänge: Bits seriell über SER + SRCLK einschieben, mit RCLK übernehmen. Mehrere lassen sich über QH′ verketten. In Arduino: shiftOut().',
  price: 0.3,
});

function gate(type: string, name: string, op: (a: number, b: number) => number, inverter = false): PartDef {
  const names = inverter ? ['1A', '1Y', '2A', '2Y', '3A', '3Y', 'GND', '4Y', '4A', '5Y', '5A', '6Y', '6A', 'VCC'] : ['1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3A', '3B', '4Y', '4A', '4B', 'VCC'];
  return dip({
    type,
    aliases: [type.replace('74hc', ''), type.toUpperCase()],
    name,
    category: 'ICs',
    keywords: `logik gatter ${name.toLowerCase()} 74hc ttl cmos`,
    names,
    label: type.toUpperCase(),
    defaults: {},
    build(ctx) {
      const n = inverter ? 6 : 4;
      const outsIds = Array.from({ length: n }, (_, i) => `${i + 1}Y`);
      const set = outputs(ctx, outsIds, 'GND', 40);
      ctx.add(new Resistor(ctx.node('VCC'), ctx.node('GND'), 1e6));
      return {
        pre(c) {
          const vcc = c.v('VCC') - c.v('GND');
          for (let i = 1; i <= n; i++) {
            const a = logic(c, `${i}A`, vcc);
            const y = inverter ? 1 - a : op(a, logic(c, `${i}B`, vcc));
            set(c, `${i}Y`, y && vcc > 1.5 ? vcc : 0);
          }
        },
      };
    },
    info: `${name}: ${inverter ? 'sechs Inverter (NICHT)' : 'vier Gatter mit je zwei Eingängen'}. Versorgung 2–6 V. Unbenutzte Eingänge nie offen lassen!`,
    price: 0.25,
  });
}

const cd4017 = dip({
  type: 'cd4017',
  aliases: ['4017', 'dekadenzaehler'],
  name: 'Dekadenzähler CD4017',
  category: 'ICs',
  keywords: 'zähler lauflicht 4017 dekade',
  names: ['Q5', 'Q1', 'Q0', 'Q2', 'Q6', 'Q7', 'Q3', 'VSS', 'Q8', 'Q4', 'Q9', 'CO', 'EN', 'CLK', 'MR', 'VDD'],
  label: 'CD4017BE',
  defaults: {},
  build(ctx) {
    const qs = Array.from({ length: 10 }, (_, i) => `Q${i}`);
    const set = outputs(ctx, [...qs, 'CO'], 'VSS', 200);
    ctx.add(new Resistor(ctx.node('VDD'), ctx.node('VSS'), 1e6));
    let count = 0;
    let last = 0;
    return {
      pre(c) {
        const vdd = c.v('VDD') - c.v('VSS');
        const clk = logic(c, 'CLK', vdd);
        if (logic(c, 'MR', vdd)) count = 0;
        else if (clk && !last && !logic(c, 'EN', vdd)) count = (count + 1) % 10;
        last = clk;
        qs.forEach((q, i) => set(c, q, i === count ? vdd : 0));
        set(c, 'CO', count < 5 ? vdd : 0);
      },
    };
  },
  info: 'Zählt Takte und schaltet nacheinander einen von 10 Ausgängen HIGH – mit einem 555 das klassische Lauflicht.',
  price: 0.35,
});

const eeprom = dip({
  type: '24c256',
  aliases: ['eeprom', 'at24c256', '24lc256', 'at24c02'],
  name: 'EEPROM 24C256 (I²C)',
  category: 'ICs',
  keywords: 'eeprom speicher i2c nichtflüchtig',
  names: ['A0', 'A1', 'A2', 'GND', 'SDA', 'SCL', 'WP', 'VCC'],
  label: '24C256',
  defaults: {},
  build(ctx) {
    ctx.add(new Resistor(ctx.node('VCC'), ctx.node('GND'), 3.3 / 0.0004));
  },
  info: '32 KB nichtflüchtiger Speicher über I²C (Adresse 0x50). Behält Daten ohne Strom.',
  price: 0.5,
});

/* ------------------------------------------------------------------ */
/* Treiber-Module                                                      */
/* ------------------------------------------------------------------ */

const l298n = modulePart({
  type: 'l298n',
  aliases: ['motortreiber', 'l298', 'h-bruecke'],
  name: 'Motortreiber L298N',
  category: 'ICs',
  keywords: 'motor treiber h-brücke l298n dc motor zwei motoren',
  pins: ['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB'],
  w: 170,
  h: 170,
  color: '#b71c1c',
  iq: 0,
  body: () => (
    <g>
      <rect x={45} y={20} width={80} height={60} rx={3} fill="#2a2a2a" />
      {Array.from({ length: 10 }, (_, i) => (
        <rect key={i} x={48 + i * 7.6} y={14} width={4} height={60} fill="#3a3a3a" />
      ))}
      <Chip x={60} y={84} w={50} h={20} label="L298N" legs={0} />
      {[18, 38].map((y) => (
        <rect key={y} x={0} y={y - 9} width={22} height={18} fill="#1f6fdc" />
      ))}
      {[18, 38].map((y) => (
        <rect key={y + 'r'} x={148} y={y - 9} width={22} height={18} fill="#1f6fdc" />
      ))}
      <rect x={52} y={118} width={66} height={18} fill="#1f6fdc" />
      <Label x={85} y={142} size={4}>
        12V GND 5V
      </Label>
    </g>
  ),
  extra(ctx) {
    void ctx;
  },
  info: 'Doppelte H-Brücke für zwei DC-Motoren oder einen Schrittmotor (5–35 V, 2 A). Achtung: ~2 V Spannungsabfall. Schraubklemmen: OUT1–4, 12V, GND, 5V.',
  price: 3,
  height3d: 25,
});
// Zusätzliche Klemmen am L298N
const l298nPins = l298n.pins({});
l298n.pins = () => [
  ...l298nPins,
  { id: 'OUT1', x: 5, y: 13, label: 'OUT1' },
  { id: 'OUT2', x: 5, y: 33, label: 'OUT2' },
  { id: 'OUT3', x: 165, y: 13, label: 'OUT3' },
  { id: 'OUT4', x: 165, y: 33, label: 'OUT4' },
  { id: '12V', x: 65, y: 125, label: '12V', aliases: ['VS', 'VIN', 'VMS'] },
  { id: 'GND', x: 85, y: 125, label: 'GND' },
  { id: '5V', x: 105, y: 125, label: '5V' },
];
l298n.build = (ctx) => {
  const set = outputs(ctx, ['OUT1', 'OUT2', 'OUT3', 'OUT4'], 'GND', 1.5);
  ctx.add(new Resistor(ctx.node('12V'), ctx.node('GND'), 12 / 0.036));
  const reg = ctx.add(new Source(ctx.node('5V'), ctx.node('GND'), 5, 0.5));
  for (const p of ['ENA', 'ENB']) ctx.add(new Resistor(ctx.node(p), ctx.node('5V'), 10000));
  return {
    pre(c) {
      const vs = c.v('12V') - c.v('GND');
      reg.v = vs > 7 ? 5 : Math.max(0, vs - 2);
      const drop = 2;
      const vo = Math.max(0, vs - drop);
      const en = [logic(c, 'ENA', 5), logic(c, 'ENB', 5)];
      const ins = [logic(c, 'IN1', 5), logic(c, 'IN2', 5), logic(c, 'IN3', 5), logic(c, 'IN4', 5)];
      ['OUT1', 'OUT2', 'OUT3', 'OUT4'].forEach((o, i) => {
        const e = en[i < 2 ? 0 : 1];
        set(c, o, e && ins[i] ? vo + c.v('GND') : c.v('GND') + 0.1, !e);
      });
    },
  };
};

const drv8833 = modulePart({
  type: 'drv8833',
  aliases: ['drv-8833'],
  name: 'Motortreiber DRV8833',
  category: 'ICs',
  keywords: 'motor treiber drv8833 h-brücke klein effizient',
  pins: ['AIN1', 'AIN2', 'BIN1', 'BIN2', 'VM', 'GND', 'AOUT1', 'AOUT2', 'BOUT1', 'BOUT2', 'SLP'],
  w: 120,
  h: 60,
  color: '#7b1fa2',
  iq: 0,
  body: () => <Chip x={45} y={10} w={30} h={20} label="DRV8833" legs={8} />,
  extra(ctx) {
    const set = outputs(ctx, ['AOUT1', 'AOUT2', 'BOUT1', 'BOUT2'], 'GND', 0.4);
    ctx.add(new Resistor(ctx.node('SLP'), ctx.node('VM'), 47000));
    return {
      pre(c) {
        const vm = c.v('VM') - c.v('GND');
        const on = logic(c, 'SLP', 2.5);
        const ins = ['AIN1', 'AIN2', 'BIN1', 'BIN2'].map((p) => logic(c, p, 3.3));
        ['AOUT1', 'AOUT2', 'BOUT1', 'BOUT2'].forEach((o, i) => set(c, o, ins[i] ? vm + c.v('GND') : c.v('GND'), !on));
      },
    };
  },
  info: 'Kleiner, effizienter Doppel-H-Brücken-Treiber (2,7–10,8 V, 1,5 A) mit MOSFETs – kaum Spannungsverlust. Ideal für Akku-Roboter.',
  price: 2,
});

const a4988 = modulePart({
  type: 'a4988',
  aliases: ['schrittmotortreiber', 'stepper-driver', 'drv8825'],
  name: 'Schrittmotortreiber A4988',
  category: 'ICs',
  keywords: 'schrittmotor stepper treiber a4988 3d-drucker',
  pins: ['EN', 'MS1', 'MS2', 'MS3', 'RST', 'SLP', 'STEP', 'DIR', 'VMOT', 'GND', '2B', '2A', '1A', '1B', 'VDD', 'GND2'],
  w: 90,
  h: 90,
  color: '#2e7d32',
  iq: 0.005,
  body: () => (
    <g>
      <Chip x={30} y={25} w={30} h={30} label="A4988" legs={7} legSide="four" />
      <rect x={60} y={8} width={14} height={10} fill="#e7d9a5" />
    </g>
  ),
  extra(ctx) {
    let last = 0;
    return {
      pre(c) {
        const st = logic(c, 'STEP', 3.3);
        if (st && !last) {
          const dir = logic(c, 'DIR', 3.3) ? 1 : -1;
          c.state.position = (c.state.position ?? 0) + dir;
          const m = c.engine.findConnected(c.id, ['1A', '1B', '2A', '2B'], ['schrittmotor']);
          for (const s of m) s.position = c.state.position;
        }
        last = st;
      },
    };
  },
  info: 'Steuert einen bipolaren Schrittmotor mit nur zwei Signalen: STEP (ein Puls = ein Schritt) und DIR (Richtung). Strombegrenzung per Poti einstellen!',
  price: 1.5,
});
a4988.bridges = () => [['GND', 'GND2']];

const levelShifter = modulePart({
  type: 'pegelwandler',
  aliases: ['level-shifter', 'bss138', 'logic-level-converter'],
  name: 'Pegelwandler 4-Kanal (BSS138)',
  category: 'ICs',
  keywords: 'pegelwandler level shifter 3.3v 5v bidirektional',
  pins: ['LV1', 'LV2', 'LV', 'GND', 'LV3', 'LV4', 'HV1', 'HV2', 'HV', 'GND2', 'HV3', 'HV4'],
  w: 130,
  h: 50,
  color: '#7b1fa2',
  iq: 0,
  body: () => (
    <g>
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={20 + i * 25} y={15} width={8} height={6} fill="#1d1d1f" />
      ))}
    </g>
  ),
  extra(ctx) {
    for (const i of [1, 2, 3, 4]) {
      const lv = ctx.node(`LV${i}`);
      const hv = ctx.node(`HV${i}`);
      ctx.add(new Resistor(lv, ctx.node('LV'), 10000));
      ctx.add(new Resistor(hv, ctx.node('HV'), 10000));
      ctx.add(new Mosfet(hv, ctx.node('LV'), lv, { pch: false, vth: 1.3, k: 0.5, rdsOn: 3 }));
      ctx.add(new Diode(lv, hv, diodeFromVf(0.7, 0.01, 1.5)));
    }
  },
  info: 'Verbindet 3,3-V- und 5-V-Logik in beide Richtungen (z. B. ESP32 ↔ 5-V-Sensor). LV = 3,3 V, HV = 5 V.',
  price: 0.8,
});
levelShifter.bridges = () => [['GND', 'GND2']];

/* ------------------------------------------------------------------ */
/* Servos & Schrittmotoren                                              */
/* ------------------------------------------------------------------ */

function servo(type: string, name: string, big: boolean): PartDef {
  const w = big ? 110 : 80;
  const h = big ? 60 : 46;
  return {
    type,
    aliases: big ? ['mg996r', 'servo-gross'] : ['sg90', 'servo-sg90', 'mikroservo'],
    name,
    category: 'Ein-/Ausgabe',
    keywords: 'servo motor winkel sg90 mg996r stellmotor',
    prefix: 'M',
    defaults: {},
    size: () => ({ w: w + 20, h }),
    pins: () => [
      { id: 'GND', x: 0, y: h / 2 - 10, label: 'GND', aliases: ['BRAUN', '-'] },
      { id: 'V+', x: 0, y: h / 2, label: '+', aliases: ['VCC', 'ROT', '+', '5V'] },
      { id: 'SIG', x: 0, y: h / 2 + 10, label: 'SIG', aliases: ['ORANGE', 'S', 'PWM', 'SIGNAL'] },
    ],
    render: ({ state }) => {
      const ang = state.angle ?? 90;
      const cx = 20 + w * 0.3;
      const cy = h / 2;
      return (
        <g>
          {['#6d4c41', '#d32f2f', '#f57c00'].map((c, i) => (
            <path key={i} d={`M0 ${h / 2 - 10 + i * 10} h12 q6 0 8 ${(1 - i) * 2}`} stroke={c} strokeWidth={2.2} fill="none" />
          ))}
          <g filter="url(#f-shadow)">
            <rect x={20} y={4} width={w} height={h - 8} rx={3} fill={big ? '#1d1d1f' : '#1e63d6'} opacity={big ? 1 : 0.92} />
            <rect x={14} y={h / 2 - 5} width={w + 12} height={10} rx={2} fill={big ? '#1d1d1f' : '#1e63d6'} opacity={0.8} />
            <rect x={20} y={4} width={w} height={(h - 8) / 2} rx={3} fill="url(#g-gloss)" />
            <Label x={20 + w * 0.65} y={h / 2} size={5} color="#fff">
              {big ? 'MG996R' : 'SG90'}
            </Label>
            <circle cx={cx} cy={cy} r={8} fill="#f5f5f5" />
            <g transform={`rotate(${ang - 90} ${cx} ${cy})`}>
              <path d={`M${cx - 4} ${cy} L${cx - 2} ${cy - 30} h4 L${cx + 4} ${cy} z`} fill="#fafafa" stroke="#ccc" strokeWidth={0.5} />
              <circle cx={cx} cy={cy - 26} r={1} fill="#999" />
              <circle cx={cx} cy={cy - 20} r={1} fill="#999" />
            </g>
            <circle cx={cx} cy={cy} r={2.5} fill="#bbb" />
          </g>
        </g>
      );
    },
    symbol: 'motor',
    build(ctx) {
      const load = ctx.add(new Resistor(ctx.node('V+'), ctx.node('GND'), 5 / 0.008));
      ctx.add(new Resistor(ctx.node('SIG'), ctx.node('GND'), 100000));
      return {
        pre(c, dt) {
          const v = c.v('V+') - c.v('GND');
          const tgt = c.state.target ?? 90;
          const ang = c.state.angle ?? 90;
          const speed = (v > 4 ? 60 / 0.1 : v > 3 ? 60 / 0.25 : 0) * (big ? 0.6 : 1);
          const moving = Math.abs(tgt - ang) > 0.5 && speed > 0;
          c.state.angle = moving ? ang + Math.sign(tgt - ang) * Math.min(Math.abs(tgt - ang), speed * dt) : ang;
          const r = moving ? 5 / (big ? 0.9 : 0.25) : 5 / 0.008;
          if (r !== load.r) {
            load.r = r;
            c.engine.markDirty();
          }
          c.engine.sound(c.id, moving ? 180 : 0, moving ? 0.05 : 0, 'sawtooth');
          if (moving && v < 4.2 && !c.state.warnV) {
            c.state.warnV = true;
            c.warn(`${c.id}: Servo bekommt nur ${v.toFixed(1)} V – Servos brauchen 5 V und beim Anlaufen viel Strom (bis ${big ? '2 A' : '700 mA'}). Eigene Versorgung + gemeinsame Masse!`, 'warn');
          }
        },
      };
    },
    info: big ? 'Kräftiger Metallgetriebe-Servo (10 kg·cm), braucht eigene 5–6-V-Versorgung.' : 'Mikroservo (0–180°, 1,8 kg·cm). Steuerung per 50-Hz-PWM (1–2 ms). Bibliothek Servo/ESP32Servo.',
    price: big ? 6 : 2,
    height3d: 23,
  };
}

const stepper = modulePart({
  type: 'schrittmotor',
  aliases: ['28byj-48', 'stepper', 'uln2003', 'stepper-28byj'],
  name: 'Schrittmotor 28BYJ-48 + ULN2003',
  category: 'Ein-/Ausgabe',
  keywords: 'schrittmotor stepper 28byj uln2003 präzise drehen',
  pins: ['IN1', 'IN2', 'IN3', 'IN4', '+', '-'],
  pinAliases: { '+': ['VCC', '5V'], '-': ['GND'] },
  w: 180,
  h: 110,
  color: '#1b5e20',
  iq: 0.002,
  body: ({ state }) => {
    const ang = ((state.position ?? 0) / 2048) * 360;
    return (
      <g>
        <Chip x={20} y={20} w={40} h={20} label="ULN2003" legs={8} />
        {[0, 1, 2, 3].map((i) => (
          <circle key={i} cx={28 + i * 10} cy={55} r={3} fill={state[`c${i}`] ? '#ff3b30' : '#401010'} />
        ))}
        <circle cx={130} cy={50} r={40} fill="url(#g-metal)" />
        <circle cx={130} cy={50} r={32} fill="#c9cdd1" />
        <g transform={`rotate(${ang} 130 50)`}>
          <rect x={127} y={18} width={6} height={32} rx={2} fill="#f2c94c" />
        </g>
        <circle cx={130} cy={50} r={5} fill="#888" />
      </g>
    );
  },
  extra() {
    const seq = [0b0001, 0b0011, 0b0010, 0b0110, 0b0100, 0b1100, 0b1000, 0b1001];
    let lastIdx = -1;
    return {
      pre(c) {
        const bits = ['IN1', 'IN2', 'IN3', 'IN4'].map((p) => logic(c, p, 3.3));
        bits.forEach((b, i) => (c.state[`c${i}`] = b));
        const v = bits[0] | (bits[1] << 1) | (bits[2] << 2) | (bits[3] << 3);
        let idx = seq.indexOf(v);
        if (idx < 0) {
          const full = [0b0011, 0b0110, 0b1100, 0b1001].indexOf(v);
          idx = full >= 0 ? full * 2 + 1 : -1;
        }
        if (idx >= 0 && lastIdx >= 0 && idx !== lastIdx) {
          let d = idx - lastIdx;
          if (d > 4) d -= 8;
          if (d < -4) d += 8;
          c.state.position = (c.state.position ?? 0) + d / 2;
        }
        if (idx >= 0) lastIdx = idx;
      },
    };
  },
  info: 'Günstiger Getriebe-Schrittmotor: 2048 Schritte pro Umdrehung, 5 V. Ansteuerung über ULN2003 mit 4 Pins; Bibliothek Stepper oder AccelStepper.',
  price: 3,
  height3d: 20,
});

/* ------------------------------------------------------------------ */
/* Messgeräte                                                          */
/* ------------------------------------------------------------------ */

const multimeter: PartDef = {
  type: 'multimeter',
  aliases: ['dmm', 'messgeraet', 'voltmeter', 'amperemeter'],
  name: 'Multimeter',
  category: 'Messgeräte',
  keywords: 'multimeter messen spannung strom widerstand volt ampere ohm durchgang',
  prefix: 'MM',
  defaults: { modus: 'V' },
  props: [{ key: 'modus', label: 'Messart', type: 'select', options: [{ value: 'V', label: 'Spannung (V)' }, { value: 'A', label: 'Strom (A)' }, { value: 'Ω', label: 'Widerstand (Ω)' }, { value: 'durchgang', label: 'Durchgang' }], live: true }],
  size: () => ({ w: 90, h: 150 }),
  pins: () => [
    { id: 'COM', x: 30, y: 150, label: 'COM', aliases: ['-', 'MINUS', 'SCHWARZ'] },
    { id: 'V', x: 60, y: 150, label: 'VΩA', aliases: ['+', 'PLUS', 'ROT', 'A', 'VΩ'] },
  ],
  render: ({ props, state }) => {
    const mode = props.modus ?? 'V';
    const ang = { V: -40, A: 40, 'Ω': 0, durchgang: 80 }[mode as string] ?? -40;
    return (
      <g>
        <g filter="url(#f-shadow)">
          <rect x={0} y={0} width={90} height={140} rx={10} fill="#f2b705" />
          <rect x={6} y={6} width={78} height={128} rx={7} fill="#2c2c2e" />
          <rect x={12} y={12} width={66} height={30} rx={3} fill="#c3d1b0" />
          <text x={73} y={33} fontFamily="'JetBrains Mono', monospace" fontSize={15} fill="#1d2a12" textAnchor="end">
            {state.reading ?? '0.000'}
          </text>
          <text x={16} y={20} fontFamily="Inter" fontSize={5} fill="#1d2a12">
            {state.unit ?? 'V'}
          </text>
          <circle cx={45} cy={80} r={22} fill="#1d1d1f" stroke="#555" />
          <g transform={`rotate(${ang} 45 80)`}>
            <rect x={42} y={58} width={6} height={30} rx={3} fill="#e5e5ea" />
          </g>
          {['V', 'Ω', 'A', '•))'].map((m, i) => (
            <Label key={m} x={45 + 30 * Math.sin(((-40 + i * 40) * Math.PI) / 180)} y={80 - 30 * Math.cos(((-40 + i * 40) * Math.PI) / 180)} size={5} color="#ddd">
              {m}
            </Label>
          ))}
          <circle cx={30} cy={124} r={5} fill="#1d1d1f" stroke="#666" />
          <circle cx={60} cy={124} r={5} fill="#c62828" stroke="#666" />
        </g>
        <Lead x1={30} y1={129} x2={30} y2={150} w={2.2} />
        <Lead x1={60} y1={129} x2={60} y2={150} w={2.2} />
      </g>
    );
  },
  symbol: 'box',
  build(ctx) {
    const mode = ctx.props.modus ?? 'V';
    const a = ctx.node('V');
    const b = ctx.node('COM');
    if (mode === 'A') {
      const sh = ctx.add(new Resistor(a, b, 0.05));
      return {
        post(c) {
          const i = sh.current(c.circuit.x);
          c.state.reading = Math.abs(i) < 1 ? (i * 1000).toFixed(2) : i.toFixed(3);
          c.state.unit = Math.abs(i) < 1 ? 'mA' : 'A';
          c.state.value = i;
        },
      };
    }
    if (mode === 'Ω' || mode === 'durchgang') {
      const src = ctx.add(new Source(a, b, 0.5, 1000));
      return {
        post(c) {
          const v = c.v('V') - c.v('COM');
          const r = (v * 1000) / Math.max(0.5 - v, 1e-9);
          c.state.value = r;
          c.state.unit = 'Ω';
          c.state.reading = r > 2e7 ? 'OL' : formatValue(r, '').replace(' ', '');
          const beep = mode === 'durchgang' && r < 30;
          c.engine.sound(c.id, beep ? 2400 : 0, beep ? 0.25 : 0, 'sine');
          void src;
        },
      };
    }
    ctx.add(new Resistor(a, b, 10e6));
    return {
      post(c) {
        const v = c.v('V') - c.v('COM');
        c.state.value = v;
        c.state.unit = 'V DC';
        c.state.reading = Math.abs(v) < 10 ? v.toFixed(3) : v.toFixed(2);
      },
    };
  },
  info: 'Spannung: parallel messen (10 MΩ Innenwiderstand). Strom: in Reihe einschleifen! Widerstand nur an stromlosen Bauteilen messen. Tipp: Während der Simulation zeigt auch das Überfahren eines Pins die Spannung.',
  price: 15,
  noBom: true,
  height3d: 30,
};

function scopeLike(type: string, name: string, chans: string[], logicMode: boolean, info: string): PartDef {
  const w = logicMode ? 120 : 170;
  const h = logicMode ? 70 : 120;
  return {
    type,
    aliases: logicMode ? ['logic-analyzer', 'logikanalysator-8ch', 'la'] : ['oszi', 'oscilloscope', 'scope', 'oszilloskop-4ch'],
    name,
    category: 'Messgeräte',
    keywords: logicMode ? 'logikanalysator logic analyzer protokoll i2c spi digital' : 'oszilloskop oszi spannung verlauf welle kurve',
    prefix: logicMode ? 'LA' : 'OSC',
    defaults: { zeitbasis: logicMode ? '10ms' : '100ms', volt_pro_div: 1 },
    props: [
      { key: 'zeitbasis', label: 'Zeit pro Raster', type: 'select', options: ['1ms', '10ms', '100ms', '1s'], live: true },
      ...(!logicMode ? [{ key: 'volt_pro_div', label: 'V pro Raster', type: 'select' as const, options: ['0.5', '1', '2', '5'], live: true }] : []),
    ],
    size: () => ({ w, h: h + 10 }),
    pins: () => [...chans, 'GND'].map((id, i) => ({ id, x: 10 + i * PITCH, y: h + 10, label: id })),
    render: ({ state, props }) => {
      const samples: number[][] = state.samples ?? [];
      const colors = ['#ffd60a', '#32d7ff', '#ff6bd6', '#30d158', '#ff9f0a', '#bf5af2', '#64d2ff', '#ff453a'];
      const sx = 8;
      const sy = 8;
      const sw = w - 16;
      const sh = h - 20;
      const vdiv = Number(props.volt_pro_div ?? 1);
      return (
        <g>
          <g filter="url(#f-shadow)">
            <rect x={0} y={0} width={w} height={h} rx={6} fill="#3a3a3c" />
            <rect x={sx} y={sy} width={sw} height={sh} rx={2} fill="#0a0f0a" />
            {Array.from({ length: 9 }, (_, i) => (
              <line key={'v' + i} x1={sx + (i * sw) / 8} y1={sy} x2={sx + (i * sw) / 8} y2={sy + sh} stroke="#1f2f1f" strokeWidth={0.5} />
            ))}
            {Array.from({ length: 7 }, (_, i) => (
              <line key={'h' + i} x1={sx} y1={sy + (i * sh) / 6} x2={sx + sw} y2={sy + (i * sh) / 6} stroke="#1f2f1f" strokeWidth={0.5} />
            ))}
            {chans.map((_, ci) => {
              const pts = samples.map((s, i) => {
                const x = sx + (i / Math.max(1, samples.length - 1)) * sw;
                const v = s[ci] ?? 0;
                const y = logicMode ? sy + 4 + ci * (sh / chans.length) + (v > 1.5 ? 0 : sh / chans.length - 8) : sy + sh / 2 - (v / vdiv) * (sh / 6);
                return `${x.toFixed(1)},${Math.max(sy, Math.min(sy + sh, y)).toFixed(1)}`;
              });
              return pts.length > 1 ? <polyline key={ci} points={pts.join(' ')} fill="none" stroke={colors[ci]} strokeWidth={1} strokeLinejoin="round" /> : null;
            })}
          </g>
          {[...chans, 'GND'].map((id, i) => (
            <g key={id}>
              <Lead x1={10 + i * PITCH} y1={h} x2={10 + i * PITCH} y2={h + 10} />
              <Label x={10 + i * PITCH} y={h - 5} size={3} color={i < chans.length ? colors[i] : '#ccc'}>
                {id}
              </Label>
            </g>
          ))}
        </g>
      );
    },
    symbol: 'box',
    build(ctx) {
      for (const ch of chans) ctx.add(new Resistor(ctx.node(ch), ctx.node('GND'), 1e6));
      ctx.engine.dynamic = true;
      return {
        post(c, dt) {
          const tb = parseValue(String(c.props.zeitbasis ?? '100ms').replace('ms', 'm').replace(/s$/, ''), 0.1) * 8;
          const n = 240;
          const every = Math.max(dt, tb / n);
          c.state.acc = (c.state.acc ?? 0) + dt;
          if (c.state.acc >= every) {
            c.state.acc = 0;
            const s: number[][] = c.state.samples ?? [];
            s.push(chans.map((ch) => c.v(ch) - c.v('GND')));
            while (s.length > n) s.shift();
            c.state.samples = s;
            c.state.version = (c.state.version ?? 0) + 1;
          }
        },
      };
    },
    info,
    price: logicMode ? 10 : 350,
    noBom: true,
    height3d: 40,
  };
}

const funcGen: PartDef = {
  type: 'funktionsgenerator',
  aliases: ['function-generator', 'signalgenerator', 'frequenzgenerator'],
  name: 'Funktionsgenerator',
  category: 'Messgeräte',
  keywords: 'funktionsgenerator signal sinus rechteck dreieck frequenz',
  prefix: 'FG',
  defaults: { form: 'sinus', frequenz: 5, amplitude: 2.5, offset: 2.5 },
  props: [
    { key: 'form', label: 'Signalform', type: 'select', options: ['sinus', 'rechteck', 'dreieck', 'saegezahn'], live: true },
    { key: 'frequenz', label: 'Frequenz', type: 'range', min: 0.1, max: 200, step: 0.1, unit: 'Hz', live: true },
    { key: 'amplitude', label: 'Amplitude', type: 'range', min: 0, max: 10, step: 0.1, unit: 'V', live: true },
    { key: 'offset', label: 'Offset', type: 'range', min: -5, max: 10, step: 0.1, unit: 'V', live: true },
  ],
  size: () => ({ w: 120, h: 80 }),
  pins: () => [
    { id: 'OUT', x: 90, y: 80, label: 'OUT', aliases: ['+', 'SIG'] },
    { id: 'GND', x: 110, y: 80, label: 'GND', aliases: ['-'] },
  ],
  render: ({ props }) => (
    <g>
      <g filter="url(#f-shadow)">
        <rect x={0} y={0} width={120} height={70} rx={6} fill="#e5e5ea" />
        <rect x={8} y={8} width={64} height={30} rx={3} fill="#0b1220" />
        <text x={66} y={28} fontFamily="'JetBrains Mono', monospace" fontSize={11} fill="#5ac8fa" textAnchor="end">
          {Number(props.frequenz).toFixed(1)}Hz
        </text>
        <Label x={40} y={50} size={5} color="#3a3a3c">
          {String(props.form)}
        </Label>
        <circle cx={96} cy={24} r={11} fill="url(#g-metal)" />
        <circle cx={90} cy={56} r={5} fill="#c62828" />
        <circle cx={110} cy={56} r={5} fill="#1d1d1f" />
      </g>
      <Lead x1={90} y1={60} x2={90} y2={80} />
      <Lead x1={110} y1={60} x2={110} y2={80} />
    </g>
  ),
  symbol: 'box',
  build(ctx) {
    const s = ctx.add(new Source(ctx.node('OUT'), ctx.node('GND'), 0, 50));
    ctx.engine.dynamic = true;
    return {
      pre(c) {
        const f = Number(c.props.frequenz);
        const a = Number(c.props.amplitude);
        const o = Number(c.props.offset);
        const ph = (c.time * f) % 1;
        let w = 0;
        switch (c.props.form) {
          case 'rechteck':
            w = ph < 0.5 ? 1 : -1;
            break;
          case 'dreieck':
            w = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
            break;
          case 'saegezahn':
            w = 2 * ph - 1;
            break;
          default:
            w = Math.sin(2 * Math.PI * ph);
        }
        s.v = o + a * w;
      },
    };
  },
  info: 'Erzeugt Sinus, Rechteck, Dreieck oder Sägezahn. Frequenz durch den Simulationsschritt begrenzt (bis ca. 1/10 der Schrittrate).',
  price: 80,
  noBom: true,
  height3d: 40,
};

const powerMeter: PartDef = {
  type: 'strommesser',
  aliases: ['power-profiler', 'stromlogger', 'ina219', 'energiemesser'],
  name: 'Strommessung über Zeit',
  category: 'Messgeräte',
  keywords: 'strom verbrauch akkulaufzeit batterie deep sleep profiler messung',
  prefix: 'PM',
  defaults: { kapazitaet: '2000mAh' },
  props: [{ key: 'kapazitaet', label: 'Akku für Laufzeitschätzung', type: 'select', options: ['220mAh', '1000mAh', '1100mAh', '2000mAh', '2500mAh', '3000mAh', 'auto'] }],
  size: () => ({ w: 130, h: 80 }),
  pins: () => [
    { id: 'IN', x: 0, y: 40, label: 'IN', aliases: ['VIN+', '+'] },
    { id: 'OUT', x: 130, y: 40, label: 'OUT', aliases: ['VIN-', '-'] },
  ],
  render: ({ state }) => {
    const hist: number[] = state.hist ?? [];
    const max = Math.max(1e-6, ...hist.map(Math.abs));
    const pts = hist.map((v, i) => `${10 + (i / Math.max(1, hist.length - 1)) * 110},${58 - (Math.abs(v) / max) * 34}`).join(' ');
    return (
      <g>
        <g filter="url(#f-shadow)">
          <rect x={4} y={0} width={122} height={80} rx={6} fill="#1c1c1e" />
          <rect x={10} y={20} width={110} height={40} rx={2} fill="#0b0b0d" />
          {pts && <polyline points={pts} fill="none" stroke="#30d158" strokeWidth={1} />}
          <text x={12} y={13} fontFamily="'JetBrains Mono', monospace" fontSize={8} fill="#30d158">
            {formatValue(state.i ?? 0, 'A')}
          </text>
          <text x={118} y={13} fontFamily="'JetBrains Mono', monospace" fontSize={6} fill="#8e8e93" textAnchor="end">
            ⌀ {formatValue(state.avg ?? 0, 'A')}
          </text>
          <text x={65} y={72} fontFamily="Inter" fontSize={6} fill="#ffd60a" textAnchor="middle">
            {state.life ?? 'Akkulaufzeit: —'}
          </text>
        </g>
        <path d="M0 40 h4 M126 40 h4" stroke="#888" strokeWidth={2} />
      </g>
    );
  },
  symbol: 'box',
  build(ctx) {
    const sh = ctx.add(new Resistor(ctx.node('IN'), ctx.node('OUT'), 0.01));
    return {
      post(c, dt) {
        const i = sh.current(c.circuit.x);
        c.state.i = i;
        c.state.q = (c.state.q ?? 0) + Math.abs(i) * dt;
        c.state.t = (c.state.t ?? 0) + dt;
        c.state.avg = c.state.q / Math.max(c.state.t, 1e-9);
        c.state.peak = Math.max(c.state.peak ?? 0, Math.abs(i));
        c.state.acc = (c.state.acc ?? 0) + dt;
        if (c.state.acc > 0.02) {
          c.state.acc = 0;
          const h: number[] = c.state.hist ?? [];
          h.push(i);
          while (h.length > 200) h.shift();
          c.state.hist = h;
        }
        let capAh = parseValue(String(c.props.kapazitaet ?? '2000mAh').replace(/mAh/i, 'm'), 2);
        if (c.props.kapazitaet === 'auto') capAh = c.engine.batteryCapacity() ?? 2;
        const hours = capAh / Math.max(c.state.avg, 1e-9);
        c.state.lifeHours = hours;
        c.state.life = `Akkulaufzeit ≈ ${hours > 24 * 60 ? `${(hours / 24 / 365).toFixed(1)} Jahre` : hours > 48 ? `${(hours / 24).toFixed(1)} Tage` : `${hours.toFixed(1)} h`}`;
      },
    };
  },
  info: 'Wird in die Plus-Leitung eingeschleift und zeichnet den Strom über die Zeit auf – zeigt z. B. Deep-Sleep-Phasen und schätzt die Akkulaufzeit aus dem Durchschnittsstrom.',
  price: 25,
  noBom: true,
  height3d: 15,
};

export const IC_PARTS: PartDef[] = [
  ne555,
  lm358,
  hc595,
  gate('74hc00', 'NAND-Gatter 74HC00', (a, b) => 1 - (a & b)),
  gate('74hc08', 'UND-Gatter 74HC08', (a, b) => a & b),
  gate('74hc32', 'ODER-Gatter 74HC32', (a, b) => a | b),
  gate('74hc86', 'XOR-Gatter 74HC86', (a, b) => a ^ b),
  gate('74hc04', 'Inverter 74HC04', (a) => 1 - a, true),
  cd4017,
  eeprom,
  l298n,
  drv8833,
  a4988,
  levelShifter,
  servo('servo', 'Mikroservo SG90', false),
  servo('servo-mg996r', 'Servo MG996R', true),
  stepper,
  multimeter,
  scopeLike('oszilloskop', 'Oszilloskop (4 Kanäle)', ['CH1', 'CH2', 'CH3', 'CH4'], false, 'Zeigt Spannungsverläufe von bis zu 4 Kanälen über die Zeit. Zeitbasis und V/Raster einstellbar.'),
  scopeLike('logikanalysator', 'Logikanalysator (8 Kanäle)', ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'], true, 'Zeichnet 8 digitale Signale gleichzeitig auf – ideal, um Taktsignale, PWM oder Protokolle zu prüfen.'),
  funcGen,
  powerMeter,
];

void Glow;

/** Eigenes IC aus dem Datenblatt-Leser: DIP mit Pinnamen, Ruhestrom zwischen Versorgung und Masse */
export function customIc(def: { type: string; name: string; label: string; pins: string[]; vcc?: string; gnd?: string; strom_mA?: number }): PartDef {
  const names = def.pins.length % 2 ? [...def.pins, 'NC'] : def.pins;
  return dip({
    type: def.type,
    name: def.name,
    category: 'ICs',
    keywords: `${def.name} ${def.label} eigenes bauteil datenblatt`,
    names,
    label: def.label.slice(0, 14),
    sub: 'eigenes Bauteil',
    info: `Eigenes Bauteil aus dem Datenblatt-Leser (${def.label}). Simuliert wird nur der Ruhestrom – die Pins sind für Schaltplan, Platine und Stückliste vollständig.`,
    defaults: {},
    build(ctx) {
      if (def.vcc && def.gnd && names.includes(def.vcc) && names.includes(def.gnd)) ctx.add(new Resistor(ctx.node(def.vcc), ctx.node(def.gnd), 5 / ((def.strom_mA ?? 1) / 1000)));
    },
  });
}
