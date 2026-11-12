import { useEffect } from 'react';
import { Toolbar, applyTheme } from './ui/Toolbar';
import { Library } from './ui/Library';
import { Inspector } from './ui/Inspector';
import { BottomPanel } from './ui/BottomPanel';
import { Breadboard, PinTooltip } from './views/Breadboard';
import { Schematic } from './views/Schematic';
import { PcbView } from './views/Pcb';
import { Modals } from './ui/Modals';
import { PiMonitor } from './ui/PiMonitor';
import { desk, initDesktop, setCurrentPath } from './desktop';
import { duplicateSelection, loadOhmText, newProject, pauseSim, redo, removeSelection, requestFit, restoreAutosave, rotateSelection, set, startSim, state, subscribe, undo, useStore } from './state/store';
import { openFile, saveFile, loadFromHash } from './ui/files';
import { syncAudio, unlockAudio } from './audio';
import { Icon } from './ui/icons';
import { Wordmark } from './brand/Logo';
import { EXAMPLES } from './examples';
import { Tour } from './ui/Tour';
import { openIdeaWizard } from './ui/IdeaWizard';

function Welcome() {
  const n = useStore((s) => s.project.parts.length);
  if (n > 0) return null;
  const tiles = [
    { t: 'Schlüssel-Türwächter', d: 'ESP32-C3, Reedkontakt, BLE-Anhänger', ex: 'schluessel-tuerwaechter' },
    { t: 'Blink – das erste Programm', d: 'Arduino Uno + LED', ex: 'blink' },
    { t: 'Pflanzenwächter', d: 'ESP32, Bodenfeuchte, OLED', ex: 'pflanzenwaechter' },
    { t: 'Nachtlicht ohne Code', d: 'LDR + Transistor + LED', ex: 'nachtlicht' },
  ];
  return (
    <div className="welcome">
      <div className="welcome-card">
        <div style={{ marginBottom: 10 }}><Wordmark height={14} color="var(--muted)" /></div>
        <h1>Willkommen bei Ohm Studio</h1>
        <p>Bau jede Schaltung virtuell – mit echtem Code, echten Spannungen und Teilen, die aussehen wie in echt. Zieh Bauteile aus der Bibliothek links auf die Fläche oder starte mit einem Beispiel.</p>
        <div className="tiles">
          {tiles.map((x) => (
            <button key={x.ex} className="tile" onClick={() => EXAMPLES[x.ex] && loadOhmText(EXAMPLES[x.ex], `${x.ex}.ohm`)}>
              <span className="ti">
                <Icon.sparkles size={17} />
              </span>
              <span>
                <b>{x.t}</b>
                <span>{x.d}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="try-ideas">
          <span>Probier mal:</span>
          {['Eine Lampe, die angeht, wenn es dunkel wird', 'Ein Thermometer mit Anzeige', 'Eine Alarmanlage für die Zimmertür'].map((s) => (
            <button key={s} className="try-chip" onClick={() => openIdeaWizard(s)}>
              „{s}“
            </button>
          ))}
        </div>
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={() => openIdeaWizard()}>
            <Icon.sparkles size={14} /> Neues Projekt aus Idee
          </button>
          <button className="btn" onClick={() => openFile()}>
            <Icon.folder size={14} /> .ohm-Datei öffnen
          </button>
          <button className="btn" onClick={() => set({ modal: 'examples' })}>
            Alle Beispiele
          </button>
        </div>
      </div>
    </div>
  );
}

function Toast() {
  const t = useStore((s) => s.toast);
  if (!t) return null;
  return (
    <div className={`toast ${t.level}`} key={t.id}>
      {t.level === 'error' ? <Icon.error size={16} style={{ color: 'var(--red)' }} /> : t.level === 'warn' ? <Icon.warn size={16} style={{ color: 'var(--orange)' }} /> : <Icon.check size={16} style={{ color: 'var(--green)' }} />}
      {t.text}
    </div>
  );
}

export function App() {
  const view = useStore((s) => s.view);
  const pi = useStore((s) => s.piMonitor);

  useEffect(() => {
    applyTheme(state.theme);
    (async () => {
      if (await loadFromHash()) return;
      if (!restoreAutosave()) {
        /* leeres Projekt mit Willkommen */
      }
      requestFit();
    })();
    const un = subscribe(() => syncAudio(state.sim === 'running'));
    void initDesktop({
      open: (f) => {
        loadOhmText(f.text, f.name);
        setCurrentPath(f.path);
      },
      save: () => saveFile(false),
    });
    // Dateien per Drag & Drop öffnen
    const onDrop = (e: DragEvent) => {
      const f = e.dataTransfer?.files?.[0];
      if (f && /\.(ohm|ya?ml)$/i.test(f.name)) {
        e.preventDefault();
        f.text().then((t) => loadOhmText(t, f.name));
      } else if (f && /\.(kicad_sch|schdoc)$/i.test(f.name)) {
        // KiCad/Altium per Drag & Drop: Import-Dialog mit Bericht
        e.preventDefault();
        set({ modal: 'import' });
        void f.arrayBuffer().then((b) => (globalThis as unknown as { __ohmImportDrop?: (p: { name: string; bytes: Uint8Array }) => void }).__ohmImportDrop?.({ name: f.name, bytes: new Uint8Array(b) }));
      }
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onDragOver);
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      const typing = tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveFile(e.shiftKey);
        return;
      }
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void openFile();
        return;
      }
      if (e.key === 'F11') {
        e.preventDefault();
        const d = desk();
        if (d) void d.windowCmd('fullscreen');
        else if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.().catch(() => undefined);
        return;
      }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        newProject();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        removeSelection();
      } else if (e.key === 'r' || e.key === 'R') {
        rotateSelection();
      } else if (e.key === 'Escape') {
        set({ wiring: null, selection: [], selectedNet: null, modal: null });
      } else if (e.key === ' ') {
        e.preventDefault();
        unlockAudio();
        if (state.sim === 'running') pauseSim();
        else startSim();
      } else if (e.key === 'f' || e.key === 'F') {
        requestFit();
      } else if (e.key === '1') set({ view: 'steckbrett' });
      else if (e.key === '2') set({ view: 'schaltplan' });
      else if (e.key === '3') set({ view: 'platine' });
    };
    window.addEventListener('keydown', onKey);
    const beforeUnload = () => undefined;
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      un();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <Library />
        <div className="center">
          <div className="stage">
            {view === 'steckbrett' && <Breadboard />}
            {view === 'schaltplan' && <Schematic />}
            {view === 'platine' && <PcbView />}
            <Welcome />
          </div>
          <BottomPanel />
        </div>
        <Inspector />
      </div>
      <PinTooltip />
      <Modals />
      <Tour />
      {pi && <PiMonitor id={pi} />}
      <Toast />
    </div>
  );
}
