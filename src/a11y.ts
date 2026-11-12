/** Barrierefreiheit: Farbenblind-Modus, Skalierung, hoher Kontrast, reduzierte Bewegung */
export interface A11y {
  colorblind: boolean;
  scale: number;
  contrast: boolean;
  reducedMotion: boolean;
}

function load(): A11y {
  try {
    return { colorblind: false, scale: 1, contrast: false, reducedMotion: false, ...JSON.parse(localStorage.getItem('ohm.a11y') ?? '{}') };
  } catch {
    return { colorblind: false, scale: 1, contrast: false, reducedMotion: false };
  }
}

export const a11y: A11y = load();

export function applyA11y() {
  if (typeof document === 'undefined') return;
  const r = document.documentElement;
  r.style.setProperty('--ui-scale', String(a11y.scale));
  (document.getElementById('root') as HTMLElement | null)?.style.setProperty('zoom', String(a11y.scale));
  r.classList.toggle('hc', a11y.contrast);
  r.classList.toggle('reduce-motion', a11y.reducedMotion);
}

export function setA11y(p: Partial<A11y>, reload = false) {
  Object.assign(a11y, p);
  try {
    localStorage.setItem('ohm.a11y', JSON.stringify(a11y));
  } catch {
    /* egal */
  }
  applyA11y();
  if (reload && typeof location !== 'undefined') location.reload();
}
