/**
 * Obere Leiste im Stil technischer CAD-Programme (Ribbon): Titelzeile mit Schnellzugriff, darunter Reiter und
 * beschriftete Befehlsgruppen. Keine Aufklappmenüs – jeder Befehl ist mit einem Klick erreichbar.
 */
import { useState, type ReactNode } from 'react';
import { openIdeaWizard } from './IdeaWizard';
import { restartTour } from './Tour';
import { newProject, pauseSim, redo, resetSim, set, startSim, stopSim, undo, useStore, state, changed, engine } from '../state/store';
import { Icon } from './icons';
import { t } from '../i18n';
import { useCollab } from '../team/collabStore';
import { NodeMark } from '../brand/Logo';
import { openFile, saveFile, shareLink } from './files';
import { setMuted, muted, unlockAudio } from '../audio';
import { isDesktop, desk } from '../desktop';

export type RibbonTab = 'datei' | 'start' | 'simulation' | 'platine' | 'analyse' | 'team' | 'einstellungen' | 'hilfe';

const TABS: [RibbonTab, string][] = [
  ['datei', 'Datei'],
  ['start', 'Start'],
  ['simulation', 'Simulation'],
  ['platine', 'Platine & Fertigung'],
  ['analyse', 'Analyse & KI'],
  ['team', 'Team'],
  ['einstellungen', 'Einstellungen'],
  ['hilfe', 'Hilfe'],
];

/** Großer Befehl (Symbol über Text) */
function Big({ icon, label, onClick, on, primary, cls, title, disabled, keys }: { icon: ReactNode; label: string; onClick: () => void; on?: boolean; primary?: boolean; cls?: string; title?: string; disabled?: boolean; keys?: string }) {
  const name = title ?? t(label);
  return (
    <button className={`rb-big ${on ? 'on' : ''} ${primary ? 'primary' : ''} ${cls ?? ''}`} onClick={onClick} title={keys ? `${name} (${keys})` : name} aria-label={name} aria-keyshortcuts={keys} aria-pressed={on} disabled={disabled}>
      <span className="rb-ico">{icon}</span>
      <span className="rb-txt">{t(label)}</span>
    </button>
  );
}

/** Kleiner Befehl (Symbol neben Text) */
function Small({ icon, label, onClick, on, cls, title, disabled, keys }: { icon: ReactNode; label: string; onClick: () => void; on?: boolean; cls?: string; title?: string; disabled?: boolean; keys?: string }) {
  const name = title ?? t(label);
  return (
    <button className={`rb-small ${on ? 'on' : ''} ${cls ?? ''}`} onClick={onClick} title={keys ? `${name} (${keys})` : name} aria-label={name} aria-keyshortcuts={keys} aria-pressed={on} disabled={disabled}>
      {icon}
      <span>{t(label)}</span>
    </button>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rb-group" role="group" aria-label={t(label)}>
      <div className="rb-items">{children}</div>
      <div className="rb-label">{t(label)}</div>
    </div>
  );
}

function Col({ children }: { children: ReactNode }) {
  return <div className="rb-col">{children}</div>;
}

/** Einstellungen direkt auf einem Reiter öffnen */
async function openSettings(tab: 'sprache' | 'emulatoren' | 'server' | 'richtlinien' | 'updates' | 'datenschutz' | 'transparenz') {
  const { settingsIntent } = await import('./SettingsModal');
  settingsIntent.tab = tab;
  set({ modal: 'settings' });
}

export function Toolbar() {
  const sim = useStore((s) => s.sim);
  const view = useStore((s) => s.view);
  const pcb3d = useStore((s) => s.pcb3d);
  const name = useStore((s) => s.project.name);
  const dirty = useStore((s) => s.dirty);
  const speed = useStore((s) => s.project.settings.speed);
  const realism = useStore((s) => s.project.settings.realism);
  const learn = useStore((s) => s.learnMode);
  const theme = useStore((s) => s.theme);
  const libOpen = useStore((s) => s.libraryOpen);
  const inspOpen = useStore((s) => s.inspectorOpen);
  const bottomOpen = useStore((s) => s.bottomOpen);
  const tab = useStore((s) => s.ribbonTab) ?? 'start';
  useStore((s) => (s.sim === 'running' ? Math.floor(s.tick / 10) : 0));
  const [mute, setMute] = useState(muted);
  const setTab = (t: RibbonTab) => set({ ribbonTab: t });

  const play = (
    <Big
      cls={`play ${sim === 'running' ? 'running' : ''}`}
      icon={sim === 'running' ? <Icon.pause size={20} /> : <Icon.play size={20} />}
      label={sim === 'running' ? 'Pause' : 'Start'}
      title={t(sim === 'running' ? 'Pause (Leertaste)' : 'Start (Leertaste)')}
      onClick={() => {
        unlockAudio();
        if (sim === 'running') pauseSim();
        else startSim();
      }}
    />
  );
  const simControls = (
    <Group label="Simulation">
      {play}
      <Col>
        <Small icon={<Icon.reset size={14} />} label="Zurücksetzen" onClick={resetSim} disabled={sim === 'stopped'} />
        <Small icon={<Icon.stop size={13} />} label="Stopp" onClick={stopSim} disabled={sim === 'stopped'} />
        <div className="rb-status">
          <span className={`dot ${sim === 'running' ? 'run' : sim === 'paused' ? 'pause' : ''}`} />
          {sim === 'stopped' ? t('Bereit') : `${(engine.time ?? 0).toFixed(1)} s`}
          <select
            className="speed"
            title="Simulationsgeschwindigkeit"
            aria-label="Simulationsgeschwindigkeit"
            value={speed}
            onChange={(e) => {
              state.project.settings.speed = Number(e.target.value);
              changed(false);
            }}
          >
            {[0.1, 0.25, 0.5, 1, 2, 5, 10].map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </div>
      </Col>
    </Group>
  );
  const views = (
    <Group label="Ansicht">
      <div className="seg rb-views">
        <button className={view === 'steckbrett' ? 'on' : ''} onClick={() => set({ view: 'steckbrett' })} title={`${t('Steckbrett')} (Taste 1)`} aria-keyshortcuts="1">
          <Icon.breadboard size={18} /> <span>{t('Steckbrett')}</span>
        </button>
        <button className={view === 'schaltplan' ? 'on' : ''} onClick={() => set({ view: 'schaltplan' })} title={`${t('Schaltplan')} (Taste 2)`} aria-keyshortcuts="2">
          <Icon.schematic size={18} /> <span>{t('Schaltplan')}</span>
        </button>
        <button className={view === 'platine' ? 'on' : ''} onClick={() => set({ view: 'platine' })} title={`${t('Platine')} (Taste 3)`} aria-keyshortcuts="3">
          <Icon.pcb size={18} /> <span>{t('Platine')}</span>
        </button>
      </div>
      <Big icon={<Icon.cube size={20} />} label="3D" title="3D-Ansicht" on={view === 'platine' && pcb3d} onClick={() => set({ view: 'platine', pcb3d: !(view === 'platine' && pcb3d) })} />
    </Group>
  );

  let body: ReactNode = null;
  if (tab === 'datei')
    body = (
      <>
        <Group label="Projekt">
          <Big icon={<Icon.doc size={20} />} label="Leeres Projekt" title="Leeres Projekt (von Null anfangen)" keys="Strg+N" onClick={() => newProject()} />
          <Big icon={<Icon.folder size={20} />} label="Öffnen" keys="Strg+O" onClick={() => void openFile()} />
          <Big icon={<Icon.sparkles size={20} />} label="Beispiele" onClick={() => set({ modal: 'examples' })} />
        </Group>
        <Group label="Speichern">
          <Big icon={<Icon.download size={20} />} label="Speichern" keys="Strg+S" onClick={() => void saveFile()} />
          <Big icon={<Icon.download size={20} />} label="Speichern unter" keys="Strg+Umschalt+S" onClick={() => void saveFile(true)} />
        </Group>
        <Group label="Austausch">
          <Big icon={<Icon.download size={20} />} label="Importieren" title="Importieren (KiCad, Altium)" onClick={() => set({ modal: 'import' })} />
          <Big icon={<Icon.pcb size={20} />} label="Exportieren" title="Exportieren & bestellen" onClick={() => set({ modal: 'export' })} />
          {!isDesktop() && <Big icon={<Icon.share size={20} />} label="Als Link" title="Als Link teilen" onClick={() => void shareLink()} />}
        </Group>
        {isDesktop() && (
          <Group label="Programm">
            <Big icon={<Icon.close size={20} />} label="Beenden" onClick={() => void desk()?.windowCmd('close')} />
          </Group>
        )}
      </>
    );
  else if (tab === 'start')
    body = (
      <>
        <Group label="Neu">
          <Big icon={<Icon.doc size={20} />} label="Leeres Projekt" cls="blank-btn" title="Leeres Projekt (von Null anfangen)" keys="Strg+N" onClick={() => newProject()} />
          <Big icon={<Icon.sparkles size={20} />} label="Neues Projekt aus Idee" primary cls="idea-btn" onClick={() => openIdeaWizard()} />
          <Big icon={<Icon.send size={20} />} label="KI-Assistent" onClick={() => set({ modal: 'assistant' })} />
        </Group>
        <Group label="Projekt">
          <Big icon={<Icon.folder size={20} />} label="Öffnen" keys="Strg+O" onClick={() => void openFile()} />
          <Big icon={<Icon.sparkles size={20} />} label="Beispiele" onClick={() => set({ modal: 'examples' })} />
          <Big icon={<Icon.share size={20} />} label="Galerie" title="Community-Galerie" cls="gallery-btn" onClick={() => set({ modal: 'galerie' })} />
        </Group>
        {views}
        {simControls}
      </>
    );
  else if (tab === 'simulation')
    body = (
      <>
        {simControls}
        <Group label="Modus">
          <Big icon={<Icon.graduation size={20} />} label="Lernmodus" title="Lernmodus: Stromfluss und Spannungen sichtbar" on={learn} onClick={() => set({ learnMode: !learn })} />
          <Big
            icon={<Icon.bolt size={20} />}
            label="Realismus"
            title="Realismus-Modus (Toleranzen, Wackelkontakte, Erwärmung)"
            on={!!realism}
            onClick={() => {
              state.project.settings.realism = !state.project.settings.realism;
              changed(false);
            }}
          />
          <Big
            icon={<Icon.bell size={20} />}
            label={mute ? 'Töne aus' : 'Töne an'}
            title="Töne ein/aus"
            on={!mute}
            onClick={() => {
              setMuted(!mute);
              setMute(!mute);
            }}
          />
        </Group>
        <Group label="Messen">
          <Big icon={<Icon.terminal size={20} />} label="Monitor & Messgeräte" title="Serieller Monitor, Messgeräte, Tests" on={bottomOpen} onClick={() => set({ bottomOpen: !bottomOpen })} />
        </Group>
      </>
    );
  else if (tab === 'platine')
    body = (
      <>
        {views}
        <Group label="Fertigung">
          <Big icon={<Icon.pcb size={20} />} label="Exportieren & bestellen" onClick={() => set({ modal: 'export' })} />
          <Big icon={<Icon.cube size={20} />} label="Gehäuse" title="Gehäuse (STL/STEP)" onClick={() => set({ modal: 'enclosure' })} />
        </Group>
        <Group label="Austausch">
          <Big icon={<Icon.download size={20} />} label="Importieren" title="Importieren (KiCad, Altium)" onClick={() => set({ modal: 'import' })} />
        </Group>
      </>
    );
  else if (tab === 'analyse')
    body = (
      <>
        <Group label="Analysen">
          <Big icon={<Icon.gauge size={20} />} label="Analysen" title="Analysen (Wärme, Monte Carlo, FMEA, SI/PI, EMV)" onClick={() => set({ modal: 'analysis' })} />
        </Group>
        <Group label="KI">
          <Big icon={<Icon.sparkles size={20} />} label="Neues Projekt aus Idee" primary onClick={() => openIdeaWizard()} />
          <Big icon={<Icon.send size={20} />} label="KI-Assistent" onClick={() => set({ modal: 'assistant' })} />
          <Big icon={<Icon.checklist size={20} />} label="KI-Werkzeuge" title="KI-Werkzeuge (Review, Datenblatt, Platzieren, Code)" onClick={() => set({ modal: 'review' })} />
        </Group>
      </>
    );
  else if (tab === 'team')
    body = (
      <>
        <Group label="Zusammenarbeit">
          <Big icon={<Icon.undo size={20} />} label="Versionen & Review" title="Versionen, Review & Team" onClick={() => set({ modal: 'history' })} />
          <CollabAvatars />
        </Group>
        <Group label="Community">
          <Big icon={<Icon.share size={20} />} label="Galerie" title="Community-Galerie" onClick={() => set({ modal: 'galerie' })} />
        </Group>
        <Group label="Unterricht">
          <Big icon={<Icon.graduation size={20} />} label="Lernen & Klassenraum" onClick={() => set({ modal: 'learn' })} />
        </Group>
      </>
    );
  else if (tab === 'einstellungen')
    body = (
      <>
        <Group label="Darstellung">
          <Big icon={<Icon.sun size={20} />} label="Hell" on={theme === 'light'} onClick={() => applyTheme('light')} />
          <Big icon={<Icon.moon size={20} />} label="Dunkel" on={theme === 'dark'} onClick={() => applyTheme('dark')} />
          <Big icon={<Icon.monitor size={20} />} label="Wie System" on={theme === 'system'} onClick={() => applyTheme('system')} />
        </Group>
        <Group label="Fenster">
          <Col>
            <Small icon={<Icon.sidebarLeft size={14} />} label="Bibliothek" on={libOpen} onClick={() => set({ libraryOpen: !libOpen })} />
            <Small icon={<Icon.sidebarRight size={14} />} label="Inspektor" on={inspOpen} onClick={() => set({ inspectorOpen: !inspOpen })} />
            <Small icon={<Icon.panelBottom size={14} />} label="Unteres Panel" on={bottomOpen} onClick={() => set({ bottomOpen: !bottomOpen })} />
          </Col>
          <Big
            icon={<Icon.bell size={20} />}
            label={mute ? 'Töne aus' : 'Töne an'}
            title="Töne ein/aus"
            on={!mute}
            onClick={() => {
              setMuted(!mute);
              setMute(!mute);
            }}
          />
        </Group>
        <Group label="Programm">
          <Big icon={<Icon.chip size={20} />} label="Sprache" title="Sprache & Barrierefreiheit" onClick={() => void openSettings('sprache')} />
          <Big icon={<Icon.chip size={20} />} label="Emulatoren" onClick={() => void openSettings('emulatoren')} />
          <Big icon={<Icon.download size={20} />} label="Updates" onClick={() => void openSettings('updates')} />
          <Big icon={<Icon.monitor size={20} />} label="Firmenserver" title="Firmenserver & Anmeldung" onClick={() => void openSettings('server')} />
          <Big icon={<Icon.checklist size={20} />} label="Richtlinien" onClick={() => void openSettings('richtlinien')} />
          <Big icon={<Icon.keyboard size={20} />} label="Tastenkürzel" cls="keys-btn" onClick={() => set({ modal: 'shortcuts' })} />
        </Group>
        <Group label="Daten & Konto">
          <Big icon={<Icon.info size={20} />} label="Datenschutz" onClick={() => void openSettings('datenschutz')} />
          <Big icon={<Icon.info size={20} />} label="Transparenz" onClick={() => void openSettings('transparenz')} />
          <Big icon={<Icon.cart size={20} />} label="Konto & Pläne" onClick={() => set({ modal: 'account' })} />
        </Group>
      </>
    );
  else if (tab === 'hilfe')
    body = (
      <>
        <Group label="Erste Schritte">
          <Big icon={<Icon.graduation size={20} />} label="Einführungstour" onClick={() => restartTour()} />
          <Big icon={<Icon.graduation size={20} />} label="Lernen" title="Lernen & Klassenraum" onClick={() => set({ modal: 'learn' })} />
        </Group>
        <Group label="Programm">
          {isDesktop() && <Big icon={<Icon.download size={20} />} label="Nach Updates suchen" onClick={() => void desk()?.updateCheck('stabil', true)} />}
          <Big icon={<Icon.keyboard size={20} />} label="Tastenkürzel" onClick={() => set({ modal: 'shortcuts' })} />
          <Big icon={<Icon.info size={20} />} label="Über Ohm Studio" onClick={() => set({ modal: 'about' })} />
        </Group>
      </>
    );

  return (
    <header className="toolbar ribbon">
      <div className="rb-title">
        <div className="brand-mark" title="Ohm Studio by Nodaris">
          <NodeMark size={14} color="#fff" />
        </div>
        <div className="rb-quick">
          <button className="rb-q" title={`${t('Speichern')} (Strg+S)`} aria-keyshortcuts="Strg+S" aria-label={t('Speichern')} onClick={() => void saveFile()}>
            <Icon.download size={14} />
          </button>
          <button className="rb-q" title={`${t('Rückgängig')} (Strg+Z)`} aria-keyshortcuts="Strg+Z" aria-label={t('Rückgängig')} onClick={undo}>
            <Icon.undo size={14} />
          </button>
          <button className="rb-q" title={`${t('Wiederholen')} (Strg+Y)`} aria-keyshortcuts="Strg+Y" aria-label={t('Wiederholen')} onClick={redo}>
            <Icon.redo size={14} />
          </button>
        </div>
        <div className="rb-name" title={name}>
          {dirty ? '● ' : ''}
          <b>{name}</b> – Ohm Studio
        </div>
      </div>
      <nav className="rb-tabs" role="tablist" aria-label="Befehle">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`rb-tab ${tab === k ? 'on' : ''} ${k === 'datei' ? 'file' : ''}`} onClick={() => setTab(k)}>
            {t(l)}
          </button>
        ))}
      </nav>
      <div className="rb-body" role="tabpanel">
        {body}
      </div>
    </header>
  );
}

export function applyTheme(t: 'system' | 'light' | 'dark') {
  try {
    localStorage.setItem('ohm.theme', t);
  } catch {
    /* egal */
  }
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  set({ theme: t });
}

function CollabAvatars() {
  const c = useCollab();
  if (!c.active) return null;
  return (
    <button className="collab-avatars rb-big" title={`Live-Sitzung „${c.room}“`} onClick={() => set({ modal: 'history' })}>
      <span className="rb-ico">
        {[c.me, ...c.peers].map((p, i) => (
          <span key={i} className="avatar" style={{ background: p.color }} title={p.name}>
            {p.name.slice(0, 1).toUpperCase()}
          </span>
        ))}
      </span>
      <span className="rb-txt">Live</span>
    </button>
  );
}
