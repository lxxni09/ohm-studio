/**
 * Verbindung zum Firmenserver (Nodaris Cloud oder Self-Hosted):
 * Anmeldung (Passwort + 2FA oder SSO), verschlüsselter Projektspeicher, Audit-Log, Richtlinien.
 * Alles geht ausschließlich an den eingetragenen Server.
 */
import { useSyncExternalStore } from 'react';

export interface OrgSettings {
  server: string;
  token?: string;
  user?: { name: string; email: string; rolle: string };
  updateChannel: 'stabil' | 'beta' | 'lts';
  autoUpdate: boolean;
  /** Richtlinien: KI aus, eigener KI-Anbieter, Audit an Server */
  aiDisabled: boolean;
  aiEndpoint?: string;
  audit: boolean;
  exportControl?: string;
}

const KEY = 'ohm.org';
const DEFAULTS: OrgSettings = { server: '', updateChannel: 'stabil', autoUpdate: true, aiDisabled: false, audit: true };
let cur: OrgSettings = read();
const ls = new Set<() => void>();

function read(): OrgSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<OrgSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function org(): OrgSettings {
  return cur;
}

export function setOrg(patch: Partial<OrgSettings>) {
  cur = { ...cur, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cur));
  } catch {
    /* egal */
  }
  ls.forEach((l) => l());
}

export function useOrg() {
  return useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    () => cur,
  );
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!cur.server) throw new Error('Kein Server eingetragen');
  const r = await fetch(cur.server.replace(/\/$/, '') + path, { ...init, headers: { 'Content-Type': 'application/json', ...(cur.token ? { Authorization: `Bearer ${cur.token}` } : {}), ...(init.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((j as { error?: string }).error ?? `HTTP ${r.status}`), { status: r.status, body: j });
  return j as T;
}

export async function serverConfig() {
  return call<{ sso: boolean; lokal: boolean; zweiFaktor: boolean }>('/auth/config');
}

export async function login(email: string, passwort: string, code?: string) {
  const r = await call<{ token: string; name: string; rolle: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, passwort, code }) });
  setOrg({ token: r.token, user: { name: r.name, email, rolle: r.rolle } });
  return r;
}

export async function register(email: string, name: string, passwort: string) {
  return call<{ id: string; rolle: string }>('/auth/register', { method: 'POST', body: JSON.stringify({ email, name, passwort }) });
}

/** SSO: öffnet die Anmeldeseite des Servers; das Token kommt per postMessage oder wird eingefügt */
export function startSso(): Promise<string | null> {
  const w = window.open(`${cur.server.replace(/\/$/, '')}/auth/sso`, 'nodaris-sso', 'width=520,height=680');
  return new Promise((res) => {
    const on = (e: MessageEvent) => {
      const t = (e.data as { nodarisToken?: string })?.nodarisToken;
      if (!t) return;
      window.removeEventListener('message', on);
      void acceptToken(t).then(() => res(t));
    };
    window.addEventListener('message', on);
    setTimeout(() => {
      window.removeEventListener('message', on);
      res(null);
    }, 300000);
    if (!w) res(null);
  });
}

export async function acceptToken(token: string) {
  setOrg({ token });
  try {
    const me = await call<{ name: string; email: string; rolle: string }>('/auth/me');
    setOrg({ user: { name: me.name, email: me.email, rolle: me.rolle } });
  } catch {
    setOrg({ token: undefined, user: undefined });
    throw new Error('Code ungültig');
  }
}

export function logout() {
  setOrg({ token: undefined, user: undefined });
}

export async function setup2fa() {
  return call<{ secret: string; uri: string }>('/auth/2fa/setup', { method: 'POST' });
}
export async function enable2fa(code: string) {
  return call<{ ok: boolean }>('/auth/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) });
}

export async function cloudList() {
  return call<string[]>('/v1/projects');
}
export async function cloudSave(id: string, text: string) {
  return call<{ ok: boolean }>(`/v1/projects/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ text }) });
}
export async function cloudLoad(id: string) {
  return (await call<{ text: string }>(`/v1/projects/${encodeURIComponent(id)}`)).text;
}

export async function auditLog(n = 200) {
  return call<{ zeit: string; wer: string; aktion: string; projekt?: string }[]>(`/v1/audit?n=${n}`);
}

/** Audit-Ereignis an den Firmenserver melden (nur wenn angemeldet und Audit aktiv) */
export function audit(aktion: string, projekt?: string, details?: unknown) {
  if (!cur.server || !cur.token || !cur.audit) return;
  void call('/v1/audit', { method: 'POST', body: JSON.stringify({ wer: cur.user?.email ?? '?', aktion, projekt, details }) }).catch(() => {});
}

export const cloudId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'projekt';

/* ------------------------------ Klassenräume ------------------------------ */

export interface ClassInfo {
  id: string;
  name: string;
  code?: string;
  lehrer: boolean;
  lehrerName: string;
  mitglieder: number;
  aufgaben: number;
}
export interface Assignment {
  id: string;
  titel: string;
  text: string;
  kriterien: unknown[];
  vorlage: string;
  meine?: { punkte: number; max: number; zeit: string };
}
export const classes = {
  list: () => call<ClassInfo[]>('/v1/classes'),
  create: (name: string) => call<{ id: string; code: string }>('/v1/classes', { method: 'POST', body: JSON.stringify({ name }) }),
  join: (code: string) => call<{ id: string; name: string }>('/v1/classes/join', { method: 'POST', body: JSON.stringify({ code }) }),
  assignments: (id: string) => call<Assignment[]>(`/v1/classes/${id}/assignments`),
  addAssignment: (id: string, a: { titel: string; text: string; kriterien: unknown[]; vorlage: string }) => call<Assignment>(`/v1/classes/${id}/assignments`, { method: 'POST', body: JSON.stringify(a) }),
  submit: (id: string, aid: string, text: string, punkte: number, max: number) => call<{ ok: boolean }>(`/v1/classes/${id}/assignments/${aid}/submit`, { method: 'POST', body: JSON.stringify({ text, punkte, max }) }),
  progress: (id: string) => call<{ mitglieder: { id: string; name: string }[]; aufgaben: { id: string; titel: string }[]; abgaben: { aufgabe: string; schueler: string; name: string; punkte: number; max: number; zeit: string }[] }>(`/v1/classes/${id}/progress`),
};
