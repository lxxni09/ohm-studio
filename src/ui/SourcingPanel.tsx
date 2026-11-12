import { useMemo, useState } from 'react';
import type { Project } from '../ohm/model';
import { bomCheck, bomTotal, fetchLivePrices, liveConsent, sourcedBom, TIERS, type LiveConfig, type SourcedRow } from '../export/sourcing';
import { fabQuotes } from '../export/fab';
import { toast } from '../state/store';

const eur = (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: v < 1 ? 3 : 2 });
const LC: Record<string, string> = { aktiv: 'Aktiv', nrnd: 'NRND', abgekuendigt: 'Abgekündigt', unbekannt: '?' };

export function SourcingPanel({ project }: { project: Project }) {
  const base = useMemo(() => sourcedBom(project), [project]);
  const [rows, setRows] = useState<SourcedRow[]>(base);
  const [qty, setQty] = useState(1);
  const [consent, setConsent] = useState(liveConsent());
  const [cfg, setCfg] = useState<LiveConfig>(() => {
    try {
      return JSON.parse(localStorage.getItem('ohm.livecfg') ?? '') as LiveConfig;
    } catch {
      return { provider: 'nexar', key: '' };
    }
  });
  const [busy, setBusy] = useState(false);
  const warnings = bomCheck(rows);
  const quotes = fabQuotes(project, 5);

  const live = async () => {
    try {
      localStorage.setItem('ohm.livecfg', JSON.stringify(cfg));
    } catch {
      /* egal */
    }
    setBusy(true);
    const r = await fetchLivePrices(rows, cfg);
    setBusy(false);
    setRows(r);
    toast(`${r.filter((x) => x.live).length} von ${r.length} Positionen mit Live-Preis aktualisiert.`);
  };

  return (
    <div className="sourcing">
      <h3 style={{ margin: '20px 0 8px', fontSize: 13 }}>Einkauf & Stückliste</h3>
      <div className="btn-row" style={{ alignItems: 'center', marginBottom: 8 }}>
        <span className="info-text" style={{ margin: 0 }}>Stückzahl:</span>
        {TIERS.map((t) => (
          <button key={t} className={`btn ${qty === t ? 'primary' : ''}`} onClick={() => setQty(t)}>
            {t.toLocaleString('de-DE')}
          </button>
        ))}
        <b style={{ marginLeft: 'auto' }}>
          {eur(bomTotal(rows, qty))} gesamt · {eur(bomTotal(rows, qty) / qty)} je Gerät
        </b>
      </div>
      <div className="table-wrap">
        <table className="bom-table">
          <thead>
            <tr>
              <th>Ref.</th>
              <th>Bauteil</th>
              <th>Hersteller / MPN</th>
              <th>Status</th>
              <th>RoHS</th>
              <th>@{qty}</th>
              <th>Alternativen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.bezeichnung}>
                <td>{r.refs.join(', ')}</td>
                <td>
                  {r.anzahl}× {r.bezeichnung}
                </td>
                <td>
                  {r.src.hersteller} <code>{r.src.mpn}</code>
                  {r.src.lcsc && <small> · LCSC {r.src.lcsc}</small>}
                </td>
                <td className={`lc lc-${r.src.lifecycle}`}>{LC[r.src.lifecycle]}</td>
                <td>{r.src.rohs ? '✓' : '–'}</td>
                <td>
                  {eur(r.live && qty === 1 ? r.live.price : r.tiers[qty])}
                  {r.live && <small title={`${r.live.stock} auf Lager`}> · {r.live.distributor}</small>}
                </td>
                <td>
                  <small>{r.src.alternativen.join(', ') || '—'}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {warnings.length > 0 && (
        <ul className="issue-list" style={{ marginTop: 8 }}>
          {warnings.map((w, i) => (
            <li key={i} className={w.level}>
              <b>{w.ref}:</b> {w.text}
            </li>
          ))}
        </ul>
      )}
      <details style={{ marginTop: 10 }}>
        <summary>Live-Preise & Lagerbestand (optional)</summary>
        <p className="info-text">
          Ohm Studio fragt Preise nur ab, wenn du hier zustimmst und einen eigenen API-Schlüssel einträgst. Gesendet werden ausschließlich Herstellerteilenummern (MPN) – keine Schaltung, kein Projektname, keine persönlichen Daten. Ohne Zustimmung arbeitet die Stückliste mit Richtpreisen.
        </p>
        <label className="chk">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked);
              try {
                localStorage.setItem('ohm.liveprices', e.target.checked ? 'ja' : 'nein');
              } catch {
                /* egal */
              }
            }}
          />
          Ich stimme zu, dass Teilenummern an den gewählten Anbieter gesendet werden.
        </label>
        <div className="btn-row" style={{ marginTop: 6 }}>
          <select className="field" value={cfg.provider} onChange={(e) => setCfg({ ...cfg, provider: e.target.value as LiveConfig['provider'] })}>
            <option value="nexar">Octopart / Nexar</option>
            <option value="mouser">Mouser</option>
            <option value="digikey">DigiKey (über Nexar)</option>
          </select>
          <input className="field" type="password" placeholder="API-Schlüssel" value={cfg.key} onChange={(e) => setCfg({ ...cfg, key: e.target.value })} style={{ flex: 1 }} />
          <button className="btn primary" disabled={!consent || !cfg.key || busy} onClick={() => void live()}>
            {busy ? 'Frage ab …' : 'Preise abfragen'}
          </button>
        </div>
      </details>
      <h3 style={{ margin: '20px 0 8px', fontSize: 13 }}>Platine fertigen lassen (5 Stück, Richtpreise)</h3>
      <div className="fab-quotes">
        {quotes.map((q) => (
          <a key={q.fab} className="fab-quote" href={q.url} target="_blank" rel="noreferrer">
            <b>{q.fab}</b>
            <span className="price">{eur(q.price)}</span>
            <small>
              {q.qty} Stk. · {q.days}
            </small>
            <small>{q.note}</small>
          </a>
        ))}
      </div>
      <p className="info-text">Richtpreise ohne Versand und MwSt. Lade das Fertigungspaket beim Hersteller hoch – es wird nichts automatisch übertragen.</p>
    </div>
  );
}
