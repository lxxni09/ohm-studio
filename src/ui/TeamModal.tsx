import { useEffect, useMemo, useState } from 'react';
import { changed, loadOhmText, saveOhmText, state, toast, useStore, set } from '../state/store';
import { commitVersion, listVersions, pruneVersions, shortId, type Version } from '../team/history';
import { diffProjects, diffSummary, type ProjectDiff } from '../team/diff';
import { parseOhm } from '../ohm/format';
import type { Project, Review, Rolle } from '../ohm/model';
import { getPart } from '../parts/registry';
import { limit } from '../license/license';
import { startCollab, stopCollab, useCollab } from '../team/collabStore';
import { randomRoom } from '../team/collab';
import { BRAND } from '../brand/brand';

const ROLLEN: Record<Rolle, string> = { betrachter: 'Betrachter', bearbeiter: 'Bearbeiter', pruefer: 'Prüfer', admin: 'Admin' };
const STATUS: Record<Review['status'], string> = { entwurf: 'Entwurf', 'in-pruefung': 'In Prüfung', freigegeben: 'Freigegeben', abgelehnt: 'Abgelehnt' };
const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

function myName(): string {
  try {
    return localStorage.getItem('ohm.collab.name') || state.project.autor || 'Ich';
  } catch {
    return 'Ich';
  }
}

export function TeamBody() {
  const [tab, setTab] = useState<'verlauf' | 'review' | 'live'>('verlauf');
  return (
    <div>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={tab === 'verlauf' ? 'on' : ''} onClick={() => setTab('verlauf')}>
          Versionen
        </button>
        <button className={tab === 'review' ? 'on' : ''} onClick={() => setTab('review')}>
          Review & Freigabe
        </button>
        <button className={tab === 'live' ? 'on' : ''} onClick={() => setTab('live')}>
          Live zusammenarbeiten
        </button>
      </div>
      {tab === 'verlauf' && <History />}
      {tab === 'review' && <ReviewPanel />}
      {tab === 'live' && <LivePanel />}
    </div>
  );
}

/* ------------------------------ Versionen ------------------------------ */

function History() {
  const project = useStore((s) => s.project);
  const rev = useStore((s) => s.rev);
  const [list, setList] = useState<Version[]>([]);
  const [msg, setMsg] = useState('');
  const [sel, setSel] = useState<Version | null>(null);
  const reload = () => void listVersions(project.name).then(setList);
  useEffect(reload, [project.name]);
  const current = useMemo(() => parseOhm(saveOhmText()).project, [rev, project]);
  const diff = useMemo(() => (sel ? diffProjects(parseOhm(sel.text).project, current) : null), [sel, current]);

  const save = async (tag?: string) => {
    const v = await commitVersion(project.name, saveOhmText(), msg, myName(), tag);
    if (!v) toast('Keine Änderungen seit der letzten Version.');
    else toast(`Version ${shortId(v.id)} gespeichert`);
    setMsg('');
    await pruneVersions(project.name, limit('historyDays') as number);
    reload();
  };

  return (
    <div className="team-grid">
      <div>
        <div className="btn-row">
          <input className="field" style={{ flex: 1 }} placeholder="Was hast du geändert?" value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
          <button className="btn primary" onClick={() => void save()}>
            Version speichern
          </button>
        </div>
        <ol className="timeline">
          {list.length === 0 && <li className="info-text">Noch keine Versionen. Speichere den aktuellen Stand, um später vergleichen und zurückspringen zu können.</li>}
          {list.map((v, i) => (
            <li key={v.id} className={sel?.id === v.id ? 'on' : ''} onClick={() => setSel(v)}>
              <span className="dot" />
              <div>
                <b>{v.message}</b>
                {v.tag && <span className="tag">{v.tag}</span>}
                <small>
                  <code>{shortId(v.id)}</code> · {v.author} · {new Date(v.time).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
                  {i === 0 && ' · neueste'}
                </small>
              </div>
            </li>
          ))}
        </ol>
        <p className="info-text">Versionen liegen lokal auf diesem Rechner. Jede Version hat eine eindeutige Prüfsumme und einen Vorgänger – wie ein Git-Commit.</p>
      </div>
      <div>
        {!sel || !diff ? (
          <div className="empty-diff">Wähle links eine Version, um sie mit dem aktuellen Stand zu vergleichen.</div>
        ) : (
          <>
            <div className="btn-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <b>
                {shortId(sel.id)} → aktuell: {diffSummary(diff)}
              </b>
              <span className="btn-row">
                <button className="btn" onClick={() => void save(prompt('Name der Version (z. B. „Rev A – Fertigung“):') ?? undefined)}>
                  Als Meilenstein markieren
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    if (!confirm('Diesen Stand wiederherstellen? Der aktuelle Stand bleibt über „Rückgängig“ erreichbar.')) return;
                    loadOhmText(sel.text, state.fileName);
                    set({ modal: null });
                  }}
                >
                  Wiederherstellen
                </button>
              </span>
            </div>
            <VisualDiff a={parseOhm(sel.text).project} b={current} d={diff} />
            <DiffList d={diff} />
          </>
        )}
      </div>
    </div>
  );
}

const KIND_COLOR = { neu: '#30d158', entfernt: '#ff453a', geaendert: '#ff9f0a', verschoben: '#64d2ff' } as const;

export function VisualDiff({ a, b, d }: { a: Project; b: Project; d: ProjectDiff }) {
  const kinds = new Map(d.parts.map((p) => [p.id, p.kind]));
  const all = [...b.parts, ...a.parts.filter((p) => !b.parts.some((q) => q.id === p.id))];
  const boxes = all.map((p) => {
    const def = getPart(p.type);
    const s = def ? def.size(p.props) : { w: 40, h: 40 };
    return { p, w: s.w, h: s.h, kind: kinds.get(p.id) };
  });
  if (!boxes.length) return null;
  const minX = Math.min(...boxes.map((x) => x.p.x)) - 20;
  const minY = Math.min(...boxes.map((x) => x.p.y)) - 20;
  const maxX = Math.max(...boxes.map((x) => x.p.x + x.w)) + 20;
  const maxY = Math.max(...boxes.map((x) => x.p.y + x.h)) + 20;
  const old = new Map(a.parts.map((p) => [p.id, p]));
  return (
    <svg className="visual-diff" viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} preserveAspectRatio="xMidYMid meet">
      {boxes.map(({ p, w, h, kind }) => {
        const o = old.get(p.id);
        return (
          <g key={p.id}>
            {kind === 'verschoben' && o && <rect x={o.x} y={o.y} width={w} height={h} rx={4} fill="none" stroke={KIND_COLOR.verschoben} strokeDasharray="4 3" opacity={0.6} />}
            {kind === 'verschoben' && o && <line x1={o.x + w / 2} y1={o.y + h / 2} x2={p.x + w / 2} y2={p.y + h / 2} stroke={KIND_COLOR.verschoben} markerEnd="url(#arr)" />}
            <rect x={p.x} y={p.y} width={w} height={h} rx={4} fill={kind ? KIND_COLOR[kind] + '33' : 'var(--hover)'} stroke={kind ? KIND_COLOR[kind] : 'var(--border-strong)'} strokeWidth={kind ? 2 : 1} strokeDasharray={kind === 'entfernt' ? '5 3' : undefined} />
            <text x={p.x + w / 2} y={p.y + h / 2 + 4} textAnchor="middle" fontSize={Math.min(14, Math.max(8, w / 5))} fill="var(--text)">
              {p.id}
            </text>
          </g>
        );
      })}
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0L10 5L0 10z" fill={KIND_COLOR.verschoben} />
        </marker>
      </defs>
    </svg>
  );
}

function DiffList({ d }: { d: ProjectDiff }) {
  return (
    <div className="diff-list">
      {d.parts.map((p) => (
        <div key={p.id} className="diff-item">
          <span className="chip" style={{ background: KIND_COLOR[p.kind] }}>
            {{ neu: 'neu', entfernt: 'entfernt', geaendert: 'geändert', verschoben: 'verschoben' }[p.kind]}
          </span>
          <b>{p.id}</b> <small>{p.details.join(' · ')}</small>
        </div>
      ))}
      {d.netsAdded.map((n) => (
        <div key={'+' + n} className="diff-item">
          <span className="chip" style={{ background: KIND_COLOR.neu }}>Netz</span> <b>{n}</b>
        </div>
      ))}
      {d.netsRemoved.map((n) => (
        <div key={'-' + n} className="diff-item">
          <span className="chip" style={{ background: KIND_COLOR.entfernt }}>Netz</span> <b>{n}</b>
        </div>
      ))}
      {d.netsChanged.map((n) => (
        <div key={'~' + n.name} className="diff-item">
          <span className="chip" style={{ background: KIND_COLOR.geaendert }}>Netz</span> <b>{n.name}</b> <small>{[...n.added.map((x) => '+' + x), ...n.removed.map((x) => '−' + x)].join(' ')}</small>
        </div>
      ))}
      {d.meta.map((m) => (
        <div key={m} className="diff-item">
          <small>{m}</small>
        </div>
      ))}
      {d.code.map((c) => (
        <details key={c.ziel} open>
          <summary>Code {c.ziel}</summary>
          <pre className="code-diff">
            {c.lines
              .filter((l, i, arr) => l.op !== ' ' || arr.slice(Math.max(0, i - 2), i + 3).some((x) => x.op !== ' '))
              .map((l, i) => (
                <div key={i} className={l.op === '+' ? 'add' : l.op === '-' ? 'del' : ''}>
                  {l.op} {l.text}
                </div>
              ))}
          </pre>
        </details>
      ))}
    </div>
  );
}

/* ------------------------------ Review ------------------------------ */

function ensureReview(): Review {
  state.project.review ??= { status: 'entwurf', kommentare: [], entscheidungen: [] };
  return state.project.review;
}

function ReviewPanel() {
  const project = useStore((s) => s.project);
  useStore((s) => s.rev);
  const selection = useStore((s) => s.selection);
  const r = project.review ?? { status: 'entwurf', kommentare: [], entscheidungen: [] };
  const team = project.team ?? [];
  const me = myName();
  const myRole: Rolle = team.find((m) => m.name === me)?.rolle ?? (team.length ? 'betrachter' : 'admin');
  const [text, setText] = useState('');
  const [newMember, setNewMember] = useState('');
  const [newRole, setNewRole] = useState<Rolle>('bearbeiter');
  const canEdit = myRole !== 'betrachter';
  const canApprove = myRole === 'pruefer' || myRole === 'admin';
  const open = r.kommentare.filter((k) => !k.erledigt).length;

  const decide = (ergebnis: 'freigegeben' | 'abgelehnt' | 'angefordert') => {
    const rv = ensureReview();
    rv.entscheidungen.push({ wer: me, rolle: myRole, wann: now(), ergebnis });
    rv.status = ergebnis === 'angefordert' ? 'in-pruefung' : ergebnis;
    changed(false);
    if (ergebnis === 'freigegeben') void commitVersion(project.name, saveOhmText(), `Freigegeben von ${me}`, me, `Freigabe ${new Date().toLocaleDateString('de-DE')}`);
  };

  return (
    <div className="team-grid">
      <div>
        <div className={`review-status st-${r.status}`}>
          <b>{STATUS[r.status]}</b>
          <small>
            {open} offene Kommentare · Deine Rolle: {ROLLEN[myRole]}
          </small>
        </div>
        <div className="btn-row" style={{ margin: '10px 0' }}>
          {canEdit && r.status !== 'in-pruefung' && (
            <button className="btn" onClick={() => decide('angefordert')}>
              Prüfung anfordern
            </button>
          )}
          {canApprove && (
            <>
              <button className="btn primary" disabled={open > 0} title={open > 0 ? 'Erst alle Kommentare erledigen' : ''} onClick={() => decide('freigegeben')}>
                Freigeben
              </button>
              <button className="btn" onClick={() => decide('abgelehnt')}>
                Ablehnen
              </button>
            </>
          )}
        </div>
        <ol className="timeline small">
          {r.entscheidungen
            .slice()
            .reverse()
            .map((d, i) => (
              <li key={i}>
                <span className="dot" />
                <div>
                  <b>{d.ergebnis === 'angefordert' ? 'Prüfung angefordert' : d.ergebnis === 'freigegeben' ? 'Freigegeben' : 'Abgelehnt'}</b>
                  <small>
                    {d.wer} ({ROLLEN[d.rolle]}) · {d.wann}
                  </small>
                </div>
              </li>
            ))}
        </ol>
        <h3 style={{ fontSize: 13, margin: '16px 0 6px' }}>Team & Rollen</h3>
        {team.map((m, i) => (
          <div key={m.name} className="member">
            <span className="avatar">{m.name.slice(0, 1).toUpperCase()}</span>
            <span style={{ flex: 1 }}>{m.name}</span>
            <select
              className="field"
              value={m.rolle}
              disabled={myRole !== 'admin'}
              onChange={(e) => {
                state.project.team![i].rolle = e.target.value as Rolle;
                changed(false);
              }}
            >
              {Object.entries(ROLLEN).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        ))}
        {myRole === 'admin' && (
          <div className="btn-row" style={{ marginTop: 6 }}>
            <input className="field" style={{ flex: 1 }} placeholder="Name" value={newMember} onChange={(e) => setNewMember(e.target.value)} />
            <select className="field" value={newRole} onChange={(e) => setNewRole(e.target.value as Rolle)}>
              {Object.entries(ROLLEN).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <button
              className="btn"
              disabled={!newMember.trim()}
              onClick={() => {
                state.project.team ??= team.length ? [] : [{ name: me, rolle: 'admin' }];
                if (!state.project.team.some((m) => m.name === newMember.trim())) state.project.team.push({ name: newMember.trim(), rolle: newRole });
                setNewMember('');
                changed(false);
              }}
            >
              Hinzufügen
            </button>
          </div>
        )}
        <p className="info-text">Betrachter sehen und kommentieren, Bearbeiter ändern, Prüfer geben frei, Admins verwalten das Team. Rollen und Kommentare werden in der .ohm-Datei gespeichert.</p>
      </div>
      <div>
        <div className="btn-row">
          <input
            className="field"
            style={{ flex: 1 }}
            placeholder={selection.length ? `Kommentar zu ${selection.join(', ')} …` : 'Kommentar zum Projekt …'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !text.trim()) return;
              const rv = ensureReview();
              rv.kommentare.push({ id: `k${Date.now().toString(36)}`, autor: me, text: text.trim(), wann: now(), ...(selection[0] ? { teil: selection[0] } : {}) });
              setText('');
              changed(false);
            }}
          />
        </div>
        <div className="comments">
          {r.kommentare.length === 0 && <div className="empty-diff">Noch keine Kommentare. Wähle ein Bauteil aus und schreibe oben einen Hinweis – er wird an das Teil geheftet.</div>}
          {r.kommentare.map((k) => (
            <Comment key={k.id} id={k.id} me={me} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Comment({ id, me }: { id: string; me: string }) {
  const k = state.project.review!.kommentare.find((x) => x.id === id)!;
  const [reply, setReply] = useState('');
  const def = k.teil && state.project.parts.find((p) => p.id === k.teil);
  return (
    <div className={`comment ${k.erledigt ? 'done' : ''}`}>
      <div className="comment-head">
        <span className="avatar">{k.autor.slice(0, 1).toUpperCase()}</span>
        <b>{k.autor}</b>
        <small>{k.wann}</small>
        {k.teil && (
          <button className="chip-btn" onClick={() => set({ selection: [k.teil!], modal: null })} title="Bauteil zeigen">
            {k.teil}
            {def ? '' : ' (gelöscht)'}
          </button>
        )}
        <label className="chk" style={{ marginLeft: 'auto' }}>
          <input
            type="checkbox"
            checked={!!k.erledigt}
            onChange={(e) => {
              k.erledigt = e.target.checked || undefined;
              changed(false);
            }}
          />
          erledigt
        </label>
      </div>
      <p>{k.text}</p>
      {k.antworten?.map((a, i) => (
        <div key={i} className="reply">
          <b>{a.autor}</b> <small>{a.wann}</small>
          <p>{a.text}</p>
        </div>
      ))}
      {!k.erledigt && (
        <input
          className="field reply-in"
          placeholder="Antworten …"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !reply.trim()) return;
            (k.antworten ??= []).push({ autor: me, text: reply.trim(), wann: now() });
            setReply('');
            changed(false);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------ Live ------------------------------ */

function LivePanel() {
  const c = useCollab();
  const [room, setRoom] = useState(randomRoom());
  const [name, setName] = useState(myName());
  const [server, setServer] = useState(() => {
    try {
      return localStorage.getItem('ohm.collab.server') ?? '';
    } catch {
      return '';
    }
  });
  if (c.active)
    return (
      <div>
        <div className="review-status st-freigegeben">
          <b>Live-Sitzung „{c.room}“</b>
          <small>{c.status === 'verbunden' ? `${c.peers.length + 1} Teilnehmer` : c.status}</small>
        </div>
        <div className="member" style={{ marginTop: 10 }}>
          <span className="avatar" style={{ background: c.me.color }}>
            {c.me.name.slice(0, 1).toUpperCase()}
          </span>
          {c.me.name} (du)
        </div>
        {c.peers.map((p) => (
          <div key={p.id} className="member">
            <span className="avatar" style={{ background: p.color }}>
              {p.name.slice(0, 1).toUpperCase()}
            </span>
            <span style={{ flex: 1 }}>{p.name}</span>
            <small>{p.selection.length ? `bearbeitet ${p.selection.join(', ')}` : ''}</small>
          </div>
        ))}
        <p className="info-text">Sitzungscode zum Weitergeben: <code>{c.room}</code>. Änderungen erscheinen bei allen sofort, die Auswahl der anderen siehst du als farbigen Rahmen.</p>
        <button className="btn" onClick={stopCollab}>
          Sitzung verlassen
        </button>
      </div>
    );
  return (
    <div style={{ maxWidth: 560 }}>
      <p className="info-text" style={{ marginTop: 0 }}>
        Arbeite gleichzeitig mit anderen an diesem Projekt. Ohne Server verbinden sich alle Fenster von Ohm Studio auf diesem Rechner. Mit einem Nodaris-Server (Cloud oder eigener Server im Firmennetz) arbeitet ihr über das Netzwerk zusammen.
      </p>
      <div className="row-form">
        <label>Dein Name</label>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        <label>Sitzungscode</label>
        <input className="field" value={room} onChange={(e) => setRoom(e.target.value)} />
        <label>Server (optional)</label>
        <input className="field" placeholder={`z. B. https://collab.${BRAND.domain} oder http://server:8787`} value={server} onChange={(e) => setServer(e.target.value)} />
      </div>
      <p className="info-text">Gesendet wird der Projektstand nur an den eingetragenen Server – sonst bleibt alles auf diesem Rechner.</p>
      <button className="btn primary" disabled={!name.trim() || !room.trim()} onClick={() => startCollab(room.trim(), name.trim(), server.trim())}>
        Sitzung starten / beitreten
      </button>
    </div>
  );
}
