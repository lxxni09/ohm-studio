/** Anbindung nativer Werkzeuge in der Desktop-App (arduino-cli, QEMU, Renode, ngspice) */
import { engine, state, toast, emit, firmwareOverride } from './state/store';
import { getPart } from './parts/registry';

interface NativeApi {
  platform: string;
  which(cmd: string): Promise<string | null>;
  compile(fqbn: string, code: string): Promise<{ ok: boolean; log: string; hex?: string; uf2Base64?: string }>;
  updateCheck?(channel: string): Promise<{ ok: boolean; current: string; latest?: string; newer?: boolean; url?: string; notes?: string }>;
}

function api(): NativeApi | null {
  return (globalThis as unknown as { ohmNative?: NativeApi }).ohmNative ?? null;
}

export function nativeAvailable() {
  return !!api();
}

const FQBN: Record<string, string> = {
  'arduino-uno': 'arduino:avr:uno',
  'arduino-nano': 'arduino:avr:nano:cpu=atmega328',
  'arduino-pro-mini': 'arduino:avr:pro:cpu=16MHzatmega328',
  attiny85: 'attiny:avr:ATtinyX5:cpu=attiny85,clock=internal16',
  pico: 'rp2040:rp2040:rpipico',
  'pico-w': 'rp2040:rp2040:rpipicow',
};

/** Sketch mit arduino-cli zu echtem Maschinencode kompilieren und im Emulator starten */
export async function compileNative(target: string) {
  const a = api();
  const inst = state.project.parts.find((p) => p.id === target);
  const def = inst && getPart(inst.type);
  const code = state.project.code.find((c) => c.ziel === target);
  if (!a || !def?.board || !code) return;
  const fqbn = FQBN[def.board.id];
  if (!fqbn) {
    toast(`Für ${def.board.name} gibt es noch keinen Emulator im Präzisionsmodus (geplant: QEMU/Renode).`, 'warn');
    return;
  }
  toast('Kompiliere mit arduino-cli …', 'info');
  const r = await a.compile(fqbn, code.datei);
  if (!r.ok) {
    state.messages = [...state.messages, { level: 'error', text: `arduino-cli: ${r.log.slice(-1500)}`, time: engine.time }];
    toast('Kompilieren fehlgeschlagen – Details unter „Meldungen“.', 'error');
    emit();
    return;
  }
  if (r.hex) firmwareOverride.set(target, { code: r.hex, lang: 'hex' });
  else if (r.uf2Base64) firmwareOverride.set(target, { code: r.uf2Base64, lang: 'uf2' });
  const f = firmwareOverride.get(target);
  if (f) engine.setCode(target, f.code, f.lang);
  toast('Echter Maschinencode läuft jetzt im Emulator (Präzisionsmodus).', 'info');
  emit();
}

/** Installierte externe Engines erkennen (für Einstellungen/Status) */
export async function detectEngines(): Promise<Record<string, string | null>> {
  const a = api();
  const names = ['arduino-cli', 'qemu-system-xtensa', 'qemu-system-riscv32', 'qemu-system-aarch64', 'renode', 'ngspice'];
  const out: Record<string, string | null> = {};
  for (const n of names) out[n] = a ? await a.which(n) : null;
  return out;
}

export async function checkForUpdates(channel: string) {
  const a = api();
  if (!a?.updateCheck) return null;
  return a.updateCheck(channel);
}
