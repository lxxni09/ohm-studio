/**
 * Präzisionsmodus für Raspberry Pi Pico (RP2040) mit rp2040js (MIT).
 *  - Sprache „uf2“: beliebige Firmware (C/C++ SDK, Rust Embassy, Arduino-Core …) als Base64-UF2
 *  - Sprache „micropython“: echtes MicroPython 1.24 (MIT) läuft im Emulator,
 *    das Skript wird über den Raw-REPL (USB-CDC) übertragen
 */
import { Simulator, GPIOPinState, USBCDC, ConsoleLogger, LogLevel } from 'rp2040js';
import { bootromB1 } from './rp2040-bootrom';
import type { Host } from '../runtime';
import type { BoardDef } from '../../parts/boards';
import { b64ToBytes, uf2Blocks, type DebugView, type McuCore } from '../core';

const FLASH_START = 0x10000000;
export const MICROPYTHON_URL = 'firmware/micropython-pico-1.24.1.uf2';

let mpCache: Promise<Uint8Array> | null = null;
/** MicroPython-Firmware laden (Browser: fetch, Node/Tests: Datei) */
export function loadMicroPython(): Promise<Uint8Array> {
  if (!mpCache) {
    mpCache = (async () => {
      if (typeof window !== 'undefined' && typeof fetch !== 'undefined') {
        const r = await fetch(MICROPYTHON_URL);
        if (!r.ok) throw new Error('MicroPython-Firmware nicht gefunden');
        return new Uint8Array(await r.arrayBuffer());
      }
      const fs = await import('node:fs');
      return new Uint8Array(fs.readFileSync(new URL('../../../public/' + MICROPYTHON_URL, import.meta.url)));
    })();
  }
  return mpCache;
}

export class Rp2040Core implements McuCore {
  kind = 'rp2040' as const;
  timeUs = 0;
  error: string | null = null;
  errorLine: number | null = null;
  halted = false;
  paused = false;
  sleep: 'awake' | 'deep' = 'awake';
  wifi = { status: 0, ssid: '', since: 0 };
  ble = { advertising: false, name: '' };
  breakpoints = new Set<number>();
  private sim: Simulator | null = null;
  private image: Uint8Array | null = null;
  private script: string | null = null;
  private nanoBase = 0;
  private cdc: USBCDC | null = null;
  private replState: 'boot' | 'raw' | 'running' | 'done' = 'boot';
  private replBuf = '';
  private pending: Promise<void> | null = null;
  private serialQueue: number[] = [];
  private gpioState = new Map<number, GPIOPinState>();
  private last = new Map<number, { st: GPIOPinState; since: number; high: number; changes: number; pwm: boolean }>();
  private windowStart = 0;

  constructor(public board: BoardDef, public host: Host) {}

  static supports(b: BoardDef) {
    return ['pico', 'pico-w', 'xiao-rp2040'].includes(b.id);
  }

  load(code: string, lang = 'uf2'): boolean {
    this.error = null;
    if (lang === 'micropython' || lang === 'python') {
      this.script = code;
      this.image = null;
      this.pending = loadMicroPython().then(
        (img) => {
          this.image = img;
        },
        (e) => {
          this.error = `MicroPython konnte nicht geladen werden: ${(e as Error).message}`;
        },
      );
      return true;
    }
    try {
      this.image = b64ToBytes(code);
      this.script = null;
      if (![...uf2Blocks(this.image)].length) throw new Error('keine UF2-Blöcke gefunden');
      return true;
    } catch (e) {
      this.error = `Firmware ungültig: ${(e as Error).message}`;
      return false;
    }
  }

  /** wartet, bis eine nachgeladene Firmware bereit ist */
  ready(): Promise<void> {
    return this.pending ?? Promise.resolve();
  }

  reset() {
    if (!this.image) {
      // Firmware lädt noch → später erneut
      this.pending?.then(() => this.reset());
      return;
    }
    const sim = new Simulator();
    const mcu = sim.rp2040;
    mcu.loadBootrom(bootromB1);
    mcu.logger = new ConsoleLogger(LogLevel.Error);
    for (const { addr, payload } of uf2Blocks(this.image)) mcu.flash.set(payload, addr - FLASH_START);
    mcu.uart[0].onByte = (b) => this.host.serialWrite(String.fromCharCode(b));
    this.sim = sim;
    this.nanoBase = this.timeUs * 1000;
    this.gpioState.clear();
    this.last.clear();
    this.host.onReset();
    for (let i = 0; i < 30; i++) {
      mcu.gpio[i].addListener((st) => this.onGpio(i, st));
    }
    mcu.adc.onADCRead = (ch) => {
      const v = ch < 3 ? this.host.readVoltage(26 + ch) : 0.7;
      mcu.adc.completeADCRead(Math.max(0, Math.min(4095, Math.round((v / 3.3) * 4095))), false);
    };
    this.replState = 'boot';
    this.replBuf = '';
    if (this.script !== null) {
      const cdc = new USBCDC(mcu.usbCtrl);
      this.cdc = cdc;
      cdc.onDeviceConnected = () => {
        // Strg-C (Abbruch), Strg-A (Raw-REPL)
        for (const b of [3, 3, 1]) cdc.sendSerialByte(b);
        this.replState = 'raw';
      };
      cdc.onSerialData = (buf: Uint8Array) => this.onRepl(buf);
    } else this.cdc = null;
    mcu.core.PC = FLASH_START;
    this.halted = false;
    this.paused = false;
  }

  private onRepl(buf: Uint8Array) {
    const text = String.fromCharCode(...buf);
    if (this.replState === 'raw') {
      this.replBuf += text;
      if (this.replBuf.includes('raw REPL') && this.replBuf.trimEnd().endsWith('>')) {
        const code = (this.script ?? '').replace(/\r\n/g, '\n');
        for (let i = 0; i < code.length; i++) this.cdc!.sendSerialByte(code.charCodeAt(i) & 0xff);
        this.cdc!.sendSerialByte(4); // Strg-D: ausführen
        this.replState = 'running';
        this.replBuf = '';
      }
      return;
    }
    if (this.replState === 'running') {
      this.replBuf += text;
      // Antwort: "OK" <Ausgabe> \x04 <Fehler> \x04 >
      let out = this.replBuf;
      if (out.startsWith('OK')) out = out.slice(2);
      const parts = out.split('\x04');
      if (parts.length >= 1) {
        this.host.serialWrite(parts[0].replace(/\r/g, ''));
        this.replBuf = this.replBuf.startsWith('OK') ? 'OK' : '';
        if (parts.length >= 2) {
          this.replBuf = '';
          const err = parts[1];
          if (err.trim()) {
            this.error = `MicroPython: ${err.trim().split('\n').pop()}`;
            const m = /line (\d+)/.exec(err);
            this.errorLine = m ? Number(m[1]) : null;
            this.host.serialWrite('\n' + err.replace(/\r/g, ''));
            this.host.warn(this.error);
          }
          this.replState = 'done';
        }
      }
      return;
    }
    if (this.replState === 'done') this.host.serialWrite(text.replace(/\r/g, '').replace(/\x04|^>/g, ''));
  }

  private onGpio(i: number, st: GPIOPinState) {
    const now = this.sim?.clock.nanos ?? 0;
    const prev = this.last.get(i);
    if (prev && prev.st === GPIOPinState.High) prev.high += now - Math.max(prev.since, this.windowStart);
    this.last.set(i, { st, since: now, high: prev?.high ?? 0, changes: (prev?.changes ?? 0) + (prev && (prev.st === GPIOPinState.High || prev.st === GPIOPinState.Low) && (st === GPIOPinState.High || st === GPIOPinState.Low) ? 1 : 0), pwm: prev?.pwm ?? false });
    this.gpioState.set(i, st);
    if (st === GPIOPinState.High || st === GPIOPinState.Low) {
      this.host.pinMode(i, 'OUTPUT');
      this.host.digitalWrite(i, st === GPIOPinState.High ? 1 : 0);
    } else this.host.pinMode(i, st === GPIOPinState.InputPullUp ? 'INPUT_PULLUP' : st === GPIOPinState.InputPullDown ? 'INPUT_PULLDOWN' : 'INPUT');
  }

  private syncInputs() {
    const mcu = this.sim!.rp2040;
    for (let i = 0; i < 30; i++) {
      const st = this.gpioState.get(i) ?? GPIOPinState.Input;
      if (st === GPIOPinState.High || st === GPIOPinState.Low) mcu.gpio[i].setInputValue(st === GPIOPinState.High);
      else mcu.gpio[i].setInputValue(this.host.readVoltage(i) > 1.65);
    }
  }

  run(untilUs: number) {
    const sim = this.sim;
    if (!sim || this.halted || this.paused) {
      if (sim) this.nanoBase = untilUs * 1000 - sim.clock.nanos;
      this.timeUs = Math.max(this.timeUs, untilUs);
      if (!sim && this.image) this.reset();
      return;
    }
    const mcu = sim.rp2040;
    const clock = sim.clock;
    const target = untilUs * 1000 - this.nanoBase;
    this.windowStart = clock.nanos;
    for (const v of this.last.values()) {
      v.high = 0;
      v.changes = 0;
    }
    this.syncInputs();
    while (this.serialQueue.length) {
      const b = this.serialQueue.shift()!;
      if (this.cdc) this.cdc.sendSerialByte(b);
      else mcu.uart[0].feedByte(b);
    }
    const cycleNanos = 8; // 125 MHz
    const bp = this.breakpoints.size > 0;
    try {
      let n = 0;
      while (clock.nanos < target) {
        if (mcu.core.waiting) {
          const d = Math.min(clock.nanosToNextAlarm, target - clock.nanos);
          clock.tick(Math.max(d, 1));
        } else {
          if (bp && this.breakpoints.has(mcu.core.PC)) {
            this.paused = true;
            break;
          }
          const c = mcu.core.executeInstruction();
          clock.tick(c * cycleNanos);
        }
        if (++n % 20000 === 0) this.syncInputs();
      }
    } catch (e) {
      this.error = `Emulator: ${(e as Error).message}`;
      this.halted = true;
      this.host.warn(this.error);
    }
    const win = Math.max(1, clock.nanos - this.windowStart);
    for (const [pin, v] of this.last) {
      if (v.changes >= 2 && (v.st === GPIOPinState.High || v.st === GPIOPinState.Low)) {
        const high = v.high + (v.st === GPIOPinState.High ? clock.nanos - Math.max(v.since, this.windowStart) : 0);
        this.host.pwmWrite(pin, Math.min(1, high / win), 1000);
        v.pwm = true;
      } else if (v.pwm && (v.st === GPIOPinState.High || v.st === GPIOPinState.Low)) {
        // PWM beendet → wieder fester Pegel
        v.pwm = false;
        this.host.digitalWrite(pin, v.st === GPIOPinState.High ? 1 : 0);
      }
    }
    this.timeUs = (clock.nanos + this.nanoBase) / 1000;
  }

  checkInterrupts() {}

  serialFeed(text: string) {
    for (const ch of text) this.serialQueue.push(ch.charCodeAt(0) & 0xff);
  }

  step() {
    const sim = this.sim;
    if (!sim) return;
    const c = sim.rp2040.core.executeInstruction();
    sim.clock.tick(c * 8);
    this.paused = true;
  }

  resume() {
    if (this.sim && this.breakpoints.has(this.sim.rp2040.core.PC)) this.step();
    this.paused = false;
  }

  debug(): DebugView | null {
    const sim = this.sim;
    if (!sim) return null;
    const core = sim.rp2040.core;
    const regs = Array.from({ length: 13 }, (_, i) => ({ name: `R${i}`, value: core.registers[i] >>> 0, bits: 32 }));
    return {
      kind: 'rp2040',
      pc: core.PC,
      registers: [{ name: 'PC', value: core.PC >>> 0, bits: 32 }, { name: 'SP', value: core.SP >>> 0, bits: 32 }, { name: 'LR', value: core.LR >>> 0, bits: 32 }, ...regs, { name: 'Zeit µs', value: Math.round(sim.clock.nanos / 1000) }],
      memory: (addr, len) => sim.rp2040.sram.slice(addr, addr + len),
      memoryName: 'SRAM (0x20000000)',
      memorySize: sim.rp2040.sram.length,
      peripherals: () => {
        const out: Record<string, string> = {};
        const st = ['L', 'H', 'in', 'pu', 'pd', 'bk'];
        out.GPIO = Array.from({ length: 29 }, (_, i) => `${i}:${st[sim.rp2040.gpio[i].value] ?? '?'}`).join(' ');
        out['MicroPython-REPL'] = this.cdc ? this.replState : '—';
        return out;
      },
    };
  }
}
