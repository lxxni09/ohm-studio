import { useEffect, useState } from 'react';
import { acceptToken, audit, auditLog, cloudId, cloudList, cloudLoad, cloudSave, enable2fa, login, logout, register, serverConfig, setOrg, setup2fa, startSso, useOrg } from '../enterprise/org';
import { loadOhmText, saveOhmText, state, toast, set } from '../state/store';
import { checkForUpdates, nativeAvailable } from '../native';
import { BRAND } from '../brand/brand';
import { a11y, setA11y } from '../a11y';
import { esp32Api } from '../mcu/cores/esp32qemu';
import { business, partners, PROVISION_HINWEIS } from '../business/config';
import { currentLang, LANGS, setLang, t, type Lang } from '../i18n';

type SettingsTab = 'server' | 'sprache' | 'emulatoren' | 'richtlinien' | 'updates' | 'datenschutz' | 'transparenz';
/** Von außen gewünschter Einstieg (z. B. nach dem Setup: Emulator direkt laden) – wird beim Öffnen einmal verbraucht */
export const settingsIntent: { tab?: SettingsTab; installEmu?: boolean } = {};

export function SettingsBody() {
  const o = useOrg();
  const [tab, setTab] = useState<SettingsTab>(() => {
    const t0 = settingsIntent.tab ?? 'sprache';
    settingsIntent.tab = undefined;
    return t0;
  });
  return (
    <div>
      <div className="seg" style={{ marginBottom: 14 }}>
        {(
          [
            ['sprache', 'Sprache & Barrierefreiheit'],
            ['emulatoren', 'Emulatoren'],
            ['server', 'Firmenserver & Anmeldung'],
            ['richtlinien', 'Richtlinien'],
            ['updates', 'Updates'],
            ['datenschutz', 'Datenschutz'],
            ['transparenz', 'Transparenz'],
          ] as const
        ).map(([k, v]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {t(v)}
          </button>
        ))}
      </div>
      {tab === 'server' && <ServerTab />}
      {tab === 'sprache' && <LangTab />}
      {tab === 'emulatoren' && <EmuTab />}
      {tab === 'transparenz' && <TransparencyTab />}
      {tab === 'richtlinien' && (
        <div style={{ maxWidth: 620 }}>
          <label className="chk">
            <input type="checkbox" checked={o.aiDisabled} onChange={(e) => setOrg({ aiDisabled: e.target.checked })} /> KI-Funktionen abschalten (Assistent, Review, Code-Hilfe)
          </label>
          <div className="row-form">
            <label>Eigener KI-Anbieter</label>
            <input className="field" placeholder="z. B. https://ki.firma.de/v1 (Anthropic-kompatibel)" value={o.aiEndpoint ?? ''} onChange={(e) => setOrg({ aiEndpoint: e.target.value || undefined })} />
            <label>Exportkontrolle</label>
            <input className="field" placeholder="Hinweistext, z. B. „Dual-Use – Ausfuhr genehmigungspflichtig“" value={o.exportControl ?? ''} onChange={(e) => setOrg({ exportControl: e.target.value || undefined })} />
          </div>
          <label className="chk">
            <input type="checkbox" checked={o.audit} onChange={(e) => setOrg({ audit: e.target.checked })} /> Änderungen im Audit-Log des Firmenservers protokollieren
          </label>
          <p className="info-text">Ist ein Exportkontroll-Hinweis gesetzt, erscheint er bei jedem Export und Teilen. Richtlinien lassen sich in Firmen per Konfigurationsdatei vorgeben.</p>
        </div>
      )}
      {tab === 'updates' && <UpdatesTab />}
      {tab === 'datenschutz' && (
        <div style={{ maxWidth: 680 }} className="privacy">
          <p>
            <b>Ohm Studio sendet ohne deine Zustimmung keine Daten an Dritte.</b> Es gibt keine Werbung, keine Tracker und keine versteckte Telemetrie. Übersicht, was wann wohin geht:
          </p>
          <table className="bom-table">
            <tbody>
              <tr>
                <td>Projekte, Code, Simulation</td>
                <td>bleiben auf deinem Rechner</td>
              </tr>
              <tr>
                <td>KI-Assistent</td>
                <td>nur mit deinem eigenen API-Schlüssel, direkt an Anthropic bzw. den eingetragenen Firmenanbieter</td>
              </tr>
              <tr>
                <td>Live-Preise</td>
                <td>nur nach Zustimmung; ausschließlich Teilenummern an den gewählten Distributor</td>
              </tr>
              <tr>
                <td>Lizenzprüfung</td>
                <td>nur mit aktivierter Lizenz; ausschließlich die Lizenz-ID an {BRAND.company}</td>
              </tr>
              <tr>
                <td>Update-Suche</td>
                <td>Programmversion und Kanal (abschaltbar)</td>
              </tr>
              <tr>
                <td>Firmenserver, Live-Sitzungen</td>
                <td>nur an den Server, den du einträgst</td>
              </tr>
              <tr>
                <td>Teilen-Link</td>
                <td>das Projekt steckt in der URL – nur wer den Link hat, sieht es</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ServerTab() {
  const o = useOrg();
  const [server, setServer] = useState(o.server);
  const [cfg, setCfg] = useState<{ sso: boolean } | null>(null);
  const [err, setErr] = useState('');
  const [email, setEmail] = useState(o.user?.email ?? '');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [need2fa, setNeed2fa] = useState(false);
  const [paste, setPaste] = useState('');
  const [projects, setProjects] = useState<string[] | null>(null);
  const [tfa, setTfa] = useState<{ secret: string; uri: string } | null>(null);
  const [log, setLog] = useState<{ zeit: string; wer: string; aktion: string; projekt?: string }[] | null>(null);

  useEffect(() => {
    if (!o.server) return setCfg(null);
    serverConfig()
      .then((c) => (setCfg(c), setErr('')))
      .catch((e) => (setCfg(null), setErr(`Server nicht erreichbar: ${(e as Error).message}`)));
  }, [o.server]);

  const run = async (f: () => Promise<unknown>) => {
    try {
      setErr('');
      await f();
    } catch (e) {
      const ex = e as Error & { body?: { zweiFaktor?: boolean } };
      if (ex.body?.zweiFaktor) setNeed2fa(true);
      setErr(ex.message);
    }
  };

  return (
    <div className="team-grid">
      <div>
        <div className="row-form">
          <label>Server-Adresse</label>
          <div className="btn-row">
            <input className="field" style={{ flex: 1 }} placeholder={`https://ohm.firma.de oder https://cloud.${BRAND.domain}`} value={server} onChange={(e) => setServer(e.target.value)} />
            <button className="btn" onClick={() => setOrg({ server: server.trim(), token: undefined, user: undefined })}>
              Verbinden
            </button>
          </div>
        </div>
        {err && <p className="info-text" style={{ color: 'var(--red)' }}>{err}</p>}
        {o.user ? (
          <>
            <div className="member">
              <span className="avatar">{o.user.name.slice(0, 1).toUpperCase()}</span>
              <span style={{ flex: 1 }}>
                {o.user.name} <small>· {o.user.email} · {o.user.rolle}</small>
              </span>
              <button className="btn" onClick={logout}>
                Abmelden
              </button>
            </div>
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => void run(async () => setTfa(await setup2fa()))}>
                Zwei-Faktor einrichten
              </button>
              {o.user.rolle === 'admin' && (
                <button className="btn" onClick={() => void run(async () => setLog(await auditLog()))}>
                  Audit-Log anzeigen
                </button>
              )}
            </div>
            {tfa && (
              <div className="tfa">
                <p className="info-text">
                  Trage diesen Schlüssel in deine Authenticator-App ein (Google Authenticator, Microsoft Authenticator, 1Password …):
                </p>
                <code style={{ userSelect: 'all', fontSize: 13 }}>{tfa.secret.match(/.{1,4}/g)!.join(' ')}</code>
                <div className="btn-row" style={{ marginTop: 6 }}>
                  <input className="field" placeholder="6-stelliger Code" value={code} onChange={(e) => setCode(e.target.value)} />
                  <button className="btn primary" onClick={() => void run(async () => (await enable2fa(code), setTfa(null), toast('Zwei-Faktor-Anmeldung aktiv')))}>
                    Bestätigen
                  </button>
                </div>
              </div>
            )}
          </>
        ) : cfg ? (
          <>
            {cfg.sso && (
              <button className="btn primary" style={{ width: '100%', justifyContent: 'center', margin: '6px 0' }} onClick={() => void run(async () => ((await startSso()) ? toast('Angemeldet') : null))}>
                Mit Firmenkonto anmelden (SSO)
              </button>
            )}
            <div className="row-form">
              <label>E-Mail</label>
              <input className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
              <label>Passwort</label>
              <input className="field" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
              {need2fa && (
                <>
                  <label>2FA-Code</label>
                  <input className="field" value={code} onChange={(e) => setCode(e.target.value)} />
                </>
              )}
            </div>
            <div className="btn-row">
              <button className="btn primary" onClick={() => void run(() => login(email, pw, code || undefined).then(() => audit('anmeldung.app')))}>
                Anmelden
              </button>
              <button className="btn" title="Nur möglich, solange der Server noch kein Konto hat (erstes Konto wird Admin)" onClick={() => void run(async () => (await register(email, email.split('@')[0], pw), await login(email, pw)))}>
                Erstes Admin-Konto anlegen
              </button>
            </div>
            {cfg.sso && (
              <div className="btn-row" style={{ marginTop: 8 }}>
                <input className="field" style={{ flex: 1 }} placeholder="Anmeldecode aus dem Browser einfügen" value={paste} onChange={(e) => setPaste(e.target.value)} />
                <button className="btn" onClick={() => void run(() => acceptToken(paste.trim()))}>
                  Übernehmen
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="info-text">
            Mit einem Nodaris-Server (Nodaris Cloud in Frankfurt oder eigener Server per Docker/Kubernetes) bekommt dein Team zentrale Anmeldung mit SSO, Zwei-Faktor, verschlüsselten Projektspeicher, SCIM-Benutzerverwaltung und ein Audit-Log. Ohne Server funktioniert Ohm Studio vollständig lokal.
          </p>
        )}
      </div>
      <div>
        {o.user && (
          <>
            <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>Projekte auf dem Server</h3>
            <div className="btn-row">
              <button
                className="btn primary"
                onClick={() =>
                  void run(async () => {
                    await cloudSave(cloudId(state.project.name), saveOhmText());
                    audit('projekt.gespeichert', state.project.name);
                    toast('Verschlüsselt auf dem Server gespeichert');
                    setProjects(await cloudList());
                  })
                }
              >
                Aktuelles Projekt speichern
              </button>
              <button className="btn" onClick={() => void run(async () => setProjects(await cloudList()))}>
                Liste laden
              </button>
            </div>
            <div className="cloud-list">
              {projects?.length === 0 && <div className="info-text">Noch keine Projekte auf dem Server.</div>}
              {projects?.map((p) => (
                <button
                  key={p}
                  className="cloud-item"
                  onClick={() =>
                    void run(async () => {
                      loadOhmText(await cloudLoad(p), `${p}.ohm`);
                      set({ modal: null });
                    })
                  }
                >
                  {p}
                </button>
              ))}
            </div>
          </>
        )}
        {log && (
          <>
            <h3 style={{ fontSize: 13, margin: '14px 0 8px' }}>Audit-Log</h3>
            <div className="table-wrap">
              <table className="bom-table">
                <thead>
                  <tr>
                    <th>Zeit</th>
                    <th>Wer</th>
                    <th>Aktion</th>
                    <th>Projekt</th>
                  </tr>
                </thead>
                <tbody>
                  {log
                    .slice()
                    .reverse()
                    .map((e, i) => (
                      <tr key={i}>
                        <td>{new Date(e.zeit).toLocaleString('de-DE')}</td>
                        <td>{e.wer}</td>
                        <td>{e.aktion}</td>
                        <td>{e.projekt ?? ''}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function UpdatesTab() {
  const o = useOrg();
  const [res, setRes] = useState('');
  return (
    <div style={{ maxWidth: 560 }}>
      <div className="row-form">
        <label>Kanal</label>
        <select className="field" value={o.updateChannel} onChange={(e) => setOrg({ updateChannel: e.target.value as 'stabil' })}>
          <option value="stabil">Stabil (empfohlen)</option>
          <option value="beta">Beta – neue Funktionen früher</option>
          <option value="lts">Firmen-LTS – nur Sicherheitsupdates, 2 Jahre</option>
        </select>
      </div>
      <label className="chk">
        <input type="checkbox" checked={o.autoUpdate} onChange={(e) => setOrg({ autoUpdate: e.target.checked })} /> Beim Start nach Updates suchen
      </label>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button
          className="btn"
          disabled={!nativeAvailable()}
          onClick={async () => {
            const r = await checkForUpdates(o.updateChannel);
            setRes(!r ? '' : !r.ok ? `Version ${r.current} – Update-Server nicht erreichbar.` : r.newer ? `Version ${r.latest} ist verfügbar.` : `Version ${r.current} ist aktuell.`);
          }}
        >
          Jetzt prüfen
        </button>
        <span className="info-text" style={{ margin: 0 }}>
          {nativeAvailable() ? res : 'Die Web-Version ist immer aktuell.'}
        </span>
      </div>
      <p className="info-text">Bei der Suche wird nur die Programmversion übertragen. Die Programme sind digital signiert (Windows Authenticode, Apple-Notarisierung), sobald das Zertifikat hinterlegt ist.</p>
    </div>
  );
}

function LangTab() {
  const [, force] = useState(0);
  const upd = (p: Partial<typeof a11y>, reload = false) => {
    setA11y(p, reload);
    force((x) => x + 1);
  };
  return (
    <div style={{ maxWidth: 600 }}>
      <div className="row-form">
        <label>{t('Sprache')}</label>
        <select className="field" value={currentLang()} onChange={(e) => setLang(e.target.value as Lang)}>
          {LANGS.map(([k, n]) => (
            <option key={k} value={k}>
              {n}
            </option>
          ))}
        </select>
        <label>Größe der Oberfläche</label>
        <select className="field" value={a11y.scale} onChange={(e) => upd({ scale: Number(e.target.value) })}>
          {[0.9, 1, 1.1, 1.25, 1.5].map((v) => (
            <option key={v} value={v}>
              {Math.round(v * 100)} %
            </option>
          ))}
        </select>
      </div>
      <label className="chk">
        <input type="checkbox" checked={a11y.colorblind} onChange={(e) => upd({ colorblind: e.target.checked }, true)} /> Farbenblind-Modus: Widerstandswerte zusätzlich als Text
      </label>
      <label className="chk">
        <input type="checkbox" checked={a11y.contrast} onChange={(e) => upd({ contrast: e.target.checked })} /> Hoher Kontrast
      </label>
      <label className="chk">
        <input type="checkbox" checked={a11y.reducedMotion} onChange={(e) => upd({ reducedMotion: e.target.checked })} /> Bewegungen reduzieren
      </label>
      <p className="info-text">
        Menüs, Werkzeugleiste, Bibliothek und Panels sind in 10 Sprachen verfügbar; Dialoge, Lektionen und Meldungen sind derzeit auf Deutsch. Alle Schaltflächen haben Beschriftungen für Bildschirmleser, Dialoge schließen mit Esc, die Tastatur-Bedienung ist unter „Tastenkürzel“ beschrieben.
      </p>
    </div>
  );
}

function EmuTab() {
  const api = esp32Api();
  const [st, setSt] = useState<{ cli: boolean; core: boolean; riscv32: boolean; xtensa: boolean } | null>(null);
  const [prog, setProg] = useState<{ text: string; frac: number } | null>(null);
  const [err, setErr] = useState('');
  const install = async () => {
    if (!api) return;
    setErr('');
    setProg({ text: 'Starte …', frac: 0 });
    const r = await api.install();
    if (!r.ok) setErr(r.error ?? 'Installation fehlgeschlagen');
    setSt(await api.status());
    setProg(null);
  };
  useEffect(() => {
    if (!api) return;
    void api.status().then(setSt);
    if (settingsIntent.installEmu) {
      settingsIntent.installEmu = false;
      void install();
    }
    return api.onProgress((p) => setProg({ text: p.text, frac: p.frac }));
  }, []);
  if (!api)
    return (
      <p className="info-text" style={{ maxWidth: 620 }}>
        Echte Emulatoren für ESP32 laufen als eigener Prozess und sind nur im Windows-Programm verfügbar. In dieser Version laufen ESP32-Sketche im Schnellmodus.
      </p>
    );
  const ready = st && st.cli && st.core && st.riscv32 && st.xtensa;
  return (
    <div style={{ maxWidth: 640 }}>
      <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Echter ESP32 (ESP32 und ESP32-C3)</h3>
      <p className="info-text" style={{ marginTop: 0 }}>
        Dein Sketch wird mit dem offiziellen ESP32-Kern von Espressif zu echtem Maschinencode übersetzt und im Espressif-Emulator (QEMU) ausgeführt – genau das Programm, das auch auf das echte Board käme. Pins, ADC, PWM, Deep-Sleep und BLE-Scan sind über eine Brücke mit deiner simulierten Schaltung verbunden. Nicht nachgebildet: WLAN, I²C/SPI-Geräte, BLE-Werbung.
      </p>
      <div className="emc-list">
        {(
          [
            ['arduino-cli (Übersetzer)', st?.cli],
            ['ESP32-Kern von Espressif', st?.core],
            ['Emulator ESP32-C3 (RISC-V)', st?.riscv32],
            ['Emulator ESP32 (Xtensa)', st?.xtensa],
          ] as [string, boolean | undefined][]
        ).map(([n, ok]) => (
          <div key={n} className="emc-item" style={{ gridTemplateColumns: 'auto 1fr' }}>
            <span className={`lvl lvl-${ok ? 'ok' : 'warn'}`} />
            <span>
              {n} – {ok ? 'installiert' : 'fehlt'}
            </span>
          </div>
        ))}
      </div>
      {!ready && (
        <>
          <p className="info-text">Einmalig ca. 1,5 GB Download (Platzbedarf ca. 8 GB). Die Programme stammen direkt von Espressif und Arduino und laufen getrennt von Ohm Studio.</p>
          <button
            className="btn primary"
            disabled={!!prog && prog.frac < 1}
            onClick={() => void install()}
          >
            ESP32-Werkzeuge installieren
          </button>
        </>
      )}
      {prog && (
        <div style={{ marginTop: 10 }}>
          <div className="progress-bar">
            <div style={{ width: `${Math.round(prog.frac * 100)}%` }} />
          </div>
          <small className="info-text">{prog.text}</small>
        </div>
      )}
      {err && <pre className="code-diff" style={{ color: 'var(--red)', whiteSpace: 'pre-wrap' }}>{err}</pre>}
      {ready && <p className="info-text">Bereit. Wähle im Code-Bereich unten „Arduino C++ · echter ESP32 (Emulator)“ und starte die Simulation.</p>}
    </div>
  );
}

/** Wo verdient Nodaris Geld? Alles auf einen Blick – Pflicht, damit nichts versteckt ist */
function TransparencyTab() {
  const b = business();
  const row = (on: boolean, title: string, text: string) => (
    <div className="emc-item" style={{ gridTemplateColumns: 'auto 1fr' }}>
      <span className={`lvl lvl-${on ? 'warn' : 'ok'}`} />
      <span>
        <b>{title}</b> – {on ? 'eingeschaltet' : 'ausgeschaltet'}
        <br />
        <small className="info-text">{text}</small>
      </span>
    </div>
  );
  const prov = partners().filter((p) => p.provision);
  return (
    <div style={{ maxWidth: 680 }} className="transparency">
      <p className="info-text" style={{ marginTop: 0 }}>
        Hier steht jede Stelle, an der Nodaris mit Ohm Studio Geld verdienen kann. Es gibt <b>keine Werbung</b> im Programm, und deine Daten werden <b>nicht verkauft</b>.
      </p>
      <div className="emc-list">
        {row(b.planLocks, 'Pläne (Plus, Pro, Team)', 'Free bleibt vollwertig für Hobbyprojekte. Nur wenn eingeschaltet, sind Profi-Funktionen an einen bezahlten Plan gebunden.')}
        {row(b.partnerLinks, 'Partner-Links zu Bauteil-Shops', `Jeder Partner-Link ist mit * markiert: „${PROVISION_HINWEIS}“${prov.length ? ` Aktive Partner mit Provision: ${prov.map((p) => p.name).join(', ')}.` : ' Derzeit ist bei keinem Shop eine Provision hinterlegt.'}`)}
        {row(b.kits, 'Bausätze', 'Projekte als Bausatz (Platine + Bauteile) kaufen. Der Preis steht immer dabei.')}
        {row(b.marketplace, 'Marktplatz', `Nutzer können eigene Projekte verkaufen; Nodaris behält ${Math.round(b.marketplaceFee * 100)} % des Preises, der Rest geht an die Person, die es gebaut hat. Remixe fremder Projekte können nicht verkauft werden.`)}
        {row(false, 'Werbung', 'Gibt es nicht und wird es nicht geben.')}
      </div>
      <p className="info-text">Zahlungen laufen derzeit nur im Testmodus – es wird kein echtes Geld bewegt.</p>
    </div>
  );
}
