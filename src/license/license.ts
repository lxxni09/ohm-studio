/**
 * Lizenzprüfung: signierte Lizenzschlüssel (ECDSA P-256), 14 Tage Offline-Kulanz,
 * lokale Testphase (14 Tage Pro ohne Zahlungsdaten), Feature-Flags.
 *
 * Datenschutz (Abschnitt 13): Die Online-Prüfung sendet nur die Lizenz-ID an den Nodaris-Lizenzserver –
 * und nur, wenn ein Lizenzschlüssel aktiviert wurde. Ohne Lizenz verlässt nichts den Rechner.
 */
import { planById, type PlanFeatures, type PlanId } from './plans';
import { BRAND } from '../brand/brand';

/** Öffentlicher Schlüssel des Lizenzservers (SPKI, Base64). Privater Schlüssel liegt nur beim Betreiber. */
export const LICENSE_PUBLIC_KEY = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEpTnz8jgvMRYDrPludutQglrs1N2wk10g6+VsddJw8ux4ybzYVHNnVGFazG1leiiRM3MXQLQfsts7/945szYG9A==';
export const GRACE_DAYS = 14;
export const TRIAL_DAYS = 14;
const DAY = 86400000;

/** Durchsetzung der Planlimits. In der Vorschau-Version aus, bis die Bezahlung live ist (siehe ENTSCHEIDUNGEN.md). */
/** Lizenzserver für die Online-Prüfung. Ohne Server gelten Lizenzen bis zum Ablaufdatum ohne Online-Prüfung. */
export const LICENSE_SERVER = ((import.meta as { env?: Record<string, string> }).env?.VITE_LICENSE_SERVER ?? '').replace(/\/$/, '');
export const ENFORCE = (import.meta as { env?: Record<string, string> }).env?.VITE_LICENSE_ENFORCE === '1';

export interface LicensePayload {
  id: string;
  plan: PlanId;
  name: string;
  email?: string;
  seats: number;
  /** ms seit Epoch */
  issued: number;
  expires: number;
  /** Offline-Lizenz (Enterprise, abgeschottete Netze): keine Online-Prüfung nötig */
  offline?: boolean;
  test?: boolean;
}

export interface LicenseState {
  key?: string;
  payload?: LicensePayload;
  lastCheck?: number;
  trialStart?: number;
  /** Testphase vom Gerät für beendet erklärt (Uhr zurückgestellt / Eintrag verändert) */
  trialEnded?: boolean;
}

export interface Entitlement {
  plan: PlanId;
  source: 'free' | 'trial' | 'license' | 'grace';
  daysLeft?: number;
  note?: string;
  features: PlanFeatures;
}

const b64u = {
  enc: (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)),
};

/** Format: NODARIS-<payload base64url>.<signatur base64url> */
export async function verifyLicense(key: string, publicKey = LICENSE_PUBLIC_KEY): Promise<LicensePayload | null> {
  const m = /^NODARIS-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(key.trim());
  if (!m) return null;
  try {
    const pk = await crypto.subtle.importKey('spki', Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const data = b64u.dec(m[1]);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pk, b64u.dec(m[2]) as BufferSource, data as BufferSource);
    if (!ok) return null;
    return JSON.parse(new TextDecoder().decode(data)) as LicensePayload;
  } catch {
    return null;
  }
}

/** Nur für Betreiber-Werkzeuge und Tests: Lizenz signieren */
export async function signLicense(payload: LicensePayload, privateKey: CryptoKey): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, data));
  return `NODARIS-${b64u.enc(data)}.${b64u.enc(sig)}`;
}

/** Berechnet den aktuellen Anspruch – rein, ohne Netz */
export function entitlement(st: LicenseState, now = Date.now(), server = LICENSE_SERVER): Entitlement {
  const p = st.payload;
  if (p && p.expires > now) {
    const since = now - (st.lastCheck ?? p.issued);
    if (p.offline || !server || since <= GRACE_DAYS * DAY) {
      return { plan: p.plan, source: since > DAY && !p.offline && server ? 'grace' : 'license', daysLeft: Math.ceil((p.expires - now) / DAY), note: p.offline ? 'Offline-Lizenz' : since > DAY && server ? `Offline – noch ${Math.max(0, GRACE_DAYS - Math.floor(since / DAY))} Tage bis zur nächsten Prüfung` : undefined, features: planById(p.plan).features };
    }
    return { plan: 'free', source: 'free', note: `Lizenz seit über ${GRACE_DAYS} Tagen nicht geprüft – bitte einmal online gehen. Deine Projekte bleiben vollständig erhalten.`, features: planById('free').features };
  }
  if (st.trialStart && !st.trialEnded && now - st.trialStart < TRIAL_DAYS * DAY) {
    return { plan: 'pro', source: 'trial', daysLeft: Math.ceil((st.trialStart + TRIAL_DAYS * DAY - now) / DAY), features: planById('pro').features };
  }
  return { plan: 'free', source: 'free', note: p && p.expires <= now ? 'Lizenz abgelaufen.' : undefined, features: planById('free').features };
}

/* ------------- Speicher ------------- */

const KEY = 'ohm.license';

export function loadLicense(): LicenseState {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as LicenseState;
  } catch {
    return {};
  }
}

export function saveLicense(st: LicenseState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(st));
  } catch {
    /* egal */
  }
  listeners.forEach((l) => l());
}

const listeners = new Set<() => void>();
export function onLicenseChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function currentEntitlement(): Entitlement {
  return entitlement(loadLicense());
}

/** Feature-Flag: liefert true, wenn erlaubt (oder Durchsetzung aus ist) */
export function can<K extends keyof PlanFeatures>(k: K, enforce = ENFORCE): boolean {
  if (!enforce) return true;
  const v = currentEntitlement().features[k];
  return typeof v === 'boolean' ? v : typeof v === 'number' ? v > 0 : v !== 'nein';
}

export function limit<K extends keyof PlanFeatures>(k: K, enforce = ENFORCE): PlanFeatures[K] {
  if (!enforce) return planById('enterprise').features[k];
  return currentEntitlement().features[k];
}

export async function activateLicense(key: string): Promise<{ ok: boolean; text: string }> {
  const payload = await verifyLicense(key);
  if (!payload) return { ok: false, text: 'Der Lizenzschlüssel ist ungültig.' };
  if (payload.expires < Date.now()) return { ok: false, text: 'Diese Lizenz ist abgelaufen.' };
  saveLicense({ ...loadLicense(), key, payload, lastCheck: Date.now() });
  return { ok: true, text: `${planById(payload.plan).name} aktiviert – danke!` };
}

export function startTrial(): boolean {
  const st = loadLicense();
  if (st.trialStart) return false;
  saveLicense({ ...st, trialStart: Date.now() });
  // Im Windows-Programm zusätzlich am Gerät festhalten (übersteht Neuinstallation)
  void deviceTrial()?.start(loadLicense().trialStart).then(applyDeviceTrial);
  return true;
}

type DeviceTrialApi = { status(): Promise<{ start: number | null; ended: boolean }>; start(at?: number): Promise<{ start: number | null; ended: boolean }> };
function deviceTrial(): DeviceTrialApi | null {
  return ((globalThis as { ohmNative?: { trial?: DeviceTrialApi } }).ohmNative?.trial ?? null) as DeviceTrialApi | null;
}

/** Gerätezustand übernehmen: frühester Start gewinnt, „beendet“ bleibt beendet */
export function applyDeviceTrial(d: { start: number | null; ended: boolean } | null) {
  if (!d) return;
  const st = loadLicense();
  const start = d.start === null ? st.trialStart : st.trialStart ? Math.min(st.trialStart, d.start) : d.start;
  if (start === st.trialStart && !!d.ended === !!st.trialEnded) return;
  saveLicense({ ...st, trialStart: start, trialEnded: d.ended || undefined });
}

/** Beim Start: Testphase mit dem Gerät abgleichen (nur Windows-Programm) */
export async function syncDeviceTrial() {
  const api = deviceTrial();
  if (!api) return;
  const st = loadLicense();
  // Lokal schon gestartet, Gerät weiß noch nichts → am Gerät eintragen (start() behält einen früheren Gerätestart)
  applyDeviceTrial(await (st.trialStart ? api.start(st.trialStart) : api.status()));
}

export function removeLicense() {
  const st = loadLicense();
  saveLicense({ trialStart: st.trialStart, trialEnded: st.trialEnded });
}

/** Online-Prüfung: sendet nur die Lizenz-ID. Schlägt still fehl, wenn kein Netz – dann greift die Kulanz. */
export async function checkOnline(): Promise<boolean> {
  const st = loadLicense();
  if (!st.payload || st.payload.offline) return false;
  try {
    if (!LICENSE_SERVER) return false;
    const r = await fetch(`${LICENSE_SERVER}/v1/license/${encodeURIComponent(st.payload.id)}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return false;
    const j = (await r.json()) as { valid: boolean };
    if (j.valid) saveLicense({ ...st, lastCheck: Date.now() });
    else saveLicense({ trialStart: st.trialStart, trialEnded: st.trialEnded });
    return true;
  } catch {
    return false;
  }
}

/** Kauf-/Portal-Links (Merchant of Record, Testmodus bis zum Start) */
export function checkoutUrl(plan: PlanId, zyklus: 'monat' | 'jahr'): string {
  return `https://${BRAND.domain}/kaufen?plan=${plan}&zyklus=${zyklus}&modus=test`;
}
export const PORTAL_URL = `https://${BRAND.domain}/konto`;
