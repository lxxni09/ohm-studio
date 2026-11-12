import { useState } from 'react';
import { changed, set, state, toast, useStore, setCode } from '../state/store';
import { aiAvailable, aiReview, codeAssist, readDatasheet, suggestParts, symbolSvg, type CodeAction, type ExtractedPart, type PartSuggestion, type ReviewFinding } from '../ai/features';
import { autoPlacePcb } from '../eda/placement';
import { registerPart } from '../parts/registry';
import { customIc } from '../parts/library/ics';
import { renderMarkdownLite } from './markdownLite';

type Tab = 'review' | 'vorschlaege' | 'datenblatt' | 'platzieren' | 'code';

export function AiToolsBody() {
  const [tab, setTab] = useState<Tab>('review');
  const mode = aiAvailable();
  if (mode === 'aus') return <p className="info-text">Die KI-Funktionen sind durch die Richtlinien deiner Organisation abgeschaltet. Regelbasierte Prüfungen findest du unter „Analysen“.</p>;
  return (
    <div>
      <div className="seg seg-scroll" style={{ marginBottom: 12 }}>
        {(
          [
            ['review', 'Schaltungs-Review'],
            ['vorschlaege', 'Bauteil-Vorschläge'],
            ['datenblatt', 'Datenblatt-Leser'],
            ['platzieren', 'Automatisch platzieren'],
            ['code', 'Code-Assistent'],
          ] as [Tab, string][]
        ).map(([k, v]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {v}
          </button>
        ))}
      </div>
      {mode === 'offline' && tab !== 'platzieren' && (
        <p className="info-text" style={{ marginTop: 0 }}>
          Ohne API-Schlüssel arbeiten Review und Vorschläge regelbasiert. Für Erklärungen in eigenen Worten, den Datenblatt-Leser und den Code-Assistenten hinterlege einen Claude-API-Schlüssel im{' '}
          <button className="chip-btn" onClick={() => set({ modal: 'assistant' })}>
            KI-Assistenten
          </button>
          .
        </p>
      )}
      {tab === 'review' && <Review />}
      {tab === 'vorschlaege' && <Suggestions />}
      {tab === 'datenblatt' && <Datasheet />}
      {tab === 'platzieren' && <Place />}
      {tab === 'code' && <CodeHelp />}
    </div>
  );
}

const SEV = { kritisch: 'error', warnung: 'warn', hinweis: 'info' } as const;

function Review() {
  const project = useStore((s) => s.project);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ zusammenfassung: string; befunde: ReviewFinding[]; quelle: string } | null>(null);
  return (
    <div>
      <button
        className="btn primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setRes(await aiReview(project));
          } catch (e) {
            toast(String((e as Error).message), 'error');
          }
          setBusy(false);
        }}
      >
        {busy ? 'Prüfe Schaltung …' : 'Schaltung prüfen'}
      </button>
      {res && (
        <>
          <p style={{ fontSize: 13 }}>
            <b>{res.zusammenfassung}</b> <small className="info-text">({res.quelle === 'ki' ? 'KI-Review' : 'regelbasiert'})</small>
          </p>
          <div className="emc-list">
            {res.befunde.map((b, i) => (
              <div key={i} className="emc-item" style={{ gridTemplateColumns: 'auto 160px 1fr' }}>
                <span className={`lvl lvl-${SEV[b.schwere]}`} />
                <span>
                  <b>{b.titel}</b>
                  {b.teil && (
                    <>
                      <br />
                      <button className="chip-btn" onClick={() => set({ selection: b.teil.split(/,\s*/).filter((id) => project.parts.some((p) => p.id === id)), modal: null })}>
                        {b.teil}
                      </button>
                    </>
                  )}
                </span>
                <span>
                  {b.erklaerung}
                  {b.vorschlag && (
                    <>
                      <br />
                      <i>→ {b.vorschlag}</i>
                    </>
                  )}
                </span>
              </div>
            ))}
            {!res.befunde.length && <div className="empty-diff">Keine Befunde – sauber!</div>}
          </div>
        </>
      )}
    </div>
  );
}

function Suggestions() {
  const project = useStore((s) => s.project);
  const sel = useStore((s) => s.selection);
  const [wish, setWish] = useState('');
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<PartSuggestion[] | null>(null);
  const id = sel[0];
  const inst = project.parts.find((p) => p.id === id);
  if (!inst) return <div className="empty-diff">Wähle zuerst ein Bauteil in der Schaltung aus.</div>;
  return (
    <div>
      <div className="btn-row">
        <input className="field" style={{ flex: 1 }} placeholder={`Wunsch zu ${id}, z. B. „günstiger, gleiches Gehäuse“`} value={wish} onChange={(e) => setWish(e.target.value)} />
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setList(await suggestParts(project, id, wish));
            } catch (e) {
              toast(String((e as Error).message), 'error');
            }
            setBusy(false);
          }}
        >
          {busy ? 'Suche …' : 'Vorschläge'}
        </button>
      </div>
      <div className="cloud-list">
        {list?.map((s) => (
          <div key={s.typ} className="member">
            <span style={{ flex: 1 }}>
              <b>{s.name}</b> <small>· {s.grund}</small>
            </span>
            <button
              className="btn"
              onClick={() => {
                inst.type = s.typ;
                changed();
                toast(`${id} ist jetzt ${s.name}. Prüfe die Anschlüsse.`);
              }}
            >
              Übernehmen
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Datasheet() {
  const [busy, setBusy] = useState(false);
  const [part, setPart] = useState<ExtractedPart | null>(null);
  return (
    <div>
      <label className="btn primary" style={{ cursor: 'pointer' }}>
        {busy ? 'Lese Datenblatt …' : 'PDF-Datenblatt wählen'}
        <input
          type="file"
          accept="application/pdf"
          hidden
          disabled={busy}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            try {
              const buf = new Uint8Array(await f.arrayBuffer());
              let bin = '';
              for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
              setPart(await readDatasheet(btoa(bin)));
            } catch (err) {
              toast(String((err as Error).message), 'error');
            }
            setBusy(false);
          }}
        />
      </label>
      <p className="info-text">Das PDF wird nur an Anthropic (bzw. den Firmen-Endpunkt) gesendet, um Pins und Kennwerte auszulesen.</p>
      {part && (
        <div className="team-grid">
          <div>
            <b>
              {part.name} <small className="info-text">· {part.hersteller} {part.mpn} · {part.gehaeuse}</small>
            </b>
            <p className="info-text">{part.beschreibung}</p>
            <div className="symbol-preview" dangerouslySetInnerHTML={{ __html: symbolSvg(part) }} />
            <button
              className="btn primary"
              onClick={() => {
                const typ = `eigen-${part.mpn || part.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
                const pins = part.pins.map((p) => p.name.replace(/[^\w+-]/g, '') || `P${p.nummer}`);
                const uniq = pins.map((p, i) => (pins.indexOf(p) !== i ? `${p}_${part.pins[i].nummer}` : p));
                const vcc = uniq[part.pins.findIndex((p) => p.art === 'versorgung')];
                const gnd = uniq[part.pins.findIndex((p) => p.art === 'masse')];
                const cp = { typ, name: part.name, label: part.mpn || part.name, pins: uniq, vcc, gnd, hersteller: part.hersteller, mpn: part.mpn };
                registerPart(customIc({ type: typ, name: cp.name, label: cp.label, pins: cp.pins, vcc, gnd }));
                state.project.library = [...(state.project.library ?? []).filter((x) => x.typ !== typ), cp];
                changed(false);
                toast(`„${part.name}“ ist jetzt in der Bibliothek (Typ ${typ}) und wird mit dem Projekt gespeichert.`);
              }}
            >
              In die Projektbibliothek übernehmen
            </button>
          </div>
          <div className="table-wrap" style={{ maxHeight: 380 }}>
            <table className="bom-table">
              <thead>
                <tr>
                  <th>Pin</th>
                  <th>Name</th>
                  <th>Art</th>
                  <th>Funktion</th>
                </tr>
              </thead>
              <tbody>
                {part.pins.map((p) => (
                  <tr key={p.nummer}>
                    <td>{p.nummer}</td>
                    <td>{p.name}</td>
                    <td>{p.art}</td>
                    <td>
                      <small>{p.funktion}</small>
                    </td>
                  </tr>
                ))}
                {part.kennwerte.map((k) => (
                  <tr key={k.name}>
                    <td />
                    <td colSpan={2}>{k.name}</td>
                    <td>{k.wert}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Place() {
  const [res, setRes] = useState<string>('');
  return (
    <div style={{ maxWidth: 560 }}>
      <p className="info-text" style={{ marginTop: 0 }}>
        Ordnet die Bauteile auf der Platine so an, dass zusammengehörige Teile nah beieinander liegen. Das Ergebnis wird nur übernommen, wenn die Leitungen kürzer werden und keine neuen Regelverstöße entstehen.
      </p>
      <button
        className="btn primary"
        onClick={() => {
          const r = autoPlacePcb(state.project);
          if (r.applied) {
            changed(false);
            setRes(`Verbindungslänge um ${Math.round((1 - r.after / r.before) * 100)} % reduziert.`);
          } else setRes('Die aktuelle Anordnung ist bereits gut – keine Verbesserung gefunden.');
        }}
      >
        Platzieren
      </button>
      <button
        className="btn"
        style={{ marginLeft: 8 }}
        onClick={() => {
          delete (state.project as { pcb?: unknown }).pcb;
          changed(false);
          setRes('Platzierung zurückgesetzt.');
        }}
      >
        Zurücksetzen
      </button>
      {res && <p className="info-text">{res}</p>}
    </div>
  );
}

function CodeHelp() {
  const target = useStore((s) => s.codeTarget);
  const project = useStore((s) => s.project);
  const [frage, setFrage] = useState('');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const code = project.code.find((c) => c.ziel === target)?.datei ?? '';
  const run = async (a: CodeAction) => {
    if (!target) return;
    setBusy(true);
    setOut('');
    try {
      await codeAssist(project, target, code, a, frage, setOut);
    } catch (e) {
      setOut(String((e as Error).message));
    }
    setBusy(false);
  };
  const block = /```(?:cpp|c|arduino|ino)?\n([\s\S]*?)```/.exec(out)?.[1];
  if (!target) return <div className="empty-diff">Kein Mikrocontroller mit Code im Projekt.</div>;
  return (
    <div>
      <div className="btn-row">
        <button className="btn" disabled={busy} onClick={() => void run('erklaeren')}>
          Erklären
        </button>
        <button className="btn" disabled={busy} onClick={() => void run('fehler')}>
          Fehler finden
        </button>
        <button className="btn" disabled={busy} onClick={() => void run('kommentieren')}>
          Kommentieren
        </button>
        <input className="field" style={{ flex: 1 }} placeholder="Eigene Frage zum Code …" value={frage} onChange={(e) => setFrage(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && frage.trim() && void run('frage')} />
      </div>
      {out && <div className="ai-out" dangerouslySetInnerHTML={{ __html: renderMarkdownLite(out) }} />}
      {block && !busy && (
        <button
          className="btn primary"
          onClick={() => {
            setCode(target, block);
            toast('Code übernommen.');
          }}
        >
          Vorgeschlagenen Code übernehmen
        </button>
      )}
    </div>
  );
}
