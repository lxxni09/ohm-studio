/**
 * 60-Sekunden-Tour beim ersten Start: 6 Stationen à ca. 10 s (laufen von selbst weiter, „Weiter“ geht schneller),
 * am Ende öffnet sich das Blink-Projekt und die Simulation läuft – das erste funktionierende Projekt.
 * Überspringen ist jederzeit möglich; danach kommt die Tour nicht wieder (Hilfe → Tour startet sie erneut).
 */
import { t } from '../i18n';
import { useEffect, useLayoutEffect, useState } from 'react';
import { loadOhmText, set, startSim, state, subscribe } from '../state/store';
import { EXAMPLES } from '../examples';
import { unlockAudio } from '../audio';

interface Stop {
  sel: string;
  title: string;
  text: string;
  /** vor der Station ausführen (z. B. Ansicht wechseln) */
  before?: () => void;
}

const STOPS: Stop[] = [
  { sel: '.sidebar.left', title: 'Bauteile', text: 'Hier sind über 190 Bauteile – vom Widerstand bis zum ESP32. Zieh sie einfach auf die Fläche. Die Suche versteht auch „led rot“ oder „widerstand 1k“.' },
  { sel: '.stage', title: 'Deine Werkbank', text: 'Auf der Fläche baust du. Klick auf einen Pin und dann auf einen zweiten – schon liegt ein Kabel. Mit R drehst du ein Teil.' },
  { sel: '.rb-views', title: 'Drei Ansichten', text: 'Dieselbe Schaltung als Steckbrett, als Schaltplan oder als fertige Platine – alles bleibt automatisch gleich.' },
  { sel: '.rb-big.play', title: 'Simulieren', text: 'Der Startknopf erweckt die Schaltung zum Leben: echte Spannungen, echter Code, du kannst Taster drücken und Regler drehen.' },
  { sel: '.bottom', title: 'Code und Messwerte', text: 'Unten steht der Code für den Mikrocontroller, dazu serieller Monitor, Oszilloskop und Tests.' },
  { sel: '.idea-btn', title: 'Idee rein, Platine raus', text: 'Beschreib einfach, was du bauen willst. Ohm Studio baut Schaltung und Code, prüft sie selbst und rechnet aus, was die Platine kostet.' },
];
const PER_STOP_MS = 10000;

export function tourDone(): boolean {
  try {
    return localStorage.getItem('ohm.tourDone') === '1';
  } catch {
    return true;
  }
}

let startTour: (() => void) | null = null;
/** Tour erneut starten (Hilfe-Menü) */
export function restartTour() {
  startTour?.();
}

function finish(loadBlink: boolean) {
  try {
    localStorage.setItem('ohm.tourDone', '1');
  } catch {
    /* egal */
  }
  if (loadBlink && EXAMPLES['blink']) {
    loadOhmText(EXAMPLES['blink'], 'blink.ohm');
    unlockAudio();
    setTimeout(startSim, 400);
  }
}

export function Tour() {
  const [i, setI] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [t0, setT0] = useState(() => Date.now());
  const [, tickRender] = useState(0);
  startTour = () => {
    set({ ribbonTab: 'start' });
    setI(0);
    setT0(Date.now());
  };

  // Erst kurz nach dem Start entscheiden: Wurde eine Datei geöffnet (Doppelklick, Link, Sicherung), keine Tour
  useEffect(() => {
    const h = setTimeout(() => {
      if (!tourDone() && !state.project.parts.length && !state.modal) {
        set({ ribbonTab: 'start' });
        setI(0);
        setT0(Date.now());
      }
    }, 1200);
    return () => clearTimeout(h);
  }, []);

  // Zielbereich der Station messen (auch bei Fenstergröße/Layout-Änderungen)
  useLayoutEffect(() => {
    if (i === null) return;
    STOPS[i].before?.();
    const measure = () => {
      const el = document.querySelector(STOPS[i].sel);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    window.addEventListener('resize', measure);
    const un = subscribe(measure);
    return () => {
      window.removeEventListener('resize', measure);
      un();
    };
  }, [i]);

  // von selbst weiterlaufen
  useEffect(() => {
    if (i === null) return;
    const h = setInterval(() => {
      tickRender((x) => x + 1);
      if (Date.now() - t0 >= PER_STOP_MS) next();
    }, 200);
    return () => clearInterval(h);
  });

  // Esc überspringt
  useEffect(() => {
    if (i === null) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skip();
      if (e.key === 'ArrowRight' || e.key === 'Enter') next();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  if (i === null) return null;
  const stop = STOPS[i];
  const frac = Math.min(1, (Date.now() - t0) / PER_STOP_MS);
  const last = i === STOPS.length - 1;

  function next() {
    if (i === null) return;
    if (i >= STOPS.length - 1) {
      setI(null);
      finish(true);
      return;
    }
    setI(i + 1);
    setT0(Date.now());
  }
  function skip() {
    setI(null);
    finish(false);
    set({});
  }

  // Sprechblase neben dem Zielbereich, sonst in der Mitte
  const pad = 8;
  const W = 340;
  let left = window.innerWidth / 2 - W / 2;
  let top = window.innerHeight / 2 - 90;
  if (rect) {
    const roomRight = window.innerWidth - rect.right;
    const roomBelow = window.innerHeight - rect.bottom;
    if (roomBelow > 200) {
      top = rect.bottom + 14;
      left = Math.min(Math.max(12, rect.left + rect.width / 2 - W / 2), window.innerWidth - W - 12);
    } else if (roomRight > W + 30) {
      left = rect.right + 16;
      top = Math.max(12, rect.top + 20);
    } else if (rect.left > W + 30) {
      left = rect.left - W - 16;
      top = Math.max(12, rect.top + 20);
    } else {
      top = Math.max(12, rect.top - 200);
      left = Math.min(Math.max(12, rect.left + rect.width / 2 - W / 2), window.innerWidth - W - 12);
    }
    // Große Bereiche (Arbeitsfläche): Sprechblase in den Bereich hinein
    if (rect.width > window.innerWidth * 0.4 && rect.height > window.innerHeight * 0.4) {
      left = rect.left + rect.width / 2 - W / 2;
      top = rect.top + rect.height / 2 - 90;
    }
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={`Tour: ${stop.title}`}>
      {rect ? (
        <div className="tour-hole" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-card" style={{ left, top, width: W }}>
        <div className="tour-step">
          {i + 1} / {STOPS.length}
        </div>
        <h3>{stop.title}</h3>
        <p>{stop.text}</p>
        <div className="tour-bar">
          <div style={{ width: `${(((i + frac) / STOPS.length) * 100).toFixed(1)}%` }} />
        </div>
        <div className="tour-nav">
          <button className="btn" onClick={skip}>
            {t('Überspringen')}
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn primary" onClick={next} autoFocus>
            {t(last ? 'Los: erstes Projekt starten' : 'Weiter')}
          </button>
        </div>
      </div>
    </div>
  );
}
