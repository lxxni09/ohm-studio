/**
 * Assistent „Neues Projekt aus Idee“ – Idee rein, Platine raus.
 * Schritte: Idee → Rückfragen → Bauen → Selbstprüfung → Ausprobieren → Platine → Gehäuse → Kosten → Bestellen.
 * Jeder Schritt lässt sich überspringen, „Zurück“ geht einen Schritt zurück. Der Stand bleibt erhalten, wenn
 * man den Assistenten zum Ausprobieren verkleinert.
 */
import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { loadOhmText, newProject, saveOhmText, set, startSim, state, stopSim, useStore } from '../state/store';
import { unlockAudio } from '../audio';
import { download, exportName } from './files';
import { gerberFiles, zip } from '../export/exporters';
import { designEnclosure, enclosureMeshes, stlBinary } from '../mech/enclosure';
import { aiAvailable } from '../ai/features';
import type { ChatMsg } from '../ai/offline';
import { buildProject, costs, enclosureSummary, ideaQuestions, MAX_REPAIRS, orderSteps, pcbSummary, repairOnce, selfCheck, type Built, type CheckResult, type IdeaQuestion } from '../ai/idea';
import { Modal } from './Modals';
import { autoPlacePcb } from '../eda/placement';
import { PartnerLinks } from './PartnerLinks';

const STEPS = ['Idee', 'Fragen', 'Bauen', 'Prüfen', 'Ausprobieren', 'Platine', 'Gehäuse', 'Kosten', 'Bestellen'] as const;

interface Attempt {
  nr: number;
  fehler: string[];
}

interface WizardState {
  active: boolean;
  step: number;
  idea: string;
  questions: IdeaQuestion[] | null;
  answers: Record<string, string>;
  busy: string;
  error: string;
  partial: string;
  built: Built | null;
  history: ChatMsg[];
  check: CheckResult | null;
  attempts: Attempt[];
  loaded: boolean;
}

const fresh = (): WizardState => ({ active: false, step: 0, idea: '', questions: null, answers: {}, busy: '', error: '', partial: '', built: null, history: [], check: null, attempts: [], loaded: false });

/** Stand des Assistenten (bleibt beim Verkleinern erhalten) */
let W: WizardState = fresh();
const listeners = new Set<() => void>();
function update(p: Partial<WizardState>) {
  W = { ...W, ...p };
  for (const l of listeners) l();
}
function useWizard() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return W;
}

export function openIdeaWizard(idea = '') {
  if (!W.active || idea) W = { ...fresh(), active: true, idea };
  set({ modal: 'idee' });
}

/** Kleiner Knopf unten rechts, solange der Assistent verkleinert ist */
export function IdeaResumeChip() {
  const w = useWizard();
  const m = useStore((s) => s.modal);
  if (!w.active || m) return null;
  return (
    <button
      className="idea-chip"
      onClick={() => {
        // nach dem Ausprobieren geht es mit der Platine weiter (wie auf dem Knopf angekündigt)
        if (W.step === 4 && W.loaded) {
          stopSim();
          update({ step: 5 });
        }
        set({ modal: 'idee' });
      }}
    >
      ✨ Idee-Assistent: weiter mit „{STEPS[Math.min(w.step + (w.step === 4 ? 1 : 0), STEPS.length - 1)]}“ →
    </button>
  );
}

function errText(e: unknown): string {
  const err = e as { status?: number; message?: string };
  if (err.status === 401) return 'Der API-Schlüssel ist ungültig.';
  if (err.status === 429) return 'Zu viele Anfragen – bitte kurz warten und noch einmal versuchen.';
  return err.message ?? String(e);
}

const tick = () => new Promise((r) => setTimeout(r, 30));

async function runBuild() {
  update({ step: 2, busy: 'Baue das Projekt …', error: '', partial: '', built: null, check: null, attempts: [], loaded: false });
  try {
    const { built, history } = await buildProject(W.idea, W.answers, (t) => update({ partial: t }));
    update({ built, history, partial: '' });
    await runCheck();
  } catch (e) {
    update({ busy: '', error: errText(e) });
  }
}

async function runCheck() {
  update({ step: 3, busy: 'Prüfe das Projekt (Datei, ERC, Simulation, Tests) …' });
  await tick();
  let check = selfCheck(W.built!.text);
  const attempts: Attempt[] = [{ nr: 0, fehler: check.fehler }];
  update({ check, attempts });
  // Reparatur nur mit KI (die Vorlagen sind geprüft; ohne KI gibt es nichts zu reparieren)
  let history = W.history;
  for (let n = 1; !check.ok && W.built?.quelle === 'ki' && n <= MAX_REPAIRS; n++) {
    update({ busy: `Reparaturversuch ${n} von ${MAX_REPAIRS} …`, partial: '' });
    try {
      const r = await repairOnce(history, check, (t) => update({ partial: t }));
      history = r.history;
      if (!r.text) {
        attempts.push({ nr: n, fehler: ['Die KI hat kein korrigiertes Projekt geliefert.'] });
        continue;
      }
      update({ built: { ...W.built!, text: r.text }, history });
      await tick();
      check = selfCheck(r.text);
      attempts.push({ nr: n, fehler: check.fehler });
      update({ check, attempts: [...attempts] });
    } catch (e) {
      update({ busy: '', error: errText(e) });
      return;
    }
  }
  update({ busy: '', partial: '', check, attempts: [...attempts] });
}

function loadAndTry() {
  if (!W.built) return;
  const issues = loadOhmText(W.built.text, 'idee.ohm');
  if (issues.some((i) => i.level === 'error')) {
    update({ error: 'Das Projekt ließ sich nicht öffnen.' });
    return;
  }
  update({ loaded: true, step: 4 });
  unlockAudio();
  setTimeout(startSim, 300);
}

export function IdeaWizard() {
  const w = useWizard();
  useStore((s) => s.project); // neu zeichnen, wenn das Projekt im Editor geändert wird
  const go = (step: number) => update({ step, error: '' });
  const next = () => go(Math.min(STEPS.length - 1, w.step + 1));
  const back = () => go(Math.max(0, w.step - (w.step === 3 ? 2 : 1)));
  const online = aiAvailable() === 'online';

  const startQuestions = async () => {
    if (!w.idea.trim()) return;
    update({ step: 1, busy: 'Überlege, ob ich noch etwas wissen muss …', error: '', questions: null, answers: {} });
    try {
      const qs = await ideaQuestions(w.idea.trim());
      update({ questions: qs, busy: '' });
      if (!qs.length) void runBuild();
    } catch (e) {
      // Rückfragen sind optional: ohne sie weiterbauen
      update({ questions: [], busy: '', error: `Rückfragen nicht möglich (${errText(e)}) – ich baue direkt.` });
      void runBuild();
    }
  };

  let body: React.ReactNode = null;
  if (w.step === 0)
    body = (
      <>
        <p className="info-text" style={{ marginTop: 0 }}>
          Beschreib in einem Satz, was dein Gerät tun soll. Ich baue Schaltung und Code, prüfe sie selbst, und am Ende hast du Platine, Gehäuse, Kosten und eine Bestellanleitung.
        </p>
        <textarea className="field idea-input" rows={3} autoFocus placeholder="z. B. Eine Lampe, die angeht, wenn es dunkel wird" value={w.idea} onChange={(e) => update({ idea: e.target.value })} onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void startQuestions();
          }
        }} />
        <div className="btn-row" style={{ marginTop: 8 }}>
          {['Eine Lampe, die angeht, wenn es dunkel wird', 'Ein Warner, der piept, wenn die Pflanze Wasser braucht', 'Eine Ampel mit Fußgängertaste'].map((s) => (
            <button key={s} className="btn" onClick={() => update({ idea: s })}>
              Probier mal: {s}
            </button>
          ))}
        </div>
        {!online && <p className="info-text">Ohne Claude-API-Schlüssel starte ich mit der passendsten Vorlage. Mit Schlüssel (im KI-Assistenten eintragen) baue ich genau nach deiner Idee.</p>}
      </>
    );
  else if (w.step === 1)
    body = w.questions === null ? (
      <p className="info-text">{w.busy}</p>
    ) : (
      <>
        <p className="info-text" style={{ marginTop: 0 }}>
          Noch {w.questions.length === 1 ? 'eine kurze Frage' : `${w.questions.length} kurze Fragen`}:
        </p>
        {w.questions.map((q) => (
          <div key={q.frage} className="idea-q">
            <div className="idea-q-title">{q.frage}</div>
            <div className="seg">
              {q.optionen.map((o) => (
                <button key={o} className={w.answers[q.frage] === o ? 'on' : ''} onClick={() => update({ answers: { ...w.answers, [q.frage]: o } })}>
                  {o}
                </button>
              ))}
            </div>
          </div>
        ))}
      </>
    );
  else if (w.step === 2 || (w.step === 3 && w.busy && !w.check))
    body = (
      <>
        <p className="info-text" style={{ marginTop: 0 }}>{w.busy || (w.error ? '' : 'Fertig.')}</p>
        {w.partial && <div className="idea-stream">{w.partial.replace(/```[\s\S]*$/, '… schreibe das Projekt …').slice(-600)}</div>}
      </>
    );
  else if (w.step === 3 && w.check)
    body = (
      <>
        {w.built && <p className="info-text" style={{ marginTop: 0, whiteSpace: 'pre-wrap' }}>{w.built.erklaerung.slice(0, 600)}</p>}
        <div className={`idea-verdict ${w.busy ? 'busy' : w.check.ok ? 'ok' : 'bad'}`} data-verdict={w.busy ? 'busy' : w.check.ok ? 'ok' : 'bad'}>
          {w.busy ? w.busy : w.check.ok ? '✓ Selbstprüfung bestanden' : `✗ Selbstprüfung nicht bestanden${w.attempts.length > 1 ? ` – auch nach ${w.attempts.length - 1} Reparaturversuch${w.attempts.length > 2 ? 'en' : ''}` : ''}`}
        </div>
        <ul className="idea-list">
          {w.attempts.map((a) => (
            <li key={a.nr}>
              {a.nr === 0 ? 'Erster Entwurf' : `Reparatur ${a.nr}`}: {a.fehler.length ? `${a.fehler.length} Problem${a.fehler.length > 1 ? 'e' : ''}` : 'keine Probleme'}
            </li>
          ))}
        </ul>
        {!!w.check.fehler.length && !w.busy && (
          <>
            <div className="idea-sub">Offene Probleme (ehrlich):</div>
            <ul className="idea-list bad">{w.check.fehler.slice(0, 8).map((f) => <li key={f}>{f}</li>)}</ul>
            <p className="info-text">Du kannst das Projekt trotzdem öffnen und selbst weiterbauen{w.built?.quelle === 'ki' ? '' : ' (ohne KI-Schlüssel sind keine Reparaturen möglich)'}.</p>
          </>
        )}
        {!!w.check.tests.length && (
          <>
            <div className="idea-sub">Testschritte in der Simulation:</div>
            <ul className="idea-list">{w.check.tests.map((t) => <li key={t.schritt}>{t.ok ? '✓' : t.ok === false ? '✗' : '–'} {t.schritt}</li>)}</ul>
          </>
        )}
        {!!w.check.hinweise.length && <details><summary className="info-text">{w.check.hinweise.length} {w.check.hinweise.length === 1 ? 'Hinweis' : 'Hinweise'}</summary><ul className="idea-list">{w.check.hinweise.slice(0, 12).map((h) => <li key={h}>{h}</li>)}</ul></details>}
      </>
    );
  else if (w.step === 4)
    body = (
      <>
        <p className="info-text" style={{ marginTop: 0 }}>
          {w.loaded ? 'Das Projekt ist geöffnet und die Simulation läuft. Verkleinere den Assistenten, probier es aus (Taster drücken, Regler drehen) und komm dann zurück.' : 'Öffnet das Projekt im Editor und startet die Simulation.'}
        </p>
        <div className="btn-row">
          {!w.loaded && <button className="btn primary" onClick={loadAndTry}>Öffnen und simulieren</button>}
          {w.loaded && <button className="btn primary" onClick={() => set({ modal: null })}>Assistent verkleinern und ausprobieren</button>}
        </div>
      </>
    );
  else if (w.step === 5) body = <PcbStep />;
  else if (w.step === 6) body = <EnclosureStep />;
  else if (w.step === 7) body = <CostStep />;
  else if (w.step === 8) body = <OrderStep />;

  const canNext =
    !w.busy &&
    ((w.step === 0 && !!w.idea.trim()) || (w.step === 1 && w.questions !== null) || (w.step === 3 && !!w.check) || (w.step === 4 && w.loaded) || w.step >= 5) &&
    w.step < STEPS.length - 1;
  const onNext = () => {
    if (w.step === 0) return void startQuestions();
    if (w.step === 1) return void runBuild();
    if (w.step === 3) return go(4);
    if (w.step === 4) stopSim();
    next();
  };

  return (
    <Modal title="Neues Projekt aus Idee" wide>
      <div className="idea-progress" role="progressbar" aria-label="Fortschritt des Assistenten" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={w.step + 1} aria-valuetext={STEPS[w.step]}>
        {STEPS.map((s, i) => (
          <div key={s} className={`idea-dot ${i < w.step ? 'done' : i === w.step ? 'now' : ''}`}>
            <span>{i < w.step ? '✓' : i + 1}</span>
            <small>{t(s)}</small>
          </div>
        ))}
      </div>
      <div className="idea-body" data-step={STEPS[w.step]}>{body}</div>
      {w.error && <div className="idea-error">{w.error}</div>}
      <div className="idea-nav">
        {w.step === 0 ? (
          <button className="btn" onClick={() => (newProject(), update({ active: false }), set({ modal: null }))} title="Ohne Idee mit einem komplett leeren Bauplan anfangen">
            {t('Leer starten')}
          </button>
        ) : (
          <button className="btn" disabled={!!w.busy} onClick={back}>
            {t('← Zurück')}
          </button>
        )}
        <span style={{ flex: 1 }} />
        {w.step >= 1 && w.step < STEPS.length - 1 && w.step !== 2 && (
          <button className="btn" disabled={!!w.busy} onClick={() => (w.step === 1 ? void runBuild() : w.step === 3 && !w.loaded ? (loadAndTry(), next()) : next())} title="Diesen Schritt auslassen">
            {t('Überspringen')}
          </button>
        )}
        {w.step === 2 && w.error && <button className="btn" onClick={() => void runBuild()}>Noch einmal</button>}
        {w.step < STEPS.length - 1 ? (
          <button className="btn primary" disabled={!canNext} onClick={onNext}>
            {t(w.step === 0 ? 'Los geht’s' : w.step === 1 ? 'Projekt bauen' : 'Weiter →')}
          </button>
        ) : (
          <button className="btn primary" onClick={() => (update({ active: false }), set({ modal: null }))}>
            {t('Fertig')}
          </button>
        )}
      </div>
    </Modal>
  );
}

function PcbStep() {
  const project = useStore((s) => s.project);
  const [busy, setBusy] = useState(false);
  const [s, setS] = useState(() => pcbSummary(project));
  useEffect(() => setS(pcbSummary(project)), [project]);
  return (
    <>
      <p className="info-text" style={{ marginTop: 0 }}>
        Platine automatisch platziert und geroutet: <b>{s.breiteMm} × {s.hoeheMm} mm</b>, {s.lagen} Lagen.
      </p>
      <ul className="idea-list">
        <li>{s.ungeroutet ? `✗ ${s.ungeroutet} Verbindung(en) konnten nicht automatisch geroutet werden` : '✓ alle Verbindungen geroutet'}</li>
        <li>{s.drcFehler.length ? `✗ ${s.drcFehler.length} DRC-Fehler (Fertigungsregeln JLCPCB)` : '✓ DRC ohne Fehler (Fertigungsregeln JLCPCB)'}{s.drcWarnungen ? `, ${s.drcWarnungen} Hinweise` : ''}</li>
      </ul>
      {!!s.drcFehler.length && <ul className="idea-list bad">{s.drcFehler.slice(0, 5).map((f, i) => <li key={i}>{f}</li>)}</ul>}
      <div className="btn-row">
        <button className="btn" disabled={busy} onClick={() => {
          setBusy(true);
          setTimeout(() => {
            autoPlacePcb(state.project);
            set({ project: { ...state.project } });
            setBusy(false);
          }, 20);
        }}>
          {busy ? 'Optimiere …' : 'Platzierung optimieren'}
        </button>
        <button className="btn" onClick={() => set({ modal: null, view: 'platine' })}>Platine ansehen</button>
      </div>
    </>
  );
}

function EnclosureStep() {
  const project = useStore((s) => s.project);
  const e = enclosureSummary(project);
  return (
    <>
      <p className="info-text" style={{ marginTop: 0 }}>
        Passendes Gehäuse zum 3D-Drucken: <b>{e.aussen.x} × {e.aussen.y} × {e.aussen.z} mm</b> (Unterschale mit Schraubdomen, Deckel, Ausschnitte für Stecker und Knöpfe).
      </p>
      <ul className="idea-list">{e.kollisionen.length ? e.kollisionen.map((k) => <li key={k}>✗ {k}</li>) : <li>✓ keine Kollisionen zwischen Bauteilen und Gehäuse</li>}</ul>
      <div className="btn-row">
        <button className="btn" onClick={() => {
          const enc = designEnclosure(project);
          const m = enclosureMeshes(enc);
          download(exportName('-gehaeuse.zip'), zip([{ name: 'unterschale.stl', data: stlBinary(m.unterschale, 'Unterschale') }, { name: 'deckel.stl', data: stlBinary(m.deckel, 'Deckel') }]));
        }}>
          Gehäuse als STL speichern
        </button>
        <button className="btn" onClick={() => set({ modal: 'enclosure' })}>Gehäuse anpassen</button>
      </div>
    </>
  );
}

const eur = (x: number) => x.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

function CostStep() {
  const project = useStore((s) => s.project);
  const rows = costs(project);
  return (
    <>
      <table className="idea-table">
        <thead>
          <tr>
            <th>Stückzahl</th>
            <th>Bauteile</th>
            <th>Platinen</th>
            <th>pro Gerät</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.stueck}>
              <td>{r.stueck}</td>
              <td>{eur(r.bauteile)}</td>
              <td>{eur(r.platine)} <small>({r.fertiger}{r.stueck < 5 ? ', ab 5 Stück' : ''})</small></td>
              <td><b>{eur(r.proStueck)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="info-text">Richtpreise aus öffentlichen Preislisten, ohne Versand, Zoll und Mehrwertsteuer. Platinen werden meist erst ab 5 Stück gefertigt – bei 1 Gerät bezahlst du trotzdem 5 Platinen.</p>
    </>
  );
}

function OrderStep() {
  const project = useStore((s) => s.project);
  const steps = orderSteps(project);
  const open = (url: string) => {
    const n = (globalThis as unknown as { ohmNative?: { openExternal(u: string): void } }).ohmNative;
    if (n) n.openExternal(url);
    else window.open(url, '_blank', 'noopener');
  };
  return (
    <>
      <p className="info-text" style={{ marginTop: 0 }}>Direkt aus Ohm Studio bestellen geht noch nicht (dafür braucht es Verträge mit den Herstellern). So bestellst du in wenigen Minuten selbst:</p>
      <ol className="idea-order">
        {steps.map((s, i) => (
          <li key={i}>
            <b>{s.titel}</b> – {s.text}
            {i === 0 && <button className="btn" style={{ marginLeft: 8 }} onClick={() => download(exportName('-gerber.zip'), zip(gerberFiles(project)))}>Gerber-ZIP speichern</button>}
            {s.link && <button className="btn" style={{ marginLeft: 8 }} onClick={() => open(s.link!.url)}>{s.link.label} ↗</button>}
          </li>
        ))}
      </ol>
      <PartnerLinks project={project} />
      <div className="btn-row">
        <button className="btn" onClick={() => download(exportName('.ohm'), saveOhmText(), 'text/yaml')}>Projekt (.ohm) speichern</button>
      </div>
    </>
  );
}
