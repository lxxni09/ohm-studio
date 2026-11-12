/**
 * Automatische Bewertung für Lektionen und Aufgaben: deklarative Kriterien, geprüft an Struktur und Simulation.
 */
import { getPart } from '../parts/registry';
import { runProject, type RunMetrics } from '../analysis/runner';
import { erc } from '../eda/erc';
import { drc } from '../eda/drc';
import type { Project } from '../ohm/model';

export type Kriterium =
  | { art: 'teil'; typ: string; anzahl?: number; text?: string }
  | { art: 'kategorie'; kategorie: string; anzahl?: number; text?: string }
  | { art: 'led_an'; anzahl?: number; text?: string }
  | { art: 'led_aus'; text?: string }
  | { art: 'led_strom'; min_mA: number; max_mA: number; text?: string }
  | { art: 'spannung'; netz?: string; min: number; max: number; text?: string }
  | { art: 'code'; muster: string; text?: string }
  | { art: 'aktiv'; typ: string; text?: string }
  | { art: 'keine_fehler'; text?: string }
  | { art: 'drc_sauber'; text?: string }
  | { art: 'verbunden'; a: string; b: string; text?: string };

export interface Bewertung {
  ok: boolean;
  punkte: number;
  max: number;
  details: { ok: boolean; text: string }[];
}

const DEFAULT_TEXT: Record<Kriterium['art'], (k: any) => string> = {
  teil: (k) => `Mindestens ${k.anzahl ?? 1}× ${getPart(k.typ)?.name ?? k.typ}`,
  kategorie: (k) => `Mindestens ${k.anzahl ?? 1} Teil(e) aus „${k.kategorie}“`,
  led_an: (k) => `${k.anzahl ?? 1} LED(s) leuchten in der Simulation`,
  led_aus: () => 'Keine LED leuchtet dauerhaft',
  led_strom: (k) => `LED-Strom zwischen ${k.min_mA} und ${k.max_mA} mA`,
  spannung: (k) => `Spannung ${k.netz ? `am Netz ${k.netz} ` : 'an einem Netz '}zwischen ${k.min} und ${k.max} V`,
  code: (k) => `Code enthält ${k.muster}`,
  aktiv: (k) => `${getPart(k.typ)?.name ?? k.typ} ist in der Simulation aktiv`,
  keine_fehler: () => 'Keine Fehler in Prüfung und Simulation',
  drc_sauber: () => 'Platine ohne Regelverstöße (DRC)',
  verbunden: (k) => `${k.a} ist mit ${k.b} verbunden`,
};

export function grade(project: Project, kriterien: Kriterium[], m?: RunMetrics): Bewertung {
  let metrics = m;
  const sim = () => (metrics ??= runProject(project, { seconds: 0.6 }));
  const leds = project.parts.filter((p) => p.type === 'led' || p.type === 'rgb-led');
  const details = kriterien.map((k) => {
    const text = k.text ?? DEFAULT_TEXT[k.art](k);
    let ok = false;
    switch (k.art) {
      case 'teil':
        ok = project.parts.filter((p) => getPart(p.type)?.type === getPart(k.typ)?.type).length >= (k.anzahl ?? 1);
        break;
      case 'kategorie':
        ok = project.parts.filter((p) => getPart(p.type)?.category === k.kategorie).length >= (k.anzahl ?? 1);
        break;
      case 'led_an':
        ok = leds.filter((l) => (sim().active[l.id] ?? 0) > 0.15).length >= (k.anzahl ?? 1);
        break;
      case 'led_aus':
        ok = leds.every((l) => (sim().active[l.id] ?? 0) < 0.9);
        break;
      case 'led_strom':
        ok = leds.length > 0 && leds.some((l) => {
          const i = (sim().current[l.id] ?? 0) * 1000;
          return i >= k.min_mA && i <= k.max_mA;
        });
        break;
      case 'spannung': {
        const nets = sim().nets;
        ok = k.netz ? nets[k.netz] !== undefined && nets[k.netz] >= k.min && nets[k.netz] <= k.max : Object.values(nets).some((v) => v >= k.min && v <= k.max);
        break;
      }
      case 'code':
        ok = project.code.some((c) => new RegExp(k.muster).test(c.datei));
        break;
      case 'aktiv': {
        const t = getPart(k.typ)?.type;
        ok = project.parts.some((p) => getPart(p.type)?.type === t && (sim().active[p.id] ?? 0) > 0.05);
        break;
      }
      case 'keine_fehler':
        ok = !erc(project).some((i) => i.level === 'error') && sim().errors.length === 0;
        break;
      case 'drc_sauber':
        ok = drc(project).filter((v) => v.level === 'error').length === 0 && project.parts.length > 0;
        break;
      case 'verbunden':
        ok = project.nets.some((n) => n.pins.some((r) => r.startsWith(k.a)) && n.pins.some((r) => r.startsWith(k.b)));
        break;
    }
    return { ok, text };
  });
  const punkte = details.filter((d) => d.ok).length;
  return { ok: punkte === details.length, punkte, max: details.length, details };
}

export function describeKriterium(k: Kriterium): string {
  return k.text ?? DEFAULT_TEXT[k.art](k);
}
