import { EXAMPLES } from '../examples';

export const MODEL = 'claude-opus-5-5';

export interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
}

export function extractOhm(text: string): string | null {
  const m = /```(?:yaml|ohm|yml)?\s*\n([\s\S]*?)```/.exec(text);
  if (m && /\bteile\s*:/.test(m[1])) return m[1];
  return null;
}

/** Offline: passende Vorlage per Stichwort */
export function offlineTemplate(prompt: string): { key: string; text: string } | null {
  const p = prompt.toLowerCase();
  const rules: [RegExp, string][] = [
    [/pflanze|boden|gieß|giess|feucht/, 'pflanzenwaechter'],
    [/tür|tuer|schlüssel|schluessel|ble|beacon|anhänger/, 'schluessel-tuerwaechter'],
    [/thermo|temperatur|dht|klima|lcd/, 'thermometer'],
    [/ampel|fußgänger|fussgaenger/, 'ampel'],
    [/abstand|ultraschall|park|entfernung|hc-sr04/, 'abstandswarner'],
    [/servo|poti|winkel/, 'servo-poti'],
    [/nacht|dunkel|ldr|lichtsensor|dämmer/, 'nachtlicht'],
    [/555|timer|ohne mikrocontroller|ohne code/, 'timer555'],
    [/lauflicht|schieberegister|595/, 'lauflicht-595'],
    [/blink|led|anfänger|erste/, 'blink'],
  ];
  for (const [re, key] of rules) if (re.test(p) && EXAMPLES[key]) return { key, text: EXAMPLES[key] };
  return null;
}
