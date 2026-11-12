/**
 * Mikrocontroller- und Computer-Boards: Pinbelegung, Versorgung, Grafikdaten.
 * Die Pin-Positionen liegen im 2,54-mm-Raster, damit Boards ins Steckbrett passen.
 */
import { PITCH, type PinDef } from './types';

export type Family = 'avr' | 'esp32' | 'esp8266' | 'rp2040' | 'stm32' | 'nrf52' | 'samd' | 'imxrt' | 'rpi' | 'renesas';

export interface BoardDef {
  id: string;
  name: string;
  chip: string;
  family: Family;
  mhz: number;
  /** Logikpegel */
  vcc: number;
  adcBits: number;
  adcRef: number;
  pins: PinDef[];
  ledBuiltin?: number;
  ledActiveLow?: boolean;
  /** analoge Pin-Nummern (A0 = 14 beim Uno) → GPIO */
  analogMap?: Record<number, number>;
  constants?: Record<string, number>;
  w: number;
  h: number;
  color: string;
  layout: 'dual' | 'uno' | 'mega' | 'pi' | 'pizero' | 'tiny';
  usb: 'micro' | 'usbc' | 'usbb' | 'mini' | 'none';
  /** Stromaufnahme aktiv / WLAN / Deep-Sleep in A */
  current: { active: number; radio?: number; sleep: number };
  /** Spannungsregler auf dem Board: 5V → Logik */
  regulator?: { dropout: number };
  wifi?: boolean;
  ble?: boolean;
  /** Bildschirm/Linux */
  linux?: boolean;
  price: number;
  info: string;
  buttons?: { id: string; label: string; gpio?: number; x: number; y: number }[];
  /** Positionen der Onboard-LEDs */
  leds?: { x: number; y: number; color: string; gpio?: number; power?: boolean }[];
  outPinR?: number;
  pullup?: number;
}

/** Pins einer Stiftleiste von oben nach unten (vertikal) bzw. links nach rechts */
function header(labels: string[], x0: number, y0: number, dir: 'v' | 'h', gpioOf: (l: string) => number | undefined, extra?: (l: string) => Partial<PinDef>): PinDef[] {
  return labels
    .map((label, i) => {
      if (!label) return null;
      const x = dir === 'h' ? x0 + i * PITCH : x0;
      const y = dir === 'v' ? y0 + i * PITCH : y0;
      const gpio = gpioOf(label);
      const p: PinDef = { id: label, label, x, y, gpio, ...power(label), ...(extra?.(label) ?? {}) };
      return p;
    })
    .filter((p): p is PinDef => !!p);
}

function power(label: string): Partial<PinDef> {
  const l = label.toUpperCase();
  if (/^(GND|G)\d*$/.test(l)) return { power: 'gnd' };
  if (l === '5V' || l === 'VBUS' || l === 'VUSB' || l === '5V0') return { power: '5v' };
  if (l === '3V3' || l === '3.3V' || l === '3V' || l === '3V3_OUT' || l === 'VCC3') return { power: '3v3' };
  if (l === 'VIN' || l === 'RAW' || l === 'VSYS') return { power: 'vin' };
  if (l === 'BAT' || l === 'VBAT') return { power: 'vbat' };
  return {};
}

/** eindeutige Pin-IDs bei mehrfach vorkommenden Labels (GND, GND2 …) */
function uniq(pins: PinDef[]): PinDef[] {
  const seen = new Map<string, number>();
  return pins.map((p) => {
    const n = seen.get(p.id) ?? 0;
    seen.set(p.id, n + 1);
    if (n === 0) return p;
    return { ...p, id: `${p.id}_${n + 1}`, aliases: [...(p.aliases ?? [])] };
  });
}

const espGpio = (l: string) => {
  const m = /^(?:IO|GPIO|G|D)?(\d+)$/.exec(l.split('/')[0]);
  return m ? parseInt(m[1], 10) : undefined;
};
const espExtra = (adcPins: number[]) => (l: string): Partial<PinDef> => {
  const g = espGpio(l);
  if (g === undefined) return {};
  return { adc: adcPins.includes(g), pwm: true, aliases: [`GPIO${g}`, `IO${g}`, `G${g}`, String(g), `D${g}`].filter((a) => a !== l) };
};

function dual(left: string[], right: string[], widthPins: number, gpioOf: (l: string) => number | undefined, extra?: (l: string) => Partial<PinDef>, top = 1): { pins: PinDef[]; w: number; h: number } {
  const n = Math.max(left.length, right.length);
  const w = (widthPins + 1) * PITCH;
  const h = (n + top + 1) * PITCH;
  const pins = uniq([...header(left, PITCH / 2, (top + 0.5) * PITCH, 'v', gpioOf, extra), ...header(right, w - PITCH / 2, (top + 0.5) * PITCH, 'v', gpioOf, extra)]);
  return { pins, w, h };
}

/* --------------------------- Arduino (AVR) --------------------------- */

const arduinoGpio = (l: string) => {
  let m = /^D(\d+)$/.exec(l);
  if (m) return parseInt(m[1], 10);
  m = /^A(\d+)$/.exec(l);
  if (m) return 14 + parseInt(m[1], 10);
  return undefined;
};
const unoPwm = [3, 5, 6, 9, 10, 11];
const arduinoExtra = (pwm: number[], aBase = 14) => (l: string): Partial<PinDef> => {
  const g = arduinoGpio(l);
  if (g === undefined) return {};
  const isA = /^A/.test(l);
  const gg = isA ? aBase + parseInt(l.slice(1), 10) : g;
  return { gpio: gg, adc: isA, pwm: pwm.includes(gg), aliases: isA ? [String(gg), `D${gg}`] : [String(g), `${g}`] };
};

function unoLayout(name: string, extraPwm = unoPwm): { pins: PinDef[]; w: number; h: number } {
  const w = 270;
  const h = 210;
  // obere Leiste (Digital) von rechts nach links wie auf dem Board
  const digital = ['SCL', 'SDA', 'AREF', 'GND', 'D13', 'D12', 'D11', 'D10', 'D9', 'D8', '', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1', 'D0'];
  const top = header(digital, 90, 12, 'h', arduinoGpio, arduinoExtra(extraPwm));
  const pwr = ['', 'IOREF', 'RESET', '3V3', '5V', 'GND', 'GND', 'VIN', '', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5'];
  const bottom = header(pwr, 110, 198, 'h', arduinoGpio, arduinoExtra(extraPwm));
  void name;
  return { pins: uniq([...top, ...bottom]), w, h };
}

const AVR_CONST = { A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19, A6: 20, A7: 21, SDA: 18, SCL: 19 };

function nanoLayout(): { pins: PinDef[]; w: number; h: number } {
  const left = ['D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'GND', 'RESET', 'D0', 'D1'];
  const right = ['D13', '3V3', 'AREF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', '5V', 'RESET', 'GND', 'VIN'];
  return dual(left, right, 6, arduinoGpio, arduinoExtra(unoPwm), 1.5);
}

/* --------------------------- Boards --------------------------- */

function mk(b: Omit<BoardDef, 'pins' | 'w' | 'h'> & { lay: { pins: PinDef[]; w: number; h: number } }): BoardDef {
  const { lay, ...rest } = b;
  return { ...rest, pins: lay.pins, w: lay.w, h: lay.h };
}

const PRO_MINI = dual(['D1', 'D0', 'RESET', 'GND', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9'], ['RAW', 'GND', 'RESET', 'VCC', 'A3', 'A2', 'A1', 'A0', 'D13', 'D12', 'D11', 'D10'], 6, arduinoGpio, arduinoExtra(unoPwm));
PRO_MINI.pins.forEach((p) => {
  if (p.id === 'VCC') p.power = '5v';
});

const C3_SUPERMINI = dual(['5V', 'GND', '3V3', 'IO4', 'IO3', 'IO2', 'IO1', 'IO0'], ['IO5', 'IO6', 'IO7', 'IO8', 'IO9', 'IO10', 'IO20', 'IO21'], 7, espGpio, espExtra([0, 1, 2, 3, 4]), 1.6);

const ESP32_DEVKIT = dual(
  ['EN', 'VP', 'VN', 'IO34', 'IO35', 'IO32', 'IO33', 'IO25', 'IO26', 'IO27', 'IO14', 'IO12', 'GND', 'IO13', 'SD2', 'SD3', 'CMD', '5V'],
  ['IO23', 'IO22', 'TX', 'RX', 'IO21', 'GND', 'IO19', 'IO18', 'IO5', 'IO17', 'IO16', 'IO4', 'IO0', 'IO2', 'IO15', 'SD1', 'SD0', 'CLK', '3V3'].slice(0, 18),
  10,
  (l) => (l === 'VP' ? 36 : l === 'VN' ? 39 : l === 'TX' ? 1 : l === 'RX' ? 3 : espGpio(l)),
  (l) => {
    const g = l === 'VP' ? 36 : l === 'VN' ? 39 : l === 'TX' ? 1 : l === 'RX' ? 3 : espGpio(l);
    if (g === undefined) return {};
    return { adc: [32, 33, 34, 35, 36, 39, 25, 26, 27, 14, 12, 13, 15, 2, 4, 0].includes(g), pwm: g < 34, aliases: [`GPIO${g}`, `IO${g}`, `G${g}`, String(g), `D${g}`].filter((a) => a !== l) };
  },
  2,
);
ESP32_DEVKIT.pins.push({ id: '3V3', label: '3V3', x: ESP32_DEVKIT.w - 5, y: ESP32_DEVKIT.pins.find((p) => p.id === '5V')!.y, power: '3v3' });
ESP32_DEVKIT.pins.splice(ESP32_DEVKIT.pins.findIndex((p) => p.id === 'CLK'), 1);

const S3_DEVKIT = dual(
  ['3V3', '3V3', 'RST', 'IO4', 'IO5', 'IO6', 'IO7', 'IO15', 'IO16', 'IO17', 'IO18', 'IO8', 'IO3', 'IO46', 'IO9', 'IO10', 'IO11', 'IO12', 'IO13', 'IO14', '5V', 'GND'],
  ['GND', 'TX', 'RX', 'IO1', 'IO2', 'IO42', 'IO41', 'IO40', 'IO39', 'IO38', 'IO37', 'IO36', 'IO35', 'IO0', 'IO45', 'IO48', 'IO47', 'IO21', 'IO20', 'IO19', 'GND', 'GND'],
  10,
  (l) => (l === 'TX' ? 43 : l === 'RX' ? 44 : espGpio(l)),
  espExtra([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]),
  2,
);

const C3_DEVKIT = dual(['GND', '3V3', '3V3', 'IO2', 'IO3', 'GND', 'RST', 'GND', 'IO0', 'IO1', 'IO10', 'GND', '5V', '5V', 'GND'], ['GND', 'TX', 'RX', 'GND', 'IO9', 'IO8', 'GND', 'IO7', 'IO6', 'IO5', 'IO4', 'GND', 'IO18', 'IO19', 'GND'], 10, (l) => (l === 'TX' ? 21 : l === 'RX' ? 20 : espGpio(l)), espExtra([0, 1, 2, 3, 4]), 2);
const C6_DEVKIT = dual(['3V3', 'RST', 'IO4', 'IO5', 'IO6', 'IO7', 'IO0', 'IO1', 'IO8', 'IO10', 'IO11', 'IO2', 'IO3', '5V', 'GND', ''], ['GND', 'TX', 'RX', 'IO15', 'IO23', 'IO22', 'IO21', 'IO20', 'IO19', 'IO18', 'IO9', 'GND', 'IO13', 'IO12', 'GND', ''], 10, (l) => (l === 'TX' ? 16 : l === 'RX' ? 17 : espGpio(l)), espExtra([0, 1, 2, 3, 4, 5, 6]), 2);
const XIAO = (labels: [string[], string[]]) => dual(labels[0], labels[1], 6, espGpio, espExtra([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 1.2);
const XIAO_C3 = dual(['IO2', 'IO3', 'IO4', 'IO5', 'IO6', 'IO7', 'IO21'], ['5V', 'GND', '3V3', 'IO10', 'IO9', 'IO8', 'IO20'], 6, espGpio, espExtra([2, 3, 4]), 1.2);

const NODEMCU = dual(['A0', 'RSV', 'RSV', 'SD3', 'SD2', 'SD1', 'CMD', 'SD0', 'CLK', 'GND', '3V3', 'EN', 'RST', 'GND', 'VIN'], ['D0', 'D1', 'D2', 'D3', 'D4', '3V3', 'GND', 'D5', 'D6', 'D7', 'D8', 'RX', 'TX', 'GND', '3V3'], 10, (l) => {
  const map: Record<string, number> = { D0: 16, D1: 5, D2: 4, D3: 0, D4: 2, D5: 14, D6: 12, D7: 13, D8: 15, RX: 3, TX: 1, A0: 17 };
  return map[l];
}, (l) => {
  const map: Record<string, number> = { D0: 16, D1: 5, D2: 4, D3: 0, D4: 2, D5: 14, D6: 12, D7: 13, D8: 15, RX: 3, TX: 1, A0: 17 };
  const g = map[l];
  if (g === undefined) return {};
  return { adc: l === 'A0', pwm: true, aliases: [`GPIO${g}`, String(g)] };
}, 2);

const picoGpio = (l: string) => {
  const m = /^GP(\d+)$/.exec(l);
  return m ? parseInt(m[1], 10) : undefined;
};
const picoExtra = (l: string): Partial<PinDef> => {
  const g = picoGpio(l);
  if (g === undefined) return {};
  return { adc: g >= 26 && g <= 28, pwm: true, aliases: [`GPIO${g}`, String(g), `D${g}`, ...(g >= 26 ? [`A${g - 26}`] : [])] };
};
const PICO = dual(
  ['GP0', 'GP1', 'GND', 'GP2', 'GP3', 'GP4', 'GP5', 'GND', 'GP6', 'GP7', 'GP8', 'GP9', 'GND', 'GP10', 'GP11', 'GP12', 'GP13', 'GND', 'GP14', 'GP15'],
  ['VBUS', 'VSYS', 'GND', '3V3_EN', '3V3', 'ADC_VREF', 'GP28', 'GND', 'GP27', 'GP26', 'RUN', 'GP22', 'GND', 'GP21', 'GP20', 'GP19', 'GP18', 'GND', 'GP17', 'GP16'],
  7,
  picoGpio,
  picoExtra,
  2,
);
PICO.pins.forEach((p) => {
  if (p.id === '3V3') p.power = '3v3';
});

const stmGpio = (l: string) => {
  const m = /^P([ABC])(\d+)$/.exec(l);
  if (!m) return undefined;
  return { A: 0, B: 16, C: 32 }[m[1] as 'A' | 'B' | 'C']! + parseInt(m[2], 10);
};
const stmExtra = (l: string): Partial<PinDef> => {
  const g = stmGpio(l);
  if (g === undefined) return {};
  return { adc: g <= 7 || g === 16 || g === 17, pwm: true, aliases: [String(g)] };
};
const BLUEPILL = dual(['PB12', 'PB13', 'PB14', 'PB15', 'PA8', 'PA9', 'PA10', 'PA11', 'PA12', 'PA15', 'PB3', 'PB4', 'PB5', 'PB6', 'PB7', 'PB8', 'PB9', '5V', 'GND', '3V3'], ['GND', 'GND', '3V3', 'RESET', 'PB11', 'PB10', 'PB1', 'PB0', 'PA7', 'PA6', 'PA5', 'PA4', 'PA3', 'PA2', 'PA1', 'PA0', 'PC15', 'PC14', 'PC13', 'VBAT'], 6, stmGpio, stmExtra, 2);

const nrfGpio = (l: string) => {
  const m = /^P([01])\.(\d+)$/.exec(l);
  return m ? parseInt(m[1], 10) * 32 + parseInt(m[2], 10) : undefined;
};
const NICE_NANO = dual(['P0.06', 'P0.08', 'GND', 'GND', 'P0.17', 'P0.20', 'P0.22', 'P0.24', 'P1.00', 'P0.11', 'P1.04', 'P1.06'], ['BAT', 'GND', 'RST', '3V3', 'P0.31', 'P0.29', 'P0.02', 'P1.15', 'P1.13', 'P1.11', 'P0.10', 'P0.09'], 6, nrfGpio, (l) => {
  const g = nrfGpio(l);
  return g === undefined ? {} : { adc: [2, 29, 31].includes(g), pwm: true, aliases: [String(g)] };
}, 1.5);

const TEENSY = dual(['GND', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12'], ['VIN', 'GND', '3V3', 'D23', 'D22', 'D21', 'D20', 'D19', 'D18', 'D17', 'D16', 'D15', 'D14', 'D13'], 6, (l) => {
  const m = /^D(\d+)$/.exec(l);
  return m ? +m[1] : undefined;
}, (l) => {
  const m = /^D(\d+)$/.exec(l);
  if (!m) return {};
  const g = +m[1];
  return { adc: g >= 14, pwm: true, aliases: [String(g), ...(g >= 14 ? [`A${g - 14}`] : [])] };
}, 1.5);

const TINY = dual(['RESET', 'PB3', 'PB4', 'GND'], ['VCC', 'PB2', 'PB1', 'PB0'], 3, (l) => {
  const m = /^PB(\d)$/.exec(l);
  return m ? +m[1] : undefined;
}, (l) => {
  const m = /^PB(\d)$/.exec(l);
  if (!m) return {};
  const g = +m[1];
  return { adc: [2, 3, 4].includes(g), pwm: [0, 1, 4].includes(g), aliases: [String(g), `D${g}`, ...(g === 2 ? ['A1'] : g === 3 ? ['A3'] : g === 4 ? ['A2'] : [])] };
}, 0.8);
TINY.pins.forEach((p) => {
  if (p.id === 'VCC') p.power = '5v';
});

/** Raspberry Pi 40-Pin-Header */
function piHeader(w: number, h: number, x0: number, y0: number): { pins: PinDef[]; w: number; h: number } {
  const odd = ['3V3', 'GPIO2', 'GPIO3', 'GPIO4', 'GND', 'GPIO17', 'GPIO27', 'GPIO22', '3V3', 'GPIO10', 'GPIO9', 'GPIO11', 'GND', 'ID_SD', 'GPIO5', 'GPIO6', 'GPIO13', 'GPIO19', 'GPIO26', 'GND'];
  const even = ['5V', '5V', 'GND', 'GPIO14', 'GPIO15', 'GPIO18', 'GND', 'GPIO23', 'GPIO24', 'GND', 'GPIO25', 'GPIO8', 'GPIO7', 'ID_SC', 'GND', 'GPIO12', 'GND', 'GPIO16', 'GPIO20', 'GPIO21'];
  const g = (l: string) => {
    const m = /^GPIO(\d+)$/.exec(l);
    return m ? +m[1] : undefined;
  };
  const ex = (l: string): Partial<PinDef> => {
    const n = g(l);
    return n === undefined ? {} : { pwm: [12, 13, 18, 19].includes(n), aliases: [String(n), `BCM${n}`, `GP${n}`] };
  };
  const pins = uniq([...header(odd, x0, y0 + PITCH, 'h', g, ex), ...header(even, x0, y0, 'h', g, ex)]);
  return { pins, w, h };
}

export const BOARDS: BoardDef[] = [
  mk({ id: 'arduino-uno', name: 'Arduino Uno R3', chip: 'ATmega328P', family: 'avr', mhz: 16, vcc: 5, adcBits: 10, adcRef: 5, ledBuiltin: 13, analogMap: { 0: 14, 1: 15, 2: 16, 3: 17, 4: 18, 5: 19 }, constants: AVR_CONST, lay: unoLayout('uno'), color: '#0f7c8c', layout: 'uno', usb: 'usbb', current: { active: 0.045, sleep: 0.03 }, regulator: { dropout: 1.0 }, price: 24, info: 'Der Klassiker: ATmega328P mit 16 MHz, 14 Digital-Pins (6× PWM), 6 Analog-Eingänge, 5-V-Logik. 32 KB Flash, 2 KB RAM.', leds: [{ x: 150, y: 52, color: '#ffb300', gpio: 13 }, { x: 240, y: 92, color: '#2ee66b', power: true }], buttons: [{ id: 'reset', label: 'RESET', x: 28, y: 20 }] }),
  mk({ id: 'arduino-uno-r4-minima', name: 'Arduino Uno R4 Minima', chip: 'Renesas RA4M1', family: 'renesas', mhz: 48, vcc: 5, adcBits: 10, adcRef: 5, ledBuiltin: 13, analogMap: { 0: 14, 1: 15, 2: 16, 3: 17, 4: 18, 5: 19 }, constants: AVR_CONST, lay: unoLayout('r4'), color: '#0f7c8c', layout: 'uno', usb: 'usbc', current: { active: 0.03, sleep: 0.01 }, regulator: { dropout: 1.0 }, price: 20, info: 'Uno-Formfaktor mit 32-Bit Arm Cortex-M4 (48 MHz), 256 KB Flash, 32 KB RAM, USB-C, 12-Bit-DAC. 5-V-Logik.', leds: [{ x: 150, y: 52, color: '#ffb300', gpio: 13 }, { x: 240, y: 92, color: '#2ee66b', power: true }], buttons: [{ id: 'reset', label: 'RESET', x: 28, y: 20 }] }),
  mk({ id: 'arduino-uno-r4-wifi', name: 'Arduino Uno R4 WiFi', chip: 'RA4M1 + ESP32-S3', family: 'renesas', mhz: 48, vcc: 5, adcBits: 10, adcRef: 5, ledBuiltin: 13, analogMap: { 0: 14, 1: 15, 2: 16, 3: 17, 4: 18, 5: 19 }, constants: AVR_CONST, lay: unoLayout('r4w'), color: '#0f7c8c', layout: 'uno', usb: 'usbc', current: { active: 0.06, radio: 0.12, sleep: 0.02 }, regulator: { dropout: 1.0 }, wifi: true, ble: true, price: 27, info: 'Uno R4 mit ESP32-S3-Koprozessor für WLAN und Bluetooth, 12×8-LED-Matrix auf dem Board.', leds: [{ x: 150, y: 52, color: '#ffb300', gpio: 13 }, { x: 240, y: 92, color: '#2ee66b', power: true }], buttons: [{ id: 'reset', label: 'RESET', x: 28, y: 20 }] }),
  mk({ id: 'arduino-leonardo', name: 'Arduino Leonardo', chip: 'ATmega32U4', family: 'avr', mhz: 16, vcc: 5, adcBits: 10, adcRef: 5, ledBuiltin: 13, analogMap: { 0: 14, 1: 15, 2: 16, 3: 17, 4: 18, 5: 19 }, constants: { ...AVR_CONST, SDA: 2, SCL: 3 }, lay: unoLayout('leo', [3, 5, 6, 9, 10, 11, 13]), color: '#0f7c8c', layout: 'uno', usb: 'micro', current: { active: 0.04, sleep: 0.02 }, regulator: { dropout: 1.0 }, price: 22, info: 'ATmega32U4 mit nativem USB – kann sich als Tastatur oder Maus ausgeben.', leds: [{ x: 150, y: 52, color: '#ffb300', gpio: 13 }], buttons: [{ id: 'reset', label: 'RESET', x: 28, y: 20 }] }),
  mk({ id: 'arduino-mega', name: 'Arduino Mega 2560', chip: 'ATmega2560', family: 'avr', mhz: 16, vcc: 5, adcBits: 10, adcRef: 5, ledBuiltin: 13, analogMap: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i, 54 + i])), constants: { ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`A${i}`, 54 + i])), SDA: 20, SCL: 21 }, lay: (() => {
    const base = unoLayout('mega', [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 44, 45, 46]);
    const w = 400;
    const extra: PinDef[] = [];
    for (let i = 22; i <= 53; i++) {
      const col = Math.floor((i - 22) / 2);
      const row = (i - 22) % 2;
      extra.push({ id: `D${i}`, label: `D${i}`, x: 300 + row * PITCH + 50, y: 20 + col * PITCH * 0 + col * 0 + (col * 10) / 1, gpio: i, pwm: [44, 45, 46].includes(i), aliases: [String(i)] });
    }
    extra.forEach((p, idx) => {
      p.x = 350 + (idx % 2) * PITCH;
      p.y = 20 + Math.floor(idx / 2) * PITCH;
    });
    const analog: PinDef[] = [];
    for (let i = 6; i < 16; i++) analog.push({ id: `A${i}`, label: `A${i}`, x: 260 + (i - 6) * PITCH, y: 198, gpio: 54 + i, adc: true, aliases: [String(54 + i)] });
    const pins = base.pins.map((p) => (p.id.startsWith('A') && /^A\d$/.test(p.id) ? { ...p, gpio: 54 + parseInt(p.id.slice(1), 10), aliases: [String(54 + parseInt(p.id.slice(1), 10))] } : p));
    return { pins: [...pins, ...extra, ...analog], w, h: 210 };
  })(), color: '#0f7c8c', layout: 'mega', usb: 'usbb', current: { active: 0.07, sleep: 0.04 }, regulator: { dropout: 1.0 }, price: 38, info: 'ATmega2560 mit 54 Digital-Pins (15× PWM), 16 Analog-Eingängen und 4 seriellen Schnittstellen. 256 KB Flash, 8 KB RAM.', leds: [{ x: 150, y: 52, color: '#ffb300', gpio: 13 }], buttons: [{ id: 'reset', label: 'RESET', x: 28, y: 20 }] }),
  mk({ id: 'arduino-nano', name: 'Arduino Nano', chip: 'ATmega328P', family: 'avr', mhz: 16, vcc: 5, adcBits: 10, adcRef: 5, ledBuiltin: 13, analogMap: { 0: 14, 1: 15, 2: 16, 3: 17, 4: 18, 5: 19, 6: 20, 7: 21 }, constants: AVR_CONST, lay: nanoLayout(), color: '#0c5f9e', layout: 'dual', usb: 'mini', current: { active: 0.025, sleep: 0.015 }, regulator: { dropout: 1.0 }, price: 22, info: 'Kompakter Uno-Bruder fürs Steckbrett: ATmega328P, 8 Analog-Eingänge (A6/A7 nur analog), Mini-USB.', leds: [{ x: 35, y: 30, color: '#ffb300', gpio: 13 }, { x: 35, y: 60, color: '#2ee66b', power: true }], buttons: [{ id: 'reset', label: 'RST', x: 35, y: 90 }] }),
  mk({ id: 'arduino-nano-every', name: 'Arduino Nano Every', chip: 'ATmega4809', family: 'avr', mhz: 20, vcc: 5, adcBits: 10, adcRef: 5, ledBuiltin: 13, analogMap: { 0: 14, 1: 15, 2: 16, 3: 17, 4: 18, 5: 19, 6: 20, 7: 21 }, constants: AVR_CONST, lay: nanoLayout(), color: '#0c5f9e', layout: 'dual', usb: 'micro', current: { active: 0.02, sleep: 0.01 }, regulator: { dropout: 0.6 }, price: 14, info: 'Nano-Formfaktor mit ATmega4809 (20 MHz), 48 KB Flash, 6 KB RAM.', leds: [{ x: 35, y: 30, color: '#ffb300', gpio: 13 }], buttons: [{ id: 'reset', label: 'RST', x: 35, y: 90 }] }),
  mk({ id: 'arduino-nano-esp32', name: 'Arduino Nano ESP32', chip: 'ESP32-S3', family: 'esp32', mhz: 240, vcc: 3.3, adcBits: 12, adcRef: 3.3, ledBuiltin: 13, analogMap: { 0: 14, 1: 15, 2: 16, 3: 17, 4: 18, 5: 19, 6: 20, 7: 21 }, constants: AVR_CONST, lay: nanoLayout(), color: '#0c5f9e', layout: 'dual', usb: 'usbc', current: { active: 0.05, radio: 0.13, sleep: 0.00002 }, regulator: { dropout: 0.3 }, wifi: true, ble: true, price: 21, info: 'Nano-Formfaktor mit ESP32-S3: WLAN, Bluetooth LE, 3,3-V-Logik (nicht 5-V-tolerant!).', leds: [{ x: 35, y: 30, color: '#ffb300', gpio: 13 }], buttons: [{ id: 'reset', label: 'RST', x: 35, y: 90 }] }),
  mk({ id: 'arduino-pro-mini', name: 'Arduino Pro Mini 5V', chip: 'ATmega328P', family: 'avr', mhz: 16, vcc: 5, adcBits: 10, adcRef: 5, ledBuiltin: 13, analogMap: { 0: 14, 1: 15, 2: 16, 3: 17 }, constants: AVR_CONST, lay: PRO_MINI, color: '#c62828', layout: 'dual', usb: 'none', current: { active: 0.015, sleep: 0.0045 }, regulator: { dropout: 0.6 }, price: 4, info: 'Minimal-Arduino ohne USB-Chip (Programmierung über FTDI-Adapter). Ideal für Batterieprojekte, wenn man die Power-LED ablötet.', leds: [{ x: 40, y: 40, color: '#2ee66b', power: true }, { x: 40, y: 80, color: '#ffb300', gpio: 13 }] }),
  mk({ id: 'arduino-micro', name: 'Arduino Micro', chip: 'ATmega32U4', family: 'avr', mhz: 16, vcc: 5, adcBits: 10, adcRef: 5, ledBuiltin: 13, analogMap: { 0: 18, 1: 19, 2: 20, 3: 21, 4: 22, 5: 23 }, constants: { A0: 18, A1: 19, A2: 20, A3: 21, A4: 22, A5: 23, SDA: 2, SCL: 3 }, lay: dual(['D13', '3V3', 'AREF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'NC', 'NC', '5V', 'RESET', 'GND', 'VIN', 'MISO', 'SCK'], ['MOSI', 'SS', 'D1', 'D0', 'RESET', 'GND', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12'], 6, (l) => (/^A\d$/.test(l) ? 18 + +l[1] : arduinoGpio(l)), (l) => (/^A\d$/.test(l) ? { adc: true, gpio: 18 + +l[1], aliases: [String(18 + +l[1])] } : arduinoExtra([3, 5, 6, 9, 10, 11, 13])(l)), 1.5), color: '#0c5f9e', layout: 'dual', usb: 'micro', current: { active: 0.03, sleep: 0.02 }, regulator: { dropout: 1.0 }, price: 22, info: 'Kleiner Leonardo: ATmega32U4 mit nativem USB im Steckbrettformat.', leds: [{ x: 35, y: 40, color: '#ffb300', gpio: 13 }] }),
  mk({ id: 'attiny85', name: 'ATtiny85 (Digispark)', chip: 'ATtiny85', family: 'avr', mhz: 16, vcc: 5, adcBits: 10, adcRef: 5, ledBuiltin: 1, analogMap: { 1: 2, 2: 4, 3: 3 }, lay: TINY, color: '#1f1f1f', layout: 'tiny', usb: 'none', current: { active: 0.008, sleep: 0.0000005 }, price: 2, info: 'Winziger 8-Pin-AVR: 5 nutzbare I/O-Pins, 8 KB Flash, 512 Byte RAM. Perfekt für Mini-Projekte.' }),

  mk({ id: 'esp32-devkit', name: 'ESP32 DevKit V1', chip: 'ESP32-WROOM-32', family: 'esp32', mhz: 240, vcc: 3.3, adcBits: 12, adcRef: 3.3, ledBuiltin: 2, lay: ESP32_DEVKIT, color: '#1d1d1f', layout: 'dual', usb: 'micro', current: { active: 0.05, radio: 0.16, sleep: 0.00001 }, regulator: { dropout: 1.1 }, wifi: true, ble: true, price: 8, info: 'Dual-Core 240 MHz, WLAN + Bluetooth (Classic & LE), 34 GPIOs, 12-Bit-ADC, Touch-Pins, Deep-Sleep ~10 µA (Chip).', buttons: [{ id: 'reset', label: 'EN', x: 20, y: 18 }, { id: 'boot', label: 'BOOT', gpio: 0, x: 90, y: 18 }], leds: [{ x: 70, y: 185, color: '#2a7fff', gpio: 2 }, { x: 40, y: 185, color: '#ff3b30', power: true }] }),
  mk({ id: 'esp32-s2-mini', name: 'ESP32-S2 Mini', chip: 'ESP32-S2', family: 'esp32', mhz: 240, vcc: 3.3, adcBits: 13, adcRef: 3.3, ledBuiltin: 15, lay: dual(['IO1', 'IO2', 'IO3', 'IO4', 'IO5', 'IO6', 'IO7', 'IO8', 'IO9', 'IO10', 'IO11', 'IO12', 'IO13', 'IO14', '3V3', 'GND'], ['IO40', 'IO39', 'IO38', 'IO37', 'IO36', 'IO35', 'IO34', 'IO33', 'IO21', 'IO18', 'IO17', 'IO16', 'IO15', 'EN', 'VBUS', 'GND'], 8, espGpio, espExtra([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 1.5), color: '#1d1d1f', layout: 'dual', usb: 'usbc', current: { active: 0.04, radio: 0.15, sleep: 0.00002 }, regulator: { dropout: 0.3 }, wifi: true, price: 6, info: 'Single-Core 240 MHz mit WLAN (kein Bluetooth), natives USB, 27 GPIOs.', leds: [{ x: 40, y: 30, color: '#2a7fff', gpio: 15 }] }),
  mk({ id: 'esp32-s3-devkit', name: 'ESP32-S3 DevKitC', chip: 'ESP32-S3', family: 'esp32', mhz: 240, vcc: 3.3, adcBits: 12, adcRef: 3.3, ledBuiltin: 48, lay: S3_DEVKIT, color: '#1d1d1f', layout: 'dual', usb: 'usbc', current: { active: 0.06, radio: 0.17, sleep: 0.000008 }, regulator: { dropout: 1.1 }, wifi: true, ble: true, price: 12, info: 'Dual-Core 240 MHz mit Vektor-Befehlen für KI, WLAN + BLE 5, natives USB, RGB-LED (WS2812) an GPIO48.', buttons: [{ id: 'reset', label: 'RST', x: 20, y: 225 }, { id: 'boot', label: 'BOOT', gpio: 0, x: 90, y: 225 }] }),
  mk({ id: 'esp32-c3-supermini', name: 'ESP32-C3 SuperMini', chip: 'ESP32-C3', family: 'esp32', mhz: 160, vcc: 3.3, adcBits: 12, adcRef: 3.3, ledBuiltin: 8, ledActiveLow: true, lay: C3_SUPERMINI, color: '#1d1d1f', layout: 'dual', usb: 'usbc', current: { active: 0.022, radio: 0.11, sleep: 0.000045 }, regulator: { dropout: 0.25 }, wifi: true, ble: true, price: 3, info: 'Daumennagelgroßes RISC-V-Board (160 MHz) mit WLAN + BLE 5, USB-C, 13 GPIOs. Blaue LED an GPIO8 (Low-aktiv), BOOT-Taster an GPIO9. Deep-Sleep ~45 µA (Board).', buttons: [{ id: 'boot', label: 'BOOT', gpio: 9, x: 22, y: 92 }, { id: 'reset', label: 'RST', x: 58, y: 92 }], leds: [{ x: 60, y: 70, color: '#2a7fff', gpio: 8 }, { x: 25, y: 70, color: '#ff3b30', power: true }] }),
  mk({ id: 'esp32-c3-devkit', name: 'ESP32-C3 DevKitM-1', chip: 'ESP32-C3', family: 'esp32', mhz: 160, vcc: 3.3, adcBits: 12, adcRef: 3.3, ledBuiltin: 8, lay: C3_DEVKIT, color: '#1d1d1f', layout: 'dual', usb: 'micro', current: { active: 0.025, radio: 0.12, sleep: 0.000005 }, regulator: { dropout: 1.1 }, wifi: true, ble: true, price: 9, info: 'Offizielles Espressif-Entwicklungsboard mit ESP32-C3 (RISC-V, WLAN + BLE 5) und RGB-LED.', buttons: [{ id: 'boot', label: 'BOOT', gpio: 9, x: 20, y: 160 }, { id: 'reset', label: 'RST', x: 90, y: 160 }] }),
  mk({ id: 'esp32-c5-devkit', name: 'ESP32-C5 DevKitC', chip: 'ESP32-C5', family: 'esp32', mhz: 240, vcc: 3.3, adcBits: 12, adcRef: 3.3, ledBuiltin: 27, lay: C6_DEVKIT, color: '#1d1d1f', layout: 'dual', usb: 'usbc', current: { active: 0.03, radio: 0.13, sleep: 0.000008 }, regulator: { dropout: 1.1 }, wifi: true, ble: true, price: 14, info: 'Erstes ESP mit Dualband-WLAN 6 (2,4 + 5 GHz), BLE 5, Zigbee/Thread, RISC-V 240 MHz.' }),
  mk({ id: 'esp32-c6-devkit', name: 'ESP32-C6 DevKitC', chip: 'ESP32-C6', family: 'esp32', mhz: 160, vcc: 3.3, adcBits: 12, adcRef: 3.3, ledBuiltin: 8, lay: C6_DEVKIT, color: '#1d1d1f', layout: 'dual', usb: 'usbc', current: { active: 0.025, radio: 0.12, sleep: 0.000007 }, regulator: { dropout: 1.1 }, wifi: true, ble: true, price: 10, info: 'WLAN 6, BLE 5 und 802.15.4 (Thread/Zigbee/Matter) – RISC-V mit 160 MHz plus Low-Power-Kern.' }),
  mk({ id: 'esp32-h2-devkit', name: 'ESP32-H2 DevKitM', chip: 'ESP32-H2', family: 'esp32', mhz: 96, vcc: 3.3, adcBits: 12, adcRef: 3.3, ledBuiltin: 8, lay: C6_DEVKIT, color: '#1d1d1f', layout: 'dual', usb: 'usbc', current: { active: 0.015, radio: 0.03, sleep: 0.000007 }, regulator: { dropout: 1.1 }, ble: true, price: 9, info: 'Sparsamer RISC-V mit BLE 5 und Thread/Zigbee – ohne WLAN.' }),
  mk({ id: 'esp32-p4-devkit', name: 'ESP32-P4 Function EV', chip: 'ESP32-P4', family: 'esp32', mhz: 400, vcc: 3.3, adcBits: 12, adcRef: 3.3, ledBuiltin: 2, lay: S3_DEVKIT, color: '#1d1d1f', layout: 'dual', usb: 'usbc', current: { active: 0.12, sleep: 0.00002 }, regulator: { dropout: 1.1 }, price: 35, info: 'Hochleistungs-ESP: Dual-Core RISC-V 400 MHz, MIPI-Kamera/Display, H.264 – ohne eigenes Funkmodul.' }),
  mk({ id: 'esp8266-nodemcu', name: 'ESP8266 NodeMCU', chip: 'ESP8266', family: 'esp8266', mhz: 80, vcc: 3.3, adcBits: 10, adcRef: 3.3, ledBuiltin: 2, ledActiveLow: true, constants: { D0: 16, D1: 5, D2: 4, D3: 0, D4: 2, D5: 14, D6: 12, D7: 13, D8: 15, A0: 17, SDA: 4, SCL: 5 }, analogMap: { 0: 17 }, lay: NODEMCU, color: '#1d1d1f', layout: 'dual', usb: 'micro', current: { active: 0.07, radio: 0.08, sleep: 0.00002 }, regulator: { dropout: 1.1 }, wifi: true, price: 5, info: 'Der WLAN-Klassiker: 80 MHz, 1 Analog-Eingang (0–3,3 V am Board), 11 GPIOs.', leds: [{ x: 60, y: 30, color: '#2a7fff', gpio: 2 }] }),
  mk({ id: 'xiao-esp32c3', name: 'Seeed XIAO ESP32C3', chip: 'ESP32-C3', family: 'esp32', mhz: 160, vcc: 3.3, adcBits: 12, adcRef: 3.3, lay: XIAO_C3, color: '#2b2b2b', layout: 'dual', usb: 'usbc', current: { active: 0.02, radio: 0.1, sleep: 0.000044 }, regulator: { dropout: 0.25 }, wifi: true, ble: true, price: 6, info: 'Briefmarkengroß: ESP32-C3 mit WLAN + BLE, Akku-Ladeschaltung und externer Antenne.' }),
  mk({ id: 'xiao-esp32s3', name: 'Seeed XIAO ESP32S3', chip: 'ESP32-S3', family: 'esp32', mhz: 240, vcc: 3.3, adcBits: 12, adcRef: 3.3, ledBuiltin: 21, ledActiveLow: true, lay: XIAO([['IO1', 'IO2', 'IO3', 'IO4', 'IO5', 'IO6', 'IO43'], ['5V', 'GND', '3V3', 'IO9', 'IO8', 'IO7', 'IO44']]), color: '#2b2b2b', layout: 'dual', usb: 'usbc', current: { active: 0.04, radio: 0.12, sleep: 0.000014 }, regulator: { dropout: 0.25 }, wifi: true, ble: true, price: 8, info: 'XIAO mit Dual-Core ESP32-S3, 8 MB PSRAM optional, WLAN + BLE 5.' }),
  mk({ id: 'xiao-rp2040', name: 'Seeed XIAO RP2040', chip: 'RP2040', family: 'rp2040', mhz: 133, vcc: 3.3, adcBits: 12, adcRef: 3.3, ledBuiltin: 25, lay: dual(['GP26', 'GP27', 'GP28', 'GP29', 'GP6', 'GP7', 'GP0'], ['5V', 'GND', '3V3', 'GP3', 'GP4', 'GP2', 'GP1'], 6, picoGpio, picoExtra, 1.2), color: '#2b2b2b', layout: 'dual', usb: 'usbc', current: { active: 0.025, sleep: 0.001 }, regulator: { dropout: 0.25 }, price: 5, info: 'RP2040 im XIAO-Format mit RGB-LED.' }),
  mk({ id: 'xiao-nrf52840', name: 'Seeed XIAO nRF52840', chip: 'nRF52840', family: 'nrf52', mhz: 64, vcc: 3.3, adcBits: 12, adcRef: 3.3, lay: XIAO([['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6'], ['5V', 'GND', '3V3', 'D10', 'D9', 'D8', 'D7']]), color: '#2b2b2b', layout: 'dual', usb: 'usbc', current: { active: 0.006, radio: 0.012, sleep: 0.000005 }, regulator: { dropout: 0.25 }, ble: true, price: 10, info: 'Ultrasparsames Bluetooth-LE-Board mit Cortex-M4F und Akku-Lader.' }),
  mk({ id: 'xiao-samd21', name: 'Seeed XIAO SAMD21', chip: 'ATSAMD21', family: 'samd', mhz: 48, vcc: 3.3, adcBits: 10, adcRef: 3.3, ledBuiltin: 13, lay: XIAO([['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6'], ['5V', 'GND', '3V3', 'D10', 'D9', 'D8', 'D7']]), color: '#2b2b2b', layout: 'dual', usb: 'usbc', current: { active: 0.01, sleep: 0.00005 }, regulator: { dropout: 0.25 }, price: 5, info: 'Cortex-M0+ mit 48 MHz im XIAO-Format, DAC-Ausgang.' }),

  mk({ id: 'pico', name: 'Raspberry Pi Pico', chip: 'RP2040', family: 'rp2040', mhz: 133, vcc: 3.3, adcBits: 12, adcRef: 3.3, ledBuiltin: 25, constants: { A0: 26, A1: 27, A2: 28 }, analogMap: { 0: 26, 1: 27, 2: 28 }, lay: PICO, color: '#1b7a3b', layout: 'dual', usb: 'micro', current: { active: 0.025, sleep: 0.0013 }, regulator: { dropout: 0.2 }, price: 4, info: 'Dual-Core Cortex-M0+ (133 MHz), 264 KB RAM, 26 GPIOs, 3 ADC-Kanäle, programmierbare I/O (PIO).', leds: [{ x: 35, y: 18, color: '#2ee66b', gpio: 25 }] }),
  mk({ id: 'pico-w', name: 'Raspberry Pi Pico W', chip: 'RP2040 + CYW43439', family: 'rp2040', mhz: 133, vcc: 3.3, adcBits: 12, adcRef: 3.3, ledBuiltin: 64, constants: { A0: 26, A1: 27, A2: 28 }, analogMap: { 0: 26, 1: 27, 2: 28 }, lay: { ...PICO, pins: [...PICO.pins, { id: 'LED', label: 'LED', x: -1000, y: -1000, gpio: 64 }] }, color: '#1b7a3b', layout: 'dual', usb: 'micro', current: { active: 0.03, radio: 0.08, sleep: 0.0015 }, regulator: { dropout: 0.2 }, wifi: true, ble: true, price: 7, info: 'Pico mit WLAN und Bluetooth (Infineon CYW43439). Die Onboard-LED hängt am Funkchip ("LED").', leds: [{ x: 35, y: 18, color: '#2ee66b', gpio: 64 }] }),
  mk({ id: 'pico2', name: 'Raspberry Pi Pico 2', chip: 'RP2350', family: 'rp2040', mhz: 150, vcc: 3.3, adcBits: 12, adcRef: 3.3, ledBuiltin: 25, constants: { A0: 26, A1: 27, A2: 28 }, analogMap: { 0: 26, 1: 27, 2: 28 }, lay: PICO, color: '#1b7a3b', layout: 'dual', usb: 'micro', current: { active: 0.022, sleep: 0.0001 }, regulator: { dropout: 0.2 }, price: 5, info: 'RP2350: Dual Cortex-M33 oder RISC-V (150 MHz), 520 KB RAM, Secure Boot, mehr PIO.', leds: [{ x: 35, y: 18, color: '#2ee66b', gpio: 25 }] }),
  mk({ id: 'pico2-w', name: 'Raspberry Pi Pico 2 W', chip: 'RP2350 + CYW43439', family: 'rp2040', mhz: 150, vcc: 3.3, adcBits: 12, adcRef: 3.3, ledBuiltin: 64, constants: { A0: 26, A1: 27, A2: 28 }, analogMap: { 0: 26, 1: 27, 2: 28 }, lay: { ...PICO, pins: [...PICO.pins, { id: 'LED', label: 'LED', x: -1000, y: -1000, gpio: 64 }] }, color: '#1b7a3b', layout: 'dual', usb: 'micro', current: { active: 0.026, radio: 0.08, sleep: 0.0002 }, regulator: { dropout: 0.2 }, wifi: true, ble: true, price: 8, info: 'Pico 2 mit WLAN und Bluetooth.', leds: [{ x: 35, y: 18, color: '#2ee66b', gpio: 64 }] }),

  mk({ id: 'stm32-bluepill', name: 'STM32 Blue Pill', chip: 'STM32F103C8', family: 'stm32', mhz: 72, vcc: 3.3, adcBits: 12, adcRef: 3.3, ledBuiltin: 45, ledActiveLow: true, constants: { PC13: 45, PA0: 0, PA1: 1, PA2: 2, PA3: 3, PA4: 4, PA5: 5, PA6: 6, PA7: 7, PB0: 16, PB1: 17 }, lay: BLUEPILL, color: '#1f4fa8', layout: 'dual', usb: 'micro', current: { active: 0.03, sleep: 0.00002 }, regulator: { dropout: 0.3 }, price: 4, info: 'Cortex-M3 mit 72 MHz, 64 KB Flash, 20 KB RAM, 2× 12-Bit-ADC. LED an PC13 (Low-aktiv).' }),
  mk({ id: 'stm32-nucleo-f401', name: 'STM32 Nucleo-F401RE', chip: 'STM32F401RE', family: 'stm32', mhz: 84, vcc: 3.3, adcBits: 12, adcRef: 3.3, ledBuiltin: 13, analogMap: { 0: 14, 1: 15, 2: 16, 3: 17, 4: 18, 5: 19 }, constants: AVR_CONST, lay: unoLayout('nucleo'), color: '#f2f2f2', layout: 'uno', usb: 'mini', current: { active: 0.04, sleep: 0.00002 }, regulator: { dropout: 0.3 }, price: 15, info: 'Cortex-M4F mit 84 MHz und Arduino-kompatiblen Buchsenleisten, integrierter ST-LINK-Debugger.' }),
  mk({ id: 'nrf52840-nicenano', name: 'nRF52840 (nice!nano)', chip: 'nRF52840', family: 'nrf52', mhz: 64, vcc: 3.3, adcBits: 12, adcRef: 3.3, ledBuiltin: 47, lay: NICE_NANO, color: '#3b2a5c', layout: 'dual', usb: 'usbc', current: { active: 0.005, radio: 0.01, sleep: 0.000003 }, regulator: { dropout: 0.1 }, ble: true, price: 22, info: 'Bluetooth-LE-Profi im Pro-Micro-Format mit LiPo-Lader – beliebt für kabellose Tastaturen.' }),
  mk({ id: 'teensy-41', name: 'Teensy 4.1', chip: 'i.MX RT1062', family: 'imxrt', mhz: 600, vcc: 3.3, adcBits: 10, adcRef: 3.3, ledBuiltin: 13, analogMap: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i, 14 + i])), lay: TEENSY, color: '#2e7d32', layout: 'dual', usb: 'micro', current: { active: 0.1, sleep: 0.005 }, regulator: { dropout: 0.3 }, price: 35, info: 'Cortex-M7 mit 600 MHz – das schnellste Arduino-kompatible Board. Ideal für Audio und Echtzeit.' }),
  mk({ id: 'teensy-40', name: 'Teensy 4.0', chip: 'i.MX RT1062', family: 'imxrt', mhz: 600, vcc: 3.3, adcBits: 10, adcRef: 3.3, ledBuiltin: 13, analogMap: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i, 14 + i])), lay: TEENSY, color: '#2e7d32', layout: 'dual', usb: 'micro', current: { active: 0.1, sleep: 0.005 }, regulator: { dropout: 0.3 }, price: 28, info: 'Kompakte Variante des Teensy 4.1 (600 MHz Cortex-M7).' }),

  mk({ id: 'rpi-zero2w', name: 'Raspberry Pi Zero 2 W', chip: 'BCM2710A1', family: 'rpi', mhz: 1000, vcc: 3.3, adcBits: 0, adcRef: 3.3, lay: piHeader(260, 120, 30, 6), color: '#1b7a3b', layout: 'pizero', usb: 'micro', current: { active: 0.35, sleep: 0.1 }, regulator: { dropout: 0.2 }, wifi: true, ble: true, linux: true, price: 18, info: 'Quad-Core 1 GHz, 512 MB RAM, WLAN + BLE, Mini-HDMI. Bootet Raspberry Pi OS.' }),
  mk({ id: 'rpi-3', name: 'Raspberry Pi 3 B+', chip: 'BCM2837B0', family: 'rpi', mhz: 1400, vcc: 3.3, adcBits: 0, adcRef: 3.3, lay: piHeader(340, 224, 34, 6), color: '#1b7a3b', layout: 'pi', usb: 'micro', current: { active: 0.6, sleep: 0.35 }, regulator: { dropout: 0.2 }, wifi: true, ble: true, linux: true, price: 38, info: 'Quad-Core 1,4 GHz, 1 GB RAM, 4× USB, Gigabit-Ethernet (USB2), HDMI, WLAN + BLE.' }),
  mk({ id: 'rpi-4', name: 'Raspberry Pi 4 B', chip: 'BCM2711', family: 'rpi', mhz: 1800, vcc: 3.3, adcBits: 0, adcRef: 3.3, lay: piHeader(340, 224, 34, 6), color: '#1b7a3b', layout: 'pi', usb: 'usbc', current: { active: 0.75, sleep: 0.45 }, regulator: { dropout: 0.2 }, wifi: true, ble: true, linux: true, price: 55, info: 'Quad-Core Cortex-A72 1,8 GHz, 2–8 GB RAM, 2× Micro-HDMI (4K), USB 3, Gigabit-Ethernet.' }),
  mk({ id: 'rpi-5', name: 'Raspberry Pi 5', chip: 'BCM2712', family: 'rpi', mhz: 2400, vcc: 3.3, adcBits: 0, adcRef: 3.3, lay: piHeader(340, 224, 34, 6), color: '#1b7a3b', layout: 'pi', usb: 'usbc', current: { active: 1.0, sleep: 0.5 }, regulator: { dropout: 0.2 }, wifi: true, ble: true, linux: true, price: 80, info: 'Quad-Core Cortex-A76 2,4 GHz, bis 16 GB RAM, PCIe, Echtzeituhr, Ein-/Aus-Taster.' }),
];

export const BOARD_ALIASES: Record<string, string> = {
  uno: 'arduino-uno',
  'arduino-uno-r3': 'arduino-uno',
  'uno-r4': 'arduino-uno-r4-minima',
  nano: 'arduino-nano',
  mega: 'arduino-mega',
  'mega-2560': 'arduino-mega',
  esp32: 'esp32-devkit',
  'esp32-devkitc': 'esp32-devkit',
  'esp32-c3': 'esp32-c3-devkit',
  'esp32c3-supermini': 'esp32-c3-supermini',
  'esp32-c3-mini': 'esp32-c3-supermini',
  'esp32-s3': 'esp32-s3-devkit',
  'esp32-s2': 'esp32-s2-mini',
  'esp32-c5': 'esp32-c5-devkit',
  'esp32-c6': 'esp32-c6-devkit',
  'esp32-h2': 'esp32-h2-devkit',
  'esp32-p4': 'esp32-p4-devkit',
  esp8266: 'esp8266-nodemcu',
  nodemcu: 'esp8266-nodemcu',
  'raspberry-pi-pico': 'pico',
  'rpi-pico': 'pico',
  'pico-2': 'pico2',
  'pico-2-w': 'pico2-w',
  'raspberry-pi-4': 'rpi-4',
  'raspberry-pi-5': 'rpi-5',
  'raspberry-pi-3': 'rpi-3',
  'raspberry-pi-zero-2-w': 'rpi-zero2w',
  'pi-zero-2-w': 'rpi-zero2w',
  'blue-pill': 'stm32-bluepill',
  bluepill: 'stm32-bluepill',
  'nucleo-f401re': 'stm32-nucleo-f401',
  nrf52840: 'nrf52840-nicenano',
  teensy41: 'teensy-41',
  teensy40: 'teensy-40',
  digispark: 'attiny85',
};
