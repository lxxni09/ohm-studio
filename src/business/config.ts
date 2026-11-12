/**
 * Einnahmequellen – vorbereitet, aber standardmäßig AUS. Eingeschaltet wird nur beim Bauen über Variablen
 * (z. B. in GitHub Actions): VITE_LICENSE_ENFORCE=1, VITE_PARTNER_LINKS=1, VITE_KITS=1, VITE_MARKETPLACE=1.
 * Transparenz ist Pflicht: Jede Stelle, an der Nodaris Geld verdient, ist im Programm sichtbar beschriftet,
 * und Einstellungen → Transparenz zeigt alles auf einen Blick. Keine Werbung, keine versteckten Provisionen.
 */
import { ENFORCE } from '../license/license';

const env = ((import.meta as { env?: Record<string, string> }).env ?? {}) as Record<string, string | undefined>;

/** Vorschau für Tests/Demos: localStorage „ohm.business.vorschau“ = {"partnerLinks":true,…} (ändert nichts an Preisen) */
function preview(): Partial<Business> {
  try {
    return JSON.parse(localStorage.getItem('ohm.business.vorschau') ?? '{}') as Partial<Business>;
  } catch {
    return {};
  }
}

export interface Business {
  planLocks: boolean;
  partnerLinks: boolean;
  kits: boolean;
  marketplace: boolean;
  /** Anteil, den Nodaris bei Marktplatz-Verkäufen behält */
  marketplaceFee: number;
}

export function business(): Business {
  return {
    planLocks: ENFORCE,
    partnerLinks: env.VITE_PARTNER_LINKS === '1',
    kits: env.VITE_KITS === '1',
    marketplace: env.VITE_MARKETPLACE === '1',
    marketplaceFee: 0.15,
    ...preview(),
  };
}

export const PROVISION_HINWEIS = 'Nodaris erhält eine Provision, für dich ändert sich der Preis nicht.';
export const TESTMODUS_HINWEIS = 'Testmodus – es wird kein echtes Geld bewegt.';

/* ------------------------------ Partner-Shops ------------------------------ */

export interface Partner {
  id: string;
  name: string;
  /** Suchlink für eine Teilenummer/Bezeichnung; mit Partner-Kennung, wenn eine hinterlegt ist */
  link(query: string): string;
  /** true, wenn eine Partner-Kennung hinterlegt ist (nur dann gibt es eine Provision) */
  provision: boolean;
}

function withTag(url: string, param: string, tag: string | undefined) {
  if (!tag) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${param}=${encodeURIComponent(tag)}`;
}

export function partners(): Partner[] {
  const p = preview() as Record<string, unknown>;
  const tag = (k: string) => (p[`tag_${k}`] as string | undefined) ?? env[`VITE_PARTNER_${k.toUpperCase()}`];
  return [
    { id: 'lcsc', name: 'LCSC', link: (q) => withTag(`https://www.lcsc.com/search?q=${encodeURIComponent(q)}`, 'utm_source', tag('lcsc')), provision: !!tag('lcsc') },
    { id: 'reichelt', name: 'reichelt', link: (q) => withTag(`https://www.reichelt.de/index.html?ACTION=446&SEARCH=${encodeURIComponent(q)}`, 'PROVID', tag('reichelt')), provision: !!tag('reichelt') },
    { id: 'berrybase', name: 'BerryBase', link: (q) => withTag(`https://www.berrybase.de/search?sSearch=${encodeURIComponent(q)}`, 'partner', tag('berrybase')), provision: !!tag('berrybase') },
  ];
}
