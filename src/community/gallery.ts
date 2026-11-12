/**
 * Community-Galerie – Verbindung zum Nodaris-Server (server/gallery.mjs).
 * Ohne eingestellten Server zeigt die Galerie ehrlich nur die offiziellen Beispiele (offline).
 * Daten verlassen den Rechner nur beim Anmelden, Veröffentlichen, Liken, Kommentieren oder Melden.
 */
import { EXAMPLES, exampleList } from '../examples';

export interface GalleryEntry {
  id: string;
  titel: string;
  beschreibung: string;
  kategorie: string;
  autor: string;
  vorschau: string | null;
  remixVon: string | null;
  remixVonTitel: string | null;
  remixe: number;
  likes: number;
  gefaelltMir: boolean;
  kommentare: number;
  erstellt: number;
  offiziell: boolean;
  teile: number;
}

export interface GalleryDetail extends GalleryEntry {
  ohm: string;
  remixListe: { id: string; titel: string; autor: string }[];
  kommentarListe: { id: string; autor: string; text: string; zeit: number }[];
}

export const KATEGORIEN = ['Einsteiger', 'Licht', 'Sensoren', 'Smart Home', 'Spiele', 'Roboter & Motoren', 'Audio', 'Werkzeuge', 'Sonstiges'];
export const MELDEGRUENDE = ['Spam oder Werbung', 'Beleidigend oder gemein', 'Gefährliche Schaltung', 'Fremdes Projekt kopiert', 'Persönliche Daten', 'Sonstiges'];

const KEY = 'ohm.galerie';
interface Stored {
  server: string;
  token?: string;
  name?: string;
  admin?: boolean;
}

function stored(): Stored {
  try {
    return { server: (import.meta.env.VITE_GALLERY_URL as string | undefined) ?? '', ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Stored>) };
  } catch {
    return { server: '' };
  }
}
function store(p: Partial<Stored>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...stored(), ...p }));
  } catch {
    /* egal */
  }
}

export const gallery = {
  server: () => stored().server.replace(/\/$/, ''),
  setServer: (url: string) => store({ server: url.trim(), token: undefined, name: undefined, admin: undefined }),
  user: () => {
    const s = stored();
    return s.token ? { name: s.name ?? '', admin: !!s.admin } : null;
  },
  logout: () => store({ token: undefined, name: undefined, admin: undefined }),
};

/** Woher das gerade geöffnete Projekt stammt (für „Remix von …“ beim Veröffentlichen) */
export let origin: { id: string; titel: string } | null = null;
export function setOrigin(o: typeof origin) {
  origin = o;
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const base = gallery.server();
  if (!base) throw new Error('Kein Galerie-Server eingestellt.');
  const s = stored();
  let r: Response;
  try {
    r = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(s.token ? { Authorization: `Bearer ${s.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Der Galerie-Server ist nicht erreichbar. Bist du online?');
  }
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  if (r.status === 401 && s.token) gallery.logout();
  if (!r.ok) throw new Error(j.error ?? `Fehler ${r.status}`);
  return j as T;
}

export async function register(name: string, passwort: string, alterOk: boolean) {
  const r = await api<{ token: string; name: string; admin: boolean }>('/v1/galerie/konto', { name, passwort, alterOk });
  store({ token: r.token, name: r.name, admin: r.admin });
  return r;
}
export async function login(name: string, passwort: string) {
  const r = await api<{ token: string; name: string; admin: boolean }>('/v1/galerie/anmelden', { name, passwort });
  store({ token: r.token, name: r.name, admin: r.admin });
  return r;
}

/** Offline: nur die offiziellen Beispiele */
function offlineList(q: string, kategorie: string): GalleryEntry[] {
  return exampleList()
    .map((e, i) => ({
      id: `bsp-${e.key}`,
      titel: e.name,
      beschreibung: e.beschreibung ?? '',
      kategorie: 'Einsteiger',
      autor: 'Nodaris',
      vorschau: null,
      remixVon: null,
      remixVonTitel: null,
      remixe: 0,
      likes: 0,
      gefaelltMir: false,
      kommentare: 0,
      erstellt: i,
      offiziell: true,
      teile: (EXAMPLES[e.key].match(/^\s{2}[A-Za-z][\w-]*\s*:\s*\{?\s*typ:/gm) ?? []).length,
    }))
    .filter((e) => (!kategorie || e.kategorie === kategorie) && (!q || `${e.titel} ${e.beschreibung}`.toLowerCase().includes(q.toLowerCase())));
}

export async function list(q = '', kategorie = '', sort = 'neu'): Promise<{ eintraege: GalleryEntry[]; gesamt: number; offline: boolean }> {
  if (!gallery.server()) {
    const e = offlineList(q, kategorie);
    return { eintraege: e, gesamt: e.length, offline: true };
  }
  const r = await api<{ eintraege: GalleryEntry[]; gesamt: number }>(`/v1/galerie?q=${encodeURIComponent(q)}&kategorie=${encodeURIComponent(kategorie)}&sort=${sort}`);
  return { ...r, offline: false };
}

export async function detail(id: string): Promise<GalleryDetail> {
  if (!gallery.server() && id.startsWith('bsp-')) {
    const key = id.slice(4);
    const e = offlineList('', '').find((x) => x.id === id)!;
    return { ...e, ohm: EXAMPLES[key], remixListe: [], kommentarListe: [] };
  }
  return api<GalleryDetail>(`/v1/galerie/${id}`);
}

export const like = (id: string) => api<{ likes: number; gefaelltMir: boolean }>(`/v1/galerie/${id}/like`, {});
export const comment = (id: string, text: string) => api<{ id: string; autor: string; text: string; zeit: number }>(`/v1/galerie/${id}/kommentar`, { text });
export const report = (id: string, grund: string) => api<{ ok: boolean; text: string }>(`/v1/galerie/${id}/melden`, { grund });
export const publish = (p: { titel: string; beschreibung: string; kategorie: string; ohm: string; vorschau: string | null; remixVon: string | null }) => api<GalleryEntry>('/v1/galerie', p);

export interface Report {
  id: string;
  titel: string;
  autor: string;
  verborgen: boolean;
  meldungen: { grund: string; zeit: number }[];
  kommentarTexte: { id: string; autor: string; text: string; verborgen: boolean }[];
}
export const adminReports = () => api<{ eintraege: Report[] }>('/v1/galerie/admin/meldungen');
export const adminAction = (id: string, aktion: 'verbergen' | 'freigeben' | 'loeschen', kommentar?: string) => api<{ ok: boolean }>(`/v1/galerie/admin/${id}`, { aktion, kommentar });

/** Vorschaubild der aktuellen Ansicht (Arbeitsfläche als PNG/JPEG, max. ca. 200 KB) */
export async function snapshot(): Promise<string | null> {
  const svg = document.querySelector('.stage svg') as SVGSVGElement | null;
  if (!svg) return null;
  try {
    const box = svg.getBoundingClientRect();
    const clone = svg.cloneNode(true) as SVGSVGElement;
    // Darstellung kommt teils aus dem Stylesheet – als Inline-Stil übernehmen, sonst wird alles schwarz
    const PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'display', 'visibility', 'color'];
    const src = [svg, ...svg.querySelectorAll('*')] as Element[];
    const dst = [clone, ...clone.querySelectorAll('*')] as Element[];
    for (let i = 0; i < src.length && i < dst.length; i++) {
      const cs = getComputedStyle(src[i]);
      let st = '';
      for (const k of PROPS) {
        const v = cs.getPropertyValue(k);
        if (v) st += `${k}:${v};`;
      }
      (dst[i] as SVGElement).setAttribute('style', st + (dst[i].getAttribute('style') ?? ''));
      dst[i].removeAttribute('class');
    }
    clone.setAttribute('width', String(box.width));
    clone.setAttribute('height', String(box.height));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('style', `${clone.getAttribute('style') ?? ''};background:${getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() || '#f4f5f7'}`);
    // Farben aus CSS-Variablen in feste Werte umrechnen, damit das Bild ohne Stylesheet stimmt
    const css = getComputedStyle(document.documentElement);
    let txt = new XMLSerializer().serializeToString(clone).replace(/var\((--[\w-]+)\)/g, (_, v: string) => css.getPropertyValue(v).trim() || '#888');
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(txt);
    await img.decode();
    const W = 640;
    const H = Math.round((W * box.height) / box.width);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = css.getPropertyValue('--canvas').trim() || '#f4f5f7';
    g.fillRect(0, 0, W, H);
    g.drawImage(img, 0, 0, W, H);
    for (const q of [0.82, 0.6, 0.4]) {
      const url = c.toDataURL('image/jpeg', q);
      if (url.length < 200 * 1024) return url;
    }
    return null;
  } catch (e) {
    console.warn('Vorschaubild nicht möglich:', e);
    return null;
  }
}

/* ------------------------------ Marktplatz (nur wenn eingeschaltet) ------------------------------ */

export interface Offer {
  id: string;
  eintrag: string;
  titel: string;
  art: 'datei' | 'bausatz';
  preis: number;
  preisText: string;
  verkaeufer: string;
  gebuehr: number;
  testmodus: boolean;
}
export const offers = () => api<{ angebote: Offer[]; gebuehr: number; testmodus: boolean }>('/v1/markt');
export const sell = (eintrag: string, art: 'datei' | 'bausatz', preis: number) => api<Offer>('/v1/markt', { eintrag, art, preis });
export const buy = (id: string) => api<{ bestellung: string; zahlung: { id: string; modus: string }; preisText: string; gebuehrText: string; auszahlungText: string }>(`/v1/markt/${id}/kaufen`, {});
export const confirmTestPayment = (sid: string) => api<{ ok: boolean; art: string; ohm?: string; text: string }>(`/v1/markt/zahlung/${sid}`, {});
