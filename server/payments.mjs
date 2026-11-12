/**
 * Zahlungs-Schnittstelle für den Marktplatz.
 *  - Testmodus (Standard): es fließt kein Geld; Zahlungen werden nur zum Ausprobieren „bestätigt“.
 *  - Live: absichtlich NICHT eingebaut. Ein echter Zahlungsanbieter (z. B. Stripe, Mollie) braucht Verträge,
 *    ein Gewerbe, Steuer-Einstellungen und – bei Minderjährigen – die Zustimmung der Eltern
 *    (siehe rechtliches/BETREIBER-CHECKLISTE.md). Bis dahin verweigert der Live-Modus jede Zahlung.
 */
import { randomBytes } from 'node:crypto';

export function createPayments(mode = process.env.PAYMENT_MODE ?? 'test') {
  if (mode === 'live') {
    return {
      mode: 'live',
      create() {
        throw Object.assign(new Error('Echte Zahlungen sind noch nicht eingerichtet (Betreiber-Checkliste: Zahlungsanbieter).'), { code: 503 });
      },
      confirm() {
        throw Object.assign(new Error('Echte Zahlungen sind noch nicht eingerichtet.'), { code: 503 });
      },
    };
  }
  const sessions = new Map();
  return {
    mode: 'test',
    /** Bezahlvorgang anlegen → { id, betrag } */
    create(betrag, zweck) {
      const id = `test_${randomBytes(9).toString('base64url')}`;
      sessions.set(id, { betrag, zweck, bezahlt: false });
      return { id, betrag, modus: 'test' };
    },
    /** Nur im Testmodus: Zahlung „bestätigen“ */
    confirm(id) {
      const s = sessions.get(id);
      if (!s) throw Object.assign(new Error('Unbekannter Bezahlvorgang'), { code: 404 });
      s.bezahlt = true;
      return s;
    },
  };
}
