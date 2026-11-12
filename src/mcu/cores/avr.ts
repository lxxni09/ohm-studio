/**
 * Präzisionsmodus für AVR (ATmega328P: Uno, Nano, Pro Mini; ATtiny85):
 * echte Befehlsausführung mit avr8js (MIT), gekoppelt an die Schaltung.
 */
import {
  CPU,
  avrInstruction,
  AVRIOPort,
  portBConfig,
  portCConfig,
  portDConfig,
  AVRTimer,
  timer0Config,
  timer1Config,
  timer2Config,
  AVRUSART,
  usart0Config,
  AVRADC,
  adcConfig,
  AVRClock,
  clockConfig,
  AVREEPROM,
  EEPROMMemoryBackend,
  eepromConfig,
  PinState,
} from 'avr8js';
import type { Host } from '../runtime';
import type { BoardDef } from '../../parts/boards';
import { parseIntelHex, type DebugView, type McuCore } from '../core';

const F = 16_000_000;

export class AvrCore implements McuCore {
  kind = 'avr' as const;
  timeUs = 0;
  error: string | null = null;
  errorLine: number | null = null;
  halted = false;
  paused = false;
  sleep: 'awake' | 'deep' = 'awake';
  wifi = { status: 0, ssid: '', since: 0 };
  ble = { advertising: false, name: '' };
  breakpoints = new Set<number>();
  private program: Uint16Array | null = null;
  private cpu: CPU | null = null;
  private ports: { port: AVRIOPort; name: string }[] = [];
  private usart: AVRUSART | null = null;
  private serialQueue: number[] = [];
  private cycleBase = 0;
  /** Arduino-Pin → [Port-Index, Bit] */
  private map: Map<number, [number, number]>;
  private last = new Map<number, { st: PinState; since: number; high: number; changes: number; pwm: boolean }>();
  private windowStart = 0;
  private tiny: boolean;

  constructor(public board: BoardDef, public host: Host) {
    this.tiny = board.id === 'attiny85';
    this.map = new Map();
    if (this.tiny) for (let b = 0; b < 5; b++) this.map.set(b, [0, b]);
    else {
      for (let d = 0; d < 8; d++) this.map.set(d, [2, d]); // PORTD
      for (let d = 8; d < 14; d++) this.map.set(d, [0, d - 8]); // PORTB
      for (let a = 0; a < 6; a++) this.map.set(14 + a, [1, a]); // PORTC
    }
  }

  static supports(b: BoardDef) {
    return ['arduino-uno', 'arduino-nano', 'arduino-pro-mini', 'attiny85'].includes(b.id);
  }

  load(code: string): boolean {
    try {
      const bytes = parseIntelHex(code, this.tiny ? 8192 : 32768);
      if (bytes.every((b) => b === 0xff)) throw new Error('Die .hex-Datei enthält keine Daten.');
      this.program = new Uint16Array(bytes.buffer);
      this.error = null;
      return true;
    } catch (e) {
      this.error = `Firmware ungültig: ${(e as Error).message}`;
      return false;
    }
  }

  reset() {
    if (!this.program) return;
    const cpu = new CPU(this.program, this.tiny ? 512 + 0x60 : 0x800);
    this.cpu = cpu;
    this.cycleBase = this.timeUs * (F / 1e6);
    this.ports = this.tiny ? [{ port: new AVRIOPort(cpu, portBConfig), name: 'PORTB' }] : [
      { port: new AVRIOPort(cpu, portBConfig), name: 'PORTB' },
      { port: new AVRIOPort(cpu, portCConfig), name: 'PORTC' },
      { port: new AVRIOPort(cpu, portDConfig), name: 'PORTD' },
    ];
    new AVRTimer(cpu, timer0Config);
    if (!this.tiny) {
      new AVRTimer(cpu, timer1Config);
      new AVRTimer(cpu, timer2Config);
      this.usart = new AVRUSART(cpu, usart0Config, F);
      this.usart.onByteTransmit = (b) => this.host.serialWrite(String.fromCharCode(b));
      const adc = new AVRADC(cpu, adcConfig);
      adc.onADCRead = (input) => {
        const ch = (input as { channel?: number }).channel ?? 0;
        const v = this.host.readVoltage(14 + ch);
        const val = Math.max(0, Math.min(1023, Math.round((v / 5) * 1023)));
        cpu.addClockEvent(() => adc.completeADCRead(val), adc.sampleCycles);
      };
      new AVREEPROM(cpu, new EEPROMMemoryBackend(1024), eepromConfig);
    }
    new AVRClock(cpu, F, clockConfig);
    this.last.clear();
    this.host.onReset();
    this.ports.forEach(({ port }, pi) => {
      port.addListener(() => this.onPort(pi));
    });
    this.halted = false;
    this.paused = false;
    this.windowStart = cpu.cycles;
  }

  private pinOf(pi: number, bit: number): number | undefined {
    for (const [pin, [p, b]] of this.map) if (p === pi && b === bit) return pin;
    return undefined;
  }

  private onPort(pi: number) {
    const port = this.ports[pi].port;
    const now = this.cpu!.cycles;
    for (let bit = 0; bit < 8; bit++) {
      const pin = this.pinOf(pi, bit);
      if (pin === undefined) continue;
      const st = port.pinState(bit);
      const prev = this.last.get(pin);
      if (prev && prev.st === st) continue;
      if (prev && prev.st === PinState.High) prev.high += now - Math.max(prev.since, this.windowStart);
      this.last.set(pin, { st, since: now, high: prev?.high ?? 0, changes: (prev?.changes ?? 0) + (prev && (prev.st === PinState.High || prev.st === PinState.Low) && (st === PinState.High || st === PinState.Low) ? 1 : 0), pwm: prev?.pwm ?? false });
      this.apply(pin, st);
    }
  }

  private apply(pin: number, st: PinState) {
    if (st === PinState.High || st === PinState.Low) {
      this.host.pinMode(pin, 'OUTPUT');
      this.host.digitalWrite(pin, st === PinState.High ? 1 : 0);
    } else this.host.pinMode(pin, st === PinState.InputPullUp ? 'INPUT_PULLUP' : 'INPUT');
  }

  private syncInputs() {
    for (const [pin, [pi, bit]] of this.map) {
      const st = this.ports[pi].port.pinState(bit);
      if (st === PinState.Input || st === PinState.InputPullUp) this.ports[pi].port.setPin(bit, this.host.readVoltage(pin) > 2.5);
    }
  }

  run(untilUs: number) {
    const cpu = this.cpu;
    if (!cpu || this.halted || this.paused) {
      this.timeUs = Math.max(this.timeUs, untilUs);
      if (cpu) this.cycleBase = untilUs * (F / 1e6) - cpu.cycles;
      return;
    }
    const target = untilUs * (F / 1e6) - this.cycleBase;
    this.windowStart = cpu.cycles;
    for (const v of this.last.values()) {
      v.high = 0;
      v.changes = 0;
    }
    this.syncInputs();
    if (this.usart && this.serialQueue.length && !this.usart.rxBusy) this.usart.writeByte(this.serialQueue.shift()!);
    let nextSync = cpu.cycles + 1600;
    const bp = this.breakpoints.size > 0;
    try {
      while (cpu.cycles < target) {
        if (bp && this.breakpoints.has(cpu.pc)) {
          this.paused = true;
          break;
        }
        avrInstruction(cpu);
        cpu.tick();
        if (cpu.cycles > nextSync) {
          this.syncInputs();
          nextSync = cpu.cycles + 1600;
        }
      }
    } catch (e) {
      this.error = `Emulator: ${(e as Error).message}`;
      this.halted = true;
      this.host.warn(this.error);
    }
    // Pins, die im Fenster mehrfach umgeschaltet haben → PWM-Mittelwert
    const win = Math.max(1, cpu.cycles - this.windowStart);
    for (const [pin, v] of this.last) {
      if (v.changes >= 2 && (v.st === PinState.High || v.st === PinState.Low)) {
        const high = v.high + (v.st === PinState.High ? cpu.cycles - Math.max(v.since, this.windowStart) : 0);
        this.host.pwmWrite(pin, Math.min(1, high / win), 490);
        v.pwm = true;
      } else if (v.pwm && (v.st === PinState.High || v.st === PinState.Low)) {
        // PWM beendet → wieder fester Pegel
        v.pwm = false;
        this.host.digitalWrite(pin, v.st === PinState.High ? 1 : 0);
      }
    }
    this.timeUs = (cpu.cycles + this.cycleBase) / (F / 1e6);
  }

  checkInterrupts() {}

  serialFeed(text: string) {
    for (const ch of text) this.serialQueue.push(ch.charCodeAt(0) & 0xff);
  }

  step() {
    if (!this.cpu) return;
    avrInstruction(this.cpu);
    this.cpu.tick();
    this.paused = true;
  }

  resume() {
    if (this.cpu && this.breakpoints.has(this.cpu.pc)) {
      avrInstruction(this.cpu);
      this.cpu.tick();
    }
    this.paused = false;
  }

  debug(): DebugView | null {
    const cpu = this.cpu;
    if (!cpu) return null;
    const regs = Array.from({ length: 32 }, (_, i) => ({ name: `R${i}`, value: cpu.data[i], bits: 8 }));
    const sreg = cpu.data[0x5f];
    return {
      kind: 'avr',
      pc: cpu.pc * 2,
      registers: [{ name: 'PC', value: cpu.pc * 2, bits: 16 }, { name: 'SP', value: cpu.SP, bits: 16 }, { name: 'SREG', value: sreg, bits: 8 }, { name: 'Zyklen', value: cpu.cycles }, ...regs],
      memory: (addr, len) => cpu.data.slice(addr, addr + len),
      memoryName: 'SRAM/IO',
      memorySize: cpu.data.length,
      peripherals: () => {
        const out: Record<string, string> = {};
        const fl = 'ITHSVNZC';
        out.SREG = fl.split('').map((f, i) => ((sreg >> (7 - i)) & 1 ? f : '·')).join('');
        if (!this.tiny) {
          out.DDRB = cpu.data[0x24].toString(2).padStart(8, '0');
          out.PORTB = cpu.data[0x25].toString(2).padStart(8, '0');
          out.DDRD = cpu.data[0x2a].toString(2).padStart(8, '0');
          out.PORTD = cpu.data[0x2b].toString(2).padStart(8, '0');
          out['Timer0 TCNT0'] = String(cpu.data[0x46]);
          out['Timer1 TCNT1'] = String(cpu.data[0x84] | (cpu.data[0x85] << 8));
          out['UART UBRR0'] = String(cpu.data[0xc4] | (cpu.data[0xc5] << 8)) + (cpu.data[0xc4] ? ` (≈ ${Math.round(F / 16 / ((cpu.data[0xc4] | (cpu.data[0xc5] << 8)) + 1))} Baud)` : '');
        } else out.PORTB = cpu.data[0x38].toString(2).padStart(8, '0');
        return out;
      },
    };
  }
}
