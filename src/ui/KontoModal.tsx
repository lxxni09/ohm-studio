/**
 * Nodaris-Konto: Anmelden / Konto anlegen (Spitzname + Passwort, keine E-Mail).
 * Dasselbe Konto gilt für Galerie, Kommentare und Marktplatz. Braucht den Nodaris-Server (server/nodaris-server.mjs);
 * ist keiner eingestellt, sagt das Fenster das ehrlich und bietet an, eine Server-Adresse einzutragen.
 */
import { useEffect, useState } from 'react';
import { gallery, login, onKontoChange, register } from '../community/gallery';
import { set } from '../state/store';
import { Modal } from './Modals';
import { t } from '../i18n';

export function useKonto() {
  const [, tick] = useState(0);
  useEffect(() => onKontoChange(() => tick((x) => x + 1)), []);
  return { user: gallery.user(), server: gallery.server() };
}

export function KontoModal() {
  const { user, server } = useKonto();
  const [neu, setNeu] = useState(false);
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [alterOk, setAlterOk] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(server);

  if (user)
    return (
      <Modal title="Nodaris-Konto">
        <div className="konto">
          <p>
            Angemeldet als <b className="konto-name">{user.name}</b>
            {user.admin && ' (Moderator)'}
          </p>
          <p className="info-text">Mit deinem Konto kannst du Projekte in der Galerie veröffentlichen, kommentieren und Remixe teilen.</p>
          <div className="btn-row">
            <button className="btn" onClick={() => set({ modal: 'account' })}>Konto & Pläne</button>
            <button className="btn" onClick={() => set({ modal: 'galerie' })}>Galerie</button>
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={() => gallery.logout()}>Abmelden</button>
          </div>
        </div>
      </Modal>
    );

  const submit = async () => {
    setErr('');
    if (neu && pw !== pw2) return setErr('Die Passwörter sind nicht gleich.');
    setBusy(true);
    try {
      if (neu) await register(name.trim(), pw, alterOk);
      else await login(name.trim(), pw);
      setPw('');
      setPw2('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={neu ? 'Konto anlegen' : 'Anmelden'}>
      <div className="konto">
        {!server ? (
          <div className="gal-note">
            Anmelden braucht den <b>Nodaris-Server</b> – der ist noch nicht online. Alles andere in Ohm Studio funktioniert ohne Konto.
            <div className="konto-server">
              <input className="field" placeholder="Server-Adresse, z. B. https://konto.nodaris.de" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Server-Adresse" />
              <button className="btn" disabled={!/^https?:\/\/\S+$/.test(url.trim())} onClick={() => gallery.setServer(url)}>
                Übernehmen
              </button>
            </div>
          </div>
        ) : (
          <form
            className="konto-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label>
              {t('Spitzname')}
              <input className="field" autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} aria-label="Spitzname" autoFocus />
            </label>
            <label>
              {t('Passwort')}
              <input className="field" type="password" autoComplete={neu ? 'new-password' : 'current-password'} value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Passwort" />
            </label>
            {neu && (
              <>
                <label>
                  {t('Passwort wiederholen')}
                  <input className="field" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-label="Passwort wiederholen" />
                </label>
                <label className="chk">
                  <input type="checkbox" checked={alterOk} onChange={(e) => setAlterOk(e.target.checked)} /> Ich bin mindestens 16 – oder meine Eltern sind einverstanden.
                </label>
              </>
            )}
            {err && <div className="idea-error">{err}</div>}
            <div className="btn-row">
              <button className="btn primary" type="submit" disabled={busy || !name.trim() || !pw || (neu && !alterOk)}>
                {neu ? 'Konto anlegen' : 'Anmelden'}
              </button>
              <button className="btn" type="button" onClick={() => (setNeu(!neu), setErr(''))}>
                {neu ? 'Ich habe schon ein Konto' : 'Neues Konto anlegen'}
              </button>
            </div>
            <small className="info-text">Nur Spitzname und Passwort – keine E-Mail, kein echter Name. Server: {server}</small>
          </form>
        )}
      </div>
    </Modal>
  );
}
