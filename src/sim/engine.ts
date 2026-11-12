/**
 * Ohm Studio – Simulations-Engine.
 * Baut aus dem Projekt die Schaltung, koppelt Mikrocontroller an die Knoten und
 * führt alles auf einer gemeinsamen Zeitachse aus.
 */
import { Capacitor, Circuit, Inductor, Source, terminalCurrents, type Device } from './mna';
import { getPart, findPin } from '../parts/registry';
import { breadboardHoles } from '../parts/library/basic';
import type { BoardDef } from '../parts/boards';
import type { Behaviour, BuildCtx, PartDef } from '../parts/types';
import { McuRuntime, type Host, type PinMode } from '../mcu/runtime';
import type { McuCore } from '../mcu/core';
import { AvrCore } from '../mcu/cores/avr';
import { Rp2040Core } from '../mcu/cores/rp2040';
import { Esp32QemuCore } from '../mcu/cores/esp32qemu';
import type { BleSeen, PartState } from '../mcu/libs';
import { i2cPins } from '../parts/library/boardParts';
import type { Project, PartInst } from '../ohm/model';
import { splitRef } from '../ohm/model';

export interface SimMessage {
  level: 'info' | 'warn' | 'error';
  text: string;
  part?: string;
  time: number;
}

export interface SoundReq {
  freq: number;
  vol: number;
  type: string;
}

/** Weltkoordinaten eines Pins (mit Drehung um die Bauteilmitte) */
export function pinWorld(inst: PartInst, def: PartDef, local: { x: number; y: number }): { x: number; y: number } {
  const { w, h } = def.size(inst.props);
  const cx = w / 2;
  const cy = h / 2;
  const dx = local.x - cx;
  const dy = local.y - cy;
  const r = ((inst.rot % 360) + 360) % 360;
  let x = dx;
  let y = dy;
  if (r === 90) {
    x = -dy;
    y = dx;
  } else if (r === 180) {
    x = -dx;
    y = -dy;
  } else if (r === 270) {
    x = dy;
    y = -dx;
  }
  return { x: inst.x + cx + x, y: inst.y + cy + y };
}

class UnionFind {
  p = new Map<string, string>();
  find(a: string): string {
    if (!this.p.has(a)) this.p.set(a, a);
    let r = a;
    while (this.p.get(r) !== r) r = this.p.get(r)!;
    let c = a;
    while (this.p.get(c) !== r) {
      const n = this.p.get(c)!;
      this.p.set(c, r);
      c = n;
    }
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.p.set(ra, rb);
  }
}

export interface Connectivity {
  /** pinKey → Wurzel */
  root: Map<string, string>;
  /** Wurzel → Mitglieder */
  groups: Map<string, string[]>;
  groundRoot: string | null;
  /** Netzname je Wurzel */
  names: Map<string, string>;
}

export function computeConnectivity(project: Project): Connectivity {
  const uf = new UnionFind();
  const defs = new Map(project.parts.map((p) => [p.id, getPart(p.type)]));
  const pinKeys: string[] = [];
  for (const inst of project.parts) {
    const def = defs.get(inst.id);
    if (!def) continue;
    for (const pin of def.pins(inst.props)) {
      const k = `${inst.id}.${pin.id}`;
      uf.find(k);
      pinKeys.push(k);
    }
    for (const g of def.bridges?.(inst.props) ?? []) for (let i = 1; i < g.length; i++) uf.union(`${inst.id}.${g[0]}`, `${inst.id}.${g[i]}`);
  }
  const names = new Map<string, string>();
  const byId = new Map(project.parts.map((p) => [p.id, p]));
  const canon = (ref: string): string | null => {
    const [pid, pn] = splitRef(ref);
    const inst = byId.get(pid);
    const def = inst && defs.get(pid);
    if (!inst || !def) return null;
    const pin = findPin(def, inst.props, pn);
    return pin ? `${pid}.${pin.id}` : null;
  };
  for (const net of project.nets) {
    const ks = net.pins.map(canon).filter((k): k is string => !!k);
    for (let i = 1; i < ks.length; i++) uf.union(ks[0], ks[i]);
  }
  // Steckbrett: Pins, die in Löchern stecken
  const boards = project.parts.filter((p) => p.type === 'steckbrett' || p.type === 'steckbrett-halb');
  if (boards.length) {
    const holeMap = new Map<string, string>();
    for (const bb of boards) {
      const { holes } = breadboardHoles(bb.type === 'steckbrett-halb');
      for (const h of holes) {
        const k = `${Math.round(bb.x + h.x)},${Math.round(bb.y + h.y)}`;
        holeMap.set(k, `${bb.id}#${h.strip}`);
      }
    }
    for (const inst of project.parts) {
      const def = defs.get(inst.id);
      if (!def || inst.type === 'steckbrett' || inst.type === 'steckbrett-halb') continue;
      for (const pin of def.pins(inst.props)) {
        const w = pinWorld(inst, def, pin);
        for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const strip = holeMap.get(`${Math.round(w.x) + dx},${Math.round(w.y) + dy}`);
          if (strip) {
            uf.union(`${inst.id}.${pin.id}`, strip);
            break;
          }
        }
      }
    }
  }
  const root = new Map<string, string>();
  const groups = new Map<string, string[]>();
  for (const k of pinKeys) {
    const r = uf.find(k);
    root.set(k, r);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(k);
  }
  for (const net of project.nets) {
    const k = net.pins.map(canon).find(Boolean);
    if (k) names.set(uf.find(k), net.name);
  }
  // Masse bestimmen
  let groundRoot: string | null = null;
  for (const [r, n] of names) if (/^(GND|MASSE|0|VSS|-)$/i.test(n)) groundRoot = r;
  if (!groundRoot) {
    let best = -1;
    for (const [r, members] of groups) {
      let score = 0;
      for (const m of members) {
        const [pid, pn] = splitRef(m);
        if (/^(GND|GND_\d+|-|VSS|COM|GND2)$/i.test(pn)) score += 2;
        const def = defs.get(pid);
        const pin = def?.pins(byId.get(pid)!.props).find((p) => p.id === pn);
        if (pin?.power === 'gnd') score += 3;
      }
      if (score > best) {
        best = score;
        groundRoot = r;
      }
    }
  }
  return { root, groups, groundRoot, names };
}

interface PartRuntime {
  inst: PartInst;
  def: PartDef;
  ctx: BuildCtx;
  beh: Behaviour | void;
  devices: Device[];
}

export class McuSlot implements Host {
  runtime: McuCore;
  gpioSrc = new Map<number, Source>();
  pinNode = new Map<number, number>();
  rail = -1;
  gnd = -1;
  modes = new Map<number, PinMode>();
  levels = new Map<number, number>();
  pwm = new Map<number, { duty: number; freq: number }>();
  tones = new Map<number, number>();
  vcc = 0;
  powered = false;
  appliedVcc = 0;
  serialOut = '';
  warnedPins = new Set<string>();
  bleName: string | null = null;
  outR: number;
  pullR: number;

  constructor(public engine: Engine, public id: string, public board: BoardDef) {
    this.runtime = new McuRuntime(board, this);
    this.outR = { avr: 25, esp32: 35, esp8266: 35, rp2040: 60, stm32: 40, nrf52: 60, samd: 50, imxrt: 40, rpi: 40, renesas: 30 }[board.family] ?? 40;
    this.pullR = { avr: 35000, esp32: 45000, rp2040: 50000 }[board.family as 'avr'] ?? 40000;
  }

  /** Programm laden und passenden Kern wählen (Schnellmodus, AVR- oder RP2040-Emulator) */
  program(code: string, lang = 'arduino') {
    const l = lang.toLowerCase();
    const wantAvr = (l === 'hex' || l === 'ihex') && AvrCore.supports(this.board);
    const wantRp = (l === 'uf2' || l === 'micropython' || l === 'python') && Rp2040Core.supports(this.board);
    const wantEsp = l === 'esp32-echt' && Esp32QemuCore.supports(this.board) && Esp32QemuCore.available();
    const kind = wantAvr ? 'avr' : wantRp ? 'rp2040' : wantEsp ? 'esp32' : 'schnell';
    if (this.runtime.kind !== kind) {
      const bps = this.runtime.breakpoints;
      this.runtime.dispose?.();
      this.runtime = kind === 'avr' ? new AvrCore(this.board, this) : kind === 'rp2040' ? new Rp2040Core(this.board, this) : kind === 'esp32' ? new Esp32QemuCore(this.board, this) : new McuRuntime(this.board, this);
      this.runtime.breakpoints = bps;
    }
    if ((l === 'hex' || l === 'uf2') && kind === 'schnell') {
      this.runtime.error = `Firmware-Dateien (.${l}) laufen im Präzisionsmodus nur auf ${l === 'hex' ? 'Arduino Uno, Nano, Pro Mini und ATtiny85' : 'Raspberry Pi Pico'}.`;
      return;
    }
    if (l === 'esp32-echt' && kind === 'schnell') {
      // kein Emulator verfügbar (Web-Version) oder Board nicht unterstützt → ehrlich im Schnellmodus weiter
      this.warn(Esp32QemuCore.supports(this.board) ? 'Echter ESP32-Modus nur im Windows-Programm – läuft hier im Schnellmodus.' : `Echter Modus unterstützt ${this.board.chip} noch nicht (ESP32 und ESP32-C3 gehen) – läuft im Schnellmodus.`);
      this.runtime.load(code, 'arduino');
      return;
    }
    if ((l === 'micropython' || l === 'python') && kind === 'schnell') {
      this.runtime.error = 'MicroPython läuft derzeit auf dem Raspberry Pi Pico (echte Firmware im Emulator).';
      return;
    }
    this.runtime.load(code, l);
  }

  bind(gpioSrc: Map<number, Source>, pinNode: Map<number, number>, rail: number, gnd: number) {
    this.gpioSrc = gpioSrc;
    this.pinNode = pinNode;
    this.rail = rail;
    this.gnd = gnd;
    for (const g of gpioSrc.keys()) this.apply(g);
  }

  apply(pin: number) {
    const s = this.gpioSrc.get(pin);
    if (!s) return;
    const mode = this.powered ? this.modes.get(pin) ?? 'INPUT' : 'INPUT';
    let v = 0;
    let r = 1e9;
    if (mode === 'OUTPUT') {
      const pw = this.pwm.get(pin);
      const tone = this.tones.get(pin);
      v = (tone ? 0.5 : pw ? pw.duty : this.levels.get(pin) ?? 0) * this.vcc;
      r = this.outR;
    } else if (mode === 'INPUT_PULLUP') {
      v = this.vcc;
      r = this.pullR;
    } else if (mode === 'INPUT_PULLDOWN') {
      v = 0;
      r = this.pullR;
    }
    if (s.v !== v || s.r !== r) {
      s.v = v;
      s.r = r;
      this.engine.markDirty();
    }
  }

  setPowered(p: boolean) {
    this.powered = p;
    if (p) {
      this.runtime.timeUs = this.engine.time * 1e6;
      this.runtime.reset();
    } else {
      this.modes.clear();
      this.levels.clear();
      this.pwm.clear();
      this.tones.clear();
      this.runtime.halted = false;
    }
    for (const g of this.gpioSrc.keys()) this.apply(g);
  }

  reset() {
    this.runtime.timeUs = this.engine.time * 1e6;
    this.runtime.reset();
    this.engine.message('info', `${this.id}: Neustart (Reset)`, this.id);
  }

  refreshVcc() {
    if (Math.abs(this.vcc - this.appliedVcc) > 0.03) {
      this.appliedVcc = this.vcc;
      for (const [g, m] of this.modes) if (m !== 'INPUT') this.apply(g);
    }
  }

  /* ---------------- Host ---------------- */
  pinMode(pin: number, mode: PinMode) {
    this.modes.set(pin, mode);
    this.pwm.delete(pin);
    this.apply(pin);
  }
  digitalWrite(pin: number, level: number) {
    this.levels.set(pin, level);
    this.pwm.delete(pin);
    this.apply(pin);
    const nd = this.pinNode.get(pin);
    if (nd !== undefined) this.engine.digitalEdge(nd, level);
  }
  pwmWrite(pin: number, duty: number, freq: number) {
    this.modes.set(pin, 'OUTPUT');
    if (duty <= 0) {
      this.pwm.delete(pin);
      this.levels.set(pin, 0);
    } else if (duty >= 1) {
      this.pwm.delete(pin);
      this.levels.set(pin, 1);
    } else this.pwm.set(pin, { duty, freq });
    this.apply(pin);
  }
  readVoltage(pin: number): number {
    const nd = this.pinNode.get(pin);
    if (nd === undefined) return 0;
    this.engine.ensureSolved();
    const v = this.engine.circuit!.voltage(nd) - this.engine.circuit!.voltage(this.gnd);
    if (v > this.board.vcc + 0.7 && !this.warnedPins.has('5v' + pin)) {
      this.warnedPins.add('5v' + pin);
      this.engine.message('error', `${this.id}: An Pin ${pin} liegen ${v.toFixed(1)} V – der ${this.board.chip} verträgt nur ${this.board.vcc} V! Spannungsteiler oder Pegelwandler verwenden.`, this.id);
    }
    return v;
  }
  tone(pin: number, freq: number) {
    this.modes.set(pin, 'OUTPUT');
    this.tones.set(pin, freq);
    this.apply(pin);
  }
  noTone(pin: number) {
    this.tones.delete(pin);
    this.apply(pin);
  }
  pulseIn(pin: number, level: number, timeoutUs: number): number {
    const nd = this.pinNode.get(pin);
    if (nd === undefined) return 0;
    const st = this.engine.partOnNode(nd, ['hc-sr04'], 'ECHO');
    if (st) {
      if (!st.powered) return 0;
      const cm = Number(st.props.entfernung ?? 50);
      const noise = this.engine.project.settings.realism ? (Math.random() - 0.5) * 2 : 0;
      const us = (cm + noise) * 58.3;
      return us < timeoutUs && level === 1 ? Math.round(us) : 0;
    }
    return 0;
  }
  serialWrite(text: string) {
    if (!text) return;
    this.serialOut += text;
    if (this.serialOut.length > 200000) this.serialOut = this.serialOut.slice(-100000);
    this.engine.onSerial?.(this.id, text);
  }
  warn(msg: string) {
    this.engine.message('warn', `${this.id}: ${msg}`, this.id);
  }
  sleepChanged(state: 'awake' | 'light' | 'deep') {
    if (state === 'deep') {
      this.modes.clear();
      this.levels.clear();
      this.pwm.clear();
      this.tones.clear();
      for (const g of this.gpioSrc.keys()) this.apply(g);
      this.engine.message('info', `${this.id}: Deep-Sleep 💤`, this.id);
    }
  }
  onReset() {
    this.modes.clear();
    this.levels.clear();
    this.pwm.clear();
    this.tones.clear();
    for (const g of this.gpioSrc.keys()) this.apply(g);
  }
  rgbWrite(pin: number, r: number, g: number, b: number) {
    const st = this.engine.states.get(this.id);
    if (st) st.rgb = [r, g, b];
    void pin;
  }

  /* ---------------- LibHost ---------------- */
  findI2C(kinds: string[]): PartState | null {
    const { sda } = i2cPins(this.board);
    const nd = this.pinNode.get(sda);
    if (nd === undefined) return null;
    return this.engine.partOnNode(nd, kinds, 'SDA');
  }
  findOnPin(pin: number, kinds: string[], pinName?: string): PartState | null {
    const nd = this.pinNode.get(pin);
    if (nd === undefined) return null;
    return this.engine.partOnNode(nd, kinds, pinName);
  }
  findAny(kinds: string[]): PartState | null {
    for (const nd of this.pinNode.values()) {
      const s = this.engine.partOnNode(nd, kinds);
      if (s) return s;
    }
    return null;
  }
  bleScan(): BleSeen[] {
    if (!this.board.ble) {
      this.warn('Dieses Board hat kein Bluetooth.');
      return [];
    }
    return this.engine.bleScan(this.id);
  }
  bleAdvertise(name: string | null) {
    this.bleName = name;
  }
  wifiAvailable(): boolean {
    if (!this.board.wifi) {
      this.warn('Dieses Board hat kein WLAN.');
      return false;
    }
    return true;
  }
}

export class Engine {
  project: Project;
  circuit: Circuit | null = null;
  time = 0;
  running = false;
  dirty = true;
  dynamic = false;
  needsRebuild = true;
  states = new Map<string, Record<string, any>>();
  parts: PartRuntime[] = [];
  mcus = new Map<string, McuSlot>();
  nodeOf = new Map<string, number>();
  conn: Connectivity | null = null;
  messages: SimMessage[] = [];
  sounds = new Map<string, SoundReq>();
  clicks: string[] = [];
  edgeListeners = new Map<number, { part: PartRuntime; pin: string; cb: (c: BuildCtx, pin: string, lvl: number) => void }[]>();
  logicLevels = new Map<number, number>();
  onSerial?: (id: string, text: string) => void;
  onMessage?: (m: SimMessage) => void;
  realtimeFactor = 1;
  private solveCount = 0;
  codes = new Map<string, { code: string; lang: string }>();
  bleAdvertisers = new Map<string, string>();

  constructor(project: Project) {
    this.project = project;
  }

  setProject(p: Project) {
    this.project = p;
    this.needsRebuild = true;
  }

  message(level: SimMessage['level'], text: string, part?: string) {
    if (this.messages.some((m) => m.text === text)) return;
    const m = { level, text, part, time: this.time };
    this.messages.push(m);
    if (this.messages.length > 200) this.messages.shift();
    this.onMessage?.(m);
  }

  markDirty() {
    this.dirty = true;
  }

  stateOf(id: string): Record<string, any> {
    let s = this.states.get(id);
    if (!s) {
      s = {};
      this.states.set(id, s);
    }
    return s;
  }

  /** Schaltung (neu) aufbauen – Zustände und laufende Programme bleiben erhalten */
  build() {
    const project = this.project;
    const conn = computeConnectivity(project);
    this.conn = conn;
    const nodeIdx = new Map<string, number>();
    let n = 0;
    for (const r of conn.groups.keys()) {
      if (r === conn.groundRoot) nodeIdx.set(r, -1);
      else nodeIdx.set(r, n++);
    }
    this.nodeOf.clear();
    for (const [k, r] of conn.root) this.nodeOf.set(k, nodeIdx.get(r)!);
    const internal: string[] = [];
    const parts: PartRuntime[] = [];
    // interne Knoten werden nach den Netzknoten vergeben
    const internals = new Map<string, number>();
    const prevX = this.circuit?.x;
    const circuit = new Circuit(0);
    this.edgeListeners.clear();
    this.dynamic = false;
    const self = this;
    const notFitted = new Set(project.activeVariant ? project.variants?.[project.activeVariant]?.ohne ?? [] : []);
    for (const inst of project.parts) {
      const def = getPart(inst.type);
      if (!def || notFitted.has(inst.id)) continue;
      const state = this.stateOf(inst.id);
      state.props = inst.props;
      // eslint-disable-next-line prefer-const
      let pr: PartRuntime;
      const ctx: BuildCtx = {
        id: inst.id,
        props: inst.props,
        state,
        circuit,
        node: (pin: string) => {
          const p = findPin(def, inst.props, pin);
          const k = `${inst.id}.${p?.id ?? pin}`;
          const nd = this.nodeOf.get(k);
          return nd === undefined ? -1 : nd;
        },
        internal: (name: string) => {
          const k = `${inst.id}~${name}`;
          if (!internals.has(k)) {
            internals.set(k, n++);
            internal.push(k);
          }
          return internals.get(k)!;
        },
        add: (d) => {
          pr.devices.push(d);
          return circuit.add(d);
        },
        v: (pin: string) => circuit.voltage(ctx.node(pin)),
        invalidate: () => {
          this.needsRebuild = true;
        },
        warn: (msg, level = 'warn') => this.message(level, msg, inst.id),
        get time() {
          return self.time;
        },
        get realism() {
          return self.project.settings.realism;
        },
        engine: this.api,
      };
      pr = { inst, def, ctx, beh: undefined, devices: [] };
      this.currentBuild = pr;
      pr.beh = def.build?.(ctx);
      parts.push(pr);
    }
    this.currentBuild = null;
    circuit.resize(n);
    if (prevX && prevX.length === n) circuit.x.set(prevX);
    this.circuit = circuit;
    this.parts = parts;
    // nicht mehr vorhandene MCUs entfernen
    for (const id of [...this.mcus.keys()]) if (!project.parts.some((p) => p.id === id)) this.mcus.delete(id);
    this.needsRebuild = false;
    this.dirty = true;
    this.solve(Infinity, true);
  }

  private currentBuild: PartRuntime | null = null;

  /** API für Bauteile (ctx.engine) */
  api = this.makeApi();

  private makeApi() {
    const self = this;
    return {
    markDirty: () => this.markDirty(),
    get dynamic() {
      return self.dynamic;
    },
    set dynamic(v: boolean) {
      if (v) self.dynamic = true;
    },
    registerMcu: (id: string, board: BoardDef, io: { gpioSrc: Map<number, Source>; pinNode: Map<number, number>; rail: number; gnd: number }) => {
      let slot = this.mcus.get(id);
      if (!slot || slot.board.id !== board.id) {
        slot = new McuSlot(this, id, board);
        this.mcus.set(id, slot);
        const code = this.codes.get(id);
        if (code !== undefined) slot.program(code.code, code.lang);
      }
      slot.bind(io.gpioSrc, io.pinNode, io.rail, io.gnd);
      return slot;
    },
    distanceTo: (id: string, types: string[]): number | null => {
      const me = this.project.parts.find((p) => p.id === id);
      if (!me) return null;
      const md = getPart(me.type)!.size(me.props);
      let best: number | null = null;
      for (const p of this.project.parts) {
        if (p.id === id || !types.includes(p.type)) continue;
        const d = getPart(p.type)!.size(p.props);
        const dist = Math.hypot(p.x + d.w / 2 - (me.x + md.w / 2), p.y + d.h / 2 - (me.y + md.h / 2)) - Math.max(md.w, md.h) / 2;
        if (best === null || dist < best) best = Math.max(0, dist);
      }
      return best;
    },
    sound: (key: string, freq: number, vol: number, type: string) => {
      if (type === 'click') {
        this.clicks.push(key);
        return;
      }
      if (freq > 0 && vol > 0) this.sounds.set(key, { freq, vol, type });
      else this.sounds.delete(key);
    },
    toneOnNet: (id: string, pins: string[]): number => {
      const nodes = pins.map((p) => this.nodeOf.get(`${id}.${p}`));
      let any = 0;
      let count = 0;
      for (const slot of this.mcus.values()) {
        for (const [pin, f] of slot.tones) {
          count++;
          any = f;
          if (nodes.includes(slot.pinNode.get(pin))) return f;
        }
      }
      if (count === 1 && this.circuit) {
        const [a, b] = nodes;
        const v = Math.abs(this.circuit.voltage(a ?? -1) - this.circuit.voltage(b ?? -1));
        if (v > 0.1) return any;
      }
      return 0;
    },
    onEdge: (id: string, pins: string[], cb: (c: BuildCtx, pin: string, lvl: number) => void) => {
      const pr = this.currentBuild;
      if (!pr) return;
      for (const pin of pins) {
        const nd = pr.ctx.node(pin);
        if (nd < 0) continue;
        if (!this.edgeListeners.has(nd)) this.edgeListeners.set(nd, []);
        this.edgeListeners.get(nd)!.push({ part: pr, pin, cb });
      }
      void id;
    },
    logic: (id: string, pin: string, vcc: number): number => {
      const pr = this.parts.find((p) => p.inst.id === id);
      if (!pr || !this.circuit) return 0;
      const nd = pr.ctx.node(pin);
      if (this.logicLevels.has(nd)) return this.logicLevels.get(nd)!;
      return this.circuit.voltage(nd) > Math.max(vcc, 1) / 2 ? 1 : 0;
    },
    findConnected: (id: string, pins: string[], types: string[]): Record<string, any>[] => {
      const out: Record<string, any>[] = [];
      for (const pin of pins) {
        const nd = this.nodeOf.get(`${id}.${pin}`);
        if (nd === undefined) continue;
        const s = this.partOnNode(nd, types);
        if (s && !out.includes(s)) out.push(s);
      }
      return out;
    },
    /** hängt am Pin eine externe Spannungsquelle (Batterie, Netzteil, Regler-Ausgang)? */
    hasExternalSource: (id: string, pin: string): boolean => {
      const r = this.conn?.root.get(`${id}.${pin}`);
      if (!r) return false;
      return (this.conn!.groups.get(r) ?? []).some((k) => {
        const [pid, pn] = splitRef(k);
        if (pid === id) return false;
        const inst = this.project.parts.find((p) => p.id === pid);
        const def = inst && getPart(inst.type);
        if (!def) return false;
        if (def.category === 'Stromversorgung') return !/^(IN|IN\+|IN-|-|GND)$/i.test(pn) || pn === '+';
        if (def.type.startsWith('AMS1117') || def.type === 'LM7805' || def.type === 'HT7333') return pn === 'OUT';
        if (def.board && pn === pin) return false;
        return false;
      });
    },
    isConnected: (id: string, pin: string): boolean => {
      const r = this.conn?.root.get(`${id}.${pin}`);
      if (!r) return false;
      return (this.conn!.groups.get(r) ?? []).some((k) => !k.startsWith(id + '.'));
    },
    batteryCapacity: (): number | null => {
      for (const p of this.project.parts) {
        const s = this.states.get(p.id);
        if (s?.capacityAh) return s.capacityAh;
      }
      return null;
    },
  };
  }

  /** Bauteil eines Typs, dessen (benannter) Pin am Knoten hängt */
  partOnNode(nd: number, kinds: string[], pinName?: string): PartState | null {
    for (const pr of this.parts) {
      if (!kinds.includes(pr.inst.type) && !kinds.includes(pr.def.type)) continue;
      const pins = pr.def.pins(pr.inst.props);
      for (const p of pins) {
        if (pinName && p.id !== pinName && !(p.aliases ?? []).includes(pinName)) continue;
        if (this.nodeOf.get(`${pr.inst.id}.${p.id}`) === nd) {
          const st = this.stateOf(pr.inst.id);
          st.props = pr.inst.props;
          return st;
        }
      }
    }
    return null;
  }

  bleScan(selfId: string): BleSeen[] {
    const out: BleSeen[] = [];
    const realism = this.project.settings.realism;
    const rssiAt = (d: number, tx: number) => Math.round(tx - 10 * 2.2 * Math.log10(Math.max(d, 0.05)) + (realism ? (Math.random() - 0.5) * 8 : 0));
    for (const p of this.project.parts) {
      if (p.type === 'ble-beacon' && p.props.aktiv !== false) {
        const d = Number(p.props.entfernung ?? 1);
        if (d > 40) continue;
        out.push({ mac: String(p.props.mac ?? '00:00:00:00:00:00').toLowerCase(), name: String(p.props.name ?? ''), rssi: rssiAt(d, Number(p.props.sendeleistung ?? -59)) });
      }
    }
    const me = this.project.parts.find((p) => p.id === selfId);
    for (const [id, slot] of this.mcus) {
      if (id === selfId || !slot.bleName || !slot.powered) continue;
      const other = this.project.parts.find((p) => p.id === id);
      const d = me && other ? Math.hypot(me.x - other.x, me.y - other.y) / 100 : 1;
      out.push({ mac: `24:0a:c4:${(id.charCodeAt(0) % 99).toString(16).padStart(2, '0')}:00:01`, name: slot.bleName, rssi: rssiAt(d, -59) });
    }
    return out;
  }

  digitalEdge(nd: number, level: number) {
    this.logicLevels.set(nd, level);
    const ls = this.edgeListeners.get(nd);
    if (!ls) return;
    for (const l of ls) l.cb(l.part.ctx, l.pin, level);
  }

  ensureSolved() {
    if (this.dirty && this.circuit) this.solve(this.project.settings.dt, false);
  }

  solve(dt: number, commit = true) {
    if (!this.circuit) return;
    const r = this.circuit.solve(dt, Number.isFinite(dt) ? 80 : 200, commit);
    this.solveCount++;
    // nicht konvergiert → im nächsten Schritt weiterrechnen (warm start)
    this.dirty = !r.ok;
    // Vorschau-Lösungen (beim Lesen von Pins) müssen später noch übernommen werden
    this.uncommitted = !commit;
    if (!r.ok && !this._warnedConv) {
      this._warnedConv = true;
      this.message('warn', 'Die Schaltung ließ sich nicht ganz genau berechnen (keine Konvergenz). Gibt es einen Kurzschluss oder offene Eingänge?');
    }
  }
  private _warnedConv = false;
  uncommitted = false;

  /** Code für einen Mikrocontroller setzen */
  setCode(id: string, code: string, lang = 'arduino'): string | null {
    this.codes.set(id, { code, lang });
    const slot = this.mcus.get(id);
    if (slot) {
      slot.program(code, lang);
      return slot.runtime.error;
    }
    return null;
  }

  start() {
    this.running = true;
    this.time = 0;
    this.messages = [];
    this.states.clear();
    this.mcus.clear();
    this.logicLevels.clear();
    this.sounds.clear();
    this.needsRebuild = true;
    this.build();
    // Einschalten wie in echt: Kondensatoren leer, Spulen stromlos (statt Gleichstrom-Arbeitspunkt)
    if (this.circuit) {
      for (const d of this.circuit.devices) {
        if (d instanceof Capacitor) d.vPrev = d.v = 0;
        else if (d instanceof Inductor) d.iPrev = 0;
      }
      this.dirty = true;
      this.solve(this.project.settings.dt, true);
    }
    for (const [id, slot] of this.mcus) {
      const code = this.codes.get(id);
      if (code !== undefined) slot.program(code.code, code.lang);
      if (slot.runtime.error) this.message('error', `${id}: ${slot.runtime.error}`, id);
      else if (code === undefined && !slot.board.linux) this.message('info', `${id}: Kein Programm geladen – der Mikrocontroller tut nichts. Schreibe Code im Editor unten.`, id);
      if (slot.powered) slot.reset();
    }
  }

  stop() {
    this.running = false;
    this.sounds.clear();
    for (const slot of this.mcus.values()) slot.runtime.dispose?.();
  }

  /** Simulation um `realDt` Sekunden Echtzeit voranbringen */
  advance(realDt: number) {
    if (!this.running) return;
    if (this.needsRebuild) this.build();
    const dt = this.project.settings.dt;
    const target = Math.min(realDt, 0.1) * this.project.settings.speed;
    let steps = Math.max(1, Math.round(target / dt));
    const maxSteps = 400;
    this.realtimeFactor = steps > maxSteps ? maxSteps / steps : 1;
    steps = Math.min(steps, maxSteps);
    const t0 = performance.now();
    for (let s = 0; s < steps; s++) {
      this.step(dt);
      if (performance.now() - t0 > 30) {
        this.realtimeFactor = (s + 1) / steps;
        break;
      }
    }
    for (const st of this.states.values()) st.now = this.time;
  }

  step(dt: number) {
    if (this.needsRebuild) this.build();
    this.time += dt;
    for (const p of this.parts) p.beh?.pre?.(p.ctx, dt);
    for (const slot of this.mcus.values()) {
      slot.refreshVcc();
      if (slot.powered) slot.runtime.run(this.time * 1e6);
    }
    if (this.dirty || this.dynamic || this.uncommitted) this.solve(dt, true);
    // Überlast-Prüfung der GPIOs direkt nach dem Lösen: danach können Ton/Interrupts die Pinspannung schon
    // umschalten, und der Strom aus der alten Lösung wäre falsch (früher z. B. 82 mA statt 35 mA beim Summer)
    for (const slot of this.mcus.values()) {
      for (const [g, src] of slot.gpioSrc) {
        if (src.r > 1000) continue;
        const i = Math.abs(src.current(this.circuit!.x));
        if (i > 0.045 && !slot.warnedPins.has('i' + g)) {
          slot.warnedPins.add('i' + g);
          this.message('error', `${slot.id}: Pin ${g} liefert ${(i * 1000).toFixed(0)} mA – erlaubt sind höchstens ~${slot.board.family === 'avr' ? 40 : 20} mA. Fehlt ein Vorwiderstand oder Transistor?`, slot.id);
        }
      }
    }
    for (const p of this.parts) p.beh?.post?.(p.ctx, dt);
    for (const slot of this.mcus.values()) if (slot.powered) slot.runtime.checkInterrupts();
  }

  /** Strom, der an jedem Pin in das Bauteil hineinfließt (A) */
  pinCurrents(): Map<string, number> {
    const out = new Map<string, number>();
    if (!this.circuit) return out;
    const x = this.circuit.x;
    for (const pr of this.parts) {
      const byNode = new Map<number, number>();
      for (const d of pr.devices) {
        const ic = terminalCurrents(d, x);
        d.nodes.forEach((nd, k) => byNode.set(nd, (byNode.get(nd) ?? 0) + (ic[k] ?? 0)));
      }
      const seen = new Set<number>();
      for (const pin of pr.def.pins(pr.inst.props)) {
        const nd = this.nodeOf.get(`${pr.inst.id}.${pin.id}`);
        if (nd === undefined || seen.has(nd)) continue;
        seen.add(nd);
        out.set(`${pr.inst.id}.${pin.id}`, byNode.get(nd) ?? 0);
      }
    }
    return out;
  }

  /** Spannung eines Pins (für Tooltips/Multimeter) */
  pinVoltage(partId: string, pinId: string): number | null {
    const nd = this.nodeOf.get(`${partId}.${pinId}`);
    if (nd === undefined || !this.circuit) return null;
    return this.circuit.voltage(nd);
  }

  netVoltage(rootKey: string): number | null {
    const nd = this.nodeOf.get(rootKey);
    return nd === undefined || !this.circuit ? null : this.circuit.voltage(nd);
  }
}
