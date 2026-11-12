/**
 * Gemeinsame Schnittstelle aller Mikrocontroller-Kerne:
 *  - „schnell“: Arduino-Übersetzer (McuRuntime)
 *  - „avr“: echte AVR-Emulation (avr8js) mit .hex-Firmware
 *  - „rp2040“: echte RP2040-Emulation (rp2040js) mit .uf2-Firmware oder MicroPython
 */
export type CoreKind = 'schnell' | 'avr' | 'rp2040' | 'esp32';

export interface DebugRegister {
  name: string;
  value: number;
  bits?: number;
}

export interface DebugView {
  kind: CoreKind;
  pc: number;
  registers: DebugRegister[];
  /** Speicherauszug (Adresse → Bytes) */
  memory(addr: number, len: number): Uint8Array;
  memoryName: string;
  memorySize: number;
  /** Peripherie-Zustände (Name → Text) */
  peripherals(): Record<string, string>;
  /** Variablen (nur Schnellmodus) */
  variables?(): Record<string, unknown>;
  line?: number | null;
}

export interface McuCore {
  kind: CoreKind;
  timeUs: number;
  error: string | null;
  errorLine: number | null;
  halted: boolean;
  /** angehalten am Haltepunkt / Einzelschritt */
  paused: boolean;
  sleep: 'awake' | 'deep';
  wifi: { status: number; ssid: string; since: number };
  ble: { advertising: boolean; name: string };
  load(code: string, lang?: string): boolean;
  reset(cause?: number): void;
  run(untilUs: number): void;
  checkInterrupts(): void;
  serialFeed(text: string): void;
  /** Haltepunkte: Zeilen (Schnellmodus) bzw. Programmadressen (Emulator) */
  breakpoints: Set<number>;
  step?(): void;
  resume?(): void;
  debug?(): DebugView | null;
  /** Ressourcen freigeben (z. B. Emulator-Prozess beenden) */
  dispose?(): void;
}

/** Intel-HEX → Bytes */
export function parseIntelHex(text: string, size: number): Uint8Array {
  const out = new Uint8Array(size).fill(0xff);
  let base = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith(':')) continue;
    const n = parseInt(line.slice(1, 3), 16);
    const addr = parseInt(line.slice(3, 7), 16);
    const type = parseInt(line.slice(7, 9), 16);
    if (type === 0) for (let i = 0; i < n; i++) out[base + addr + i] = parseInt(line.slice(9 + i * 2, 11 + i * 2), 16);
    else if (type === 2) base = parseInt(line.slice(9, 13), 16) << 4;
    else if (type === 4) base = parseInt(line.slice(9, 13), 16) << 16;
    else if (type === 1) break;
  }
  return out;
}

/** UF2-Blöcke (512 Byte) → (Adresse, Daten) */
export function* uf2Blocks(data: Uint8Array): Generator<{ addr: number; payload: Uint8Array }> {
  for (let o = 0; o + 512 <= data.length; o += 512) {
    const v = new DataView(data.buffer, data.byteOffset + o, 512);
    if (v.getUint32(0, true) !== 0x0a324655 || v.getUint32(4, true) !== 0x9e5d5157) continue;
    const addr = v.getUint32(12, true);
    const size = v.getUint32(16, true);
    yield { addr, payload: data.subarray(o + 32, o + 32 + size) };
  }
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
