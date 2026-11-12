/**
 * KI-Assistent: erzeugt aus einer Beschreibung ein vollständiges .ohm-Projekt.
 * Online über die Claude API (eigener API-Schlüssel des Nutzers, direkt aus dem Browser),
 * offline über passende Vorlagen.
 */
import Anthropic from '@anthropic-ai/sdk';
import guide from '../../OHM_FOR_AI.md?raw';
import { typeList } from '../ohm/format';
import { EXAMPLES } from '../examples';

import { MODEL, type ChatMsg } from './offline';
import { org } from '../enterprise/org';

export function systemPrompt(): string {
  const types = typeList()
    .map((t) => `- ${t.typ} (${t.name}) Pins: ${t.pins.slice(0, 40).join(', ')}${t.eigenschaften.length ? ` · Eigenschaften: ${t.eigenschaften.join(', ')}` : ''}`)
    .join('\n');
  return `Du bist der eingebaute Assistent von Ohm Studio, einem Elektronik-Simulator. Du baust für den Nutzer komplette, simulierbare Projekte im .ohm-Format.

${guide}

## Verfügbare Bauteiltypen
${types}

## Beispiel (vollständiges Projekt)
\`\`\`yaml
${EXAMPLES['schluessel-tuerwaechter'] ?? ''}
\`\`\`

Antworte auf Deutsch. Erkläre in 2–4 Sätzen, was du gebaut hast, und gib dann das komplette Projekt in genau einem \`\`\`yaml-Block aus.`;
}

export async function askClaude(apiKey: string, history: ChatMsg[], onText?: (t: string) => void): Promise<string> {
  // Der Schlüssel stammt vom Nutzer selbst und bleibt in seinem Browser.
  const o = org();
  if (o.aiDisabled) throw new Error('Die KI ist durch die Richtlinien deiner Organisation abgeschaltet.');
  const client = new Anthropic({ apiKey: apiKey || 'firmen-endpunkt', baseURL: o.aiEndpoint || undefined, dangerouslyAllowBrowser: true });
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: systemPrompt(),
    messages: history.map((m) => ({ role: m.role, content: m.text })),
  } as any);
  let acc = '';
  stream.on('text', (t: string) => {
    acc += t;
    onText?.(acc);
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') return 'Diese Anfrage kann ich leider nicht bearbeiten. Formuliere sie bitte anders.';
  const text = msg.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');
  if (msg.stop_reason === 'max_tokens') return text + '\n\n(Die Antwort wurde abgeschnitten – bitte nach einer kleineren Schaltung fragen.)';
  return text;
}

