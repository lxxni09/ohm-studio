/**
 * Echter ESP32-Modus: Der Arduino-Sketch wird im Windows-Programm mit arduino-cli (ESP32-Kern von Espressif)
 * zu echtem Maschinencode übersetzt und im Espressif-QEMU ausgeführt. Pins, ADC, PWM, Deep-Sleep und BLE-Scan
 * laufen über die Ohm-Studio-Brücke (UART1) zwischen Firmware und simulierter Schaltung.
 * Unterstützt: ESP32 (Xtensa) und ESP32-C3 (RISC-V). Nicht nachgebildet: WLAN, I²C/SPI-Geräte, BLE-Werbung/Server.
 */
import type { McuCore } from '../core';
import type { Host } from '../runtime';
import type { BoardDef } from '../../parts/boards';

interface Esp32Api {
  status(): Promise<{ cli: boolean; core: boolean; riscv32: boolean; xtensa: boolean }>;
  install(): Promise<{ ok: boolean; error?: string }>;
  start(id: string, chip: string, code: string): Promise<{ ok: boolean; needsInstall?: boolean }>;
  stop(id: string): Promise<void>;
  bridge(id: string, line: string): void;
  serialIn(id: string, text: string): void;
  onEvent(fn: (ev: { id: string; type: string; text?: string; line?: string; code?: number }) => void): () => void;
  onProgress(fn: (p: { stage: string; frac: number; text: string }) => void): () => void;
}

export function esp32Api(): Esp32Api | null {
  return (globalThis as unknown as { ohmNative?: { esp32?: Esp32Api } }).ohmNative?.esp32 ?? null;
}

const MODES: Record<string, 'INPUT' | 'OUTPUT' | 'INPUT_PULLUP' | 'INPUT_PULLDOWN'> = { '0': 'INPUT', '1': 'OUTPUT', '2': 'INPUT_PULLUP', '3': 'INPUT_PULLDOWN' };

let seq = 0;

export class Esp32QemuCore implements McuCore {
  kind = 'esp32' as const;
  timeUs = 0;
  error: string | null = null;
  errorLine: number | null = null;
  halted = false;
  paused = false;
  sleep: 'awake' | 'deep' = 'awake';
  wifi = { status: 6, ssid: '', since: 0 };
  ble = { advertising: false, name: '' };
  breakpoints = new Set<number>();
  /** Zustand für die Oberfläche: übersetzen, läuft, Werkzeuge fehlen … */
  phase: 'leerlauf' | 'uebersetzen' | 'laeuft' | 'fehlt' | 'fehler' = 'leerlauf';
  private sid = `esp${++seq}`;
  private code = '';
  private unsub: (() => void) | null = null;
  private lastIn = '';
  private lastAdc = new Map<number, number>();
  private pending: string[] = [];
  private nextInputCheck = 0;

  constructor(
    private board: BoardDef,
    private host: Host,
  ) {}

  static supports(board: BoardDef): boolean {
    return board.family === 'esp32' && /^ESP32-C3$|^ESP32-WROOM|^ESP32$/.test(board.chip);
  }

  static available(): boolean {
    return !!esp32Api();
  }

  load(code: string): boolean {
    const changed = code !== this.code;
    this.code = code;
    this.error = null;
    // Code während des Laufs geändert → wie echtes Neu-Flashen: neu übersetzen und starten
    if (changed && (this.phase === 'laeuft' || this.phase === 'uebersetzen')) this.reset();
    if (!esp32Api()) {
      this.error = 'Der echte ESP32-Modus gibt es nur im Windows-Programm (Emulator als eigener Prozess).';
      return false;
    }
    return true;
  }

  private startTimer: ReturnType<typeof setTimeout> | null = null;

  reset() {
    // Mehrere Resets direkt hintereinander (Einschalten + Start) nur einmal übersetzen/starten
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      this.doReset();
    }, 30);
  }

  private doReset() {
    const api = esp32Api();
    if (!api) return;
    this.dispose();
    this.phase = 'uebersetzen';
    this.lastIn = '';
    this.lastAdc.clear();
    this.sleep = 'awake';
    this.host.onReset();
    this.host.serialWrite('[Ohm Studio] Übersetze für den echten ESP32 (arduino-cli) …\n');
    this.unsub = api.onEvent((ev) => {
      if (ev.id !== this.sid) return;
      if (ev.type === 'serial') this.host.serialWrite(ev.text ?? '');
      else if (ev.type === 'bridge') this.pending.push(ev.line ?? '');
      else if (ev.type === 'status') {
        if (/läuft/.test(ev.text ?? '')) this.phase = 'laeuft';
        this.host.serialWrite(`[Ohm Studio] ${ev.text}\n`);
      } else if (ev.type === 'compileError') {
        this.phase = 'fehler';
        this.error = `Übersetzen fehlgeschlagen:\n${shortLog(ev.text ?? '')}`;
        this.host.serialWrite(`[Ohm Studio] ${this.error}\n`);
      } else if (ev.type === 'error') {
        this.phase = 'fehler';
        this.error = ev.text ?? 'Fehler';
        this.host.serialWrite(`[Ohm Studio] ${this.error}\n`);
      } else if (ev.type === 'needsInstall') {
        this.phase = 'fehlt';
        this.error = 'Für den echten ESP32-Modus müssen einmalig die Espressif-Werkzeuge geladen werden (Einstellungen → ESP32-Emulator).';
        this.host.serialWrite(`[Ohm Studio] ${this.error}\n`);
      } else if (ev.type === 'exit') {
        if (this.phase === 'laeuft') this.host.serialWrite('[Ohm Studio] ESP32-Emulator beendet.\n');
        else if (ev.code !== 0 && ev.code !== null) {
          this.error = `ESP32-Emulator ist abgebrochen (Code ${ev.code}). ${(ev.text ?? '').trim().slice(-400)}`;
          this.host.serialWrite(`[Ohm Studio] ${this.error}\n`);
        }
        this.phase = 'leerlauf';
      }
    });
    void api.start(this.sid, this.board.chip, this.code);
  }

  /** Brückenmeldungen der Firmware verarbeiten und Eingänge melden */
  run(untilUs: number) {
    this.timeUs = untilUs;
    const api = esp32Api();
    if (!api) return;
    for (const line of this.pending.splice(0)) this.onBridge(line, api);
    if (this.phase !== 'laeuft' || untilUs < this.nextInputCheck) return;
    this.nextInputCheck = untilUs + 2000;
    // Eingangspegel aus der Simulation (Schwelle 1,65 V)
    let mask = 0n;
    for (let g = 0; g < 40; g++) if (this.host.readVoltage(g) > 1.65) mask |= 1n << BigInt(g);
    const s = mask.toString(16);
    if (s !== this.lastIn) {
      this.lastIn = s;
      api.bridge(this.sid, `I ${s}`);
    }
    // ADC (12 Bit, 0–3,3 V) für die analogen Pins
    for (const g of adcPins(this.board)) {
      const v = Math.round(Math.max(0, Math.min(3.3, this.host.readVoltage(g))) / 3.3 * 4095);
      if (Math.abs(v - (this.lastAdc.get(g) ?? -100)) > 6) {
        this.lastAdc.set(g, v);
        api.bridge(this.sid, `A ${g} ${v}`);
      }
    }
  }

  private onBridge(line: string, api: Esp32Api) {
    const [k, a, b, c] = line.split(' ');
    if (k === 'H') {
      this.sleep = 'awake';
      this.host.sleepChanged('awake');
      this.lastIn = '';
      this.lastAdc.clear();
      this.nextInputCheck = 0;
    } else if (k === 'M') this.host.pinMode(Number(a), MODES[b] ?? 'INPUT');
    else if (k === 'O') this.host.digitalWrite(Number(a), Number(b));
    else if (k === 'P') {
      const duty = Number(b);
      const freq = Number(c);
      if (freq > 0 && duty === 0.5 && freq < 20000) this.host.tone(Number(a), freq);
      else this.host.pwmWrite(Number(a), duty, freq);
    } else if (k === 'S') {
      const list = this.host.bleScan();
      api.bridge(this.sid, `R ${list.length}`);
      for (const d of list.slice(0, 16)) api.bridge(this.sid, `${d.mac} ${Math.round(d.rssi)} ${d.name ? d.name.replace(/\s+/g, '_') : '-'}`);
    } else if (k === 'Z') {
      this.sleep = 'deep';
      this.host.sleepChanged('deep');
      this.lastIn = '';
    }
  }

  checkInterrupts() {}

  serialFeed(text: string) {
    esp32Api()?.serialIn(this.sid, text);
  }

  dispose() {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
    this.unsub?.();
    this.unsub = null;
    void esp32Api()?.stop(this.sid);
    this.phase = 'leerlauf';
  }
}

function adcPins(board: BoardDef): number[] {
  return board.chip === 'ESP32-C3' ? [0, 1, 2, 3, 4] : [32, 33, 34, 35, 36, 39];
}

function shortLog(log: string): string {
  const errs = log.split('\n').filter((l) => /error|Fehler/i.test(l));
  return (errs.length ? errs : log.split('\n').slice(-8)).slice(0, 8).join('\n');
}
