/** Datenmodell eines Ohm-Studio-Projekts (entspricht dem .ohm-Format) */

export interface PartInst {
  id: string;
  type: string;
  props: Record<string, any>;
  x: number;
  y: number;
  rot: number;
  /** Position wurde automatisch gesetzt */
  auto?: boolean;
}

export interface Net {
  name: string;
  pins: string[];
}

export interface CodeBlock {
  ziel: string;
  sprache: string;
  datei: string;
}

export interface TestStep {
  schritt: string;
  erwartet: string;
}

export interface WireStyle {
  /** Farbe je Netz */
  color?: string;
}

export interface Project {
  ohm: number;
  name: string;
  autor?: string;
  beschreibung?: string;
  parts: PartInst[];
  nets: Net[];
  code: CodeBlock[];
  tests: TestStep[];
  views: {
    steckbrett?: 'auto' | Record<string, unknown>;
    platine?: { groesse?: string; lagen?: number; farbe?: string; oberflaeche?: string; dicke?: number; material?: string; masseflaeche?: boolean };
    schaltplan?: { symbole?: 'IEC' | 'ANSI'; raster?: number };
    /** Kabelführung: 90° (Standard), 45°, direkt oder weich (Bézier wie v1) */
    kabel?: {
      stil?: '90' | '45' | 'direkt' | 'weich';
      kreuzungen?: 'bogen' | 'keine';
      /** eigene Knickpunkte je Verbindung (Schlüssel „A.PIN|B.PIN“), in Einheiten */
      knicke?: Record<string, { x: number; y: number }[]>;
      /** Stil je Netz */
      netze?: Record<string, '90' | '45' | 'direkt' | 'weich'>;
    };
  };
  wireColors?: Record<string, string>;
  /** Varianten: Name → Teile, die in dieser Variante nicht bestückt werden */
  variants?: Record<string, { ohne: string[] }>;
  activeVariant?: string;
  /** eigene Bauteile (aus dem Datenblatt-Leser) */
  library?: CustomPart[];
  /** Teamarbeit: Mitglieder, Kommentare, Freigabe */
  team?: TeamMember[];
  review?: Review;
  settings: { speed: number; realism: boolean; dt: number };
}

export interface CustomPart {
  typ: string;
  name: string;
  label: string;
  pins: string[];
  vcc?: string;
  gnd?: string;
  strom_mA?: number;
  hersteller?: string;
  mpn?: string;
}

export type Rolle = 'betrachter' | 'bearbeiter' | 'pruefer' | 'admin';
export interface TeamMember {
  name: string;
  rolle: Rolle;
}
export interface ReviewComment {
  id: string;
  autor: string;
  text: string;
  wann: string;
  teil?: string;
  erledigt?: boolean;
  antworten?: { autor: string; text: string; wann: string }[];
}
export interface Review {
  status: 'entwurf' | 'in-pruefung' | 'freigegeben' | 'abgelehnt';
  kommentare: ReviewComment[];
  entscheidungen: { wer: string; rolle: Rolle; wann: string; ergebnis: 'freigegeben' | 'abgelehnt' | 'angefordert'; notiz?: string }[];
}

export function emptyProject(name = 'Neues Projekt'): Project {
  return {
    ohm: 1,
    name,
    parts: [],
    nets: [],
    code: [],
    tests: [],
    views: { steckbrett: 'auto', platine: { groesse: 'auto', lagen: 2, farbe: 'gruen' }, schaltplan: { symbole: 'IEC' }, kabel: { stil: '90', kreuzungen: 'bogen' } },
    settings: { speed: 1, realism: false, dt: 0.001 },
  };
}

export function splitRef(ref: string): [string, string] {
  const s = String(ref);
  const i = s.indexOf('.');
  if (i < 0) return [s, ''];
  return [s.slice(0, i), s.slice(i + 1)];
}
