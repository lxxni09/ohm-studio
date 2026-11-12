/**
 * Laufzeitumgebung für übersetzte Arduino-Sketches.
 * Verbindet das Programm mit der Schaltung (Host) und führt es zeitgenau aus.
 */
import { compileSketch, CompileError, type CompileEnv, type CompiledProgram } from './compiler';
import { createLibObject, LIB_CLASSES, type LibHost } from './libs';
import type { McuCore, DebugView } from './core';
import type { BoardDef } from '../parts/boards';

export class Block {
  constructor(public us: number, public value: unknown = undefined, public promise?: Promise<unknown>) {}
}

export interface Host extends LibHost {
  pinMode(pin: number, mode: PinMode): void;
  digitalWrite(pin: number, level: number): void;
  pwmWrite(pin: number, duty: number, freq: number): void;
  readVoltage(pin: number): number;
  tone(pin: number, freq: number): void;
  noTone(pin: number): void;
  pulseIn(pin: number, level: number, timeoutUs: number): number;
  serialWrite(text: string, port?: number): void;
  warn(msg: string): void;
  sleepChanged(state: 'awake' | 'light' | 'deep'): void;
  onReset(): void;
}

export type PinMode = 'INPUT' | 'OUTPUT' | 'INPUT_PULLUP' | 'INPUT_PULLDOWN' | 'ANALOG';

const MODE_NAMES: Record<number, PinMode> = { 0: 'INPUT', 1: 'OUTPUT', 2: 'INPUT_PULLUP', 3: 'INPUT_PULLDOWN' };

type Gen = Generator<number | Block, unknown, unknown>;

export class McuRuntime implements McuCore {
  kind = 'schnell' as const;
  paused = false;
  breakpoints = new Set<number>();
  timeUs = 0;
  private wakeUs = 0;
  private ops = 0;
  private opsAtYield = 0;
  /** Simulierte Zeit pro „Operation“ (ca. 10–40 Taktzyklen) */
  private opUs: number;
  private budget = 2000;
  private gen: Gen | null = null;
  private inSetup = true;
  private prog: ReturnType<CompiledProgram['factory']> | null = null;
  compiled: CompiledProgram | null = null;
  error: string | null = null;
  errorLine: number | null = null;
  halted = false;
  sleep: 'awake' | 'deep' = 'awake';
  private wakeTimerUs: number | null = null;
  private wakePin: { pin: number; level: number; cause: number } | null = null;
  /** nichtflüchtiger Speicher (Preferences/EEPROM), überlebt Reset und Deep-Sleep */
  nvs = new Map<string, unknown>();
  eeprom = new Uint8Array(4096).fill(255);
  private pending: Promise<unknown> | null = null;
  private pendingValue: unknown;
  private pendingDone = false;
  serialIn: number[] = [];
  serialBaud = 0;
  rnd = 12345;
  interrupts: Map<number, { fn: unknown; mode: number; last: number }> = new Map();
  private interruptsEnabled = true;
  pinModes = new Map<number, PinMode>();
  pinOut = new Map<number, number>();
  ledc = new Map<number, { pin: number; freq: number; bits: number; duty: number }>();
  ledcPins = new Map<number, { freq: number; bits: number }>();
  analogBits: number;
  pwmBits = 8;
  wifi = { status: 0, ssid: '', since: 0 };
  ble = { advertising: false, name: '' };
  bootCount = 0;
  wakeCause = 0;
  objects: Record<string, unknown> = {};
  sourceCode = '';

  constructor(public board: BoardDef, public host: Host) {
    this.opUs = board.family === 'avr' ? 1.2 : 0.08;
    this.analogBits = board.adcBits;
  }

  env(): CompileEnv {
    const constants: Record<string, number> = {
      HIGH: 1, LOW: 0, INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2, INPUT_PULLDOWN: 3,
      CHANGE: 1, FALLING: 2, RISING: 3, ONLOW: 4, ONHIGH: 5,
      DEC: 10, HEX: 16, OCT: 8, BIN: 2, LSBFIRST: 0, MSBFIRST: 1,
      PI: Math.PI, HALF_PI: Math.PI / 2, TWO_PI: Math.PI * 2, DEG_TO_RAD: Math.PI / 180, RAD_TO_DEG: 180 / Math.PI, EULER: Math.E,
      LED_BUILTIN: this.board.ledBuiltin ?? -1,
      WL_IDLE_STATUS: 0, WL_NO_SSID_AVAIL: 1, WL_CONNECTED: 3, WL_CONNECT_FAILED: 4, WL_DISCONNECTED: 6,
      WIFI_STA: 1, WIFI_AP: 2, WIFI_AP_STA: 3, WIFI_OFF: 0,
      ESP_SLEEP_WAKEUP_UNDEFINED: 0, ESP_SLEEP_WAKEUP_EXT0: 2, ESP_SLEEP_WAKEUP_EXT1: 3, ESP_SLEEP_WAKEUP_TIMER: 4, ESP_SLEEP_WAKEUP_GPIO: 7,
      ESP_GPIO_WAKEUP_GPIO_LOW: 0, ESP_GPIO_WAKEUP_GPIO_HIGH: 1,
      DHT11: 11, DHT22: 22, DHT21: 21, AM2301: 21,
      SSD1306_SWITCHCAPVCC: 2, SSD1306_EXTERNALVCC: 1, SSD1306_WHITE: 1, SSD1306_BLACK: 0, SSD1306_INVERSE: 2, WHITE: 1, BLACK: 0, INVERSE: 2,
      NEO_GRB: 82, NEO_RGB: 6, NEO_KHZ800: 0, NEO_RGBW: 27,
      HTTP_CODE_OK: 200, NO_KEY: 0,
      SERIAL_8N1: 0x800001c, ADC_11db: 3, ADC_0db: 0,
      BME280_ADDRESS: 0x77, MPU6050_RANGE_8_G: 2, MPU6050_RANGE_500_DEG: 1, MPU6050_BAND_21_HZ: 4,
      UINT8_MAX: 255, INT16_MAX: 32767, INT32_MAX: 2147483647, UINT16_MAX: 65535, UINT32_MAX: 4294967295,
      ...Object.fromEntries(this.board.pins.filter((p) => p.gpio !== undefined).flatMap((p) => (p.aliases ?? []).map((a) => [a, p.gpio!]))),
      ...(this.board.constants ?? {}),
    };
    return {
      intBits: this.board.family === 'avr' ? 16 : 32,
      constants,
      classes: LIB_CLASSES,
      objects: ['Serial', 'Serial1', 'Serial2', 'SerialUSB', 'Wire', 'SPI', 'WiFi', 'BLEDevice', 'ESP', 'EEPROM', 'Keyboard', 'Mouse', 'NimBLEDevice', 'LittleFS', 'SPIFFS', 'WiFiClient'],
    };
  }

  load(src: string): boolean {
    this.sourceCode = src;
    try {
      this.compiled = compileSketch(src, this.env());
      this.error = null;
      this.errorLine = null;
      return true;
    } catch (e) {
      this.compiled = null;
      if (e instanceof CompileError) {
        this.error = e.message;
        this.errorLine = e.line;
      } else {
        this.error = `Übersetzungsfehler: ${(e as Error).message}`;
      }
      return false;
    }
  }

  /** Neustart (Reset-Knopf oder Aufwachen aus Deep Sleep) */
  reset(cause = 0) {
    this.gen = null;
    this.inSetup = true;
    this.halted = false;
    this.pinModes.clear();
    this.pinOut.clear();
    this.ledc.clear();
    this.ledcPins.clear();
    this.interrupts.clear();
    this.wakeUs = this.timeUs;
    this.wakeTimerUs = null;
    this.wakePin = null;
    this.pending = null;
    this.sleep = 'awake';
    this.wakeCause = cause;
    this.bootCount++;
    this.objects = {};
    this.wifi = { status: 0, ssid: '', since: 0 };
    this.ble = { advertising: false, name: '' };
    this.host.onReset();
    if (!this.compiled) return;
    try {
      this.prog = this.compiled.factory(this);
      this.gen = this.prog.setup() as Gen;
    } catch (e) {
      this.fail(e);
    }
  }

  /** Programm bis zur Zeit `untilUs` ausführen */
  run(untilUs: number) {
    if (this.paused) return;
    if (!this.gen || this.halted) {
      this.timeUs = Math.max(this.timeUs, untilUs);
      return;
    }
    if (this.sleep === 'deep') {
      if (this.wakePin && this.host.readVoltage(this.wakePin.pin) > this.board.vcc / 2 === (this.wakePin.level === 1)) {
        this.timeUs = untilUs;
        this.wake(this.wakePin.cause);
        return;
      }
      if (this.wakeTimerUs !== null && untilUs >= this.wakeTimerUs) {
        this.timeUs = this.wakeTimerUs;
        this.wake(4);
      } else {
        this.timeUs = untilUs;
        return;
      }
    }
    let guard = 0;
    while (this.timeUs < untilUs && this.gen && !this.halted) {
      if (this.pending) {
        if (!this.pendingDone) {
          this.timeUs = untilUs;
          return;
        }
        this.pending = null;
      }
      if (this.wakeUs > this.timeUs) {
        if (this.wakeUs >= untilUs) {
          this.timeUs = untilUs;
          return;
        }
        this.timeUs = this.wakeUs;
      }
      if (++guard > 20000) {
        this.timeUs = untilUs;
        return;
      }
      this.opsAtYield = this.ops;
      let r: IteratorResult<number | Block, unknown>;
      try {
        r = this.gen.next(this.pendingValue);
        this.pendingValue = undefined;
      } catch (e) {
        this.fail(e);
        return;
      }
      const spent = (this.ops - this.opsAtYield) * this.opUs;
      this.timeUs += Math.max(spent, 0.5);
      if (r.done) {
        if (this.inSetup) this.inSetup = false;
        this.gen = this.prog!.loop() as Gen;
        this.timeUs += this.board.family === 'avr' ? 2 : 0.3;
        continue;
      }
      const v = r.value;
      if (v === -2) {
        // Haltepunkt / Einzelschritt
        this.paused = true;
        this.timeUs = Math.max(this.timeUs, 0);
        return;
      }
      if (typeof v === 'number') {
        if (v > 0) this.wakeUs = this.timeUs + v;
      } else if (v instanceof Block) {
        if (v.promise) {
          this.pending = v.promise;
          this.pendingDone = false;
          v.promise.then(
            (val) => {
              this.pendingValue = val;
              this.pendingDone = true;
            },
            () => {
              this.pendingValue = undefined;
              this.pendingDone = true;
            },
          );
        }
        if (v.us > 0) this.wakeUs = this.timeUs + v.us;
      }
      if (this.sleep === 'deep') {
        this.timeUs = untilUs;
        return;
      }
    }
  }

  private wake(cause: number) {
    this.sleep = 'awake';
    this.host.sleepChanged('awake');
    this.reset(cause);
  }

  private fail(e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    this.error = `Laufzeitfehler: ${msg}`;
    this.halted = true;
    this.host.warn(this.error);
  }

  /* ------------------ vom generierten Code genutzt ------------------ */

  /* ------------------------- Debugger ------------------------- */
  ln = 0;
  dbg = false;
  private stepping = false;
  private resumeLine = -1;

  bp(line: number): boolean {
    if (this.stepping) {
      this.stepping = false;
      this.updateDbg();
      return true;
    }
    if (this.breakpoints.has(line) && line !== this.resumeLine) return true;
    if (line !== this.resumeLine) this.resumeLine = -1;
    return false;
  }

  updateDbg() {
    this.dbg = this.stepping || this.breakpoints.size > 0;
  }

  step() {
    this.stepping = true;
    this.paused = false;
    this.resumeLine = this.ln;
    this.updateDbg();
  }

  resume() {
    this.resumeLine = this.ln;
    this.paused = false;
    this.updateDbg();
  }

  debug(): DebugView | null {
    if (!this.prog) return null;
    const vars = this.prog.vars?.() ?? {};
    return {
      kind: 'schnell',
      pc: this.ln,
      line: this.paused ? this.ln : null,
      registers: [
        { name: 'Zeile', value: this.ln },
        { name: 'millis()', value: Math.floor(this.timeUs / 1000) },
      ],
      memory: () => new Uint8Array(0),
      memoryName: '—',
      memorySize: 0,
      variables: () => vars,
      peripherals: () => {
        const out: Record<string, string> = {};
        for (const [p, m] of this.pinModes) out[`Pin ${p}`] = `${m}${m === 'OUTPUT' ? ` = ${this.pinOut.get(p) ?? 0}` : ''}`;
        if (this.serialBaud) out.Serial = `${this.serialBaud} Baud`;
        if (this.wifi.status) out.WLAN = this.wifi.status === 3 ? `verbunden (${this.wifi.ssid})` : 'verbindet …';
        return out;
      },
    };
  }

  tick(): boolean {
    this.ops++;
    if (this.ops - this.opsAtYield > this.budget) return true;
    return false;
  }

  *blk(r: unknown): Generator<number | Block, unknown, unknown> {
    if (r instanceof Block) {
      const got = yield r;
      return r.promise ? got : r.value;
    }
    return r;
  }

  *mcall(obj: unknown, name: string, args: unknown[], line: number): Generator<number | Block, unknown, unknown> {
    this.ops++;
    if (typeof obj === 'string') return this.strMethod(obj, name, args);
    if (Array.isArray(obj) && name === 'length') return obj.length;
    if (obj == null) throw new Error(`Zeile ${line}: „${name}()“ wird auf einem nicht vorhandenen Objekt aufgerufen.`);
    const f = (obj as Record<string, unknown>)[name];
    if (typeof f !== 'function') {
      const cls = (obj as { __cls?: string }).__cls ?? 'Objekt';
      throw new Error(`Zeile ${line}: ${cls} kennt die Funktion „${name}()“ (noch) nicht.`);
    }
    const r = (f as (...a: unknown[]) => unknown).apply(obj, args);
    if (r instanceof Block) {
      const got = yield r;
      return r.promise ? got : r.value;
    }
    return r;
  }

  *callv(fn: unknown, args: unknown[]): Generator<number | Block, unknown, unknown> {
    if (typeof fn !== 'function') throw new Error('Aufruf eines Werts, der keine Funktion ist.');
    const r = fn(...args);
    if (r && typeof r === 'object' && typeof (r as Gen).next === 'function') return yield* r as Gen;
    return r;
  }

  prop(o: unknown, n: string): unknown {
    if (o == null) throw new Error(`Zugriff auf „.${n}“ eines nicht vorhandenen Objekts.`);
    if (typeof o === 'string' && n === 'length') return o.length;
    return (o as Record<string, unknown>)[n];
  }

  truthy(v: unknown): boolean {
    if (typeof v === 'string') return true;
    return !!v;
  }

  wrap(v: unknown, bits: number, unsigned: number): number {
    let n = typeof v === 'number' ? v : typeof v === 'boolean' ? +v : Number(v);
    if (!Number.isFinite(n)) return unsigned ? 0 : n > 0 ? 2 ** (bits - 1) - 1 : -(2 ** (bits - 1));
    n = Math.trunc(n);
    if (bits >= 53) return n;
    const m = 2 ** bits;
    n = ((n % m) + m) % m;
    if (!unsigned && n >= m / 2) n -= m;
    return n;
  }

  idiv(a: number, b: number, line: number): number {
    if (b === 0) {
      this.host.warn(`Zeile ${line}: Division durch 0! Auf echter Hardware gibt das ein unsinniges Ergebnis oder einen Absturz.`);
      return -1;
    }
    return Math.trunc(a / b);
  }
  div(a: number, b: number, line: number): number {
    if (Number.isInteger(a) && Number.isInteger(b)) return this.idiv(a, b, line);
    return a / b;
  }
  imod(a: number, b: number, line: number): number {
    if (b === 0) {
      this.host.warn(`Zeile ${line}: Rest-Division durch 0!`);
      return 0;
    }
    return Math.trunc(a) % Math.trunc(b);
  }
  bitop(a: number, b: number, op: string): number {
    // 53-Bit-sichere Bitoperationen für 32-Bit-Werte
    const x = BigInt.asUintN(53, BigInt(Math.trunc(a)));
    const y = BigInt.asUintN(53, BigInt(Math.trunc(b)));
    let r: bigint;
    if (op === '&') r = x & y;
    else if (op === '|') r = x | y;
    else r = x ^ y;
    const n = Number(r);
    return a < 0 && b < 0 && op !== '^' ? this.wrap(n, 32, 0) : n > 2 ** 52 ? this.wrap(n, 32, 0) : n;
  }
  shl(a: number, b: number): number {
    return Math.trunc(a) * 2 ** Math.trunc(b);
  }
  shr(a: number, b: number): number {
    return Math.floor(Math.trunc(a) / 2 ** Math.trunc(b));
  }

  toInt(v: unknown): number {
    if (typeof v === 'string') {
      const m = /^\s*[-+]?\d+/.exec(v);
      return m ? parseInt(m[0], 10) : 0;
    }
    return Math.trunc(Number(v) || 0);
  }
  toFloat(v: unknown): number {
    if (typeof v === 'string') return parseFloat(v) || 0;
    return Number(v) || 0;
  }

  str(v: unknown, ty: string): string {
    if (typeof v === 'string') return v;
    if (ty === 'char') return String.fromCharCode(Number(v));
    if (ty === 'float') return (v as number).toFixed(2);
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
    return String(v);
  }

  toStr(v: unknown, ty: string, arg?: number): string {
    if (typeof v === 'string') return v;
    if (ty === 'char') return String.fromCharCode(Number(v));
    if (arg !== undefined) {
      if (ty === 'float' || !Number.isInteger(v)) return (v as number).toFixed(arg);
      return Math.trunc(v as number).toString(arg).toUpperCase();
    }
    return this.str(v, ty);
  }

  /** Formatierung für print()/println() */
  fmt(v: unknown, ty: string, arg?: number): string {
    if (typeof v === 'string') return v;
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') return String(v);
    if (ty === 'char' && arg === undefined) return String.fromCharCode(Number(v));
    if (ty === 'float' || (ty === 'any' && !Number.isInteger(v))) {
      const n = v as number;
      if (Number.isNaN(n)) return 'nan';
      if (!Number.isFinite(n)) return 'inf';
      return n.toFixed(arg ?? 2);
    }
    const n = Math.trunc(v as number);
    if (arg === 16 || arg === 2 || arg === 8) return (n < 0 ? n >>> 0 : n).toString(arg).toUpperCase();
    return String(n);
  }

  charAt(s: string, i: number): number {
    return i < s.length ? s.charCodeAt(i) : 0;
  }

  arr(dims: number[], def: string): unknown[] {
    const mk = (d: number): unknown[] => {
      const n = dims[d] || 0;
      const a = new Array(n);
      for (let i = 0; i < n; i++) a[i] = d + 1 < dims.length ? mk(d + 1) : def === '""' ? '' : def === '0' ? 0 : JSON.parse(def);
      return a;
    };
    return mk(0);
  }
  pad(items: unknown[], size: number, def: string): unknown[] {
    const out = items.slice();
    while (out.length < size) out.push(def === '[]' ? [] : def === '""' ? '' : 0);
    return out;
  }
  strArr(s: string) {
    return s;
  }

  strMethod(s: string, name: string, a: unknown[]): unknown {
    switch (name) {
      case 'length':
        return s.length;
      case 'c_str':
      case 'toString':
        return s;
      case 'toInt':
        return this.toInt(s);
      case 'toFloat':
      case 'toDouble':
        return this.toFloat(s);
      case 'substring':
        return s.substring(a[0] as number, a[1] as number | undefined);
      case 'indexOf':
        return typeof a[0] === 'number' ? s.indexOf(String.fromCharCode(a[0]), (a[1] as number) ?? 0) : s.indexOf(a[0] as string, (a[1] as number) ?? 0);
      case 'lastIndexOf':
        return typeof a[0] === 'number' ? s.lastIndexOf(String.fromCharCode(a[0])) : s.lastIndexOf(a[0] as string);
      case 'charAt':
        return this.charAt(s, a[0] as number);
      case 'equals':
        return s === a[0] ? 1 : 0;
      case 'equalsIgnoreCase':
        return s.toLowerCase() === String(a[0]).toLowerCase() ? 1 : 0;
      case 'startsWith':
        return s.startsWith(a[0] as string) ? 1 : 0;
      case 'endsWith':
        return s.endsWith(a[0] as string) ? 1 : 0;
      case 'isEmpty':
        return s.length === 0 ? 1 : 0;
      case 'compareTo':
        return s < (a[0] as string) ? -1 : s > (a[0] as string) ? 1 : 0;
      default:
        return this.strm(s, name, a);
    }
  }

  strm(s: string, name: string, a: unknown[]): string {
    switch (name) {
      case 'trim':
        return s.trim();
      case 'toUpperCase':
        return s.toUpperCase();
      case 'toLowerCase':
        return s.toLowerCase();
      case 'replace':
        return s.split(this.str(a[0], typeof a[0] === 'number' ? 'char' : 'string')).join(this.str(a[1], typeof a[1] === 'number' ? 'char' : 'string'));
      case 'remove':
        return s.slice(0, a[0] as number) + (a[1] !== undefined ? s.slice((a[0] as number) + (a[1] as number)) : '');
      case 'concat':
        return s + this.str(a[0], 'any');
      case 'setCharAt':
        return s.slice(0, a[0] as number) + String.fromCharCode(a[1] as number) + s.slice((a[0] as number) + 1);
      default:
        return s;
    }
  }

  sprintf(fmt: string, ...args: unknown[]): string {
    let i = 0;
    return String(fmt).replace(/%([-+ 0#]*)(\d+)?(?:\.(\d+))?(l{0,2}|h{0,2})([diufFeEgxXscp%])/g, (_m, flags: string, width: string, prec: string, _len, conv: string) => {
      if (conv === '%') return '%';
      const v = args[i++];
      let s: string;
      switch (conv) {
        case 'd':
        case 'i':
        case 'u':
          s = String(Math.trunc(Number(v)));
          break;
        case 'f':
        case 'F':
          s = Number(v).toFixed(prec !== undefined ? +prec : 6);
          break;
        case 'e':
        case 'E':
          s = Number(v).toExponential(prec !== undefined ? +prec : 6);
          break;
        case 'g':
          s = String(Number(Number(v).toPrecision(prec !== undefined ? +prec || 1 : 6)));
          break;
        case 'x':
          s = (Number(v) >>> 0).toString(16);
          break;
        case 'X':
          s = (Number(v) >>> 0).toString(16).toUpperCase();
          break;
        case 'c':
          s = String.fromCharCode(Number(v));
          break;
        case 's':
          s = String(v ?? '');
          break;
        default:
          s = String(v);
      }
      if (flags.includes('+') && Number(v) >= 0 && 'difFeEg'.includes(conv)) s = '+' + s;
      if (width) {
        const w = +width;
        if (flags.includes('-')) s = s.padEnd(w);
        else s = s.padStart(w, flags.includes('0') ? '0' : ' ');
      }
      return s;
    });
  }

  dtostrf(v: number, width: number, prec: number): string {
    return v.toFixed(prec).padStart(width);
  }

  create(cls: string, args: unknown[], line?: number): unknown {
    const o = createLibObject(cls, args, this);
    if (!o) throw new Error(`Zeile ${line ?? '?'}: Die Bibliothek/Klasse „${cls}“ wird in der Simulation noch nicht unterstützt.`);
    return o;
  }

  /** globale Objekte (Serial, WiFi, BLEDevice, …) */
  get obj(): Record<string, unknown> {
    if (!this.objects.Serial) {
      const make = (n: string) => createLibObject(n, [], this);
      this.objects = {
        Serial: make('HardwareSerial'),
        Serial1: make('HardwareSerial'),
        Serial2: make('HardwareSerial'),
        SerialUSB: make('HardwareSerial'),
        Wire: make('TwoWire'),
        SPI: make('SPIClass'),
        WiFi: make('WiFiClass'),
        BLEDevice: make('BLEDevice'),
        NimBLEDevice: make('BLEDevice'),
        ESP: make('EspClass'),
        EEPROM: make('EEPROMClass'),
        Keyboard: make('Keyboard_'),
        Mouse: make('Keyboard_'),
        LittleFS: make('FS'),
        SPIFFS: make('FS'),
        WiFiClient: make('WiFiClient'),
      };
    }
    return this.objects;
  }

  /* ------------------------- Arduino-API ------------------------- */

  private pin(p: unknown): number {
    const n = Number(p);
    if (!Number.isFinite(n) || !this.board.pins.some((x) => x.gpio === n)) {
      throw new Error(`Pin ${String(p)} gibt es auf dem ${this.board.name} nicht.`);
    }
    return n;
  }

  fn: Record<string, (...a: any[]) => unknown> = {
    pinMode: (p: number, m: number) => {
      const pin = this.pin(p);
      const mode = MODE_NAMES[m] ?? 'INPUT';
      this.pinModes.set(pin, mode);
      this.host.pinMode(pin, mode);
    },
    digitalWrite: (p: number, v: number) => {
      const pin = this.pin(p);
      const lvl = v ? 1 : 0;
      const mode = this.pinModes.get(pin);
      if (mode !== 'OUTPUT') {
        if (mode === undefined || mode === 'INPUT') {
          // wie bei echter Hardware: Pull-up statt Ausgang
          if (lvl) {
            this.pinModes.set(pin, 'INPUT_PULLUP');
            this.host.pinMode(pin, 'INPUT_PULLUP');
            this.host.warn(`Pin ${pin}: digitalWrite() ohne pinMode(${pin}, OUTPUT) – der Pin ist noch ein Eingang. Es wird nur der schwache interne Pull-up eingeschaltet, eine LED leuchtet höchstens ganz schwach.`);
          }
          return;
        }
      }
      this.pinOut.set(pin, lvl);
      this.host.digitalWrite(pin, lvl);
    },
    digitalRead: (p: number) => {
      const pin = this.pin(p);
      if (this.pinModes.get(pin) === 'OUTPUT') return this.pinOut.get(pin) ?? 0;
      const v = this.host.readVoltage(pin);
      return v > this.board.vcc * 0.5 ? 1 : 0;
    },
    analogRead: (p: number) => {
      let pin = Number(p);
      if (this.board.analogMap && pin in this.board.analogMap) pin = this.board.analogMap[pin];
      pin = this.pin(pin);
      const info = this.board.pins.find((x) => x.gpio === pin);
      if (info && !info.adc) this.host.warn(`Pin ${pin} hat keinen Analog-Eingang (ADC). analogRead() liefert hier keine sinnvollen Werte.`);
      const v = this.host.readVoltage(pin);
      const max = 2 ** this.analogBits - 1;
      return Math.max(0, Math.min(max, Math.round((v / this.board.adcRef) * max)));
    },
    analogReadMilliVolts: (p: number) => Math.round(this.host.readVoltage(this.pin(p)) * 1000),
    analogReadResolution: (b: number) => {
      this.analogBits = b;
    },
    analogWriteResolution: (b: number) => {
      this.pwmBits = b;
    },
    analogReference: () => {},
    analogWriteFrequency: () => {},
    analogWrite: (p: number, v: number) => {
      const pin = this.pin(p);
      const info = this.board.pins.find((x) => x.gpio === pin);
      if (this.board.family === 'avr' && info && !info.pwm) {
        this.host.warn(`Pin ${pin} kann beim ${this.board.name} kein PWM (nur Pins mit ~). analogWrite() schaltet hier nur AN/AUS.`);
        const lvl = v >= 128 ? 1 : 0;
        this.pinModes.set(pin, 'OUTPUT');
        this.host.pinMode(pin, 'OUTPUT');
        this.host.digitalWrite(pin, lvl);
        return;
      }
      const max = 2 ** this.pwmBits - 1;
      this.pinModes.set(pin, 'OUTPUT');
      this.host.pinMode(pin, 'OUTPUT');
      this.host.pwmWrite(pin, Math.max(0, Math.min(1, v / max)), this.board.family === 'avr' ? 490 : 1000);
    },
    delay: (ms: number) => new Block(Math.max(0, ms) * 1000),
    sleep_ms: (ms: number) => new Block(Math.max(0, ms) * 1000),
    delayMicroseconds: (us: number) => new Block(Math.max(0, us)),
    sleep_us: (us: number) => new Block(Math.max(0, us)),
    yield: () => new Block(1),
    millis: () => Math.floor(this.timeUs / 1000) % 4294967296,
    micros: () => Math.floor(this.timeUs) % 4294967296,
    tone: (p: number, f: number, dur?: number) => {
      const pin = this.pin(p);
      this.host.tone(pin, f);
      if (dur) {
        const until = this.timeUs + dur * 1000;
        this.toneOff = { pin, at: until };
      }
    },
    noTone: (p: number) => this.host.noTone(this.pin(p)),
    pulseIn: (p: number, lvl: number, timeout = 1000000) => {
      const us = this.host.pulseIn(this.pin(p), lvl, timeout);
      return new Block(Math.min(us || timeout, timeout) + 50, us);
    },
    pulseInLong: (p: number, lvl: number, timeout = 1000000) => this.fn.pulseIn(p, lvl, timeout),
    shiftOut: (data: number, clock: number, order: number, val: number) => {
      for (let i = 0; i < 8; i++) {
        const bit = order === 1 ? (val >> (7 - i)) & 1 : (val >> i) & 1;
        this.fn.digitalWrite(data, bit);
        this.fn.digitalWrite(clock, 1);
        this.fn.digitalWrite(clock, 0);
      }
    },
    shiftIn: (data: number, clock: number, order: number) => {
      let v = 0;
      for (let i = 0; i < 8; i++) {
        this.fn.digitalWrite(clock, 1);
        const b = this.fn.digitalRead(data) as number;
        if (order === 1) v |= b << (7 - i);
        else v |= b << i;
        this.fn.digitalWrite(clock, 0);
      }
      return v;
    },
    random: (a: number, b?: number) => {
      this.rnd = (this.rnd * 1103515245 + 12345) % 2147483648;
      const r = this.rnd / 2147483648;
      if (b === undefined) return Math.floor(r * a);
      return a + Math.floor(r * (b - a));
    },
    randomSeed: (s: number) => {
      this.rnd = Math.abs(Math.trunc(s)) || 1;
    },
    esp_random: () => Math.floor(Math.random() * 4294967296),
    map: (x: number, a: number, b: number, c: number, d: number) => (b === a ? c : Math.trunc(((x - a) * (d - c)) / (b - a) + c)),
    constrain: (x: number, a: number, b: number) => Math.min(Math.max(x, a), b),
    min: (a: number, b: number) => Math.min(a, b),
    max: (a: number, b: number) => Math.max(a, b),
    abs: (a: number) => Math.abs(a),
    sq: (a: number) => a * a,
    sqrt: Math.sqrt,
    pow: Math.pow,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    atan2: Math.atan2,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    log: Math.log,
    log10: Math.log10,
    exp: Math.exp,
    fabs: Math.abs,
    fmod: (a: number, b: number) => a % b,
    isnan: (a: number) => (Number.isNaN(a) ? 1 : 0),
    isinf: (a: number) => (!Number.isFinite(a) && !Number.isNaN(a) ? 1 : 0),
    radians: (d: number) => (d * Math.PI) / 180,
    degrees: (r: number) => (r * 180) / Math.PI,
    bitRead: (v: number, b: number) => Math.floor(v / 2 ** b) % 2,
    bitSet: (v: number, b: number) => (Math.floor(v / 2 ** b) % 2 ? v : v + 2 ** b),
    bitClear: (v: number, b: number) => (Math.floor(v / 2 ** b) % 2 ? v - 2 ** b : v),
    bitWrite: (v: number, b: number, x: number) => (x ? this.fn.bitSet(v, b) : this.fn.bitClear(v, b)),
    bit: (b: number) => 2 ** b,
    lowByte: (v: number) => v & 0xff,
    highByte: (v: number) => (v >> 8) & 0xff,
    digitalPinToInterrupt: (p: number) => p,
    attachInterrupt: (p: number, fn: unknown, mode: number) => {
      const pin = this.pin(p);
      this.interrupts.set(pin, { fn, mode, last: this.host.readVoltage(pin) > this.board.vcc / 2 ? 1 : 0 });
    },
    detachInterrupt: (p: number) => {
      this.interrupts.delete(Number(p));
    },
    interrupts: () => {
      this.interruptsEnabled = true;
    },
    noInterrupts: () => {
      this.interruptsEnabled = false;
    },
    isDigit: (c: number) => (c >= 48 && c <= 57 ? 1 : 0),
    isAlpha: (c: number) => (/[A-Za-z]/.test(String.fromCharCode(c)) ? 1 : 0),
    isSpace: (c: number) => (/\s/.test(String.fromCharCode(c)) ? 1 : 0),
    isAlphaNumeric: (c: number) => (/[A-Za-z0-9]/.test(String.fromCharCode(c)) ? 1 : 0),
    isUpperCase: (c: number) => (c >= 65 && c <= 90 ? 1 : 0),
    isLowerCase: (c: number) => (c >= 97 && c <= 122 ? 1 : 0),
    toUpperCase: (c: number) => String.fromCharCode(c).toUpperCase().charCodeAt(0),
    toLowerCase: (c: number) => String.fromCharCode(c).toLowerCase().charCodeAt(0),
    atoi: (s: string) => this.toInt(s),
    atol: (s: string) => this.toInt(s),
    atof: (s: string) => this.toFloat(s),
    strlen: (s: string) => String(s).length,
    strcmp: (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0),
    dtostrf: (v: number, w: number, p: number) => this.dtostrf(v, w, p),
    __sizeof: (expr: string) => {
      const m = /^(\w+)/.exec(expr);
      const t = m?.[1] ?? '';
      const intB = this.board.family === 'avr' ? 2 : 4;
      const sizes: Record<string, number> = { char: 1, byte: 1, bool: 1, uint8_t: 1, int8_t: 1, int: intB, short: 2, word: 2, uint16_t: 2, int16_t: 2, long: 4, float: 4, double: this.board.family === 'avr' ? 4 : 8, uint32_t: 4, int32_t: 4 };
      if (t in sizes) return sizes[t];
      return 1;
    },
    ledcSetup: (ch: number, freq: number, bits: number) => {
      this.ledc.set(ch, { pin: -1, freq, bits, duty: 0 });
      return freq;
    },
    ledcAttachPin: (p: number, ch: number) => {
      const c = this.ledc.get(ch);
      if (c) c.pin = this.pin(p);
    },
    ledcAttach: (p: number, freq: number, bits: number) => {
      const pin = this.pin(p);
      this.ledcPins.set(pin, { freq, bits });
      return 1;
    },
    ledcAttachChannel: (p: number, freq: number, bits: number) => this.fn.ledcAttach(p, freq, bits),
    ledcWrite: (chOrPin: number, duty: number) => {
      // ESP32-Core 2.x: Kanal, Core 3.x: Pin
      const c = this.ledc.get(chOrPin);
      if (c && c.pin >= 0 && !this.ledcPins.has(chOrPin)) {
        this.host.pinMode(c.pin, 'OUTPUT');
        this.host.pwmWrite(c.pin, duty / (2 ** c.bits - 1), c.freq);
        return;
      }
      const lp = this.ledcPins.get(chOrPin);
      if (lp) {
        this.host.pinMode(chOrPin, 'OUTPUT');
        this.host.pwmWrite(chOrPin, duty / (2 ** lp.bits - 1), lp.freq);
      }
    },
    ledcWriteTone: (chOrPin: number, f: number) => {
      const c = this.ledc.get(chOrPin);
      const pin = c && c.pin >= 0 ? c.pin : chOrPin;
      if (f > 0) this.host.tone(pin, f);
      else this.host.noTone(pin);
      return f;
    },
    ledcDetach: () => {},
    esp_sleep_enable_timer_wakeup: (us: number) => {
      this.wakeTimerUs = -Math.abs(us);
    },
    esp_sleep_enable_ext0_wakeup: (p: number, lvl: number) => {
      this.wakePin = { pin: this.pin(p), level: lvl ? 1 : 0, cause: 2 };
    },
    esp_sleep_enable_ext1_wakeup: (mask: number, mode: number) => {
      for (let i = 0; i < 40; i++)
        if (Math.floor(mask / 2 ** i) % 2) {
          this.wakePin = { pin: i, level: mode ? 1 : 0, cause: this.board.chip.includes('C3') || this.board.chip.includes('C6') ? 7 : 3 };
          break;
        }
    },
    esp_deep_sleep_enable_gpio_wakeup: (mask: number, mode: number) => {
      this.fn.esp_sleep_enable_ext1_wakeup(mask, mode);
      if (this.wakePin) this.wakePin.cause = 7;
    },
    esp_sleep_get_wakeup_cause: () => this.wakeCause,
    esp_deep_sleep_start: () => {
      this.enterDeepSleep();
      return new Block(0);
    },
    esp_deep_sleep: (us: number) => {
      this.wakeTimerUs = -Math.abs(us);
      this.enterDeepSleep();
      return new Block(0);
    },
    esp_light_sleep_start: () => {
      const us = this.wakeTimerUs !== null ? Math.abs(this.wakeTimerUs) : 1000;
      return new Block(us);
    },
    temperatureRead: () => 42.5,
    touchRead: () => 60,
    neopixelWrite: (p: number, r: number, g: number, b: number) => this.host.rgbWrite?.(this.pin(p), r, g, b),
    rgbLedWrite: (p: number, r: number, g: number, b: number) => this.host.rgbWrite?.(this.pin(p), r, g, b),
    setCpuFrequencyMhz: () => {},
  };

  toneOff: { pin: number; at: number } | null = null;

  enterDeepSleep() {
    if (this.wakeTimerUs !== null && this.wakeTimerUs < 0) this.wakeTimerUs = this.timeUs + Math.abs(this.wakeTimerUs);
    this.sleep = 'deep';
    this.host.sleepChanged('deep');
    this.pinModes.clear();
    this.pinOut.clear();
    this.host.onReset();
    this.host.serialWrite('');
  }

  /** nach jedem Schaltungsschritt: Interrupts prüfen */
  checkInterrupts() {
    if (this.toneOff && this.timeUs >= this.toneOff.at) {
      this.host.noTone(this.toneOff.pin);
      this.toneOff = null;
    }
    if (!this.interruptsEnabled || !this.interrupts.size || this.sleep !== 'awake') return;
    for (const [pin, it] of this.interrupts) {
      const lvl = this.pinModes.get(pin) === 'OUTPUT' ? this.pinOut.get(pin) ?? 0 : this.host.readVoltage(pin) > this.board.vcc / 2 ? 1 : 0;
      const prev = it.last;
      it.last = lvl;
      const fire = (it.mode === 1 && lvl !== prev) || (it.mode === 3 && lvl && !prev) || (it.mode === 2 && !lvl && prev) || (it.mode === 4 && !lvl) || (it.mode === 5 && lvl);
      if (fire && typeof it.fn === 'function') {
        try {
          const g = (it.fn as () => Gen)();
          if (g && typeof g.next === 'function') {
            let n = 0;
            while (!g.next().done && n++ < 10000);
          }
        } catch (e) {
          this.fail(e);
        }
      }
    }
  }

  serialFeed(text: string) {
    for (const ch of text) this.serialIn.push(ch.charCodeAt(0));
  }
}
