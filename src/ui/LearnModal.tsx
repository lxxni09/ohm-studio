import { useEffect, useState } from 'react';
import { KURS, loadProgress, saveProgress, type Lektion } from '../learn/course';
import { describeKriterium, grade, type Bewertung, type Kriterium } from '../learn/grading';
import { loadOhmText, newProject, saveOhmText, set, state, toast, useStore } from '../state/store';
import { EXAMPLES } from '../examples';
import { renderMarkdownLite } from './markdownLite';
import { classes, useOrg, type Assignment, type ClassInfo } from '../enterprise/org';

export function LearnBody() {
  const [tab, setTab] = useState<'kurs' | 'klasse'>('kurs');
  return (
    <div>
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={tab === 'kurs' ? 'on' : ''} onClick={() => setTab('kurs')}>
          Elektronik in 30 Lektionen
        </button>
        <button className={tab === 'klasse' ? 'on' : ''} onClick={() => setTab('klasse')}>
          Klassenraum
        </button>
      </div>
      {tab === 'kurs' ? <Course /> : <Classroom />}
    </div>
  );
}

function Course() {
  const [prog, setProg] = useState(loadProgress());
  const [sel, setSel] = useState<number>(() => KURS.find((l) => !prog.erledigt[l.nr])?.nr ?? 1);
  const lesson = KURS.find((l) => l.nr === sel)!;
  const done = Object.keys(prog.erledigt).length;
  const kapitel = [...new Set(KURS.map((l) => l.kapitel))];
  return (
    <div className="learn-grid">
      <div className="lesson-list">
        <div className="progress-bar">
          <div style={{ width: `${(done / KURS.length) * 100}%` }} />
        </div>
        <small className="info-text">
          {done} von {KURS.length} Lektionen geschafft
        </small>
        {kapitel.map((k) => (
          <div key={k}>
            <div className="sec">{k}</div>
            {KURS.filter((l) => l.kapitel === k).map((l) => (
              <button key={l.nr} className={`lesson-item ${sel === l.nr ? 'on' : ''}`} onClick={() => setSel(l.nr)}>
                <span className={`lesson-dot ${prog.erledigt[l.nr] ? 'done' : ''}`}>{prog.erledigt[l.nr] ? '✓' : l.nr}</span>
                {l.titel}
              </button>
            ))}
          </div>
        ))}
      </div>
      <LessonView
        key={lesson.nr}
        l={lesson}
        done={!!prog.erledigt[lesson.nr]}
        onPass={() => {
          const p = { erledigt: { ...prog.erledigt, [lesson.nr]: new Date().toISOString() } };
          setProg(p);
          saveProgress(p);
        }}
        onNext={() => setSel(Math.min(KURS.length, lesson.nr + 1))}
      />
    </div>
  );
}

function LessonView({ l, done, onPass, onNext }: { l: Lektion; done: boolean; onPass: () => void; onNext: () => void }) {
  const project = useStore((s) => s.project);
  const [res, setRes] = useState<Bewertung | null>(null);
  return (
    <div className="lesson">
      <small className="info-text">
        Lektion {l.nr} · {l.kapitel}
      </small>
      <h3 style={{ margin: '2px 0 8px' }}>{l.titel}</h3>
      <div className="lesson-text" dangerouslySetInnerHTML={{ __html: renderMarkdownLite(l.theorie) }} />
      <div className="lesson-task">
        <b>Aufgabe:</b> {l.aufgabe}
      </div>
      <details>
        <summary>Tipp</summary>
        <p className="info-text">{l.tipp}</p>
      </details>
      <div className="btn-row" style={{ margin: '12px 0' }}>
        {l.start && EXAMPLES[l.start] ? (
          <button className="btn" onClick={() => (loadOhmText(EXAMPLES[l.start!], `${l.start}.ohm`), set({ modal: null }))}>
            Startprojekt öffnen
          </button>
        ) : (
          <button className="btn" onClick={() => (newProject(), set({ modal: null }))}>
            Leeres Projekt
          </button>
        )}
        <button
          className="btn primary"
          onClick={() => {
            const g = grade(project, l.kriterien);
            setRes(g);
            if (g.ok) {
              onPass();
              toast(`Lektion ${l.nr} geschafft! 🎉`);
            }
          }}
        >
          Meine Lösung prüfen
        </button>
        {(done || res?.ok) && l.nr < KURS.length && (
          <button className="btn" onClick={onNext}>
            Weiter →
          </button>
        )}
      </div>
      {res && <GradeList g={res} />}
      {!res && (
        <ul className="grade-list">
          {l.kriterien.map((k, i) => (
            <li key={i} className="todo">
              {describeKriterium(k)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GradeList({ g }: { g: Bewertung }) {
  return (
    <>
      <b style={{ fontSize: 13 }}>
        {g.punkte} / {g.max} Punkte {g.ok ? '– alles richtig!' : ''}
      </b>
      <ul className="grade-list">
        {g.details.map((d, i) => (
          <li key={i} className={d.ok ? 'ok' : 'nok'}>
            {d.text}
          </li>
        ))}
      </ul>
    </>
  );
}

/* ------------------------------ Klassenraum ------------------------------ */

function Classroom() {
  const o = useOrg();
  const [list, setList] = useState<ClassInfo[]>([]);
  const [sel, setSel] = useState<ClassInfo | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const reload = () => void classes.list().then(setList).catch((e) => setErr((e as Error).message));
  useEffect(() => {
    if (o.user) reload();
  }, [o.user]);
  if (!o.user)
    return (
      <div className="empty-diff">
        Klassenräume laufen über einen Nodaris-Server (Cloud oder Schulserver).{' '}
        <button className="chip-btn" onClick={() => set({ modal: 'settings' })}>
          Anmelden
        </button>
      </div>
    );
  const run = (f: () => Promise<unknown>) =>
    f()
      .then(() => setErr(''))
      .catch((e) => setErr((e as Error).message));
  return (
    <div className="team-grid">
      <div>
        {list.map((c) => (
          <button key={c.id} className={`cloud-item ${sel?.id === c.id ? 'on' : ''}`} style={{ width: '100%', marginBottom: 4 }} onClick={() => setSel(c)}>
            <b>{c.name}</b>{' '}
            <small className="info-text">
              {c.lehrer ? `Lehrkraft · Code ${c.code} · ${c.mitglieder} Schüler` : `bei ${c.lehrerName}`} · {c.aufgaben} Aufgaben
            </small>
          </button>
        ))}
        <div className="btn-row" style={{ marginTop: 8 }}>
          <input className="field" style={{ flex: 1 }} placeholder="Klassencode (von der Lehrkraft)" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn" onClick={() => run(async () => (await classes.join(code), setCode(''), reload()))}>
            Beitreten
          </button>
        </div>
        <div className="btn-row" style={{ marginTop: 6 }}>
          <input className="field" style={{ flex: 1 }} placeholder="Neue Klasse, z. B. „Physik 9b“" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" onClick={() => run(async () => (await classes.create(name), setName(''), reload()))}>
            Anlegen
          </button>
        </div>
        {err && <p className="info-text" style={{ color: 'var(--red)' }}>{err}</p>}
        <p className="info-text">Schulen & Unis: Klassenraum-Lizenz kostenlos. Schülerprojekte liegen nur auf dem Server der Schule.</p>
      </div>
      <div>{sel ? sel.lehrer ? <TeacherView c={sel} /> : <StudentView c={sel} /> : <div className="empty-diff">Wähle eine Klasse.</div>}</div>
    </div>
  );
}

function TeacherView({ c }: { c: ClassInfo }) {
  const [titel, setTitel] = useState('');
  const [text, setText] = useState('');
  const [lesson, setLesson] = useState(0);
  const [prog, setProg] = useState<Awaited<ReturnType<typeof classes.progress>> | null>(null);
  const reload = () => void classes.progress(c.id).then(setProg);
  useEffect(reload, [c.id]);
  return (
    <div>
      <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Neue Aufgabe</h3>
      <div className="row-form" style={{ gridTemplateColumns: '120px 1fr' }}>
        <label>Titel</label>
        <input className="field" value={titel} onChange={(e) => setTitel(e.target.value)} />
        <label>Beschreibung</label>
        <input className="field" value={text} onChange={(e) => setText(e.target.value)} />
        <label>Bewertung wie</label>
        <select className="field" value={lesson} onChange={(e) => setLesson(Number(e.target.value))}>
          <option value={0}>Lektion wählen …</option>
          {KURS.map((l) => (
            <option key={l.nr} value={l.nr}>
              {l.nr}. {l.titel}
            </option>
          ))}
        </select>
      </div>
      <button
        className="btn primary"
        disabled={!titel || !lesson}
        onClick={async () => {
          const l = KURS.find((x) => x.nr === lesson)!;
          await classes.addAssignment(c.id, { titel, text: text || l.aufgabe, kriterien: l.kriterien, vorlage: saveOhmText() });
          setTitel('');
          setText('');
          toast('Aufgabe verteilt – das aktuelle Projekt dient als Vorlage.');
          reload();
        }}
      >
        Mit aktuellem Projekt als Vorlage verteilen
      </button>
      {prog && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="bom-table">
            <thead>
              <tr>
                <th>Schüler</th>
                {prog.aufgaben.map((a) => (
                  <th key={a.id}>{a.titel}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {prog.mitglieder.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  {prog.aufgaben.map((a) => {
                    const ab = prog.abgaben.filter((x) => x.aufgabe === a.id && x.schueler === m.id).sort((x, y) => y.zeit.localeCompare(x.zeit))[0];
                    return <td key={a.id}>{ab ? <b className={ab.punkte === ab.max ? '' : 'txt-warn'}>{ab.punkte}/{ab.max}</b> : <small className="info-text">offen</small>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {!prog.mitglieder.length && <div className="empty-diff">Noch keine Schüler – gib den Klassencode weiter.</div>}
        </div>
      )}
    </div>
  );
}

function StudentView({ c }: { c: ClassInfo }) {
  const [list, setList] = useState<Assignment[]>([]);
  const [res, setRes] = useState<Record<string, Bewertung>>({});
  const reload = () => void classes.assignments(c.id).then(setList);
  useEffect(reload, [c.id]);
  return (
    <div className="comments">
      {list.map((a) => (
        <div key={a.id} className="comment">
          <div className="comment-head">
            <b>{a.titel}</b>
            {a.meine && (
              <small>
                abgegeben: {a.meine.punkte}/{a.meine.max}
              </small>
            )}
          </div>
          <p>{a.text}</p>
          <div className="btn-row">
            {a.vorlage && (
              <button className="btn" onClick={() => (loadOhmText(a.vorlage, `${a.titel}.ohm`), set({ modal: null }))}>
                Vorlage öffnen
              </button>
            )}
            <button
              className="btn primary"
              onClick={async () => {
                const g = grade(state.project, a.kriterien as Kriterium[]);
                setRes({ ...res, [a.id]: g });
                await classes.submit(c.id, a.id, saveOhmText(), g.punkte, g.max);
                toast(`Abgegeben: ${g.punkte}/${g.max} Punkte`);
                reload();
              }}
            >
              Prüfen & abgeben
            </button>
          </div>
          {res[a.id] && <GradeList g={res[a.id]} />}
        </div>
      ))}
      {!list.length && <div className="empty-diff">Noch keine Aufgaben in dieser Klasse.</div>}
    </div>
  );
}
