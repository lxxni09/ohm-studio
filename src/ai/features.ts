/**
 * KI-Funktionen (Abschnitt 6.4): Review, Bauteil-Vorschläge, Datenblatt-Leser, Code-Assistent.
 * Online nur mit dem eigenen API-Schlüssel des Nutzers (oder dem Firmen-Endpunkt aus den Richtlinien),
 * offline mit regelbasierten Ersatzfunktionen. Firmen können die KI komplett abschalten.
 */
import Anthropic from '@anthropic-ai/sdk';
import { MODEL } from './offline';
import { org } from '../enterprise/org';
import { serializeOhm } from '../ohm/format';
import { erc } from '../eda/erc';
import { drc } from '../eda/drc';
import { emcCheck, thermalAnalysis } from '../analysis/analyses';
import { runProject } from '../analysis/runner';
import { ALL_PARTS, getPart } from '../parts/registry';
import { sourcedBom } from '../export/sourcing';
import type { Project } from '../ohm/model';

export function apiKey(): string {
  try {
    return localStorage.getItem('ohm.apiKey') ?? '';
  } catch {
    return '';
  }
}

export function aiAvailable(): 'aus' | 'online' | 'offline' {
  if (org().aiDisabled) return 'aus';
  return apiKey() || org().aiEndpoint ? 'online' : 'offline';
}

function client(): Anthropic {
  const o = org();
  if (o.aiDisabled) throw new Error('KI ist durch Richtlinien abgeschaltet.');
  // Schlüssel stammt vom Nutzer bzw. der Firma und bleibt auf diesem Rechner.
  return new Anthropic({ apiKey: apiKey() || 'firmen-endpunkt', baseURL: o.aiEndpoint || undefined, dangerouslyAllowBrowser: true });
}

const COMMON = {
  model: MODEL,
  thinking: { type: 'adaptive' },
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
} as const;

export async function structured<T>(system: string, content: Anthropic.Beta.BetaContentBlockParam[], schema: Record<string, unknown>, effort: 'low' | 'medium' | 'high' = 'high'): Promise<T> {
  const stream = client().beta.messages.stream({
    ...COMMON,
    max_tokens: 32000,
    output_config: { effort, format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content }],
  } as any);
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('Die KI hat die Anfrage abgelehnt.');
  if (msg.stop_reason === 'max_tokens') throw new Error('Die Antwort wurde abgeschnitten.');
  const text = msg.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');
  return JSON.parse(text) as T;
}

/* ------------------------------ KI-Review ------------------------------ */

export interface ReviewFinding {
  schwere: 'kritisch' | 'warnung' | 'hinweis';
  teil: string;
  titel: string;
  erklaerung: string;
  vorschlag: string;
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['zusammenfassung', 'befunde'],
  properties: {
    zusammenfassung: { type: 'string' },
    befunde: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['schwere', 'teil', 'titel', 'erklaerung', 'vorschlag'],
        properties: {
          schwere: { type: 'string', enum: ['kritisch', 'warnung', 'hinweis'] },
          teil: { type: 'string' },
          titel: { type: 'string' },
          erklaerung: { type: 'string' },
          vorschlag: { type: 'string' },
        },
      },
    },
  },
};

/** Regelbasierte Befunde (immer verfügbar, auch Grundlage für die KI) */
export function ruleFindings(project: Project): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  for (const i of erc(project)) out.push({ schwere: i.level === 'error' ? 'kritisch' : 'warnung', teil: i.part ?? '', titel: 'Elektrische Regel', erklaerung: i.text.replace(/^ERC: /, ''), vorschlag: '' });
  try {
    const m = runProject(project);
    for (const t of thermalAnalysis(project, m)) if (t.level !== 'ok') out.push({ schwere: t.level === 'error' ? 'kritisch' : 'warnung', teil: t.id, titel: 'Wärme', erklaerung: `${t.id} setzt ${(t.p * 1000).toFixed(0)} mW um und erreicht etwa ${t.t.toFixed(0)} °C (max. ${t.tmax} °C).`, vorschlag: t.hint ?? '' });
    for (const e of m.errors) out.push({ schwere: 'kritisch', teil: '', titel: 'Simulation', erklaerung: e, vorschlag: '' });
  } catch {
    /* Simulation optional */
  }
  for (const e of emcCheck(project)) if (e.level !== 'ok') out.push({ schwere: e.level === 'error' ? 'kritisch' : 'hinweis', teil: e.part ?? '', titel: `EMV: ${e.rule}`, erklaerung: e.text, vorschlag: '' });
  const d = drc(project);
  if (d.length) out.push({ schwere: 'warnung', teil: '', titel: 'Platine (DRC)', erklaerung: `${d.length} Verstöße gegen die Fertigungsregeln, z. B.: ${d[0].text}`, vorschlag: 'Platinenansicht öffnen und markierte Stellen korrigieren.' });
  for (const r of sourcedBom(project)) if (r.src.lifecycle === 'nrnd' || r.src.lifecycle === 'abgekuendigt') out.push({ schwere: 'hinweis', teil: r.refs.join(', '), titel: 'Beschaffung', erklaerung: `${r.bezeichnung} ist ${r.src.lifecycle === 'nrnd' ? 'nicht mehr für Neuentwicklungen empfohlen' : 'abgekündigt'}.`, vorschlag: `Alternative: ${r.src.alternativen[0] ?? '—'}` });
  return out;
}

export async function aiReview(project: Project): Promise<{ zusammenfassung: string; befunde: ReviewFinding[]; quelle: 'ki' | 'regeln' }> {
  const rules = ruleFindings(project);
  if (aiAvailable() !== 'online') {
    const k = rules.filter((r) => r.schwere === 'kritisch').length;
    return { quelle: 'regeln', befunde: rules, zusammenfassung: rules.length ? `${rules.length} Befunde, davon ${k} kritisch (regelbasierte Prüfung ohne KI).` : 'Keine Auffälligkeiten gefunden (regelbasierte Prüfung ohne KI).' };
  }
  const r = await structured<{ zusammenfassung: string; befunde: ReviewFinding[] }>(
    'Du bist ein erfahrener Elektronik-Entwickler und prüfst Schaltungen aus Ohm Studio (.ohm-Format). Finde echte Fehler: falsche Vorwiderstände, fehlende Pull-ups/Abblockkondensatoren, Pegelkonflikte, Überlast, Code-Fehler, Sicherheitsrisiken. Erkläre jeden Befund verständlich auf Deutsch für Einsteiger und nenne eine konkrete Lösung. Bestätige die automatischen Befunde nur, wenn sie zutreffen, und ergänze eigene. Keine Füllbefunde.',
    [{ type: 'text', text: `Projekt:\n\`\`\`yaml\n${serializeOhm(project)}\n\`\`\`\n\nAutomatische Prüfungen:\n${rules.map((x) => `- [${x.schwere}] ${x.teil} ${x.titel}: ${x.erklaerung}`).join('\n') || '- keine'}` }],
    REVIEW_SCHEMA,
  );
  return { ...r, quelle: 'ki' };
}

/* ------------------------------ Bauteil-Vorschläge ------------------------------ */

export interface PartSuggestion {
  typ: string;
  name: string;
  grund: string;
  preis?: number;
}

export function offlineSuggestions(type: string): PartSuggestion[] {
  const def = getPart(type);
  if (!def) return [];
  const price = def.price ?? Infinity;
  return ALL_PARTS.filter((p) => p.category === def.category && p.type !== def.type && !p.noBom)
    .map((p) => ({ typ: p.type, name: p.name, grund: (p.price ?? 0) < price ? `günstiger (ca. ${(p.price ?? 0).toFixed(2)} € statt ${price.toFixed(2)} €)` : 'gleiche Kategorie', preis: p.price }))
    .sort((a, b) => (a.preis ?? 99) - (b.preis ?? 99))
    .slice(0, 6);
}

export async function suggestParts(project: Project, partId: string, wunsch: string): Promise<PartSuggestion[]> {
  const inst = project.parts.find((p) => p.id === partId);
  if (!inst) return [];
  if (aiAvailable() !== 'online') return offlineSuggestions(inst.type);
  const lib = ALL_PARTS.filter((p) => !p.noBom)
    .map((p) => `${p.type} | ${p.name} | ${p.category} | ${p.price ?? '?'} €`)
    .join('\n');
  const r = await structured<{ vorschlaege: PartSuggestion[] }>(
    'Du hilfst bei der Bauteilauswahl in Ohm Studio. Schlage nur Typen aus der Bibliothek vor, die elektrisch in die Schaltung passen. Begründe kurz auf Deutsch (Preis, Gehäuse, Kennwerte).',
    [{ type: 'text', text: `Bibliothek (typ | name | kategorie | preis):\n${lib}\n\nSchaltung:\n\`\`\`yaml\n${serializeOhm(project)}\n\`\`\`\n\nBauteil ${partId} (${inst.type}). Wunsch: ${wunsch || 'eine bessere oder günstigere Alternative'}` }],
    { type: 'object', additionalProperties: false, required: ['vorschlaege'], properties: { vorschlaege: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['typ', 'name', 'grund'], properties: { typ: { type: 'string' }, name: { type: 'string' }, grund: { type: 'string' } } } } } },
    'medium',
  );
  return r.vorschlaege.filter((v) => getPart(v.typ));
}

/* ------------------------------ Datenblatt-Leser ------------------------------ */

export interface ExtractedPart {
  name: string;
  hersteller: string;
  mpn: string;
  gehaeuse: string;
  beschreibung: string;
  pins: { nummer: number; name: string; funktion: string; art: 'versorgung' | 'masse' | 'eingang' | 'ausgang' | 'bidirektional' | 'passiv' | 'nc' }[];
  kennwerte: { name: string; wert: string }[];
  rastermass_mm: number;
}

const PART_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'hersteller', 'mpn', 'gehaeuse', 'beschreibung', 'pins', 'kennwerte', 'rastermass_mm'],
  properties: {
    name: { type: 'string' },
    hersteller: { type: 'string' },
    mpn: { type: 'string' },
    gehaeuse: { type: 'string' },
    beschreibung: { type: 'string' },
    rastermass_mm: { type: 'number' },
    pins: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['nummer', 'name', 'funktion', 'art'], properties: { nummer: { type: 'integer' }, name: { type: 'string' }, funktion: { type: 'string' }, art: { type: 'string', enum: ['versorgung', 'masse', 'eingang', 'ausgang', 'bidirektional', 'passiv', 'nc'] } } } },
    kennwerte: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'wert'], properties: { name: { type: 'string' }, wert: { type: 'string' } } } },
  },
};

export async function readDatasheet(pdfBase64: string): Promise<ExtractedPart> {
  if (aiAvailable() !== 'online') throw new Error('Der Datenblatt-Leser braucht einen Claude-API-Schlüssel (KI-Assistent → Schlüssel).');
  return structured<ExtractedPart>(
    'Du liest Elektronik-Datenblätter und extrahierst ein Bauteil für eine EDA-Bibliothek. Nimm das erste/Hauptgehäuse, alle Pins in Pin-Nummern-Reihenfolge, und die wichtigsten Kennwerte (Versorgungsspannung, Strom, Grenzwerte). Antworte auf Deutsch.',
    [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
      { type: 'text', text: 'Extrahiere das Bauteil.' },
    ],
    PART_SCHEMA,
  );
}

/** Erzeugt ein Schaltplansymbol (SVG) und ein DIP/SIP-Footprint-Raster aus den Pins */
export function symbolSvg(p: ExtractedPart): string {
  const n = p.pins.length;
  const half = Math.ceil(n / 2);
  const h = Math.max(2, half) * 20 + 20;
  const pinsL = p.pins.slice(0, half);
  const pinsR = p.pins.slice(half).reverse();
  const row = (x: number, y: number, pin: ExtractedPart['pins'][number], right: boolean) =>
    `<line x1="${x}" y1="${y}" x2="${right ? x + 20 : x - 20}" y2="${y}" stroke="currentColor"/><text x="${right ? x + 24 : x - 24}" y="${y + 4}" font-size="9" text-anchor="${right ? 'start' : 'end'}">${pin.nummer}</text><text x="${right ? x - 4 : x + 4}" y="${y + 4}" font-size="10" text-anchor="${right ? 'end' : 'start'}">${pin.name.replace(/[<&]/g, '')}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-60 -20 260 ${h + 30}" font-family="sans-serif" fill="currentColor"><rect x="0" y="0" width="140" height="${h}" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="70" y="-6" text-anchor="middle" font-size="11" font-weight="bold">${p.name.replace(/[<&]/g, '')}</text>${pinsL.map((pin, i) => row(0, 20 + i * 20, pin, false)).join('')}${pinsR.map((pin, i) => row(140, 20 + i * 20, pin, true)).join('')}</svg>`;
}

/* ------------------------------ Code-Assistent ------------------------------ */

export type CodeAction = 'erklaeren' | 'fehler' | 'kommentieren' | 'frage';

export async function codeAssist(project: Project, target: string, code: string, action: CodeAction, frage: string, onText: (t: string) => void): Promise<string> {
  if (aiAvailable() !== 'online') throw new Error('Der Code-Assistent braucht einen Claude-API-Schlüssel (KI-Assistent → Schlüssel).');
  const task = {
    erklaeren: 'Erkläre diesen Code Schritt für Schritt für Einsteiger.',
    fehler: 'Finde Fehler und Probleme (auch im Zusammenspiel mit der Schaltung, z. B. falsche Pins) und zeige korrigierten Code.',
    kommentieren: 'Gib den vollständigen Code mit hilfreichen deutschen Kommentaren zurück (in einem ```cpp-Block).',
    frage: frage,
  }[action];
  const stream = client().beta.messages.stream({
    ...COMMON,
    max_tokens: 32000,
    output_config: { effort: 'medium' },
    system: 'Du bist der Code-Assistent in Ohm Studio. Der Code läuft auf dem Mikrocontroller der gezeigten Schaltung. Antworte auf Deutsch, knapp und konkret.',
    messages: [{ role: 'user', content: `Schaltung:\n\`\`\`yaml\n${serializeOhm(project)}\n\`\`\`\n\nCode für ${target}:\n\`\`\`cpp\n${code}\n\`\`\`\n\n${task}` }],
  } as any);
  let acc = '';
  stream.on('text', (t: string) => {
    acc += t;
    onText(acc);
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') return 'Diese Anfrage kann ich nicht bearbeiten.';
  return acc;
}
