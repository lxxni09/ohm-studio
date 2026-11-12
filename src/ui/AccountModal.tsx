import { useEffect, useState, useSyncExternalStore } from 'react';
import { FEATURE_ROWS, formatFeature, PLANS, planById } from '../license/plans';
import { activateLicense, checkoutUrl, currentEntitlement, ENFORCE, loadLicense, onLicenseChange, PORTAL_URL, removeLicense, startTrial, checkOnline } from '../license/license';
import { toast } from '../state/store';
import { BRAND } from '../brand/brand';

let cache = currentEntitlement();
const sub = (fn: () => void) =>
  onLicenseChange(() => {
    cache = currentEntitlement();
    fn();
  });
export function useEntitlement() {
  return useSyncExternalStore(sub, () => cache);
}

const eur = (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

export function AccountBody() {
  const ent = useEntitlement();
  const [zyklus, setZyklus] = useState<'monat' | 'jahr'>('jahr');
  const [key, setKey] = useState('');
  const st = loadLicense();
  useEffect(() => {
    void checkOnline();
  }, []);
  const plan = planById(ent.plan);
  const srcText = { free: 'Kostenlos', trial: `Testphase – noch ${ent.daysLeft} Tage`, license: `Lizenz aktiv – noch ${ent.daysLeft} Tage`, grace: 'Offline-Kulanz' }[ent.source];

  return (
    <div className="account">
      <div className="acct-head">
        <div>
          <div className="acct-plan">{plan.name}</div>
          <div className="info-text" style={{ margin: 0 }}>
            {srcText}
            {st.payload && ` · ${st.payload.name}${st.payload.seats > 1 ? ` · ${st.payload.seats} Plätze` : ''}`}
            {st.payload?.test && ' · Testlizenz'}
          </div>
          {ent.note && <div className="info-text" style={{ margin: '4px 0 0' }}>{ent.note}</div>}
          {st.trialStart && ent.source === 'free' && !st.payload && (
            <div className="info-text" style={{ margin: '4px 0 0' }}>Die 14-Tage-Testphase auf diesem Rechner ist {st.trialEnded ? 'beendet' : 'abgelaufen'}. Mit einem Lizenzcode schaltest du den Plan frei.</div>
          )}
        </div>
        <div className="btn-row">
          {!st.trialStart && ent.source === 'free' && (
            <button className="btn primary" onClick={() => startTrial() && toast('14 Tage Nodaris Pro – viel Spaß! Keine Zahlungsdaten nötig, endet automatisch.')}>
              14 Tage Pro testen
            </button>
          )}
          {st.payload && (
            <a className="btn" href={PORTAL_URL} target="_blank" rel="noreferrer">
              Kundenportal
            </a>
          )}
        </div>
      </div>
      {!ENFORCE && <p className="info-text">Vorschau-Version: Alle Funktionen sind freigeschaltet. Planlimits gelten erst mit dem offiziellen Verkaufsstart.</p>}

      <div className="seg" style={{ margin: '14px 0 10px' }}>
        <button className={zyklus === 'monat' ? 'on' : ''} onClick={() => setZyklus('monat')}>
          Monatlich
        </button>
        <button className={zyklus === 'jahr' ? 'on' : ''} onClick={() => setZyklus('jahr')}>
          Jährlich <small>2 Monate gratis</small>
        </button>
      </div>
      <div className="plan-grid">
        {PLANS.map((p) => {
          const price = zyklus === 'monat' ? p.monat : p.jahr;
          const active = p.id === ent.plan;
          return (
            <div key={p.id} className={`plan-card ${active ? 'active' : ''} ${p.id === 'pro' ? 'featured' : ''}`}>
              <b>{p.name.replace('Nodaris ', '')}</b>
              <small>{p.fuer}</small>
              <div className="plan-price">
                {price === null ? 'auf Anfrage' : price === 0 ? '0 €' : eur(price)}
                {price ? <small>/{p.proNutzer ? 'Nutzer/' : ''}{zyklus === 'monat' ? 'Monat' : 'Jahr'}</small> : null}
              </div>
              {p.id === 'enterprise' && <small>ab ca. 99 €/Nutzer/Monat</small>}
              {active ? (
                <span className="btn" aria-disabled>
                  Aktueller Plan
                </span>
              ) : p.id === 'free' ? null : p.id === 'enterprise' ? (
                <a className="btn" href={`mailto:vertrieb@${BRAND.domain}?subject=Nodaris%20Enterprise`}>
                  Anfragen
                </a>
              ) : (
                <a className={`btn ${p.id === 'pro' ? 'primary' : ''}`} href={checkoutUrl(p.id, zyklus)} target="_blank" rel="noreferrer">
                  Wählen
                </a>
              )}
            </div>
          );
        })}
      </div>

      <details style={{ marginTop: 12 }}>
        <summary>Alle Funktionen vergleichen</summary>
        <div className="table-wrap" style={{ maxHeight: 'none', marginTop: 8 }}>
          <table className="bom-table">
            <thead>
              <tr>
                <th />
                {PLANS.map((p) => (
                  <th key={p.id}>{p.name.replace('Nodaris ', '')}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURE_ROWS.map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  {PLANS.map((p) => (
                    <td key={p.id}>{r.key === 'auditLog' && p.id === 'team' ? 'SSO' : formatFeature(r.key, p.features[r.key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <h3 style={{ margin: '18px 0 6px', fontSize: 13 }}>Lizenzschlüssel</h3>
      <div className="btn-row">
        <input className="field" style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 11 }} placeholder="NODARIS-…" value={key} onChange={(e) => setKey(e.target.value)} />
        <button
          className="btn primary"
          disabled={!key.trim()}
          onClick={async () => {
            const r = await activateLicense(key);
            toast(r.text, r.ok ? undefined : 'warn');
            if (r.ok) setKey('');
          }}
        >
          Aktivieren
        </button>
        {st.payload && (
          <button className="btn" onClick={() => (removeLicense(), toast('Lizenz von diesem Gerät entfernt.'))}>
            Entfernen
          </button>
        )}
      </div>
      <p className="info-text">
        Die Lizenz wird lokal mit einer digitalen Signatur geprüft. Einmal täglich fragt Ohm Studio beim Nodaris-Lizenzserver nach, ob die Lizenz noch gilt – dabei wird nur die Lizenz-ID übertragen. Ohne Internet läuft alles {14} Tage weiter. Ohne Lizenz wird nichts übertragen.
      </p>
      <h3 style={{ margin: '18px 0 6px', fontSize: 13 }}>Sonderangebote</h3>
      <ul className="info-text" style={{ margin: 0, paddingLeft: 18 }}>
        <li>Schüler, Studierende, Lehrkräfte: Pro kostenlos (Nachweis per Schul-/Uni-Mail)</li>
        <li>Schulen & Unis: Klassenraum-Lizenz kostenlos</li>
        <li>Open-Source-Projekte: Pro kostenlos für öffentliche Projekte</li>
        <li>Start-ups (unter 2 Jahre, unter 1 Mio. € Umsatz): 50 % auf Team im ersten Jahr</li>
      </ul>
    </div>
  );
}
