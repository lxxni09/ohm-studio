/** Kaufen / Verkaufen / Bausatz auf der Projektseite der Galerie – nur wenn der Marktplatz eingeschaltet ist */
import { useEffect, useState } from 'react';
import { business, TESTMODUS_HINWEIS } from '../business/config';
import { buy, confirmTestPayment, gallery, offers, sell, type Offer } from '../community/gallery';
import { loadOhmText, set, toast } from '../state/store';

export function MarketBox({ eintrag, mine }: { eintrag: string; mine: boolean }) {
  const b = business();
  const [list, setList] = useState<Offer[] | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [preis, setPreis] = useState('2,99');
  const [art, setArt] = useState<'datei' | 'bausatz'>('datei');
  const [checkout, setCheckout] = useState<{ sid: string; text: string } | null>(null);
  const load = () => offers().then((r) => setList(r.angebote.filter((a) => a.eintrag === eintrag))).catch((e) => setErr((e as Error).message));
  useEffect(() => {
    if (b.marketplace && gallery.server()) void load();
  }, [eintrag]);
  if (!b.marketplace || !gallery.server() || !list) return null;
  const user = gallery.user();
  const shown = list.filter((o) => o.art === 'datei' || b.kits);
  return (
    <div className="market">
      {shown.map((o) => (
        <div key={o.id} className="market-offer">
          <button className="btn primary" disabled={!user || mine} title={user ? '' : 'Zum Kaufen bitte anmelden'} onClick={async () => {
            setErr('');
            try {
              const k = await buy(o.id);
              setCheckout({ sid: k.zahlung.id, text: `${k.preisText} (davon ${k.gebuehrText} für Nodaris, ${k.auszahlungText} für ${o.verkaeufer})` });
            } catch (e) {
              setErr((e as Error).message);
            }
          }}>
            {o.art === 'bausatz' ? `Als Bausatz kaufen – ${o.preisText}` : `Kaufen – ${o.preisText}`}
          </button>
          <small className="info-text">
            von {o.verkaeufer} · {Math.round(b.marketplaceFee * 100)} % davon gehen an Nodaris · <b>{TESTMODUS_HINWEIS}</b>
          </small>
        </div>
      ))}
      {checkout && (
        <div className="gal-note">
          Bezahlen: {checkout.text}. <b>{TESTMODUS_HINWEIS}</b>{' '}
          <button className="btn" onClick={async () => {
            const r = await confirmTestPayment(checkout.sid);
            setCheckout(null);
            setMsg(r.text);
            if (r.ohm) {
              loadOhmText(r.ohm, 'gekauft.ohm');
              set({ modal: null });
              toast(r.text, 'info');
            }
          }}>
            Test-Zahlung bestätigen
          </button>
        </div>
      )}
      {mine && user && (
        <div className="market-sell">
          <span className="info-text">Dein Projekt verkaufen:</span>
          <select className="field" value={art} onChange={(e) => setArt(e.target.value as 'datei' | 'bausatz')} aria-label="Was verkaufen">
            <option value="datei">Projektdatei</option>
            {b.kits && <option value="bausatz">Bausatz</option>}
          </select>
          <input className="field" style={{ width: 80 }} value={preis} onChange={(e) => setPreis(e.target.value)} aria-label="Preis in Euro" /> €
          <button className="btn" onClick={async () => {
            setErr('');
            try {
              await sell(eintrag, art, Math.round(Number(preis.replace(',', '.')) * 100));
              setMsg('Angeboten.');
              await load();
            } catch (e) {
              setErr((e as Error).message);
            }
          }}>
            Anbieten
          </button>
          <small className="info-text">Du bekommst {100 - Math.round(b.marketplaceFee * 100)} %, Nodaris behält {Math.round(b.marketplaceFee * 100)} %.</small>
        </div>
      )}
      {msg && <div className="gal-note">{msg}</div>}
      {err && <div className="idea-error">{err}</div>}
    </div>
  );
}
