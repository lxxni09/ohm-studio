/**
 * Zentraler App-Zustand. Das Projekt ist bewusst ein veränderliches Objekt,
 * damit die Simulation Live-Änderungen (Schieberegler, Taster) sofort sieht.
 */
import { useSyncExternalStore, useRef } from 'react';
import { Engine, type SimMessage } from '../sim/engine';
import { emptyProject, splitRef, type Project, type PartInst } from '../ohm/model';
import { parseOhm, serializeOhm, validateProject, type Issue, autoPlace } from '../ohm/format';
import { getPart, findPin, partDefaults } from '../parts/registry';
import { DEFAULT_SKETCH } from './defaults';

export type ViewMode = 'steckbrett' | 'schaltplan' | 'platine';
export type BottomTab = 'code' | 'serial' | 'meters' | 'messages' | 'tests' | 'debug';
export type SimStatus = 'stopped' | 'running' | 'paused';

export interface AppState {
  project: Project;
  selection: string[];
  selectedNet: string | null;
  view: ViewMode;
  pcb3d: boolean;
  sim: SimStatus;
  bottomOpen: boolean;
  bottomTab: BottomTab;
  codeTarget: string | null;
  issues: Issue[];
  serial: Record<string, string>;
  messages: SimMessage[];
  theme: 'system' | 'light' | 'dark';
  learnMode: boolean;
  tick: number;
  fileName: string;
  dirty: boolean;
  modal: null | 'assistant' | 'export' | 'examples' | 'about' | 'stackup' | 'account' | 'history' | 'analysis' | 'library' | 'settings' | 'enclosure' | 'learn' | 'review' | 'idee' | 'galerie' | 'import' | 'shortcuts';
  galerieTab?: 'entdecken' | 'teilen' | 'admin';
  /** Projekt, das die Galerie direkt öffnen soll (Link) */
  galerieOpen?: string;
  /** aktiver Reiter der oberen Leiste */
  /** Willkommenskarte ausgeblendet (nach „Leeres Projekt“) */
  welcomeHidden?: boolean;
  ribbonTab?: 'datei' | 'start' | 'simulation' | 'platine' | 'analyse' | 'team' | 'einstellungen' | 'hilfe';
  piMonitor: string | null;
  toast: { text: string; level: 'info' | 'warn' | 'error'; id: number } | null;
  inspectorOpen: boolean;
  libraryOpen: boolean;
  wiring: { from: string } | null;
  hoverPin: { ref: string; x: number; y: number } | null;
  compileErrors: Record<string, { line: number | null; text: string } | null>;
  /** zählt jede Projektänderung (für Neuzeichnen) */
  rev: number;
  /** Haltepunkte je Board (Zeilen bzw. Adressen) */
  breakpoints: Record<string, number[]>;
}

const listeners = new Set<() => void>();
let version = 0;

function loadTheme(): AppState['theme'] {
  try {
    return (localStorage.getItem('ohm.theme') as AppState['theme']) || 'system';
  } catch {
    return 'system';
  }
}

export const state: AppState = {
  project: emptyProject(),
  selection: [],
  selectedNet: null,
  view: 'steckbrett',
  pcb3d: false,
  sim: 'stopped',
  bottomOpen: true,
  bottomTab: 'code',
  codeTarget: null,
  issues: [],
  serial: {},
  messages: [],
  theme: loadTheme(),
  learnMode: false,
  tick: 0,
  fileName: 'projekt.ohm',
  dirty: false,
  modal: null,
  piMonitor: null,
  toast: null,
  inspectorOpen: true,
  libraryOpen: true,
  wiring: null,
  hoverPin: null,
  compileErrors: {},
  rev: 0,
  breakpoints: {},
};

export const engine = new Engine(state.project);
engine.onSerial = (id, text) => {
  state.serial[id] = ((state.serial[id] ?? '') + text).slice(-60000);
  serialVersion++;
};
engine.onMessage = (m) => {
  state.messages = [...engine.messages];
  if (m.level === 'error') toast(m.text, 'error');
};
export let serialVersion = 0;

export function emit() {
  version++;
  state.rev++;
  for (const l of listeners) l();
}

export function set(patch: Partial<AppState>) {
  Object.assign(state, patch);
  emit();
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Zustand lesen; Komponente rendert neu, wenn sich der Wert (flach) ändert */
export function useStore<T>(sel: (s: AppState) => T): T {
  const last = useRef<{ v: number; val: T } | null>(null);
  return useSyncExternalStore(
    subscribe,
    () => {
      if (last.current && last.current.v === version) return last.current.val;
      const val = sel(state);
      if (last.current && shallowEq(last.current.val, val)) {
        last.current = { v: version, val: last.current.val };
        return last.current.val;
      }
      last.current = { v: version, val };
      return val;
    },
    () => sel(state),
  );
}

function shallowEq(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.is((a as any)[k], (b as any)[k]));
}

/* ------------------------------------------------------------------ */
/* Verlauf (Rückgängig)                                                */
/* ------------------------------------------------------------------ */

const undoStack: string[] = [];
const redoStack: string[] = [];

export function checkpoint() {
  undoStack.push(JSON.stringify(state.project));
  if (undoStack.length > 80) undoStack.shift();
  redoStack.length = 0;
}

export function undo() {
  const s = undoStack.pop();
  if (!s) return;
  redoStack.push(JSON.stringify(state.project));
  replaceProject(JSON.parse(s), false);
}

export function redo() {
  const s = redoStack.pop();
  if (!s) return;
  undoStack.push(JSON.stringify(state.project));
  replaceProject(JSON.parse(s), false);
}

/* ------------------------------------------------------------------ */
/* Projektänderungen                                                   */
/* ------------------------------------------------------------------ */

/** nach strukturellen Änderungen aufrufen */
export const changeHooks = new Set<() => void>();

export function changed(rebuild = true) {
  state.rev++;
  for (const h of changeHooks) h();
  state.dirty = true;
  state.issues = validateProject(state.project);
  if (rebuild) engine.needsRebuild = true;
  emit();
  scheduleAutosave();
}

function replaceProject(p: Project, resetSim = true) {
  if (resetSim) stopSim();
  state.project = p;
  engine.setProject(p);
  state.issues = validateProject(p);
  state.selection = [];
  state.selectedNet = null;
  for (const c of p.code) engine.setCode(c.ziel, c.datei, c.sprache);
  const firstBoard = p.parts.find((x) => getPart(x.type)?.board);
  state.codeTarget = p.code[0]?.ziel ?? firstBoard?.id ?? null;
  compileAll();
  emit();
}

/** Stand eines Teammitglieds übernehmen (ohne Undo-Eintrag, ohne Zoom-Sprung) */
export function applyRemoteText(text: string) {
  const { project } = parseOhm(text);
  const sel = state.selection;
  replaceProject(project, false);
  state.selection = sel.filter((id) => project.parts.some((p) => p.id === id));
  state.rev++;
  engine.needsRebuild = true;
  emit();
}

export function newProject() {
  checkpoint();
  const p = emptyProject('Neues Projekt');
  replaceProject(p);
  state.fileName = 'projekt.ohm';
  state.dirty = false;
  state.welcomeHidden = true;
  emit();
}

export function loadOhmText(text: string, fileName = 'projekt.ohm'): Issue[] {
  const { project, issues } = parseOhm(text);
  if (issues.some((i) => i.level === 'error') && !project.parts.length) {
    state.issues = issues;
    set({ bottomOpen: true, bottomTab: 'messages' });
    toast('Die Datei enthält Fehler – Details unter „Meldungen“.', 'error');
    return issues;
  }
  checkpoint();
  replaceProject(project);
  state.issues = issues;
  state.fileName = fileName;
  state.dirty = false;
  // Auch ein frisch geöffnetes Projekt sichern – nach einem Absturz ist es so wieder da
  scheduleAutosave();
  if (issues.some((i) => i.level === 'error')) {
    state.bottomOpen = true;
    state.bottomTab = 'messages';
    toast('Projekt geladen – mit Hinweisen, siehe „Meldungen“.', 'warn');
  } else toast(`„${project.name}“ geöffnet`, 'info');
  emit();
  requestFit();
  return issues;
}

export function saveOhmText(): string {
  // Code aus dem Editor übernehmen
  return serializeOhm(state.project);
}

let fitRequested = 0;
export function requestFit() {
  fitRequested++;
  emit();
}
export function fitVersion() {
  return fitRequested;
}

function nextId(prefix: string): string {
  const ids = new Set(state.project.parts.map((p) => p.id));
  let i = 1;
  while (ids.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

/** freien Platz rechts neben/unter den vorhandenen Teilen finden */
export function findFreeSpot(w: number, h: number): { x: number; y: number } {
  const boxes = state.project.parts
    .filter((p) => !p.type.startsWith('steckbrett'))
    .map((p) => ({ x: p.x, y: p.y, ...getPart(p.type)!.size(p.props) }));
  if (!boxes.length) return { x: 100, y: 100 };
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const free = (x: number, y: number) => !boxes.some((b) => x < b.x + b.w + 30 && x + w + 30 > b.x && y < b.y + b.h + 30 && y + h + 30 > b.y);
  for (let col = 0; col < 12; col++)
    for (let row = 0; row < 14; row++) {
      const x = x1 + 50 + col * 90;
      const y = y0 + row * 40;
      if (free(x, y)) return { x, y };
    }
  void x0;
  return { x: x1 + 50, y: y0 };
}

export function addPart(type: string, x: number, y: number, preset?: Record<string, unknown>): PartInst | null {
  const def = getPart(type);
  if (!def) return null;
  checkpoint();
  const props = partDefaults(def, preset) as Record<string, any>;
  if (Number.isNaN(x)) {
    const s = def.size(props);
    ({ x, y } = findFreeSpot(s.w, s.h));
  }
  const inst: PartInst = { id: nextId(def.prefix), type: def.type, props, x: Math.round(x / 5) * 5, y: Math.round(y / 5) * 5, rot: 0 };
  state.project.parts.push(inst);
  state.selection = [inst.id];
  if (def.board) {
    if (!state.project.code.some((c) => c.ziel === inst.id) && !def.board.linux) {
      state.project.code.push({ ziel: inst.id, sprache: 'arduino', datei: DEFAULT_SKETCH(def.board) });
      engine.setCode(inst.id, state.project.code[state.project.code.length - 1].datei);
    }
    state.codeTarget = inst.id;
    compileAll();
  }
  changed();
  return inst;
}

export function removeSelection() {
  if (!state.selection.length && !state.selectedNet) return;
  checkpoint();
  if (state.selectedNet) {
    state.project.nets = state.project.nets.filter((n) => n.name !== state.selectedNet);
    state.selectedNet = null;
    changed();
    return;
  }
  const del = new Set(state.selection);
  state.project.parts = state.project.parts.filter((p) => !del.has(p.id));
  state.project.nets = state.project.nets
    .map((n) => ({ ...n, pins: n.pins.filter((r) => !del.has(splitRef(r)[0])) }))
    .filter((n) => n.pins.length >= 2);
  state.project.code = state.project.code.filter((c) => !del.has(c.ziel));
  if (state.codeTarget && del.has(state.codeTarget)) state.codeTarget = state.project.code[0]?.ziel ?? null;
  state.selection = [];
  changed();
}

export function rotateSelection() {
  if (!state.selection.length) return;
  checkpoint();
  for (const p of state.project.parts) if (state.selection.includes(p.id)) p.rot = (p.rot + 90) % 360;
  changed();
}

export function duplicateSelection() {
  if (!state.selection.length) return;
  checkpoint();
  const newIds: string[] = [];
  for (const p of state.project.parts.filter((x) => state.selection.includes(x.id))) {
    const def = getPart(p.type)!;
    const n: PartInst = { ...p, id: nextId(def.prefix), props: JSON.parse(JSON.stringify(p.props)), x: p.x + 30, y: p.y + 30 };
    state.project.parts.push(n);
    newIds.push(n.id);
  }
  state.selection = newIds;
  changed();
}

/** zwei Pins verbinden (Netze zusammenführen) */
export function connect(a: string, b: string) {
  if (a === b) return;
  checkpoint();
  const nets = state.project.nets;
  const canon = (ref: string) => {
    const [pid, pn] = splitRef(ref);
    const inst = state.project.parts.find((p) => p.id === pid);
    const def = inst && getPart(inst.type);
    const pin = def && findPin(def, inst!.props, pn);
    return pin ? `${pid}.${pin.id}` : ref;
  };
  const ca = canon(a);
  const cb = canon(b);
  const has = (n: { pins: string[] }, r: string) => n.pins.some((x) => canon(x) === r);
  const na = nets.find((n) => has(n, ca));
  const nb = nets.find((n) => has(n, cb));
  if (na && nb && na === nb) return;
  if (na && nb) {
    // Namen behalten: sprechender Name gewinnt
    const keep = /^N\d+$/.test(na.name) && !/^N\d+$/.test(nb.name) ? nb : na;
    const drop = keep === na ? nb : na;
    keep.pins.push(...drop.pins.filter((p) => !has(keep, canon(p))));
    state.project.nets = nets.filter((n) => n !== drop);
  } else if (na) na.pins.push(cb);
  else if (nb) nb.pins.push(ca);
  else {
    let i = 1;
    while (nets.some((n) => n.name === `N${i}`)) i++;
    const gnd = /\.(GND(_\d+)?|-)$/i.test(ca) || /\.(GND(_\d+)?|-)$/i.test(cb);
    const name = gnd && !nets.some((n) => n.name === 'GND') ? 'GND' : `N${i}`;
    nets.push({ name, pins: [ca, cb] });
  }
  changed();
}

/** Pin aus seinem Netz lösen */
export function disconnectPin(ref: string) {
  checkpoint();
  for (const n of state.project.nets) n.pins = n.pins.filter((p) => p !== ref);
  state.project.nets = state.project.nets.filter((n) => n.pins.length >= 2);
  changed();
}

export function setProp(id: string, key: string, value: unknown, live = false) {
  const p = state.project.parts.find((x) => x.id === id);
  if (!p) return;
  if (!live) checkpoint();
  p.props[key] = value;
  if (live) {
    engine.markDirty();
    emit();
    state.dirty = true;
  } else changed();
}

export function renamePart(oldId: string, newId: string): string | null {
  newId = newId.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(newId)) return 'Nur Buchstaben, Ziffern und _ – beginnend mit einem Buchstaben.';
  if (state.project.parts.some((p) => p.id === newId)) return `„${newId}“ gibt es schon.`;
  checkpoint();
  const p = state.project.parts.find((x) => x.id === oldId);
  if (!p) return null;
  p.id = newId;
  for (const n of state.project.nets) n.pins = n.pins.map((r) => (splitRef(r)[0] === oldId ? `${newId}.${splitRef(r)[1]}` : r));
  for (const c of state.project.code) if (c.ziel === oldId) c.ziel = newId;
  if (state.codeTarget === oldId) state.codeTarget = newId;
  state.selection = [newId];
  const code = state.project.code.find((c) => c.ziel === newId);
  if (code) engine.setCode(newId, code.datei);
  changed();
  return null;
}

/* ------------------------------------------------------------------ */
/* Code                                                                */
/* ------------------------------------------------------------------ */

/** echt kompilierte Firmware (arduino-cli) ersetzt beim Start den Schnellmodus */
export const firmwareOverride = new Map<string, { code: string; lang: string }>();

export function setCode(target: string, text: string, lang?: string) {
  firmwareOverride.delete(target);
  let c = state.project.code.find((x) => x.ziel === target);
  if (!c) {
    c = { ziel: target, sprache: lang ?? 'arduino', datei: text };
    state.project.code.push(c);
  }
  c.datei = text;
  if (lang) c.sprache = lang;
  state.dirty = true;
  scheduleCompile(target);
  scheduleAutosave();
}

let compileTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleCompile(target: string) {
  if (compileTimer) clearTimeout(compileTimer);
  compileTimer = setTimeout(() => {
    compileOne(target);
    emit();
  }, 350);
}

function compileOne(target: string) {
  const c = state.project.code.find((x) => x.ziel === target);
  if (!c) return;
  engine.setCode(target, c.datei, c.sprache);
  // Fehler ohne laufende Simulation über einen Probe-Compiler ermitteln
  const err = ['arduino', 'c++', 'cpp', 'ino'].includes(c.sprache.toLowerCase()) ? probeCompile(target, c.datei) : null;
  state.compileErrors = { ...state.compileErrors, [target]: err };
}

import { McuRuntime } from '../mcu/runtime';
function probeCompile(target: string, code: string): { line: number | null; text: string } | null {
  const inst = state.project.parts.find((p) => p.id === target);
  const def = inst && getPart(inst.type);
  if (!def?.board) return null;
  const rt = new McuRuntime(def.board, null as never);
  rt.load(code);
  return rt.error ? { line: rt.errorLine, text: rt.error } : null;
}

export function compileAll() {
  for (const c of state.project.code) compileOne(c.ziel);
}

/* ------------------------------------------------------------------ */
/* Simulation                                                          */
/* ------------------------------------------------------------------ */

let raf = 0;
let lastT = 0;

export function applyBreakpoints() {
  for (const [id, slot] of engine.mcus) {
    slot.runtime.breakpoints = new Set(state.breakpoints[id] ?? []);
    (slot.runtime as { updateDbg?: () => void }).updateDbg?.();
  }
}

export function toggleBreakpoint(id: string, line: number) {
  const cur = new Set(state.breakpoints[id] ?? []);
  if (cur.has(line)) cur.delete(line);
  else cur.add(line);
  state.breakpoints = { ...state.breakpoints, [id]: [...cur] };
  applyBreakpoints();
  emit();
}

/** Debugger: weiter bzw. ein Schritt */
export function debugContinue(stepOnly = false) {
  for (const slot of engine.mcus.values()) {
    if (!slot.runtime.paused && !stepOnly) continue;
    if (stepOnly) slot.runtime.step?.();
    else slot.runtime.resume?.();
  }
  if (stepOnly) {
    // einen Rechenschritt ausführen, damit der Einzelschritt sichtbar wird
    engine.running = true;
    engine.advance(0.001);
    engine.running = false;
    state.tick++;
    emit();
    return;
  }
  startSim();
}

export function startSim() {
  if (state.sim === 'paused') {
    state.sim = 'running';
    engine.running = true;
    lastT = performance.now();
    loop();
    emit();
    return;
  }
  for (const c of state.project.code) engine.setCode(c.ziel, c.datei, c.sprache);
  for (const [id, f] of firmwareOverride) engine.setCode(id, f.code, f.lang);
  state.serial = {};
  engine.setProject(state.project);
  engine.start();
  applyBreakpoints();
  state.messages = [...engine.messages];
  state.sim = 'running';
  lastT = performance.now();
  loop();
  emit();
}

export function pauseSim() {
  if (state.sim !== 'running') return;
  state.sim = 'paused';
  engine.running = false;
  cancelAnimationFrame(raf);
  emit();
}

export function stopSim() {
  cancelAnimationFrame(raf);
  engine.stop();
  engine.states.clear();
  state.sim = 'stopped';
  emit();
}

export function resetSim() {
  const was = state.sim;
  stopSim();
  if (was !== 'stopped') startSim();
}

function loop() {
  raf = requestAnimationFrame((t) => {
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    if (state.sim === 'running') {
      engine.advance(dt);
      // Haltepunkt erreicht → Simulation anhalten und Debugger zeigen
      for (const [id, slot] of engine.mcus)
        if (slot.runtime.paused) {
          state.sim = 'paused';
          engine.running = false;
          state.bottomOpen = true;
          state.bottomTab = 'debug';
          state.codeTarget = id;
          state.tick++;
          emit();
          return;
        }
      state.tick++;
      emit();
      loop();
    }
  });
}

export function toast(text: string, level: 'info' | 'warn' | 'error' = 'info') {
  const id = Date.now();
  state.toast = { text, level, id };
  emit();
  setTimeout(() => {
    if (state.toast?.id === id) {
      state.toast = null;
      emit();
    }
  }, level === 'error' ? 6000 : 3200);
}

/* ------------------------------------------------------------------ */
/* Autospeichern                                                       */
/* ------------------------------------------------------------------ */

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAutosave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem('ohm.autosave', serializeOhm(state.project));
      localStorage.setItem('ohm.autosave.name', state.fileName);
    } catch {
      /* ignorieren */
    }
  }, 800);
}

export function restoreAutosave(): boolean {
  try {
    const t = localStorage.getItem('ohm.autosave');
    if (!t) return false;
    const { project, issues } = parseOhm(t);
    if (!project.parts.length) return false;
    replaceProject(project);
    state.issues = issues;
    state.fileName = localStorage.getItem('ohm.autosave.name') || 'projekt.ohm';
    return true;
  } catch {
    return false;
  }
}

export { autoPlace };

// Nur lesender Zugriff für Fehlersuche und automatische Tests
(globalThis as unknown as { __ohm?: unknown }).__ohm = { state, engine, load: (t: string) => loadOhmText(t, "test.ohm"), setProp, setCode };
