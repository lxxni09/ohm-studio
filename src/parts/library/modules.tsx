/**
 * Module: Displays, Sensoren, Funk, Eingabegeräte.
 */
import type { ReactNode } from 'react';
import { Diode, diodeFromVf, Resistor, Source, Switch } from '../../sim/mna';
import { Chip, Glow, HeaderPins, Label, Pcb, Lead } from '../svg';
import { PITCH, type BuildCtx, type Behaviour, type Category, type PartDef, type PropDef } from '../types';

/* ------------------------------------------------------------------ */
/* Framebuffer → Bild (Cache)                                          */
/* ------------------------------------------------------------------ */

const fbCache = new Map<string, { v: number; url: string }>();
export function fbImage(key: string, version: number, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): string | null {
  if (typeof document === 'undefined') return null;
  const c = fbCache.get(key);
  if (c && c.v === version) return c.url;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  if (!g) return null;
  draw(g);
  const url = cv.toDataURL();
  fbCache.set(key, { v: version, url });
  return url;
}

/* ------------------------------------------------------------------ */
/* Generisches Modul                                                   */
/* ------------------------------------------------------------------ */

interface ModuleOpts {
  type: string;
  aliases?: string[];
  name: string;
  category: Category;
  keywords: string;
  prefix?: string;
  pins: string[];
  pinAliases?: Record<string, string[]>;
  /** Lage der Stiftleiste */
  side?: 'bottom' | 'top' | 'left' | 'right';
  w: number;
  h: number;
  color?: string;
  defaults?: Record<string, unknown>;
  props?: PropDef[];
  body: (a: { props: Record<string, any>; state: Record<string, any>; id: string; w: number; h: number }) => ReactNode;
  vcc?: string;
  gnd?: string;
  /** Ruhestrom in A */
  iq?: number;
  minV?: number;
  extra?: (ctx: BuildCtx) => Behaviour | void;
  info: string;
  price: number;
  height3d?: number;
  labels?: boolean;
  bom?: (p: Record<string, any>) => string;
  areas?: PartDef['areas'];
  interaction?: PartDef['interaction'];
  noPcb?: boolean;
}

function headerPos(o: ModuleOpts) {
  const n = o.pins.length;
  const side = o.side ?? 'bottom';
  return o.pins.map((id, i) => {
    let x: number;
    let y: number;
    if (side === 'bottom' || side === 'top') {
      x = Math.round((o.w - (n - 1) * PITCH) / 2 / 5) * 5 + i * PITCH;
      y = side === 'bottom' ? o.h - 5 : 5;
    } else {
      y = Math.round((o.h - (n - 1) * PITCH) / 2 / 5) * 5 + i * PITCH;
      x = side === 'left' ? 5 : o.w - 5;
    }
    return { id, x, y, label: id, aliases: o.pinAliases?.[id] };
  });
}

export function modulePart(o: ModuleOpts): PartDef {
  const pins = headerPos(o);
  const side = o.side ?? 'bottom';
  return {
    type: o.type,
    aliases: o.aliases,
    name: o.name,
    category: o.category,
    keywords: o.keywords,
    prefix: o.prefix ?? 'U',
    defaults: o.defaults ?? {},
    props: o.props,
    size: () => ({ w: o.w, h: o.h }),
    pins: () => pins,
    render: ({ props, state, id }) => (
      <g>
        {o.noPcb ? null : <Pcb w={o.w} h={o.h} color={o.color ?? '#1f5fbf'} />}
        {o.body({ props, state, id, w: o.w, h: o.h })}
        <HeaderPins pins={pins} />
        {o.labels !== false &&
          pins.map((p) => (
            <Label
              key={p.id}
              x={side === 'left' ? p.x + 8 : side === 'right' ? p.x - 8 : p.x}
              y={side === 'bottom' ? p.y - 9 : side === 'top' ? p.y + 9 : p.y}
              size={3.3}
              anchor={side === 'left' ? 'start' : side === 'right' ? 'end' : 'middle'}
              color="#fff"
              rotate={side === 'bottom' || side === 'top' ? (p.id.length > 3 ? -90 : 0) : 0}
            >
              {p.id}
            </Label>
          ))}
      </g>
    ),
    symbol: 'box',
    build(ctx) {
      const vcc = o.vcc ?? pins.find((p) => /^(VCC|VIN|\+|3V3|5V|VDD|V\+)$/i.test(p.id))?.id;
      const gnd = o.gnd ?? pins.find((p) => /^(GND|-|VSS|G)$/i.test(p.id))?.id;
      let load: Resistor | null = null;
      if (vcc && gnd && o.iq) load = ctx.add(new Resistor(ctx.node(vcc), ctx.node(gnd), 3.3 / o.iq));
      const beh = o.extra?.(ctx) ?? {};
      return {
        pre(c, dt) {
          if (vcc && gnd) {
            const v = c.v(vcc) - c.v(gnd);
            c.state.vcc = v;
            c.state.powered = v > (o.minV ?? 2.6);
            if (v > 6.5 && !c.state.warnedV && !/12V|VIN/.test(vcc)) {
              c.state.warnedV = true;
              c.warn(`${c.id}: ${v.toFixed(1)} V an ${vcc} ist zu viel für dieses Modul (max. ~5,5 V).`, 'error');
            }
            if (load) load.r = Math.max(v, 1) / o.iq!;
          } else c.state.powered = true;
          beh.pre?.(c, dt);
        },
        post: beh.post,
      };
    },
    info: o.info,
    price: o.price,
    height3d: o.height3d ?? 6,
    bom: o.bom,
    areas: o.areas,
    interaction: o.interaction,
  };
}

/** Ausgang eines Moduls als Spannungsquelle (Push-Pull) */
function driveOut(ctx: BuildCtx, pin: string, gnd: string, r = 100): (c: BuildCtx, level: number) => void {
  const s = ctx.add(new Source(ctx.node(pin), ctx.node(gnd), 0, r));
  return (c, level) => {
    if (Math.abs(s.v - level) > 1e-4) {
      s.v = level;
      c.engine.markDirty();
    }
  };
}

/* ------------------------------------------------------------------ */
/* Displays                                                            */
/* ------------------------------------------------------------------ */

function lcd(rows: number, cols: number): PartDef {
  const cw = 13;
  const chH = 20;
  const w = cols * cw + 60;
  const h = rows * chH + 64;
  return modulePart({
    type: rows === 2 ? 'lcd1602' : 'lcd2004',
    aliases: rows === 2 ? ['lcd', 'lcd-1602', 'lcd16x2', 'lcd1602-i2c'] : ['lcd-2004', 'lcd20x4', 'lcd2004-i2c'],
    name: rows === 2 ? 'LCD 16×2 (I²C)' : 'LCD 20×4 (I²C)',
    category: 'Displays',
    keywords: `lcd display text zeichen ${rows === 2 ? '1602 16x2' : '2004 20x4'} i2c hd44780`,
    prefix: 'LCD',
    pins: ['GND', 'VCC', 'SDA', 'SCL'],
    side: 'left',
    w,
    h,
    color: '#1d6b33',
    defaults: { adresse: '0x27', farbe: 'blau' },
    props: [
      { key: 'adresse', label: 'I²C-Adresse', type: 'select', options: ['0x27', '0x3F'] },
      { key: 'farbe', label: 'Hintergrund', type: 'select', options: ['blau', 'gruen'] },
    ],
    iq: 0.025,
    minV: 4.0,
    body: ({ props, state }) => {
      const lines: string[] = state.lines ?? Array.from({ length: rows }, () => ' '.repeat(cols));
      const blue = props.farbe !== 'gruen';
      const on = state.powered;
      const bl = on && state.backlight !== false;
      const bg = blue ? (bl ? '#2f6cf0' : '#1b2f66') : bl ? '#b8d04a' : '#5e6b2a';
      const fg = blue ? '#f2f6ff' : '#14200a';
      return (
        <g>
          <rect x={22} y={14} width={w - 34} height={h - 28} rx={2} fill="#121212" />
          <rect x={28} y={20} width={w - 46} height={h - 40} rx={1.5} fill={bg} />
          {bl && <rect x={28} y={20} width={w - 46} height={h - 40} rx={1.5} fill="#fff" opacity={0.06} />}
          {lines.map((ln, r) =>
            ln.split('').map((ch, c) => (
              <g key={`${r}-${c}`}>
                <rect x={34 + c * cw} y={26 + r * chH} width={cw - 2} height={chH - 3} fill={blue ? '#3f7af5' : '#a9c242'} opacity={on ? 0.45 : 0.2} />
                {on && ch !== ' ' && (
                  <text x={34 + c * cw + (cw - 2) / 2} y={26 + r * chH + (chH - 3) / 2 + 1} fontSize={14} fontFamily="'JetBrains Mono', monospace" fill={fg} textAnchor="middle" dominantBaseline="middle" style={{ letterSpacing: 0 }}>
                    {ch}
                  </text>
                )}
              </g>
            )),
          )}
          <rect x={28} y={20} width={w - 46} height={(h - 40) / 2} fill="url(#g-gloss)" opacity={0.5} />
          <Chip x={w - 40} y={h - 12} w={18} h={8} legs={0} />
        </g>
      );
    },
    info: `${cols} Zeichen × ${rows} Zeilen mit I²C-Adapter (PCF8574): nur 4 Kabel. Bibliothek LiquidCrystal_I2C, Adresse meist 0x27. Braucht 5 V für guten Kontrast.`,
    price: rows === 2 ? 3.5 : 6,
    height3d: 12,
  });
}

function oled(type: 'ssd1306' | 'sh1106', inch: string): PartDef {
  const w = type === 'ssd1306' ? 108 : 140;
  const h = type === 'ssd1306' ? 108 : 128;
  return modulePart({
    type,
    aliases: type === 'ssd1306' ? ['oled', 'oled-0.96', 'oled-128x64', 'ssd1306-i2c'] : ['oled-1.3', 'sh1106-i2c'],
    name: `OLED ${inch}″ ${type.toUpperCase()}`,
    category: 'Displays',
    keywords: `oled display grafik ${type} 128x64 i2c`,
    prefix: 'DISP',
    pins: ['GND', 'VCC', 'SCL', 'SDA'],
    side: 'top',
    w,
    h,
    color: '#1d3f8f',
    defaults: { farbe: 'weiss' },
    props: [{ key: 'farbe', label: 'Pixelfarbe', type: 'select', options: ['weiss', 'blau', 'gelb-blau'] }],
    iq: 0.012,
    body: ({ props, state, id }) => {
      const sx = 8;
      const sy = 22;
      const sw = w - 16;
      const sh = sw / 2;
      const col = props.farbe === 'blau' ? '#5ac8ff' : '#eef6ff';
      const fbW = state.w ?? 128;
      const fbH = state.h ?? 64;
      const url =
        state.powered && state.fb
          ? fbImage(id + type, state.version ?? 0, fbW, fbH, (g) => {
              const img = g.createImageData(fbW, fbH);
              const fb: Uint8Array = state.fb;
              for (let i = 0; i < fbW * fbH; i++) {
                if (!fb[i]) continue;
                const y = Math.floor(i / fbW);
                const yb = props.farbe === 'gelb-blau' && y < 16;
                const c = yb ? [255, 214, 70] : props.farbe === 'blau' ? [90, 200, 255] : [238, 246, 255];
                img.data.set([...c, 255], i * 4);
              }
              g.putImageData(img, 0, 0);
            })
          : null;
      return (
        <g>
          <rect x={sx - 3} y={sy - 3} width={sw + 6} height={sh + 14} rx={1.5} fill="#0c0c0e" />
          <rect x={sx} y={sy} width={sw} height={sh} fill="#050507" />
          {url && <image href={url} x={sx} y={sy} width={sw} height={sh} style={{ imageRendering: 'pixelated' }} />}
          {url && <rect x={sx} y={sy} width={sw} height={sh} fill={col} opacity={0.04} filter="url(#f-glow-s)" />}
          <rect x={sx} y={sy} width={sw} height={sh / 2} fill="url(#g-gloss)" opacity={0.25} />
          <rect x={w / 2 - 14} y={sy + sh + 4} width={28} height={5} fill="#c9a227" opacity={0.6} />
        </g>
      );
    },
    info: '128×64 Pixel, selbstleuchtend (kein Hintergrundlicht nötig), sehr kontrastreich. I²C-Adresse 0x3C. Bibliothek Adafruit_SSD1306 + Adafruit_GFX.',
    price: type === 'ssd1306' ? 3 : 5,
    height3d: 4,
  });
}

function tft(type: 'ili9341' | 'st7789'): PartDef {
  const big = type === 'ili9341';
  const w = big ? 180 : 130;
  const h = big ? 250 : 160;
  return modulePart({
    type,
    aliases: big ? ['tft', 'tft-2.8', 'ili9341-spi'] : ['tft-1.3', 'st7789-spi', 'tft-240'],
    name: big ? 'TFT 2,8″ ILI9341 (240×320)' : 'TFT 1,3″ ST7789 (240×240)',
    category: 'Displays',
    keywords: `tft farbdisplay spi ${type} lcd farbe`,
    prefix: 'DISP',
    pins: big ? ['VCC', 'GND', 'CS', 'RST', 'DC', 'MOSI', 'SCK', 'LED', 'MISO'] : ['GND', 'VCC', 'SCL', 'SDA', 'RES', 'DC', 'BLK'],
    side: 'top',
    w,
    h,
    color: '#b71c1c',
    iq: 0.04,
    body: ({ state, id }) => {
      const sx = 10;
      const sy = 22;
      const sw = w - 20;
      const sh = h - 34;
      const W = big ? 240 : 240;
      const H = big ? 320 : 240;
      const url =
        state.powered && state.ops
          ? fbImage(id + type, state.version ?? 0, W, H, (g) => {
              const c565 = (c: number) => `rgb(${((c >> 11) & 31) * 8},${((c >> 5) & 63) * 4},${(c & 31) * 8})`;
              for (const op of state.ops as any[]) {
                if (op[0] === 'fill') {
                  g.fillStyle = c565(op[1]);
                  g.fillRect(0, 0, W, H);
                } else if (op[0] === 'rect') {
                  g.fillStyle = g.strokeStyle = c565(op[5]);
                  if (op[6]) g.fillRect(op[1], op[2], op[3], op[4]);
                  else g.strokeRect(op[1] + 0.5, op[2] + 0.5, op[3] - 1, op[4] - 1);
                } else if (op[0] === 'circle') {
                  g.fillStyle = g.strokeStyle = c565(op[4]);
                  g.beginPath();
                  g.arc(op[1], op[2], op[3], 0, Math.PI * 2);
                  if (op[5]) g.fill();
                  else g.stroke();
                } else if (op[0] === 'line') {
                  g.strokeStyle = c565(op[5]);
                  g.beginPath();
                  g.moveTo(op[1], op[2]);
                  g.lineTo(op[3], op[4]);
                  g.stroke();
                } else if (op[0] === 'text') {
                  g.fillStyle = c565(op[4]);
                  g.font = `${8 * op[5]}px monospace`;
                  g.textBaseline = 'top';
                  g.fillText(op[3], op[1], op[2]);
                }
              }
            })
          : null;
      return (
        <g>
          <rect x={sx - 3} y={sy - 3} width={sw + 6} height={sh + 6} rx={2} fill="#0b0b0b" />
          <rect x={sx} y={sy} width={sw} height={sh} fill={state.powered ? '#f6f6f6' : '#151515'} />
          {url && <image href={url} x={sx} y={sy} width={sw} height={sh} />}
          <rect x={sx} y={sy} width={sw} height={sh / 2} fill="url(#g-gloss)" opacity={0.3} />
        </g>
      );
    },
    info: 'Farbdisplay mit SPI-Anschluss. Bibliothek Adafruit_ILI9341 bzw. Adafruit_ST7789 (TFT_eSPI wird noch nicht simuliert).',
    price: big ? 9 : 5,
    height3d: 5,
  });
}

const epaper = modulePart({
  type: 'epaper',
  aliases: ['e-paper', 'eink', 'e-ink', 'epaper-2.9'],
  name: 'E-Paper 2,9″',
  category: 'Displays',
  keywords: 'epaper eink e-ink elektronisches papier stromsparend',
  prefix: 'DISP',
  pins: ['BUSY', 'RST', 'DC', 'CS', 'CLK', 'DIN', 'GND', 'VCC'],
  side: 'left',
  w: 300,
  h: 140,
  color: '#1b1b1b',
  iq: 0.0001,
  body: ({ state }) => (
    <g>
      <rect x={24} y={8} width={268} height={124} rx={2} fill="#e9e7e1" />
      <rect x={30} y={14} width={256} height={112} fill="#f2f0ea" />
      <text x={158} y={70} textAnchor="middle" dominantBaseline="middle" fontSize={16} fontFamily="Inter" fill="#222">
        {state.text ?? 'E-Paper'}
      </text>
    </g>
  ),
  info: 'Behält das Bild ohne Strom – ideal für Batteriegeräte. Aktualisiert langsam (1–2 s). Bibliothek GxEPD2.',
  price: 14,
  height3d: 2,
});

const SEG_PATHS: Record<string, string> = {
  a: 'M8 4 h16 l-2 3 h-12z',
  b: 'M25 5 l2 2 v13 l-2 2 l-2 -2 v-12z',
  c: 'M25 24 l2 2 v13 l-2 2 l-2 -2 v-12z',
  d: 'M8 43 h16 l-2 -3 h-12z',
  e: 'M7 24 l2 2 v12 l-2 2 l-2 -2 v-13z',
  f: 'M7 5 l2 2 v12 l-2 2 l-2 -2 v-13z',
  g: 'M9 22 h14 l2 1.5 l-2 1.5 h-14 l-2 -1.5z',
};

const sevenSeg: PartDef = {
  type: '7-segment',
  aliases: ['siebensegment', 'seven-segment', '7seg'],
  name: '7-Segment-Anzeige',
  category: 'Displays',
  keywords: '7 segment ziffer anzeige zahl led',
  prefix: 'DS',
  defaults: { farbe: 'rot', gemeinsam: 'kathode' },
  props: [
    { key: 'farbe', label: 'Farbe', type: 'select', options: ['rot', 'gruen', 'blau', 'gelb', 'weiss'] },
    { key: 'gemeinsam', label: 'Gemeinsamer Pin', type: 'select', options: ['kathode', 'anode'] },
  ],
  size: () => ({ w: 50, h: 80 }),
  pins: () => [
    ...['g', 'f', 'COM', 'a', 'b'].map((id, i) => ({ id: id === 'COM' ? 'COM' : id.toUpperCase(), x: 5 + i * PITCH, y: 0, label: id, aliases: id === 'COM' ? ['K', 'A1', 'GND', 'VCC'] : [id] })),
    ...['e', 'd', 'COM2', 'c', 'dp'].map((id, i) => ({ id: id === 'COM2' ? 'COM2' : id.toUpperCase(), x: 5 + i * PITCH, y: 80, label: id === 'COM2' ? 'COM' : id, aliases: [id] })),
  ],
  render: ({ props, state }) => {
    const col = props.farbe === 'gruen' ? '#30ff5a' : props.farbe === 'blau' ? '#2f6bff' : props.farbe === 'gelb' ? '#ffd21f' : props.farbe === 'weiss' ? '#f4f8ff' : '#ff2a1f';
    return (
      <g>
        <g filter="url(#f-shadow)">
          <rect x={0} y={4} width={50} height={72} rx={2} fill="#1a1a1a" />
        </g>
        <g transform="translate(6 12) scale(1.2)">
          {Object.entries(SEG_PATHS).map(([k, d]) => {
            const b = state[`seg_${k}`] ?? 0;
            return (
              <g key={k}>
                <path d={d} fill={b > 0.02 ? col : '#2b2b2b'} opacity={b > 0.02 ? 0.5 + 0.5 * Math.min(1, b) : 1} />
                {b > 0.05 && <path d={d} fill={col} opacity={0.6 * Math.min(1, b)} filter="url(#f-glow-s)" />}
              </g>
            );
          })}
          <circle cx={30} cy={42} r={1.8} fill={(state.seg_dp ?? 0) > 0.02 ? col : '#2b2b2b'} />
        </g>
      </g>
    );
  },
  bridges: () => [['COM', 'COM2']],
  symbol: 'box',
  build(ctx) {
    const ca = ctx.props.gemeinsam === 'anode';
    const vf = ctx.props.farbe === 'blau' || ctx.props.farbe === 'weiss' ? 3.0 : 2.0;
    const ds = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'].map((s) => ({
      s,
      d: ctx.add(ca ? new Diode(ctx.node('COM'), ctx.node(s), { ...diodeFromVf(vf, 0.01, 2.2, 5), rs: 10 }) : new Diode(ctx.node(s), ctx.node('COM'), { ...diodeFromVf(vf, 0.01, 2.2, 5), rs: 10 })),
    }));
    return {
      post(c) {
        for (const { s, d } of ds) c.state[`seg_${s.toLowerCase()}`] = d.i > 1e-5 ? Math.min(1.2, Math.pow(d.i / 0.01, 0.55)) : 0;
      },
    };
  },
  info: 'Sieben LED-Segmente (a–g) plus Punkt. Jedes Segment braucht einen Vorwiderstand. Gemeinsame Kathode an GND, Segmente mit HIGH einschalten.',
  price: 0.4,
  height3d: 8,
};

const tm1637 = modulePart({
  type: 'tm1637',
  aliases: ['4-digit', '7-segment-4', 'tm1637-display'],
  name: '4-stellige Anzeige TM1637',
  category: 'Displays',
  keywords: 'tm1637 4 stellen 7 segment uhr anzeige',
  prefix: 'DISP',
  pins: ['CLK', 'DIO', 'VCC', 'GND'],
  side: 'right',
  w: 170,
  h: 80,
  iq: 0.02,
  body: ({ state }) => {
    const t: string = state.powered ? state.text ?? '' : '';
    return (
      <g>
        <rect x={8} y={8} width={140} height={64} rx={2} fill="#151515" />
        {[0, 1, 2, 3].map((i) => (
          <text key={i} x={28 + i * 32} y={42} textAnchor="middle" dominantBaseline="middle" fontFamily="'JetBrains Mono', monospace" fontSize={46} fill={t[i] && t[i] !== ' ' ? '#ff3b30' : '#2a1010'} style={{ filter: t[i] && t[i] !== ' ' ? 'drop-shadow(0 0 4px #ff3b30)' : undefined }}>
            {t[i] && t[i] !== ' ' ? t[i] : '8'}
          </text>
        ))}
      </g>
    );
  },
  info: '4 Ziffern mit eigenem Treiberchip – nur 2 Datenleitungen. Bibliothek TM1637Display.',
  price: 1.8,
});

const max7219 = modulePart({
  type: 'max7219',
  aliases: ['led-matrix', 'matrix-8x8', 'max7219-matrix'],
  name: 'LED-Matrix 8×8 MAX7219',
  category: 'Displays',
  keywords: 'led matrix 8x8 max7219 punktmatrix laufschrift',
  prefix: 'DISP',
  pins: ['VCC', 'GND', 'DIN', 'CS', 'CLK'],
  side: 'left',
  w: 140,
  h: 130,
  iq: 0.01,
  body: ({ state }) => {
    const rows: number[] = state.rows ?? new Array(8).fill(0);
    return (
      <g>
        <rect x={24} y={6} width={110} height={118} rx={2} fill="#141414" />
        {Array.from({ length: 8 }, (_, r) =>
          Array.from({ length: 8 }, (_, c) => {
            const on = state.powered && (rows[r] >> (7 - c)) & 1;
            return (
              <g key={`${r}${c}`}>
                <circle cx={34 + c * 13} cy={16 + r * 14} r={5} fill={on ? '#ff3b30' : '#3a1414'} />
                {on ? <circle cx={34 + c * 13} cy={16 + r * 14} r={6} fill="#ff3b30" opacity={0.5} filter="url(#f-glow-s)" /> : null}
              </g>
            );
          }),
        )}
      </g>
    );
  },
  info: '64 LEDs mit Treiber MAX7219 (SPI). Bibliothek LedControl. Mehrere Module lassen sich verketten.',
  price: 2.5,
});

/* ------------------------------------------------------------------ */
/* Sensoren                                                            */
/* ------------------------------------------------------------------ */

const dht = (eleven: boolean): PartDef =>
  modulePart({
    type: eleven ? 'dht11' : 'dht22',
    aliases: eleven ? ['dht-11'] : ['dht-22', 'am2302'],
    name: eleven ? 'DHT11 Temperatur/Feuchte' : 'DHT22 Temperatur/Feuchte',
    category: 'Sensoren',
    keywords: 'temperatur luftfeuchtigkeit feuchte klima dht sensor',
    prefix: 'U',
    pins: ['VCC', 'DATA', 'GND'],
    pinAliases: { VCC: ['+', 'VDD'], DATA: ['OUT', 'S', 'SIG'], GND: ['-'] },
    w: 64,
    h: 88,
    color: '#1f5fbf',
    defaults: { temperatur: 22.5, feuchte: 45 },
    props: [
      { key: 'temperatur', label: 'Temperatur', type: 'range', min: -40, max: 80, step: 0.1, unit: '°C', live: true },
      { key: 'feuchte', label: 'Luftfeuchte', type: 'range', min: 0, max: 100, step: 0.5, unit: '%', live: true },
    ],
    iq: 0.0015,
    body: ({ props }) => (
      <g>
        <rect x={8} y={4} width={48} height={58} rx={3} fill={eleven ? '#2b7be0' : '#f2f2f0'} />
        {Array.from({ length: 6 }, (_, r) =>
          Array.from({ length: 5 }, (_, c) => <rect key={`${r}${c}`} x={13 + c * 8.6} y={9 + r * 8.4} width={5.4} height={4.6} rx={0.6} fill={eleven ? '#174a8f' : '#cfcfcb'} />),
        )}
        <Label x={32} y={70} size={4} color="#fff">
          {Number(props.temperatur).toFixed(1)}°C · {Math.round(props.feuchte)}%
        </Label>
      </g>
    ),
    extra(ctx) {
      ctx.add(new Resistor(ctx.node('DATA'), ctx.node('VCC'), 10000));
      return {
        pre(c) {
          c.state.temperatur = c.props.temperatur;
          c.state.feuchte = c.props.feuchte;
          if (c.realism && eleven) c.state.temperatur = Math.round(c.props.temperatur);
        },
      };
    },
    info: eleven ? 'Einfacher Klimasensor (0–50 °C ±2 °C, 20–90 % ±5 %). Bibliothek DHT, Typ DHT11. Max. 1 Messung pro Sekunde.' : 'Genauer Klimasensor (−40–80 °C ±0,5 °C, 0–100 % ±2 %). Bibliothek „DHT sensor library“, Typ DHT22. Max. alle 2 s messen.',
    price: eleven ? 1.5 : 4,
    height3d: 8,
  });

const bme280 = modulePart({
  type: 'bme280',
  aliases: ['bme-280', 'bmp280'],
  name: 'BME280 Klima/Luftdruck',
  category: 'Sensoren',
  keywords: 'bme280 luftdruck temperatur feuchte höhe barometer i2c',
  pins: ['VIN', 'GND', 'SCL', 'SDA'],
  pinAliases: { VIN: ['VCC', '3V3'] },
  w: 70,
  h: 60,
  color: '#6a1b9a',
  defaults: { temperatur: 21.3, feuchte: 52, druck: 1013 },
  props: [
    { key: 'temperatur', label: 'Temperatur', type: 'range', min: -40, max: 85, step: 0.1, unit: '°C', live: true },
    { key: 'feuchte', label: 'Luftfeuchte', type: 'range', min: 0, max: 100, step: 0.5, unit: '%', live: true },
    { key: 'druck', label: 'Luftdruck', type: 'range', min: 300, max: 1100, step: 0.5, unit: 'hPa', live: true },
  ],
  iq: 0.0001,
  body: () => (
    <g>
      <rect x={30} y={14} width={10} height={10} rx={1} fill="url(#g-metal)" />
      <circle cx={33} cy={17} r={1} fill="#333" />
      <Label x={35} y={34} size={4.5}>
        BME280
      </Label>
    </g>
  ),
  extra: () => ({
    pre(c) {
      Object.assign(c.state, { temperatur: c.props.temperatur, feuchte: c.props.feuchte, druck: c.props.druck });
    },
  }),
  info: 'Präziser Bosch-Sensor für Temperatur, Feuchte und Luftdruck (→ Höhe). I²C-Adresse 0x76/0x77. Bibliothek Adafruit_BME280.',
  price: 4,
  height3d: 3,
});

const ds18b20: PartDef = {
  type: 'ds18b20',
  aliases: ['ds18b20-to92', 'onewire-temp'],
  name: 'DS18B20 Temperatursensor',
  category: 'Sensoren',
  keywords: 'ds18b20 temperatur onewire 1-wire wasserdicht',
  prefix: 'U',
  defaults: { temperatur: 21 },
  props: [{ key: 'temperatur', label: 'Temperatur', type: 'range', min: -55, max: 125, step: 0.0625, unit: '°C', live: true }],
  size: () => ({ w: 20, h: 30 }),
  pins: () => [
    { id: 'GND', x: 0, y: 30, label: 'GND' },
    { id: 'DQ', x: 10, y: 30, label: 'DQ', aliases: ['DATA', 'OUT'] },
    { id: 'VDD', x: 20, y: 30, label: 'VDD', aliases: ['VCC', '+'] },
  ],
  render: ({ props }) => (
    <g>
      {[0, 10, 20].map((x) => (
        <Lead key={x} x1={x} y1={30} x2={6 + x * 0.4} y2={14} />
      ))}
      <g filter="url(#f-shadow)">
        <path d="M0 14 V4 a10 6 0 0 1 20 0 V14z" fill="#1d1d1f" />
        <Label x={10} y={8} size={2.8} color="#ccc">
          18B20
        </Label>
      </g>
      <Label x={10} y={-6} size={3.6} color="var(--muted)">
        {Number(props.temperatur).toFixed(1)} °C
      </Label>
    </g>
  ),
  symbol: 'box',
  build(ctx) {
    ctx.add(new Resistor(ctx.node('VDD'), ctx.node('GND'), 3.3 / 0.001));
    return {
      pre(c) {
        c.state.powered = c.v('VDD') - c.v('GND') > 2.8;
        c.state.temperatur = c.props.temperatur;
      },
    };
  },
  info: '1-Wire-Temperatursensor (−55–125 °C, ±0,5 °C). Braucht einen 4,7-kΩ-Pull-up an DQ. Bibliotheken OneWire + DallasTemperature.',
  price: 1.5,
  height3d: 5,
};

const hcsr04 = modulePart({
  type: 'hc-sr04',
  aliases: ['ultraschall', 'hcsr04', 'ultrasonic'],
  name: 'Ultraschall HC-SR04',
  category: 'Sensoren',
  keywords: 'ultraschall entfernung abstand distanz sonar hc-sr04',
  pins: ['VCC', 'TRIG', 'ECHO', 'GND'],
  w: 180,
  h: 80,
  color: '#1f5fbf',
  defaults: { entfernung: 50 },
  props: [{ key: 'entfernung', label: 'Entfernung', type: 'range', min: 2, max: 400, step: 1, unit: 'cm', live: true }],
  iq: 0.015,
  minV: 4.0,
  body: ({ props }) => (
    <g>
      {[42, 138].map((x) => (
        <g key={x}>
          <circle cx={x} cy={34} r={30} fill="url(#g-metal)" />
          <circle cx={x} cy={34} r={24} fill="#2a2a2a" />
          <circle cx={x} cy={34} r={24} fill="none" stroke="#555" strokeDasharray="1.5 2" strokeWidth={8} opacity={0.6} />
        </g>
      ))}
      <rect x={78} y={8} width={24} height={10} rx={4} fill="url(#g-metal)" />
      <Label x={90} y={54} size={4.5}>
        {Math.round(props.entfernung)} cm
      </Label>
    </g>
  ),
  info: 'Misst Entfernungen von 2–400 cm per Ultraschall: TRIG 10 µs HIGH, dann ist ECHO so lange HIGH, wie der Schall braucht (58 µs pro cm). Braucht 5 V!',
  price: 1.5,
  height3d: 15,
});

const pir = modulePart({
  type: 'pir',
  aliases: ['hc-sr501', 'bewegungsmelder', 'pir-sensor'],
  name: 'Bewegungsmelder PIR (HC-SR501)',
  category: 'Sensoren',
  keywords: 'pir bewegung bewegungsmelder infrarot hc-sr501',
  pins: ['VCC', 'OUT', 'GND'],
  w: 128,
  h: 128,
  color: '#2e7d32',
  defaults: { bewegung: false },
  props: [{ key: 'bewegung', label: 'Bewegung erkannt', type: 'bool', live: true }],
  iq: 0.00006,
  minV: 4.5,
  interaction: { kind: 'toggle', area: { x: 14, y: 4, w: 100, h: 100 }, label: 'Bewegung', key: 'bewegung' },
  body: ({ props }) => (
    <g>
      <circle cx={64} cy={56} r={50} fill="#f2f2f0" />
      {Array.from({ length: 5 }, (_, r) => (
        <circle key={r} cx={64} cy={56} r={10 + r * 9} fill="none" stroke="#ddd" />
      ))}
      <circle cx={64} cy={56} r={50} fill="url(#g-dome)" opacity={0.6} />
      {props.bewegung && <circle cx={64} cy={56} r={52} fill="none" stroke="#ff9f0a" strokeWidth={3} opacity={0.8} />}
    </g>
  ),
  extra(ctx) {
    const out = driveOut(ctx, 'OUT', 'GND', 200);
    return {
      pre(c) {
        out(c, c.state.powered && c.props.bewegung ? 3.3 : 0);
      },
    };
  },
  info: 'Erkennt Wärmebewegung bis ~7 m. Ausgang wird bei Bewegung 3,3 V HIGH (Haltezeit per Poti). Versorgung 5–20 V.',
  price: 1.5,
  height3d: 25,
});

const mpu6050 = modulePart({
  type: 'mpu6050',
  aliases: ['gy-521', 'mpu-6050', 'beschleunigung', 'gyro'],
  name: 'MPU6050 Beschleunigung/Gyro',
  category: 'Sensoren',
  keywords: 'mpu6050 beschleunigung gyroskop lage neigung imu i2c',
  pins: ['VCC', 'GND', 'SCL', 'SDA', 'XDA', 'XCL', 'AD0', 'INT'],
  w: 90,
  h: 60,
  color: '#1f5fbf',
  defaults: { neigung_x: 0, neigung_y: 0 },
  props: [
    { key: 'neigung_x', label: 'Neigung X', type: 'range', min: -90, max: 90, step: 1, unit: '°', live: true },
    { key: 'neigung_y', label: 'Neigung Y', type: 'range', min: -90, max: 90, step: 1, unit: '°', live: true },
  ],
  iq: 0.004,
  body: () => (
    <g>
      <Chip x={36} y={14} w={18} h={18} label="MPU" legs={6} legSide="four" />
      <path d="M20 40 h14 M27 33 v14" stroke="#fff" strokeWidth={0.8} opacity={0.7} />
      <Label x={60} y={42} size={3.5}>
        GY-521
      </Label>
    </g>
  ),
  extra: () => ({
    pre(c) {
      const ax = (Number(c.props.neigung_x) * Math.PI) / 180;
      const ay = (Number(c.props.neigung_y) * Math.PI) / 180;
      Object.assign(c.state, { ax: 9.81 * Math.sin(ax), ay: 9.81 * Math.sin(ay), az: 9.81 * Math.cos(ax) * Math.cos(ay), gx: 0, gy: 0, gz: 0, temperatur: 24 });
    },
  }),
  info: '3-Achsen-Beschleunigungssensor + 3-Achsen-Gyroskop (I²C 0x68). Bibliothek Adafruit_MPU6050.',
  price: 2.5,
  height3d: 3,
});

const hall = modulePart({
  type: 'hall',
  aliases: ['hallsensor', 'ky-003', 'a3144', 'hall-sensor'],
  name: 'Hall-Sensor (KY-003)',
  category: 'Sensoren',
  keywords: 'hall magnet magnetfeld sensor a3144',
  pins: ['GND', 'VCC', 'OUT'],
  pinAliases: { OUT: ['S', 'SIG', 'DO'], GND: ['-'], VCC: ['+'] },
  w: 50,
  h: 70,
  color: '#1d1d1f',
  defaults: { reichweite: 10 },
  props: [{ key: 'reichweite', label: 'Schaltabstand', type: 'number', unit: 'mm' }],
  iq: 0.004,
  body: ({ state }) => (
    <g>
      <rect x={18} y={6} width={14} height={10} rx={1} fill="#1d1d1f" stroke="#555" />
      <circle cx={38} cy={36} r={3} fill={state.near ? '#ff3b30' : '#401010'} />
      {state.near && <Glow cx={38} cy={36} r={3} color="#ff3b30" intensity={0.8} />}
    </g>
  ),
  extra(ctx) {
    ctx.add(new Resistor(ctx.node('OUT'), ctx.node('VCC'), 10000));
    const sw = ctx.add(new Switch(ctx.node('OUT'), ctx.node('GND'), false, 20));
    return {
      pre(c) {
        const d = c.engine.distanceTo(c.id, ['magnet']);
        const near = d !== null && d < Number(c.props.reichweite ?? 10) / 0.254 && c.state.powered;
        c.state.near = near;
        if (near !== sw.closed) {
          sw.closed = near;
          c.engine.markDirty();
        }
      },
    };
  },
  info: 'Digitaler Hall-Sensor: OUT geht auf LOW, wenn ein Magnet (Südpol) nahe ist. Ziehe den Magneten heran!',
  price: 0.8,
});

const mic = modulePart({
  type: 'mikrofon',
  aliases: ['ky-038', 'mic', 'microphone', 'schallsensor'],
  name: 'Mikrofon-Modul (KY-038)',
  category: 'Sensoren',
  keywords: 'mikrofon schall lautstärke klatschen sound',
  pins: ['AO', 'GND', 'VCC', 'DO'],
  pinAliases: { AO: ['A0', 'AOUT'], DO: ['D0', 'DOUT'] },
  w: 50,
  h: 90,
  color: '#1f5fbf',
  defaults: { lautstaerke: 10, schwelle: 60 },
  props: [
    { key: 'lautstaerke', label: 'Lautstärke', type: 'range', min: 0, max: 100, step: 1, unit: '%', live: true },
    { key: 'schwelle', label: 'Schwelle (Poti)', type: 'range', min: 0, max: 100, step: 1, unit: '%' },
  ],
  iq: 0.004,
  body: () => (
    <g>
      <circle cx={25} cy={20} r={12} fill="url(#g-metal)" />
      <circle cx={25} cy={20} r={9} fill="#2a2a2a" />
      <rect x={12} y={38} width={10} height={12} fill="#2563eb" />
      <circle cx={17} cy={42} r={2} fill="#e7d9a5" />
    </g>
  ),
  extra(ctx) {
    const ao = driveOut(ctx, 'AO', 'GND', 1000);
    const dout = driveOut(ctx, 'DO', 'GND', 1000);
    ctx.engine.dynamic = true;
    return {
      pre(c) {
        const vcc = c.state.powered ? c.state.vcc : 0;
        const amp = Number(c.props.lautstaerke) / 100;
        const noise = (Math.random() - 0.5) * amp;
        ao(c, vcc * (0.5 + 0.45 * noise * 2));
        dout(c, amp * 100 > Number(c.props.schwelle) ? 0 : vcc);
      },
    };
  },
  info: 'Elektret-Mikrofon mit Verstärker: AO liefert das Signal um VCC/2, DO schaltet ab einer per Poti eingestellten Lautstärke (LOW-aktiv).',
  price: 1,
});

const soil = modulePart({
  type: 'bodenfeuchte',
  aliases: ['soil-moisture', 'feuchtigkeitssensor', 'bodenfeuchtesensor', 'capacitive-soil'],
  name: 'Bodenfeuchtesensor (kapazitiv)',
  category: 'Sensoren',
  keywords: 'boden feuchte pflanze gießen erde sensor kapazitiv',
  pins: ['GND', 'VCC', 'AOUT'],
  pinAliases: { AOUT: ['AO', 'A0', 'OUT', 'SIG'] },
  side: 'top',
  w: 90,
  h: 380,
  color: '#1d1d1f',
  defaults: { feuchte: 40 },
  props: [{ key: 'feuchte', label: 'Bodenfeuchte', type: 'range', min: 0, max: 100, step: 1, unit: '%', live: true }],
  iq: 0.005,
  body: ({ props }) => (
    <g>
      <rect x={25} y={30} width={40} height={30} rx={2} fill="#2b2b2b" />
      <Chip x={35} y={36} w={20} h={16} label="555" legs={4} />
      <rect x={0} y={150} width={90} height={230} fill="#6b4a2b" opacity={0.25 + Number(props.feuchte) / 200} />
      <Label x={45} y={120} size={6}>
        {Math.round(props.feuchte)} %
      </Label>
    </g>
  ),
  extra(ctx) {
    const ao = driveOut(ctx, 'AOUT', 'GND', 1000);
    return {
      pre(c) {
        const f = Number(c.props.feuchte) / 100;
        const v = c.state.powered ? (2.9 - 1.6 * f) * Math.min(1, c.state.vcc / 3.3) : 0;
        ao(c, v);
      },
    };
  },
  info: 'Misst die Bodenfeuchte kapazitiv (korrosionsfrei). Trocken ≈ 2,9 V, nass ≈ 1,3 V an AOUT – also: niedriger Wert = feuchter Boden.',
  price: 1.5,
  height3d: 2,
});

const temt6000 = modulePart({
  type: 'lichtsensor',
  aliases: ['temt6000', 'light-sensor', 'helligkeitssensor'],
  name: 'Lichtsensor TEMT6000',
  category: 'Sensoren',
  keywords: 'licht helligkeit lux sensor analog',
  pins: ['VCC', 'GND', 'SIG'],
  pinAliases: { SIG: ['OUT', 'AO'] },
  w: 50,
  h: 50,
  color: '#1f5fbf',
  defaults: { lux: 300 },
  props: [{ key: 'lux', label: 'Helligkeit', type: 'range', min: 0, max: 1000, step: 1, unit: 'lx', live: true }],
  iq: 0.0002,
  body: () => <rect x={20} y={12} width={10} height={8} rx={1} fill="#1d1d1f" />,
  extra(ctx) {
    const o = driveOut(ctx, 'SIG', 'GND', 10000);
    return { pre: (c) => o(c, c.state.powered ? Math.min(c.state.vcc, (Number(c.props.lux) / 1000) * c.state.vcc) : 0) };
  },
  info: 'Analoger Lichtsensor: Ausgangsspannung steigt linear mit der Helligkeit (0–1000 lx).',
  price: 1.5,
});

const gas = modulePart({
  type: 'mq-2',
  aliases: ['gassensor', 'mq2', 'mq-135', 'gas-sensor'],
  name: 'Gassensor MQ-2',
  category: 'Sensoren',
  keywords: 'gas rauch sensor mq2 mq135 luftqualität',
  pins: ['VCC', 'GND', 'DO', 'AO'],
  w: 80,
  h: 90,
  color: '#1f5fbf',
  defaults: { ppm: 200, schwelle: 1000 },
  props: [
    { key: 'ppm', label: 'Gaskonzentration', type: 'range', min: 0, max: 10000, step: 10, unit: 'ppm', live: true },
    { key: 'schwelle', label: 'Alarmschwelle (Poti)', type: 'number', unit: 'ppm' },
  ],
  iq: 0.15,
  minV: 4.5,
  body: () => (
    <g>
      <circle cx={40} cy={35} r={24} fill="url(#g-metal)" />
      <circle cx={40} cy={35} r={18} fill="#999" opacity={0.6} />
      {Array.from({ length: 6 }, (_, i) => (
        <line key={i} x1={24} y1={23 + i * 5} x2={56} y2={23 + i * 5} stroke="#666" strokeWidth={1.2} />
      ))}
    </g>
  ),
  extra(ctx) {
    const ao = driveOut(ctx, 'AO', 'GND', 1000);
    const dout = driveOut(ctx, 'DO', 'GND', 1000);
    return {
      pre(c) {
        const vcc = c.state.powered ? c.state.vcc : 0;
        const p = Number(c.props.ppm);
        ao(c, vcc * Math.min(0.95, 0.1 + 0.25 * Math.log10(1 + p / 50)));
        dout(c, p > Number(c.props.schwelle) ? 0 : vcc);
      },
    };
  },
  info: 'Reagiert auf Rauch, Propan, Methan. Achtung: Die Heizung zieht ~150 mA und braucht 24 h Einbrennzeit. Batteriebetrieb ist kaum möglich!',
  price: 1.8,
  height3d: 20,
});

const gps = modulePart({
  type: 'gps',
  aliases: ['neo-6m', 'gps-modul', 'gy-neo6mv2'],
  name: 'GPS-Modul NEO-6M',
  category: 'Sensoren',
  keywords: 'gps position ort navigation neo6m',
  pins: ['VCC', 'RX', 'TX', 'GND'],
  w: 110,
  h: 90,
  color: '#1f5fbf',
  defaults: { breite: 52.52, laenge: 13.405 },
  props: [
    { key: 'breite', label: 'Breitengrad', type: 'number', live: true },
    { key: 'laenge', label: 'Längengrad', type: 'number', live: true },
  ],
  iq: 0.045,
  body: () => (
    <g>
      <Chip x={35} y={14} w={40} h={40} label="u-blox" sub="NEO-6M" legs={0} />
      <circle cx={18} cy={60} r={6} fill="#e7d9a5" />
    </g>
  ),
  info: 'Satellitennavigation, sendet NMEA-Sätze mit 9600 Baud über TX. Bibliothek TinyGPSPlus (Simulation folgt).',
  price: 6,
});

const rfid = modulePart({
  type: 'rfid-rc522',
  aliases: ['rc522', 'rfid', 'mfrc522', 'nfc'],
  name: 'RFID-Leser RC522',
  category: 'Sensoren',
  keywords: 'rfid nfc karte chip transponder rc522 zugang',
  pins: ['SDA', 'SCK', 'MOSI', 'MISO', 'IRQ', 'GND', 'RST', '3.3V'],
  pinAliases: { '3.3V': ['VCC', '3V3'], SDA: ['SS', 'CS'] },
  w: 160,
  h: 200,
  color: '#1f5fbf',
  defaults: { karte: '' },
  props: [{ key: 'karte', label: 'Karte auflegen', type: 'select', options: [{ value: '', label: '— keine —' }, 'DE AD BE EF', '04 A2 2B 1C', '93 E3 9A 92'], live: true }],
  iq: 0.013,
  body: ({ props }) => (
    <g>
      <rect x={14} y={14} width={132} height={120} rx={4} fill="none" stroke="#d9b45a" strokeWidth={3} />
      <rect x={24} y={24} width={112} height={100} rx={3} fill="none" stroke="#d9b45a" strokeWidth={3} />
      <Chip x={60} y={140} w={30} h={24} label="RC522" legs={8} legSide="four" />
      {props.karte && (
        <g opacity={0.92}>
          <rect x={20} y={30} width={120} height={78} rx={6} fill="#f5f5f7" stroke="#bbb" />
          <Label x={80} y={69} size={7} color="#333">
            {String(props.karte)}
          </Label>
        </g>
      )}
    </g>
  ),
  info: 'Liest 13,56-MHz-RFID-Karten und -Anhänger (MIFARE). Nur 3,3 V! Bibliothek MFRC522. Karte im Inspektor auflegen.',
  price: 3,
  height3d: 4,
});

const joystick = modulePart({
  type: 'joystick',
  aliases: ['ky-023', 'thumbstick', 'analog-joystick'],
  name: 'Joystick-Modul',
  category: 'Ein-/Ausgabe',
  keywords: 'joystick analog steuerung x y taste',
  pins: ['GND', '+5V', 'VRx', 'VRy', 'SW'],
  pinAliases: { '+5V': ['VCC', '5V'], VRx: ['X', 'VRX'], VRy: ['Y', 'VRY'] },
  side: 'right',
  w: 120,
  h: 100,
  color: '#1d1d1f',
  defaults: { x: 0.5, y: 0.5, gedrueckt: false },
  props: [
    { key: 'x', label: 'X', type: 'range', min: 0, max: 1, step: 0.01, live: true },
    { key: 'y', label: 'Y', type: 'range', min: 0, max: 1, step: 0.01, live: true },
    { key: 'gedrueckt', label: 'Gedrückt', type: 'bool', live: true },
  ],
  iq: 0.0005,
  body: ({ props }) => (
    <g>
      <rect x={10} y={10} width={80} height={80} rx={6} fill="#2b2b2b" />
      <circle cx={50 + (Number(props.x) - 0.5) * 30} cy={50 + (Number(props.y) - 0.5) * 30} r={26} fill="#1a1a1a" />
      <circle cx={50 + (Number(props.x) - 0.5) * 30} cy={50 + (Number(props.y) - 0.5) * 30} r={26} fill="url(#g-dome)" opacity={0.5} />
    </g>
  ),
  extra(ctx) {
    const x = driveOut(ctx, 'VRx', 'GND', 5000);
    const y = driveOut(ctx, 'VRy', 'GND', 5000);
    const sw = ctx.add(new Switch(ctx.node('SW'), ctx.node('GND'), false));
    return {
      pre(c) {
        const v = c.state.powered ? c.state.vcc : 0;
        x(c, v * Number(c.props.x));
        y(c, v * Number(c.props.y));
        const p = !!c.props.gedrueckt;
        if (p !== sw.closed) {
          sw.closed = p;
          c.engine.markDirty();
        }
      },
    };
  },
  info: 'Zwei Potis (X/Y) und ein Taster. Mitte = halbe Versorgungsspannung. Taster schaltet SW gegen GND (INPUT_PULLUP nutzen).',
  price: 1.2,
  height3d: 30,
});

const encoder: PartDef = modulePart({
  type: 'drehencoder',
  aliases: ['encoder', 'ky-040', 'rotary-encoder', 'drehgeber'],
  name: 'Drehencoder (KY-040)',
  category: 'Ein-/Ausgabe',
  keywords: 'drehencoder drehgeber encoder rotary menü',
  pins: ['GND', '+', 'SW', 'DT', 'CLK'],
  pinAliases: { '+': ['VCC'] },
  side: 'right',
  w: 90,
  h: 70,
  color: '#1f5fbf',
  iq: 0.0001,
  areas: () => [
    { kind: 'press', key: 'links', area: { x: 2, y: 2, w: 28, h: 66 }, label: '⟲' },
    { kind: 'press', key: 'rechts', area: { x: 46, y: 2, w: 28, h: 66 }, label: '⟳' },
    { kind: 'press', key: 'pressed', area: { x: 30, y: 20, w: 16, h: 30 }, label: 'Drücken' },
  ],
  body: ({ state }) => (
    <g>
      <rect x={18} y={16} width={40} height={40} rx={2} fill="url(#g-metal)" />
      <g transform={`rotate(${(state.pos ?? 0) * 9} 38 36)`}>
        <circle cx={38} cy={36} r={13} fill="#c9cdd1" />
        <rect x={36.5} y={23} width={3} height={13} fill="#555" />
      </g>
      <Label x={10} y={36} size={6} color="#fff">
        ⟲
      </Label>
      <Label x={66} y={36} size={6} color="#fff">
        ⟳
      </Label>
    </g>
  ),
  extra(ctx) {
    ctx.add(new Resistor(ctx.node('CLK'), ctx.node('+'), 10000));
    ctx.add(new Resistor(ctx.node('DT'), ctx.node('+'), 10000));
    const a = ctx.add(new Switch(ctx.node('CLK'), ctx.node('GND'), false));
    const b = ctx.add(new Switch(ctx.node('DT'), ctx.node('GND'), false));
    const sw = ctx.add(new Switch(ctx.node('SW'), ctx.node('GND'), false));
    return {
      pre(c, dt) {
        c.state.phase = c.state.phase ?? 0;
        c.state.pos = c.state.pos ?? 0;
        c.state.acc = (c.state.acc ?? 0) + dt;
        if (c.state.acc > 0.004) {
          c.state.acc = 0;
          const dir = c.state.rechts ? 1 : c.state.links ? -1 : 0;
          if (dir && !c.state.held) {
            c.state.target = (c.state.target ?? c.state.phase) + 4 * dir;
            c.state.held = true;
          }
          if (!dir) c.state.held = false;
          if (c.state.target !== undefined && c.state.target !== c.state.phase) {
            c.state.phase += Math.sign(c.state.target - c.state.phase);
            if (c.state.phase % 4 === 0) c.state.pos += Math.sign(c.state.target - c.state.phase + 0.5) || 0;
          }
        }
        const ph = ((c.state.phase % 4) + 4) % 4;
        const ca = ph === 1 || ph === 2;
        const cb = ph === 2 || ph === 3;
        if (ca !== a.closed || cb !== b.closed || !!c.state.pressed !== sw.closed) {
          a.closed = ca;
          b.closed = cb;
          sw.closed = !!c.state.pressed;
          c.engine.markDirty();
        }
      },
    };
  },
  info: 'Unendlich drehbar mit Rastung: Bei jeder Raste erzeugen CLK und DT zwei versetzte Pulse (Quadratur). Drehrichtung = welches Signal zuerst kommt.',
  price: 1,
  height3d: 20,
});

function keypad(cols: number): PartDef {
  const keys = cols === 4 ? ['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D'] : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
  const pinIds = [...Array.from({ length: 4 }, (_, i) => `R${i + 1}`), ...Array.from({ length: cols }, (_, i) => `C${i + 1}`)];
  const w = cols * 40 + 20;
  const h = 4 * 40 + 40;
  return {
    type: cols === 4 ? 'keypad-4x4' : 'keypad-4x3',
    aliases: cols === 4 ? ['keypad', 'tastenfeld', 'membran-tastatur'] : ['keypad-3x4'],
    name: cols === 4 ? 'Tastenfeld 4×4' : 'Tastenfeld 4×3',
    category: 'Ein-/Ausgabe',
    keywords: 'keypad tastenfeld tastatur pin code matrix',
    prefix: 'KP',
    defaults: {},
    size: () => ({ w, h }),
    pins: () => pinIds.map((id, i) => ({ id, x: w / 2 - ((pinIds.length - 1) * PITCH) / 2 + i * PITCH, y: h, label: id })),
    areas: () => keys.map((k, i) => ({ kind: 'press' as const, key: `key_${k}`, area: { x: 10 + (i % cols) * 40, y: 10 + Math.floor(i / cols) * 40, w: 36, h: 36 }, label: k })),
    render: ({ state }) => (
      <g>
        <g filter="url(#f-shadow)">
          <rect x={0} y={0} width={w} height={h - 20} rx={6} fill="#1d1d1f" />
        </g>
        {keys.map((k, i) => {
          const x = 10 + (i % cols) * 40;
          const y = 10 + Math.floor(i / cols) * 40;
          const p = state[`key_${k}`];
          return (
            <g key={k}>
              <rect x={x} y={y} width={36} height={36} rx={5} fill={/[A-D]/.test(k) ? '#d93a3a' : /[*#]/.test(k) ? '#2b6fd6' : '#f2f2f2'} opacity={p ? 0.75 : 1} />
              <Label x={x + 18} y={y + 18} size={14} color={/[A-D*#]/.test(k) ? '#fff' : '#222'} weight={600}>
                {k}
              </Label>
            </g>
          );
        })}
        <rect x={w / 2 - pinIds.length * 5 - 2} y={h - 22} width={pinIds.length * 10 + 4} height={18} fill="#e6e1d0" opacity={0.6} />
        <HeaderPins pins={pinIds.map((_, i) => ({ x: w / 2 - ((pinIds.length - 1) * PITCH) / 2 + i * PITCH, y: h - 5 }))} />
      </g>
    ),
    symbol: 'box',
    build(ctx) {
      const sws = keys.map((k, i) => ({ k, s: ctx.add(new Switch(ctx.node(`R${Math.floor(i / cols) + 1}`), ctx.node(`C${(i % cols) + 1}`), false, 20)) }));
      return {
        pre(c) {
          let pressed = '';
          for (const { k, s } of sws) {
            const p = !!c.state[`key_${k}`];
            if (p) pressed = k;
            if (p !== s.closed) {
              s.closed = p;
              c.engine.markDirty();
            }
          }
          c.state.pressed = pressed;
        },
      };
    },
    info: 'Matrix-Tastenfeld: Jede Taste verbindet eine Zeile (R) mit einer Spalte (C). Bibliothek Keypad scannt die Matrix.',
    price: 1,
    height3d: 1,
  };
}

/* ------------------------------------------------------------------ */
/* Funk                                                                */
/* ------------------------------------------------------------------ */

const bleBeacon: PartDef = {
  type: 'ble-beacon',
  aliases: ['beacon', 'ibeacon', 'ble-tag', 'schluesselanhaenger', 'tag'],
  name: 'BLE-Beacon-Anhänger',
  category: 'Funk',
  keywords: 'bluetooth ble beacon anhänger schlüssel tag finder nrf52810',
  prefix: 'TAG',
  defaults: { chip: 'nRF52810', mac: 'aa:bb:cc:dd:ee:ff', name: 'Schlüssel', entfernung: 0.5, sendeleistung: -59, intervall: '1s' },
  props: [
    { key: 'name', label: 'Gerätename', type: 'string' },
    { key: 'mac', label: 'MAC-Adresse', type: 'string' },
    { key: 'entfernung', label: 'Entfernung', type: 'range', min: 0.1, max: 30, step: 0.1, unit: 'm', live: true },
    { key: 'sendeleistung', label: 'RSSI bei 1 m', type: 'number', unit: 'dBm' },
    { key: 'aktiv', label: 'Batterie eingelegt', type: 'bool', live: true },
  ],
  size: () => ({ w: 60, h: 70 }),
  pins: () => [],
  render: ({ props, state }) => (
    <g>
      <g filter="url(#f-shadow)">
        <path d="M30 2 a28 28 0 1 1 -0.1 0z" fill="#f5f5f7" />
        <circle cx={30} cy={8} r={4} fill="var(--canvas)" stroke="#ccc" />
        <path d="M30 2 a28 28 0 1 1 -0.1 0z" fill="url(#g-dome)" opacity={0.5} />
        <path d="M24 26 l12 10 l-6 5 v-20 l6 5 l-12 10" stroke="#0A84FF" strokeWidth={2} fill="none" strokeLinejoin="round" />
      </g>
      {props.aktiv !== false && <circle cx={44} cy={46} r={2} fill="#30d158" opacity={state.blink ? 1 : 0.3} />}
      <Label x={30} y={66} size={4} color="var(--muted)">
        {Number(props.entfernung).toFixed(1)} m
      </Label>
    </g>
  ),
  symbol: 'box',
  build: () => ({
    pre(c) {
      c.state.blink = Math.floor(c.time) % 2 === 0 && c.time % 1 < 0.08;
    },
  }),
  info: 'Kleiner Bluetooth-LE-Sender (z. B. nRF52810 mit CR2032), der regelmäßig seine MAC-Adresse aussendet. Ein ESP32 kann per Scan die Signalstärke (RSSI) und damit grob die Entfernung bestimmen.',
  price: 4,
  height3d: 6,
};

const nrf24 = modulePart({
  type: 'nrf24l01',
  aliases: ['nrf24', 'nrf24l01+'],
  name: 'Funkmodul nRF24L01+',
  category: 'Funk',
  keywords: 'funk 2.4ghz nrf24 transceiver',
  pins: ['GND', 'VCC', 'CE', 'CSN', 'SCK', 'MOSI', 'MISO', 'IRQ'],
  side: 'left',
  w: 120,
  h: 90,
  color: '#1b5e20',
  iq: 0.012,
  body: () => (
    <g>
      <Chip x={30} y={30} w={24} h={24} label="nRF24" legs={5} legSide="four" />
      <path d="M70 10 h40 v12 h-36 v12 h36 v12 h-36 v12 h36" stroke="#d9b45a" strokeWidth={3} fill="none" />
    </g>
  ),
  info: '2,4-GHz-Transceiver für Funkstrecken zwischen Mikrocontrollern (bis ~100 m). Nur 3,3 V; 10-µF-Elko an VCC empfohlen.',
  price: 1.5,
});

const lora = modulePart({
  type: 'lora',
  aliases: ['sx1278', 'ra-02', 'lora-sx1276', 'rfm95'],
  name: 'LoRa-Modul SX1278',
  category: 'Funk',
  keywords: 'lora funk langstrecke 433mhz 868mhz sx1276 sx1278',
  pins: ['GND', '3.3V', 'RST', 'DIO0', 'NSS', 'MOSI', 'MISO', 'SCK'],
  side: 'left',
  w: 110,
  h: 110,
  color: '#1f5fbf',
  iq: 0.012,
  body: () => <rect x={30} y={15} width={70} height={80} rx={2} fill="url(#g-metal)" stroke="#888" />,
  info: 'Langstreckenfunk (mehrere km) mit sehr wenig Energie. Bibliothek LoRa (Sandeep Mistry).',
  price: 5,
});

const irRecv = modulePart({
  type: 'ir-empfaenger',
  aliases: ['vs1838b', 'ir-receiver', 'tsop4838'],
  name: 'IR-Empfänger VS1838B',
  category: 'Funk',
  keywords: 'infrarot ir fernbedienung empfänger',
  pins: ['OUT', 'GND', 'VCC'],
  w: 40,
  h: 50,
  noPcb: true,
  iq: 0.001,
  body: () => (
    <g filter="url(#f-shadow)">
      <rect x={6} y={6} width={28} height={28} rx={3} fill="#1d1d1f" />
      <circle cx={20} cy={18} r={9} fill="#2b2b2b" />
      <circle cx={20} cy={18} r={9} fill="url(#g-dome)" opacity={0.4} />
    </g>
  ),
  extra(ctx) {
    const o = driveOut(ctx, 'OUT', 'GND', 1000);
    return { pre: (c) => o(c, c.state.powered ? c.state.vcc : 0) };
  },
  info: 'Empfängt 38-kHz-modulierte IR-Signale von Fernbedienungen. Ausgang im Ruhezustand HIGH.',
  price: 0.5,
});

const router: PartDef = {
  type: 'wlan-router',
  aliases: ['router', 'wifi-router', 'accesspoint'],
  name: 'WLAN-Router (virtuell)',
  category: 'Funk',
  keywords: 'wlan wifi router internet netzwerk',
  prefix: 'NET',
  defaults: { ssid: 'OhmNetz', internet: true },
  props: [
    { key: 'ssid', label: 'SSID', type: 'string' },
    { key: 'internet', label: 'Internetzugang', type: 'bool' },
  ],
  size: () => ({ w: 110, h: 60 }),
  pins: () => [],
  render: ({ props }) => (
    <g>
      <g filter="url(#f-shadow)">
        <rect x={0} y={20} width={110} height={36} rx={8} fill="#f5f5f7" stroke="#d1d1d6" />
        <rect x={14} y={0} width={4} height={24} rx={2} fill="#2c2c2e" />
        <rect x={92} y={0} width={4} height={24} rx={2} fill="#2c2c2e" />
        {[0, 1, 2, 3].map((i) => (
          <circle key={i} cx={30 + i * 12} cy={44} r={2} fill="#30d158" />
        ))}
      </g>
      <Label x={55} y={32} size={5} color="#3a3a3c">
        {String(props.ssid)}
      </Label>
    </g>
  ),
  symbol: 'box',
  info: 'Virtuelles WLAN: Simulierte ESP32/Pico W verbinden sich damit. Mit Internetzugang funktionieren echte HTTP-Anfragen (sofern der Server es erlaubt).',
  noBom: true,
  height3d: 30,
};

export const MODULE_PARTS: PartDef[] = [
  lcd(2, 16),
  lcd(4, 20),
  oled('ssd1306', '0,96'),
  oled('sh1106', '1,3'),
  tft('ili9341'),
  tft('st7789'),
  epaper,
  sevenSeg,
  tm1637,
  max7219,
  dht(false),
  dht(true),
  bme280,
  ds18b20,
  hcsr04,
  pir,
  mpu6050,
  hall,
  mic,
  soil,
  temt6000,
  gas,
  gps,
  rfid,
  joystick,
  encoder,
  keypad(4),
  keypad(3),
  bleBeacon,
  nrf24,
  lora,
  irRecv,
  router,
];

/* ------------------------------------------------------------------ */
/* Adressierbare LEDs (WS2812 / NeoPixel)                               */
/* ------------------------------------------------------------------ */

function neopixel(type: string, name: string, n: number, shape: 'single' | 'ring' | 'strip'): PartDef {
  const w = shape === 'ring' ? 150 : shape === 'strip' ? n * 40 + 20 : 50;
  const h = shape === 'ring' ? 170 : 60;
  const pinIds = ['GND', 'VCC', 'DIN', 'DOUT'];
  const pins = pinIds.map((id, i) => ({ id, x: shape === 'ring' ? 45 + i * PITCH * 2 : 10 + i * PITCH, y: h, label: id, aliases: id === 'VCC' ? ['5V', '+', 'VDD'] : id === 'DIN' ? ['DI', 'IN', 'DATA'] : id === 'GND' ? ['-', 'VSS'] : ['DO', 'OUT'] }));
  const pos = Array.from({ length: n }, (_, i) => {
    if (shape === 'ring') {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return { x: 75 + Math.cos(a) * 56, y: 75 + Math.sin(a) * 56 };
    }
    if (shape === 'strip') return { x: 30 + i * 40, y: 22 };
    return { x: 25, y: 22 };
  });
  return {
    type,
    aliases: shape === 'single' ? ['neopixel', 'ws2812b', 'sk6812'] : shape === 'ring' ? ['neopixel-ring', 'led-ring'] : ['neopixel-strip', 'led-streifen', 'ledstrip'],
    name,
    category: 'Halbleiter',
    keywords: 'neopixel ws2812 rgb adressierbar led streifen ring farbe',
    prefix: 'LED',
    defaults: {},
    size: () => ({ w, h }),
    pins: () => pins,
    render: ({ state }) => {
      const px: number[][] = state.pixels ?? [];
      return (
        <g>
          <g filter="url(#f-shadow)">
            {shape === 'ring' ? (
              <path d="M75 4 a71 71 0 1 1 -0.1 0z M75 32 a43 43 0 1 0 0.1 0z" fill="#1d1d1f" fillRule="evenodd" />
            ) : (
              <rect x={0} y={2} width={w} height={h - 12} rx={shape === 'strip' ? 3 : 6} fill={shape === 'strip' ? '#f2f2f2' : '#1d1d1f'} />
            )}
          </g>
          {pos.map((p, i) => {
            const [r, g, b] = px[i] ?? [0, 0, 0];
            const m = Math.max(r, g, b);
            const col = `rgb(${Math.min(255, (r / (m || 1)) * 255)},${Math.min(255, (g / (m || 1)) * 255)},${Math.min(255, (b / (m || 1)) * 255)})`;
            return (
              <g key={i}>
                <rect x={p.x - 9} y={p.y - 9} width={18} height={18} rx={2} fill="#f5f2ea" stroke="#ccc" strokeWidth={0.5} />
                <circle cx={p.x} cy={p.y} r={6} fill={m > 3 ? col : '#ddd8cc'} opacity={m > 3 ? 0.5 + (0.5 * m) / 255 : 1} />
                {m > 3 && <Glow cx={p.x} cy={p.y} r={7} color={col} intensity={Math.min(1, m / 160)} />}
              </g>
            );
          })}
          <HeaderPins pins={pins} />
          {pins.map((p) => (
            <Label key={p.id} x={p.x} y={p.y - 9} size={3.2} color={shape === 'strip' ? '#555' : '#fff'}>
              {p.id}
            </Label>
          ))}
        </g>
      );
    },
    symbol: 'box',
    build(ctx) {
      // Ruhestrom ~1 mA je LED, bei Licht bis 60 mA je LED
      const load = ctx.add(new Resistor(ctx.node('VCC'), ctx.node('GND'), 5 / (0.001 * n)));
      ctx.add(new Resistor(ctx.node('DIN'), ctx.node('GND'), 1e6));
      return {
        pre(c) {
          const v = c.v('VCC') - c.v('GND');
          c.state.powered = v > 3;
          if (!c.state.powered && c.state.pixels) c.state.pixels = [];
          const px: number[][] = c.state.pixels ?? [];
          const i = px.reduce((a, [r, g, b]) => a + ((r + g + b) / 765) * 0.06, 0) + 0.001 * n;
          const r = Math.max(v, 1) / i;
          if (Math.abs(r - load.r) > r * 0.01) {
            load.r = r;
            c.engine.markDirty();
          }
        },
      };
    },
    info: `${n === 1 ? 'Eine' : n} RGB-LED${n > 1 ? 's' : ''} mit eingebautem Treiber – alle über eine einzige Datenleitung (DIN) steuerbar. Bibliothek Adafruit_NeoPixel. Achtung: bis 60 mA je LED bei vollem Weiß!`,
    price: shape === 'single' ? 0.3 : shape === 'ring' ? 4 : 3,
    height3d: 2,
  };
}

MODULE_PARTS.push(neopixel('ws2812', 'WS2812B NeoPixel', 1, 'single'), neopixel('ws2812-ring', 'NeoPixel-Ring (12 LEDs)', 12, 'ring'), neopixel('ws2812-strip', 'NeoPixel-Streifen (8 LEDs)', 8, 'strip'));
