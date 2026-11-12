import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { entitlement, signLicense, verifyLicense, GRACE_DAYS, type LicensePayload } from '../src/license/license';
import { PLANS, planById } from '../src/license/plans';

const DAY = 86400000;

describe('Lizenzen', () => {
  it('Pläne entsprechen der Preistabelle', () => {
    expect(PLANS.map((p) => p.monat)).toEqual([0, 6, 19, 49, null]);
    expect(planById('plus').jahr).toBe(60);
    expect(planById('free').features.maxLayers).toBe(2);
    expect(planById('pro').features.analyses).toBe(true);
  });
  it('signierte Lizenz wird geprüft, Manipulation erkannt', async () => {
    const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const pub = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('spki', kp.publicKey))));
    const p: LicensePayload = { id: 'x', plan: 'pro', name: 'A', seats: 1, issued: Date.now(), expires: Date.now() + 30 * DAY };
    const key = await signLicense(p, kp.privateKey);
    expect((await verifyLicense(key, pub))?.plan).toBe('pro');
    const [head, sig] = key.split('.');
    const forged = head.slice(0, -2) + (head.endsWith('A') ? 'B' : 'A') + head.slice(-1) + '.' + sig;
    expect(await verifyLicense(forged, pub)).toBeNull();
  });
  it('Schlüssel aus dem Betreiber-Werkzeug passt zum eingebauten öffentlichen Schlüssel', async () => {
    if (!existsSync('.keys/test-license.txt')) return;
    const p = await verifyLicense(readFileSync('.keys/test-license.txt', 'utf8'));
    expect(p?.plan).toBe('pro');
  });
  it('Offline-Kulanz 14 Tage, danach Free – Testphase 14 Tage Pro', () => {
    const now = Date.now();
    const payload: LicensePayload = { id: 'x', plan: 'team', name: 'A', seats: 3, issued: now - 40 * DAY, expires: now + 300 * DAY };
    expect(entitlement({ payload, lastCheck: now - 3 * DAY }, now)).toMatchObject({ plan: 'team', source: 'grace' });
    expect(entitlement({ payload, lastCheck: now - (GRACE_DAYS + 1) * DAY }, now).plan).toBe('free');
    expect(entitlement({ payload: { ...payload, offline: true }, lastCheck: now - 200 * DAY }, now).plan).toBe('team');
    expect(entitlement({ trialStart: now - 5 * DAY }, now)).toMatchObject({ plan: 'pro', source: 'trial', daysLeft: 9 });
    expect(entitlement({ trialStart: now - 15 * DAY }, now).plan).toBe('free');
  });
});
