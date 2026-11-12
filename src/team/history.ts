/**
 * Versionsverlauf wie Git: jede Version hat eine Inhalts-ID (SHA-256), einen Vorgänger, Autor und Nachricht.
 * Gespeichert in IndexedDB (lokal, nichts geht ins Netz). Export als Git-Bundle-Ersatz: ZIP mit allen Ständen.
 */
export interface Version {
  id: string;
  parent: string | null;
  project: string;
  message: string;
  author: string;
  time: number;
  text: string;
  tag?: string;
}

const DB = 'ohm-history';
let dbp: Promise<IDBDatabase> | null = null;
const mem: Version[] = [];

function db(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === 'undefined') return null;
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const s = r.result.createObjectStore('versions', { keyPath: 'id' });
      s.createIndex('project', 'project');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

export async function hashText(t: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function listVersions(project: string): Promise<Version[]> {
  const d = db();
  if (!d) return mem.filter((v) => v.project === project).sort((a, b) => b.time - a.time);
  const conn = await d;
  return new Promise((res) => {
    const r = conn.transaction('versions').objectStore('versions').index('project').getAll(project);
    r.onsuccess = () => res((r.result as Version[]).sort((a, b) => b.time - a.time));
    r.onerror = () => res([]);
  });
}

export async function commitVersion(project: string, text: string, message: string, author: string, tag?: string): Promise<Version | null> {
  const list = await listVersions(project);
  const head = list[0] ?? null;
  if (head && head.text === text && !tag) return null;
  const id = (await hashText(`${head?.id ?? ''}\n${text}\n${Date.now()}`)).slice(0, 40);
  const v: Version = { id, parent: head?.id ?? null, project, message: message || 'Ohne Beschreibung', author: author || 'Ich', time: Math.max(Date.now(), (head?.time ?? 0) + 1), text, ...(tag ? { tag } : {}) };
  const d = db();
  if (!d) mem.push(v);
  else {
    const conn = await d;
    await new Promise<void>((res) => {
      const tx = conn.transaction('versions', 'readwrite');
      tx.objectStore('versions').put(v);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  }
  return v;
}

/** Ältere Versionen gemäß Planlimit (Tage) aufräumen – benannte Versionen (Tags) bleiben */
export async function pruneVersions(project: string, days: number) {
  if (!Number.isFinite(days)) return;
  const d = db();
  const cutoff = Date.now() - days * 86400000;
  const old = (await listVersions(project)).filter((v) => v.time < cutoff && !v.tag);
  if (!d) {
    for (const v of old) mem.splice(mem.indexOf(v), 1);
    return;
  }
  const conn = await d;
  const tx = conn.transaction('versions', 'readwrite');
  for (const v of old) tx.objectStore('versions').delete(v.id);
}

export function shortId(id: string) {
  return id.slice(0, 7);
}
