import type { ReactNode } from 'react';
import type { Circuit, Device } from '../sim/mna';

/** 1 Einheit = 0,254 mm, Rastermaß 2,54 mm = 10 Einheiten */
export const PITCH = 10;
export const MM = 1 / 0.254;

export interface PinDef {
  id: string;
  x: number;
  y: number;
  label?: string;
  /** zusätzliche Namen, unter denen der Pin in .ohm-Dateien gefunden wird */
  aliases?: string[];
  /** GPIO-Nummer bei Mikrocontrollern */
  gpio?: number;
  /** Fähigkeiten */
  adc?: boolean;
  pwm?: boolean;
  /** Versorgungs-/Masse-Pin */
  power?: 'gnd' | '5v' | '3v3' | 'vin' | 'vbat';
}

export type PropType = 'number' | 'value' | 'string' | 'select' | 'bool' | 'range' | 'color' | 'text';

export interface PropDef {
  key: string;
  label: string;
  type: PropType;
  options?: (string | { value: string; label: string })[];
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /** während der Simulation veränderbar (Schieberegler, Umwelt) */
  live?: boolean;
  hint?: string;
}

export type Category =
  | 'Mikrocontroller'
  | 'Computer'
  | 'Passiv'
  | 'Halbleiter'
  | 'ICs'
  | 'Ein-/Ausgabe'
  | 'Displays'
  | 'Sensoren'
  | 'Funk'
  | 'Stromversorgung'
  | 'Messgeräte'
  | 'Aufbau';

export const CATEGORIES: Category[] = ['Mikrocontroller', 'Computer', 'Passiv', 'Halbleiter', 'ICs', 'Ein-/Ausgabe', 'Displays', 'Sensoren', 'Funk', 'Stromversorgung', 'Messgeräte', 'Aufbau'];

export interface RenderArgs {
  props: Record<string, any>;
  state: Record<string, any>;
  running: boolean;
  id: string;
}

export interface Size {
  w: number;
  h: number;
}

/** Kontext für den Aufbau des elektrischen Modells */
export interface BuildCtx {
  id: string;
  props: Record<string, any>;
  state: Record<string, any>;
  circuit: Circuit;
  /** Knoten eines Pins (-1 = Masse) */
  node(pin: string): number;
  /** interner Knoten */
  internal(name: string): number;
  add<T extends Device>(d: T): T;
  /** Spannung eines Pins aus der letzten Lösung */
  v(pin: string): number;
  /** Schaltung muss neu aufgebaut werden (z. B. Bauteil zerstört) */
  invalidate(): void;
  warn(msg: string, level?: 'info' | 'warn' | 'error'): void;
  time: number;
  realism: boolean;
  /** Daten für die Mikrocontroller-Kopplung */
  engine: any;
}

export interface Behaviour {
  /** vor jedem Zeitschritt (Quellen aktualisieren) */
  pre?(ctx: BuildCtx, dt: number): void;
  /** nach jedem Zeitschritt (Ergebnisse auswerten) */
  post?(ctx: BuildCtx, dt: number): void;
}

export interface Interaction {
  kind: 'press' | 'toggle' | 'drag' | 'click';
  /** Bereich in lokalen Koordinaten */
  area?: { x: number; y: number; w: number; h: number };
  label?: string;
  /** Zustandsschlüssel (Standard: pressed bzw. Prop „an“) */
  key?: string;
}

export interface PartDef {
  type: string;
  aliases?: string[];
  name: string;
  category: Category;
  keywords?: string;
  defaults: Record<string, any>;
  props?: PropDef[];
  size(p: Record<string, any>): Size;
  pins(p: Record<string, any>): PinDef[];
  render(a: RenderArgs): ReactNode;
  /** Schaltplansymbol (optional, sonst generisch) */
  symbol?: SymbolKind;
  build?(ctx: BuildCtx): Behaviour | void;
  /** Bedienung während der Simulation */
  interaction?: Interaction;
  /** mehrere Bedienelemente (z. B. Tasten auf Boards, Keypad) */
  areas?(p: Record<string, any>): (Interaction & { area: { x: number; y: number; w: number; h: number }; key: string })[];
  /** intern verbundene Pin-Gruppen (z. B. alle GND-Pins eines Boards) */
  bridges?(p: Record<string, any>): string[][];
  /** Kurzinfo „Datenblatt“ */
  info: string;
  specs?: Record<string, string>;
  /** Richtpreis in € */
  price?: number;
  /** Bezeichnung für die Stückliste */
  bom?: (p: Record<string, any>) => string;
  /** Mikrocontroller/Board */
  board?: import('./boards').BoardDef;
  /** Bauteil ist rein dekorativ oder ein Werkzeug (nicht in Stückliste) */
  noBom?: boolean;
  /** Bauhöhe für 3D-Ansicht (mm) */
  height3d?: number;
  /** Präfix für automatische Bezeichner (R, C, D, U …) */
  prefix: string;
  /** Text-Vorschau in der Bibliothek */
  thumb?: ReactNode;
}

export type SymbolKind =
  | 'resistor'
  | 'pot'
  | 'capacitor'
  | 'elko'
  | 'inductor'
  | 'diode'
  | 'zener'
  | 'schottky'
  | 'led'
  | 'npn'
  | 'pnp'
  | 'nmos'
  | 'pmos'
  | 'battery'
  | 'switch'
  | 'button'
  | 'buzzer'
  | 'motor'
  | 'fuse'
  | 'lamp'
  | 'box';
