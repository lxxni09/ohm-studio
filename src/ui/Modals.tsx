import { useEffect, useRef, useState, type ReactNode } from 'react';
import { loadOhmText, saveOhmText, set, startSim, state, toast, useStore } from '../state/store';
import { Icon } from './icons';
import { NodeMark, Wordmark } from '../brand/Logo';
import { BRAND } from '../brand/brand';
import { exampleList, EXAMPLES } from '../examples';
import { download, exportName, shareLink } from './files';
import { bomCsv, bomRows } from '../export/bom';
import { gerberFiles, kicadNetlist, spiceNetlist, wokwiDiagram, zip } from '../export/exporters';
import { extractOhm, offlineTemplate, MODEL, type ChatMsg } from '../ai/offline';
import { unlockAudio } from '../audio';
import { StackupModal } from './StackupModal';
import { SourcingPanel } from './SourcingPanel';
import { AccountBody } from './AccountModal';
import { TeamBody } from './TeamModal';
import { SettingsBody } from './SettingsModal';
import { AnalysisBody } from './AnalysisModal';
import { AiToolsBody } from './AiToolsModal';
import { EnclosureBody } from './EnclosureModal';
import { IdeaResumeChip, IdeaWizard } from './IdeaWizard';
import { GalleryModal } from './GalleryModal';
import { ImportModal } from './ImportModal';
import { LearnBody } from './LearnModal';
import { audit, org } from '../enterprise/org';
import { t } from '../i18n';
import { assemblyPdf, fabPackage, ipc2581, pickPlaceCsv, stepModel, testPointsCsv } from '../export/fab';
import { sourcedBom, sourcedBomCsv } from '../export/sourcing';

export function Modal({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') set({ modal: null });
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && set({ modal: null })}>
      <div className="modal" ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} style={wide ? { width: 'min(860px, 94vw)' } : undefined}>
        <div className="modal-head">
          <h2>{t(title)}</h2>
          <button className="icon-btn" aria-label="Schließen" onClick={() => set({ modal: null })}>
            <Icon.close />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function Examples() {
  return (
    <Modal title="Beispiele" wide>
      <div className="example-grid">
        {exampleList().map((e) => (
          <button
            key={e.key}
            className="example"
            onClick={() => {
              loadOhmText(EXAMPLES[e.key], `${e.key}.ohm`);
              set({ modal: null });
            }}
          >
            <b>{e.name}</b>
            <span>{e.beschreibung}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function ExportModal() {
  const project = useStore((s) => s.project);
  const rows = bomRows(project);
  const total = rows.reduce((a, r) => a + r.preis * r.anzahl, 0);
  const item = (icon: ReactNode, title: string, desc: string, action: () => void) => (
    <button
      className="tile"
      onClick={() => {
        audit(`export.${title}`, project.name);
        action();
      }}
    >
      <span className="ti">{icon}</span>
      <span>
        <b>{title}</b>
        <span>{desc}</span>
      </span>
    </button>
  );
  return (
    <Modal title="Exportieren & bestellen" wide>
      {org().exportControl && <div className="export-control">⚠ Exportkontrolle: {org().exportControl}</div>}
      <div className="tiles" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        {item(<Icon.doc size={17} />, '.ohm-Projekt', 'Eine Textdatei mit allem – zum Teilen oder für KIs', () => download(exportName('.ohm'), saveOhmText(), 'text/yaml'))}
        {item(<Icon.pcb size={17} />, 'Gerber-Dateien (ZIP)', 'Kupfer, Lötstopp, Druck, Umriss, Bohrungen', () => download(exportName('-gerber.zip'), zip(gerberFiles(project))))}
        {item(<Icon.pcb size={17} />, 'Fertigungsnutzen 2×2 (ZIP)', 'Vier Platinen mit Fräskanälen, Rand, Fiducials, Werkzeuglöchern', () => download(exportName('-nutzen-gerber.zip'), zip(gerberFiles(project, { nx: 2, ny: 2, gap: 2, rail: 5 }))))}
        {item(<Icon.cart size={17} />, 'Stückliste (CSV)', `${rows.length} Positionen · ca. ${total.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} · mit Bestelllinks`, () => download(exportName('-stueckliste.csv'), bomCsv(project), 'text/csv'))}
        {item(<Icon.chip size={17} />, 'KiCad-Netzliste', 'Für den Import in KiCad (Pcbnew)', () => download(exportName('.net'), kicadNetlist(project)))}
        {item(<Icon.code size={17} />, 'Wokwi diagram.json', 'Für den Online-Simulator Wokwi', () => {
          const w = wokwiDiagram(project);
          download('diagram.json', w.json, 'application/json');
          if (w.skipped.length) toast(`Ohne Wokwi-Entsprechung: ${w.skipped.join(', ')}`, 'warn');
        })}
        {item(<Icon.schematic size={17} />, 'SPICE-Netzliste', 'Für ngspice/LTspice-Analysen', () => download(exportName('.cir'), spiceNetlist(project)))}
        {item(<Icon.share size={17} />, 'Als Link teilen', 'Projekt steckt komplett in der URL', () => void shareLink())}
      </div>
      <h3 style={{ margin: '20px 0 8px', fontSize: 13 }}>Fertigung</h3>
      <div className="tiles" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        {item(<Icon.pcb size={17} />, 'Komplettes Fertigungspaket (ZIP)', 'Gerber X2, Bohrdaten, Pick & Place, Bestückungszeichnung, Stückliste, Testpunkte, IPC-2581, ODB++, STEP', () => download(exportName('-fertigung.zip'), fabPackage(project)))}
        {item(<Icon.chip size={17} />, 'Pick & Place (CSV)', 'Bauteilpositionen für den Bestückungsautomaten', () => download(exportName('-pnp.csv'), pickPlaceCsv(project), 'text/csv'))}
        {item(<Icon.doc size={17} />, 'Bestückungszeichnung (PDF)', 'Platinenumriss, Bauteile, Referenzen und Werte', () => download(exportName('-bestueckung.pdf'), new Blob([assemblyPdf(project) as BlobPart], { type: 'application/pdf' }), 'application/pdf'))}
        {item(<Icon.pcb size={17} />, '3D-Modell (STEP)', 'Für FreeCAD, Fusion, SolidWorks – Gehäusekonstruktion', () => download(exportName('.step'), stepModel(project), 'model/step'))}
        {item(<Icon.doc size={17} />, 'IPC-2581 (XML)', 'Herstellerneutraler Fertigungsdatensatz', () => download(exportName('-ipc2581.xml'), ipc2581(project), 'application/xml'))}
        {item(<Icon.cart size={17} />, 'Einkaufs-Stückliste (CSV)', 'MPN, LCSC, Lebenszyklus, RoHS/REACH, Staffelpreise, Alternativen', () => download(exportName('-einkauf.csv'), sourcedBomCsv(sourcedBom(project)), 'text/csv'))}
        {item(<Icon.chip size={17} />, 'Testpunkte (CSV)', 'Je Netz ein Prüfpunkt für Nadelbett/Flying Probe', () => download(exportName('-testpunkte.csv'), testPointsCsv(project), 'text/csv'))}
      </div>
      <SourcingPanel project={project} />
    </Modal>
  );
}

function Assistant() {
  if (org().aiDisabled)
    return (
      <Modal title="KI-Assistent">
        <p className="info-text">Die KI-Funktionen wurden in den Richtlinien deiner Organisation abgeschaltet (Einstellungen → Richtlinien).</p>
      </Modal>
    );
  return <AssistantInner />;
}

function AssistantInner() {
  const [key, setKey] = useState(() => {
    try {
      return localStorage.getItem('ohm.apiKey') ?? '';
    } catch {
      return '';
    }
  });
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [msgs, partial]);

  const apply = (ohm: string) => {
    const issues = loadOhmText(ohm, 'ki-projekt.ohm');
    if (!issues.some((i) => i.level === 'error')) {
      set({ modal: null });
      unlockAudio();
      setTimeout(startSim, 300);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const hist = [...msgs, { role: 'user' as const, text }];
    setMsgs(hist);
    setInput('');
    if (!key && !org().aiEndpoint) {
      const t = offlineTemplate(text);
      setMsgs([...hist, { role: 'assistant', text: t ? `Ohne API-Schlüssel nutze ich passende Vorlagen. Ich öffne „${/name:\s*(.+)/.exec(t.text)?.[1]}“ und starte die Simulation.` : 'Ohne API-Schlüssel kann ich nur Vorlagen öffnen – zu deiner Beschreibung passt keine. Hinterlege unten einen Claude-API-Schlüssel, dann baue ich dir das Projekt individuell.' }]);
      if (t) setTimeout(() => apply(t.text), 700);
      return;
    }
    setBusy(true);
    try {
      const { askClaude } = await import('../ai/assistant');
      const answer = await askClaude(key, hist, setPartial);
      setPartial('');
      setMsgs([...hist, { role: 'assistant', text: answer }]);
      const ohm = extractOhm(answer);
      if (ohm) apply(ohm);
    } catch (e) {
      setPartial('');
      const err = e as { status?: number; message?: string };
      const txt = err.status === 401 ? 'Der API-Schlüssel ist ungültig.' : err.status === 429 ? 'Zu viele Anfragen – bitte kurz warten.' : `Fehler bei der Anfrage: ${err.message ?? e}`;
      setMsgs([...hist, { role: 'assistant', text: txt }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="KI-Assistent" wide>
      <div className="chat">
        {!msgs.length && (
          <div className="info-text">
            Beschreibe, was du bauen möchtest – z. B. „Bau mir einen Feuchtigkeitssensor für Pflanzen“. Ich erzeuge ein komplettes .ohm-Projekt mit Verkabelung und Code, öffne es und starte die Simulation.
            <div className="btn-row" style={{ marginTop: 10 }}>
              {['Bau mir einen Feuchtigkeitssensor für Pflanzen', 'Ein Thermometer mit LCD-Anzeige', 'Ein Abstandswarner zum Einparken'].map((s) => (
                <button key={s} className="btn" onClick={() => setInput(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.role === 'user' ? 'me' : 'ai'}`}>
            {m.role === 'assistant' ? m.text.replace(/```[\s\S]*?```/g, '[Projekt geöffnet]') : m.text}
            {m.role === 'assistant' && extractOhm(m.text) && (
              <div style={{ marginTop: 8 }}>
                <button className="btn" onClick={() => apply(extractOhm(m.text)!)}>
                  Erneut öffnen
                </button>
              </div>
            )}
          </div>
        ))}
        {busy && <div className="bubble ai">{partial ? partial.replace(/```[\s\S]*$/, '… baue das Projekt …') : 'Denke nach …'}</div>}
        <div ref={end} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <textarea className="field" rows={2} style={{ flex: 1 }} placeholder="Was möchtest du bauen?" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }} />
        <button className="btn primary" style={{ height: 'auto' }} onClick={() => void send()} disabled={busy}>
          <Icon.send size={14} />
        </button>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <label>Claude-API-Schlüssel</label>
        <input
          className="field"
          type="password"
          placeholder="sk-ant-… (optional, bleibt in deinem Browser)"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            try {
              localStorage.setItem('ohm.apiKey', e.target.value);
            } catch {
              /* egal */
            }
          }}
        />
      </div>
      <div className="info-text" style={{ fontSize: 11 }}>
        Modell: {MODEL}. Der Schlüssel wird nur lokal gespeichert und direkt an die Claude API gesendet.
      </div>
    </Modal>
  );
}

function About() {
  return (
    <Modal title="Über Ohm Studio">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '10px 0 4px', textAlign: 'center' }}>
        <NodeMark size={64} bg="#0A84FF" />
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Ohm Studio</div>
        <Wordmark height={15} color="var(--muted)" />
        <div className="info-text">Version {BRAND.version}</div>
        <p className="info-text" style={{ maxWidth: 440 }}>
          Elektronik entwerfen, simulieren und fertigen – mit echtem Code, echten Spannungen und Bauteilen, die aussehen wie in echt.
        </p>
        <div className="info-text">{BRAND.copyright} · {BRAND.domain}</div>
      </div>
    </Modal>
  );
}

/** Alle Tastenkürzel auf einen Blick (Windows-Schreibweise) */
export const SHORTCUTS: [string, string][] = [
  ['Leertaste', 'Simulation starten / pausieren'],
  ['Strg+N', 'Leeres Projekt'],
  ['Strg+O', 'Öffnen'],
  ['Strg+S', 'Speichern'],
  ['Strg+Umschalt+S', 'Speichern unter'],
  ['Strg+Z', 'Rückgängig'],
  ['Strg+Y', 'Wiederholen'],
  ['Strg+D', 'Auswahl duplizieren'],
  ['R', 'Ausgewähltes Teil drehen'],
  ['Entf / ⌫', 'Auswahl löschen'],
  ['F', 'Alles zeigen'],
  ['1 / 2 / 3', 'Steckbrett / Schaltplan / Platine'],
  ['F11', 'Vollbild'],
  ['Esc', 'Kabel abbrechen, Auswahl aufheben'],
  ['Alt beim Ziehen', 'Ohne Raster verschieben'],
];

function Shortcuts() {
  return (
    <Modal title="Tastenkürzel">
      <dl className="kv shortcuts" style={{ fontSize: 13 }}>
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>
              {k.split(/(\+| \/ )/).map((x, i) => (x === '+' || x === ' / ' ? <span key={i}>{x}</span> : <kbd key={i}>{x}</kbd>))}
            </dt>
            <dd style={{ textAlign: 'left' }}>{t(v)}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

export function Modals() {
  const m = useStore((s) => s.modal);
  if (m === 'idee') return <IdeaWizard />;
  if (m === 'galerie') return <GalleryModal />;
  if (m === 'import') return <ImportModal />;
  if (m === 'examples') return <Examples />;
  if (m === 'export') return <ExportModal />;
  if (m === 'assistant') return <Assistant />;
  if (m === 'about') return <About />;
  if (m === 'shortcuts') return <Shortcuts />;
  if (m === 'stackup') return <StackupModal />;
  if (m === 'review')
    return (
      <Modal title="KI-Werkzeuge" wide>
        <AiToolsBody />
      </Modal>
    );
  if (m === 'enclosure')
    return (
      <Modal title="Gehäuse" wide>
        <EnclosureBody />
      </Modal>
    );
  if (m === 'learn')
    return (
      <Modal title="Lernen" wide>
        <LearnBody />
      </Modal>
    );
  if (m === 'analysis')
    return (
      <Modal title="Analysen" wide>
        <AnalysisBody />
      </Modal>
    );
  if (m === 'settings')
    return (
      <Modal title="Einstellungen" wide>
        <SettingsBody />
      </Modal>
    );
  if (m === 'history')
    return (
      <Modal title="Team, Versionen & Review" wide>
        <TeamBody />
      </Modal>
    );
  if (m === 'account')
    return (
      <Modal title="Konto & Pläne" wide>
        <AccountBody />
      </Modal>
    );
  return <IdeaResumeChip />;
}
