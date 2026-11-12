/** Mitgelieferte Beispielprojekte (.ohm) */
const files = import.meta.glob('../examples/*.ohm', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const EXAMPLES: Record<string, string> = Object.fromEntries(Object.entries(files).map(([k, v]) => [k.replace(/^.*\/(.+)\.ohm$/, '$1'), v]));

export interface ExampleInfo {
  key: string;
  name: string;
  beschreibung: string;
}

export function exampleList(): ExampleInfo[] {
  return Object.entries(EXAMPLES)
    .map(([key, text]) => ({
      key,
      name: /name:\s*(.+)/.exec(text)?.[1]?.trim() ?? key,
      beschreibung: /beschreibung:\s*(.+)/.exec(text)?.[1]?.trim() ?? '',
    }))
    .sort((a, b) => (a.key === 'schluessel-tuerwaechter' ? -1 : b.key === 'schluessel-tuerwaechter' ? 1 : a.name.localeCompare(b.name)));
}
