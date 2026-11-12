/**
 * Sprachen: Deutsch (vollständig) plus Englisch, Französisch, Spanisch, Italienisch, Polnisch,
 * Chinesisch, Japanisch, Koreanisch, Portugiesisch für Menüs, Werkzeugleiste, Bibliothek und Panels.
 */
import { CATEGORY_DICT, DICT, LANGS, type Lang } from './dict';

export { LANGS, type Lang };

function detect(): Lang {
  try {
    const s = localStorage.getItem('ohm.lang') as Lang | null;
    if (s && LANGS.some(([k]) => k === s)) return s;
  } catch {
    /* egal */
  }
  return 'de';
}

let lang: Lang = detect();
if (typeof document !== 'undefined') document.documentElement.lang = lang;

export function currentLang(): Lang {
  return lang;
}

export function setLang(l: Lang) {
  lang = l;
  try {
    localStorage.setItem('ohm.lang', l);
  } catch {
    /* egal */
  }
  if (typeof location !== 'undefined') location.reload();
}

const IDX: Record<Lang, number> = { de: -1, en: 0, fr: 1, es: 2, it: 3, pl: 4, zh: 5, ja: 6, ko: 7, pt: 8 };

/** Übersetzt einen deutschen Oberflächentext (fällt auf Deutsch zurück) */
export function t(de: string): string {
  const i = IDX[lang];
  if (i < 0) return de;
  return DICT[de]?.[i] ?? CATEGORY_DICT[de]?.[i] ?? de;
}

/** Anteil übersetzter Schlüssel je Sprache (für die Einstellungen) */
export function coverage(): number {
  return Object.keys(DICT).length + Object.keys(CATEGORY_DICT).length;
}
