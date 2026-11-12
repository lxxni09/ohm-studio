/**
 * „Idee rein, Platine raus“: der Ablauf hinter dem Assistenten „Neues Projekt aus Idee“.
 * Idee → höchstens 3 Rückfragen → KI baut ein .ohm-Projekt → Selbstprüfung (Datei, ERC, Simulation, Tests)
 * mit bis zu 3 Reparaturversuchen → ausprobieren → Platine (Platzierung, Routing, DRC) → Gehäuse →
 * Kosten bei 1/5/100 Stück → Bestellen (Schritt-für-Schritt mit Direktlinks).
 *
 * Ohne API-Schlüssel startet der Assistent mit der passendsten Vorlage; alle Prüfschritte danach laufen
 * genauso (sie brauchen keine KI). Die Selbstprüfung meldet ehrlich, was nicht klappt.
 */
import { parseOhm, lint } from '../ohm/format';
import type { Project } from '../ohm/model';
import { erc } from '../eda/erc';
import { drc } from '../eda/drc';
import { runProject } from '../analysis/runner';
import { runTests } from '../sim/testrunner';
import { computePcb } from '../views/pcbLayout';
import { designEnclosure, checkCollisions } from '../mech/enclosure';
import { sourcedBom, bomTotal } from '../export/sourcing';
import { fabQuotes } from '../export/fab';
import { EXAMPLES } from '../examples';
import { extractOhm, offlineTemplate, type ChatMsg } from './offline';
import { aiAvailable } from './features';

/* ------------------------------ Rückfragen ------------------------------ */

export interface IdeaQuestion {
  frage: string;
  optionen: string[];
}

const QUESTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['fragen'],
  properties: {
    fragen: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['frage', 'optionen'],
        properties: { frage: { type: 'string' }, optionen: { type: 'array', items: { type: 'string' } } },
      },
    },
  },
};

/** Ohne KI: nur die Fragen, die wirklich etwas am Projekt ändern (Board, Stromversorgung) */
export function offlineQuestions(idea: string): IdeaQuestion[] {
  const p = idea.toLowerCase();
  const q: IdeaQuestion[] = [];
  if (!/esp32|arduino|uno|nano|pico|rp2040|attiny|ohne (mikrocontroller|code)|555/.test(p))
    q.push({ frage: 'Womit soll es gesteuert werden?', optionen: ['Arduino Uno (einfach)', 'ESP32 (WLAN/Bluetooth)', 'Egal – nimm das Passende'] });
  if (!/batterie|akku|usb|netzteil|solar/.test(p)) q.push({ frage: 'Wie bekommt es Strom?', optionen: ['USB', 'Batterie/Akku', 'Egal'] });
  return q.slice(0, 3);
}

export async function ideaQuestions(idea: string): Promise<IdeaQuestion[]> {
  if (aiAvailable() !== 'online') return offlineQuestions(idea);
  const { structured } = await import('./features');
  const r = await structured<{ fragen: IdeaQuestion[] }>(
    'Du hilfst in Ohm Studio, aus einer Projektidee eine Elektronik-Schaltung zu bauen. Stelle höchstens 3 kurze Rückfragen auf Deutsch, nur wenn die Antwort die Schaltung wirklich verändert (z. B. Board, Stromversorgung, Anzeige). Jede Frage hat 2–4 kurze Antwortmöglichkeiten. Ist die Idee klar genug, gib eine leere Liste zurück.',
    [{ type: 'text', text: `Projektidee: ${idea}` }],
    QUESTION_SCHEMA,
    'low',
  );
  return (r.fragen ?? []).filter((f) => f.frage && f.optionen?.length).slice(0, 3);
}

/* ------------------------------ Projekt bauen ------------------------------ */

export interface Built {
  text: string;
  quelle: 'ki' | 'vorlage';
  /** Erklärung der KI bzw. Hinweis auf die Vorlage */
  erklaerung: string;
}

export function ideaPrompt(idea: string, answers: Record<string, string>): string {
  const a = Object.entries(answers)
    .filter(([, v]) => v)
    .map(([k, v]) => `- ${k} ${v}`)
    .join('\n');
  return `Bau mir dieses Projekt: ${idea}${a ? `\n\nMeine Antworten auf deine Rückfragen:\n${a}` : ''}\n\nWichtig: Das Projekt muss sich simulieren lassen, braucht Code für den Mikrocontroller (falls einer drin ist) und einen Abschnitt „test:“ mit 1–3 überprüfbaren Testschritten.`;
}

export function templateFor(idea: string, answers: Record<string, string>): Built {
  const t = offlineTemplate(`${idea} ${Object.values(answers).join(' ')}`);
  const key = t?.key ?? 'blink';
  const text = t?.text ?? EXAMPLES['blink'];
  const name = /^\s*name:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? key;
  return {
    text,
    quelle: 'vorlage',
    erklaerung: t
      ? `Ohne KI-Schlüssel starte ich mit der passendsten Vorlage: „${name}“. Du kannst sie danach anpassen.`
      : `Ohne KI-Schlüssel finde ich zu dieser Idee keine passende Vorlage und starte mit „${name}“. Mit einem Claude-API-Schlüssel (Einstellungen im KI-Assistenten) baue ich das Projekt genau nach deiner Idee.`,
  };
}

export async function buildProject(idea: string, answers: Record<string, string>, onText?: (t: string) => void): Promise<{ built: Built; history: ChatMsg[] }> {
  const history: ChatMsg[] = [{ role: 'user', text: ideaPrompt(idea, answers) }];
  if (aiAvailable() !== 'online') return { built: templateFor(idea, answers), history };
  const { askClaude } = await import('./assistant');
  const { apiKey } = await import('./features');
  const answer = await askClaude(apiKey(), history, onText);
  history.push({ role: 'assistant', text: answer });
  const text = extractOhm(answer);
  if (!text) throw new Error('Die KI hat kein Projekt geliefert. Bitte die Idee etwas genauer beschreiben.');
  return { built: { text, quelle: 'ki', erklaerung: answer.replace(/```[\s\S]*?```/g, '').trim() }, history };
}

/* ------------------------------ Selbstprüfung ------------------------------ */

export interface CheckResult {
  ok: boolean;
  project: Project | null;
  /** Fehler, die repariert werden müssen */
  fehler: string[];
  /** Hinweise (nicht blockierend) */
  hinweise: string[];
  tests: { schritt: string; ok: boolean | null; detail: string }[];
}

export function selfCheck(text: string): CheckResult {
  const fehler: string[] = [];
  const hinweise: string[] = [];
  const tests: CheckResult['tests'] = [];
  let project: Project | null = null;
  try {
    const r = parseOhm(text);
    project = r.project;
    for (const i of r.issues) (i.level === 'error' ? fehler : hinweise).push(`Datei${i.line ? ` Zeile ${i.line}` : ''}: ${i.text}`);
  } catch (e) {
    fehler.push(`Datei lässt sich nicht lesen: ${(e as Error).message}`);
  }
  if (!project) return { ok: false, project, fehler, hinweise, tests };
  if (!project.parts.length) fehler.push('Das Projekt enthält keine Bauteile.');
  // Warnungen, die ein zerstörtes Bauteil bedeuten, zählen für die Selbstprüfung als Fehler
  const fatal = /kaputt|zerst[öo]r|Kurzschluss|durchbrenn/i;
  for (const i of lint(project)) (i.level === 'error' || fatal.test(i.text) ? fehler : hinweise).push(`Prüfung: ${i.text}`);
  for (const i of erc(project)) (i.level === 'error' || fatal.test(i.text) ? fehler : hinweise).push(`ERC: ${i.text}`);
  if (!fehler.length) {
    const run = runProject(project, { seconds: 0.5 });
    if (!run.ok) fehler.push('Die Simulation ist abgebrochen.');
    for (const e of run.errors.slice(0, 6)) fehler.push(`Simulation: ${e}`);
  }
  if (!fehler.length && project.tests.length) {
    const res = runTests(project);
    project.tests.forEach((t, i) => {
      const r = res[i] ?? { ok: null, detail: '' };
      const schritt = `${t.schritt} → ${t.erwartet}`;
      tests.push({ schritt, ok: r.ok, detail: r.detail });
      if (r.ok === false) fehler.push(`Test „${schritt}“ fehlgeschlagen: ${r.detail}`);
    });
  } else if (!project.tests.length) hinweise.push('Das Projekt hat keine Testschritte – die Funktion wurde nur durch einen Simulationslauf geprüft.');
  return { ok: !fehler.length, project, fehler: dedupe(fehler), hinweise: dedupe(hinweise), tests };
}

function dedupe(a: string[]): string[] {
  return [...new Set(a)];
}

export const MAX_REPAIRS = 3;

/** Einen Reparaturversuch mit der KI: Fehlerliste zurückgeben, neues Projekt holen */
export async function repairOnce(history: ChatMsg[], check: CheckResult, onText?: (t: string) => void): Promise<{ text: string | null; history: ChatMsg[] }> {
  const { askClaude } = await import('./assistant');
  const { apiKey } = await import('./features');
  const h: ChatMsg[] = [...history, { role: 'user', text: `Ohm Studio hat dein Projekt automatisch geprüft. Diese Probleme sind aufgetreten:\n${check.fehler.map((f) => `- ${f}`).join('\n')}\n\nBitte behebe sie und gib das komplette korrigierte Projekt wieder in genau einem \`\`\`yaml-Block aus.` }];
  const answer = await askClaude(apiKey(), h, onText);
  h.push({ role: 'assistant', text: answer });
  return { text: extractOhm(answer), history: h };
}

/* ------------------------------ Platine, Gehäuse, Kosten ------------------------------ */

export interface PcbSummary {
  breiteMm: number;
  hoeheMm: number;
  lagen: number;
  ungeroutet: number;
  drcFehler: string[];
  drcWarnungen: number;
}

const U = 0.254;

export function pcbSummary(project: Project): PcbSummary {
  const L = computePcb(project);
  const v = drc(project, 'jlcpcb', L);
  return {
    breiteMm: Math.round(L.w * U * 10) / 10,
    hoeheMm: Math.round(L.h * U * 10) / 10,
    lagen: L.layers,
    ungeroutet: L.unrouted,
    drcFehler: v.filter((x) => x.level === 'error').map((x) => x.text),
    drcWarnungen: v.filter((x) => x.level !== 'error').length,
  };
}

export function enclosureSummary(project: Project): { aussen: { x: number; y: number; z: number }; kollisionen: string[] } {
  const e = designEnclosure(project);
  return { aussen: { x: Math.round(e.ow), y: Math.round(e.oh), z: Math.round(e.hz + e.p.deckel) }, kollisionen: checkCollisions(e).filter((c) => c.level === 'error').map((c) => c.text) };
}

export interface CostRow {
  stueck: number;
  bauteile: number;
  platine: number;
  fertiger: string;
  /** Preis pro Stück (Bauteile + Platine), ohne Versand/Zoll/MwSt. */
  proStueck: number;
}

export function costs(project: Project): CostRow[] {
  const rows = sourcedBom(project);
  return [1, 5, 100].map((n) => {
    // Platinen gibt es meist erst ab 5 Stück
    const quotes = fabQuotes(project, Math.max(5, n)).sort((a, b) => a.price - b.price);
    const q = quotes[0];
    const bauteile = bomTotal(rows, n);
    const platine = q ? q.price : 0;
    return { stueck: n, bauteile: round2(bauteile), platine: round2(platine), fertiger: q?.fab ?? '–', proStueck: round2((bauteile + platine) / n) };
  });
}

function round2(x: number) {
  return Math.round(x * 100) / 100;
}

export interface OrderStep {
  titel: string;
  text: string;
  link?: { label: string; url: string };
}

/** Bestellen: Es gibt (noch) keine Bestell-API mit Vertrag, daher eine ehrliche Schritt-für-Schritt-Anleitung mit Direktlinks */
export function orderSteps(project: Project): OrderStep[] {
  const q = fabQuotes(project, 5).sort((a, b) => a.price - b.price)[0];
  const lcsc = sourcedBom(project)
    .map((r) => r.src.lcsc)
    .filter(Boolean);
  return [
    { titel: 'Fertigungsdateien speichern', text: 'Lädt die Gerber-Dateien als ZIP herunter (das versteht jeder Platinenhersteller).' },
    { titel: `Platine bestellen${q ? ` (z. B. ${q.fab})` : ''}`, text: 'Seite öffnen, ZIP hochladen, Stückzahl wählen. Die übrigen Einstellungen passen meistens schon.', link: q ? { label: `${q.fab} öffnen`, url: q.url } : undefined },
    {
      titel: 'Bauteile bestellen',
      text: lcsc.length ? `Die Stückliste enthält ${lcsc.length} LCSC-Nummern – im Warenkorb von LCSC über „BOM Tool“ hochladen.` : 'Stückliste exportieren und beim Händler deiner Wahl bestellen.',
      link: { label: 'LCSC BOM-Tool', url: 'https://www.lcsc.com/bom' },
    },
    { titel: 'Gehäuse drucken', text: 'Das Gehäuse als STL speichern und mit einem 3D-Drucker (oder einem Druckdienst) drucken.' },
    { titel: 'Achtung beim Bezahlen', text: 'Bestellungen kosten Geld und brauchen ein Konto beim Händler. Wenn du noch nicht volljährig bist: bitte gemeinsam mit deinen Eltern bestellen.' },
  ];
}
