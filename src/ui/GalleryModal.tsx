/**
 * Community-Galerie als eigener Bereich im Programm: Entdecken (Suche, Kategorien, Sortierung), Projektseite
 * (Öffnen, Remixen, Gefällt mir, Kommentare, Melden), Teilen/Veröffentlichen und – für Moderatoren – Meldungen.
 */
import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { loadOhmText, saveOhmText, set, state, toast, useStore } from '../state/store';
import { Modal } from './Modals';
import { MarketBox } from './MarketBox';
import {
  adminAction,
  adminReports,
  comment,
  detail,
  gallery,
  KATEGORIEN,
  like,
  list,
  login,
  MELDEGRUENDE,
  origin,
  publish,
  register,
  report,
  setOrigin,
  snapshot,
  type GalleryDetail,
  type GalleryEntry,
  type Report,
} from '../community/gallery';

type Tab = 'entdecken' | 'teilen' | 'admin';

export function GalleryModal() {
  const initial = useStore((s) => s.galerieTab) ?? 'entdecken';
  const [tab, setTab] = useState<Tab>(initial);
  const [open, setOpen] = useState<string | null>(() => state.galerieOpen ?? null);
  const [, rerender] = useState(0);
  const user = gallery.user();
  useEffect(() => {
    if (state.galerieOpen) set({ galerieOpen: undefined });
    return () => set({ galerieTab: undefined });
  }, []);
  return (
    <Modal title="Community-Galerie" wide>
      <div className="gal-head">
        <div className="seg">
          <button className={tab === 'entdecken' ? 'on' : ''} onClick={() => (setTab('entdecken'), setOpen(null))}>
            {t('Entdecken')}
          </button>
          <button className={tab === 'teilen' ? 'on' : ''} onClick={() => setTab('teilen')}>
            {t('Mein Projekt teilen')}
          </button>
          {user?.admin && (
            <button className={tab === 'admin' ? 'on' : ''} onClick={() => setTab('admin')}>
              {t('Meldungen prüfen')}
            </button>
          )}
        </div>
        <span style={{ flex: 1 }} />
        <AccountBadge onChange={() => rerender((x) => x + 1)} />
      </div>
      {tab === 'entdecken' && (open ? <Detail id={open} back={() => setOpen(null)} /> : <Browse onOpen={setOpen} />)}
      {tab === 'teilen' && <Share onDone={(id) => (setTab('entdecken'), setOpen(id))} />}
      {tab === 'admin' && <Admin />}
      <ServerLine onChange={() => rerender((x) => x + 1)} />
    </Modal>
  );
}

/* ------------------------------ Entdecken ------------------------------ */

function Browse({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [kat, setKat] = useState('');
  const [sort, setSort] = useState('neu');
  const [res, setRes] = useState<{ eintraege: GalleryEntry[]; gesamt: number; offline: boolean } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    const h = setTimeout(() => {
      list(q, kat, sort)
        .then((r) => alive && (setRes(r), setErr('')))
        .catch((e) => alive && setErr((e as Error).message));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [q, kat, sort]);
  return (
    <>
      {res?.offline && (
        <div className="gal-note">
          Die Galerie ist noch nicht mit einem Server verbunden – du siehst nur die offiziellen Beispiele. Sobald der Nodaris-Server läuft, erscheinen hier die Projekte der Community.
        </div>
      )}
      <div className="gal-filter">
        <input className="field" placeholder="Suchen: „ampel“, „esp32“, „pflanze“ …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Galerie durchsuchen" />
        <select className="field" value={kat} onChange={(e) => setKat(e.target.value)} aria-label="Kategorie">
          <option value="">Alle Kategorien</option>
          {KATEGORIEN.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <div className="seg">
          {[
            ['neu', 'Neu'],
            ['beliebt', 'Beliebt'],
            ['remixe', 'Meiste Remixe'],
          ].map(([v, l]) => (
            <button key={v} className={sort === v ? 'on' : ''} onClick={() => setSort(v)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {err && <div className="idea-error">{err}</div>}
      {!res && !err && <p className="info-text">Lade …</p>}
      {res && !res.eintraege.length && <p className="info-text">Nichts gefunden.</p>}
      <div className="gal-grid">
        {res?.eintraege.map((e) => (
          <button key={e.id} className="gal-card" onClick={() => onOpen(e.id)}>
            <Thumb e={e} />
            <div className="gal-card-body">
              <b>{e.titel}</b>
              <small>
                {e.autor}
                {e.offiziell ? ' ✓' : ''} · {e.kategorie}
              </small>
              {e.remixVonTitel && <small className="gal-remix">↻ Remix von „{e.remixVonTitel}“</small>}
              <span className="gal-stats">
                ♥ {e.likes} · 💬 {e.kommentare} · ↻ {e.remixe}
              </span>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

function Thumb({ e }: { e: { vorschau: string | null; titel: string; teile: number; kategorie: string } }) {
  if (e.vorschau) return <img className="gal-thumb" src={e.vorschau} alt={`Vorschau: ${e.titel}`} />;
  return (
    <div className="gal-thumb gal-thumb-empty" aria-hidden="true">
      <span>{e.kategorie}</span>
      <small>{e.teile} Bauteile</small>
    </div>
  );
}

/* ------------------------------ Projektseite ------------------------------ */

function Detail({ id, back }: { id: string; back: () => void }) {
  const [d, setD] = useState<GalleryDetail | null>(null);
  const [err, setErr] = useState('');
  const [text, setText] = useState('');
  const [grund, setGrund] = useState('');
  const [msg, setMsg] = useState('');
  const [link, setLink] = useState('');
  const user = gallery.user();
  const load = () => detail(id).then(setD).catch((e) => setErr((e as Error).message));
  useEffect(() => void load(), [id]);
  if (err) return <div className="idea-error">{err}</div>;
  if (!d) return <p className="info-text">Lade …</p>;
  const openIt = (remix: boolean) => {
    const issues = loadOhmText(d.ohm, `${d.titel}.ohm`);
    if (issues.some((i) => i.level === 'error')) return;
    if (remix) {
      state.project.name = `${d.titel} (Remix)`;
      setOrigin({ id: d.id, titel: d.titel });
      toast(`Remix von „${d.titel}“ – ändere, was du willst, und teile es dann.`, 'info');
    } else setOrigin({ id: d.id, titel: d.titel });
    set({ modal: null });
  };
  const run = async (f: () => Promise<unknown>) => {
    setMsg('');
    try {
      await f();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const online = !!gallery.server();
  return (
    <div className="gal-detail">
      <button className="btn" onClick={back}>
        ← Zurück
      </button>
      <div className="gal-detail-grid">
        <Thumb e={d} />
        <div>
          <h3 style={{ margin: '0 0 4px' }}>{d.titel}</h3>
          <div className="info-text">
            von <b>{d.autor}</b>
            {d.offiziell ? ' (offiziell)' : ''} · {d.kategorie} · {d.teile} Bauteile
          </div>
          {d.remixVon && (
            <div className="gal-remix" style={{ marginTop: 6 }}>
              ↻ Remix von <a href="#" onClick={(e) => (e.preventDefault(), setD(null), void detail(d.remixVon!).then(setD))}>„{d.remixVonTitel}“</a>
            </div>
          )}
          {d.beschreibung && <p>{d.beschreibung}</p>}
          {link && <input className="field gal-link" readOnly value={link} aria-label="Link zum Teilen" onFocus={(e) => e.target.select()} />}
          <div className="btn-row">
            <button className="btn primary" onClick={() => openIt(false)}>
              Öffnen und ausprobieren
            </button>
            <button className="btn" onClick={() => openIt(true)} title="Eigene Kopie, die auf dieses Projekt verweist">
              ↻ Remixen
            </button>
            {online && (
              <button className="btn" title="Link mit Vorschaubild – z. B. für WhatsApp, Discord, Instagram" onClick={async () => {
                const url = `${gallery.server()}/p/${d.id}`;
                setLink(url);
                try {
                  await navigator.clipboard.writeText(url);
                  toast('Link kopiert – mit Vorschaubild', 'info');
                } catch {
                  /* Link steht im Feld */
                }
              }}>
                🔗 Link kopieren
              </button>
            )}
            {online && (
              <button className={`btn ${d.gefaelltMir ? 'on' : ''}`} disabled={!user} title={user ? '' : 'Zum Liken bitte anmelden'} onClick={() => run(async () => {
                const r = await like(d.id);
                setD({ ...d, likes: r.likes, gefaelltMir: r.gefaelltMir });
              })}>
                ♥ {d.likes}
              </button>
            )}
          </div>
        </div>
      </div>
      <MarketBox eintrag={d.id} mine={!!user && user.name === d.autor} />
      {!!d.remixListe.length && (
        <div style={{ marginTop: 14 }}>
          <div className="idea-sub">Remixe ({d.remixListe.length})</div>
          <ul className="idea-list">{d.remixListe.map((r) => <li key={r.id}>„{r.titel}“ von {r.autor}</li>)}</ul>
        </div>
      )}
      {online && (
        <div style={{ marginTop: 14 }}>
          <div className="idea-sub">Kommentare ({d.kommentarListe.length})</div>
          {d.kommentarListe.map((k) => (
            <div key={k.id} className="gal-comment">
              <b>{k.autor}</b> <small>{new Date(k.zeit).toLocaleDateString('de-DE')}</small>
              <div>{k.text}</div>
            </div>
          ))}
          {user ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input className="field" style={{ flex: 1 }} maxLength={1000} placeholder="Freundlich bleiben 🙂" value={text} onChange={(e) => setText(e.target.value)} aria-label="Kommentar" />
              <button className="btn" disabled={text.trim().length < 2} onClick={() => run(async () => {
                const k = await comment(d.id, text.trim());
                setD({ ...d, kommentarListe: [...d.kommentarListe, k] });
                setText('');
              })}>
                Senden
              </button>
            </div>
          ) : (
            <p className="info-text">Zum Kommentieren oben rechts anmelden.</p>
          )}
          <div className="gal-report">
            <select className="field" value={grund} onChange={(e) => setGrund(e.target.value)} aria-label="Grund der Meldung">
              <option value="">Projekt melden …</option>
              {MELDEGRUENDE.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
            {grund && (
              <button className="btn" onClick={() => run(async () => {
                const r = await report(d.id, grund);
                setGrund('');
                setMsg(r.text);
              })}>
                Melden
              </button>
            )}
          </div>
        </div>
      )}
      {msg && <div className="gal-note" style={{ marginTop: 10 }}>{msg}</div>}
    </div>
  );
}

/* ------------------------------ Teilen ------------------------------ */

function Share({ onDone }: { onDone: (id: string) => void }) {
  const project = useStore((s) => s.project);
  const [titel, setTitel] = useState(project.name === 'Neues Projekt' ? '' : project.name);
  const [beschreibung, setBeschreibung] = useState(project.beschreibung ?? '');
  const [kategorie, setKategorie] = useState('Sonstiges');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [vorschau, setVorschau] = useState<string | null>(null);
  const user = gallery.user();
  useEffect(() => void snapshot().then(setVorschau), []);
  if (!gallery.server())
    return <div className="gal-note">Zum Teilen muss die Galerie mit dem Nodaris-Server verbunden sein (unten „Server“). Bis dahin kannst du dein Projekt als .ohm-Datei speichern und weitergeben.</div>;
  if (!user) return <div className="gal-note">Zum Teilen bitte oben rechts anmelden oder ein Konto anlegen (nur Spitzname und Passwort, keine E-Mail).</div>;
  if (!project.parts.length) return <div className="gal-note">Dein Projekt ist noch leer – bau erst etwas, dann kannst du es teilen.</div>;
  return (
    <div className="gal-share">
      <div>
        <label className="gal-label">Titel</label>
        <input className="field" maxLength={80} value={titel} onChange={(e) => setTitel(e.target.value)} />
        <label className="gal-label">Beschreibung (was macht es, was braucht man?)</label>
        <textarea className="field" rows={4} maxLength={1000} value={beschreibung} onChange={(e) => setBeschreibung(e.target.value)} />
        <label className="gal-label">Kategorie</label>
        <select className="field" value={kategorie} onChange={(e) => setKategorie(e.target.value)}>
          {KATEGORIEN.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        {origin && <p className="gal-remix">↻ Wird als Remix von „{origin.titel}“ veröffentlicht (mit Link zum Original).</p>}
        <label className="chk" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> Ich veröffentliche dieses Projekt für alle sichtbar unter meinem Spitznamen. Es enthält keine persönlichen Daten (keine WLAN-Passwörter, Adressen, Namen).
        </label>
        {err && <div className="idea-error">{err}</div>}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn primary" disabled={!ok || busy || titel.trim().length < 3} onClick={async () => {
            setBusy(true);
            setErr('');
            try {
              const e = await publish({ titel: titel.trim(), beschreibung: beschreibung.trim(), kategorie, ohm: saveOhmText(), vorschau, remixVon: origin?.id ?? null });
              setOrigin({ id: e.id, titel: e.titel });
              toast('Veröffentlicht – danke fürs Teilen!', 'info');
              onDone(e.id);
            } catch (x) {
              setErr((x as Error).message);
            } finally {
              setBusy(false);
            }
          }}>
            {busy ? 'Veröffentliche …' : 'Veröffentlichen'}
          </button>
        </div>
      </div>
      <div>
        <label className="gal-label">Vorschaubild (aktuelle Ansicht)</label>
        {vorschau ? <img className="gal-thumb" src={vorschau} alt="Vorschau" /> : <div className="gal-thumb gal-thumb-empty">ohne Bild</div>}
      </div>
    </div>
  );
}

/* ------------------------------ Moderation ------------------------------ */

function Admin() {
  const [r, setR] = useState<Report[] | null>(null);
  const [err, setErr] = useState('');
  const load = () => adminReports().then((x) => setR(x.eintraege)).catch((e) => setErr((e as Error).message));
  useEffect(() => void load(), []);
  if (err) return <div className="idea-error">{err}</div>;
  if (!r) return <p className="info-text">Lade …</p>;
  if (!r.length) return <p className="info-text">Keine offenen Meldungen. 🎉</p>;
  const act = async (id: string, a: 'verbergen' | 'freigeben' | 'loeschen', k?: string) => {
    await adminAction(id, a, k);
    await load();
  };
  return (
    <div>
      {r.map((e) => (
        <div key={e.id} className="gal-admin">
          <b>{e.titel}</b> <small>von {e.autor}{e.verborgen ? ' · automatisch verborgen' : ''}</small>
          <ul className="idea-list">{e.meldungen.map((m, i) => <li key={i}>{m.grund} <small>({new Date(m.zeit).toLocaleString('de-DE')})</small></li>)}</ul>
          {e.kommentarTexte.filter((k) => !k.verborgen).slice(-5).map((k) => (
            <div key={k.id} className="gal-comment">
              <b>{k.autor}:</b> {k.text}{' '}
              <button className="btn" onClick={() => act(e.id, 'verbergen', k.id)}>Kommentar verbergen</button>
            </div>
          ))}
          <div className="btn-row">
            <button className="btn" onClick={() => act(e.id, 'freigeben')}>In Ordnung – freigeben</button>
            <button className="btn" onClick={() => act(e.id, 'verbergen')}>Verbergen</button>
            <button className="btn" onClick={() => confirm('Wirklich endgültig löschen?') && act(e.id, 'loeschen')}>Löschen</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ Konto & Server ------------------------------ */

function AccountBadge({ onChange }: { onChange: () => void }) {
  const user = gallery.user();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [alterOk, setAlterOk] = useState(false);
  const [neu, setNeu] = useState(false);
  const [err, setErr] = useState('');
  if (!gallery.server()) return null;
  if (user)
    return (
      <span className="info-text">
        Angemeldet als <b>{user.name}</b>{' '}
        <button className="btn" onClick={() => (gallery.logout(), onChange())}>Abmelden</button>
      </span>
    );
  if (!open)
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        Anmelden / Konto anlegen
      </button>
    );
  return (
    <div className="gal-login">
      <input className="field" placeholder="Spitzname" value={name} onChange={(e) => setName(e.target.value)} aria-label="Spitzname" />
      <input className="field" type="password" placeholder="Passwort" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Passwort" />
      {neu && (
        <label className="chk">
          <input type="checkbox" checked={alterOk} onChange={(e) => setAlterOk(e.target.checked)} /> Ich bin mindestens 16 – oder meine Eltern sind einverstanden.
        </label>
      )}
      <div className="btn-row">
        <button className="btn primary" onClick={async () => {
          setErr('');
          try {
            if (neu) await register(name, pw, alterOk);
            else await login(name, pw);
            setOpen(false);
            onChange();
          } catch (e) {
            setErr((e as Error).message);
          }
        }}>
          {neu ? 'Konto anlegen' : 'Anmelden'}
        </button>
        <button className="btn" onClick={() => setNeu(!neu)}>{neu ? 'Ich habe schon ein Konto' : 'Neues Konto'}</button>
      </div>
      <small className="info-text">Nur Spitzname und Passwort – keine E-Mail, kein echter Name.</small>
      {err && <div className="idea-error">{err}</div>}
    </div>
  );
}

function ServerLine({ onChange }: { onChange: () => void }) {
  const [edit, setEdit] = useState(false);
  const [url, setUrl] = useState(gallery.server());
  return (
    <div className="gal-server">
      {edit ? (
        <>
          <input className="field" placeholder="https://galerie.nodaris.de" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Galerie-Server" />
          <button className="btn" onClick={() => (gallery.setServer(url), setEdit(false), onChange())}>Speichern</button>
        </>
      ) : (
        <>
          Server: {gallery.server() || 'keiner (offline)'} ·{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), setEdit(true))}>ändern</a>
        </>
      )}
    </div>
  );
}
