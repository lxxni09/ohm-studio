import { useSyncExternalStore } from 'react';
import { CollabSession } from './collab';
import { applyRemoteText, changeHooks, saveOhmText, state, subscribe, toast } from '../state/store';

let session: CollabSession | null = null;
const ls = new Set<() => void>();
let snap = { active: false, room: '', status: '', peers: [] as { id: string; name: string; color: string; selection: string[] }[], me: { name: '', color: '' } };
const update = () => {
  snap = session
    ? { active: true, room: session.room, status: session.status, peers: [...session.peers.values()], me: { name: session.name, color: session.color } }
    : { active: false, room: '', status: '', peers: [], me: { name: '', color: '' } };
  ls.forEach((l) => l());
};

let applying = false;
const onChange = () => {
  if (!session || applying) return;
  session.localChange(saveOhmText());
};
let lastSel = '';
let unsubSel: (() => void) | null = null;

export function startCollab(room: string, name: string, server?: string) {
  stopCollab();
  session = new CollabSession(room, name, server || undefined);
  session.seed(saveOhmText());
  session.onPeers = update;
  session.onRemoteDoc = (text) => {
    applying = true;
    try {
      applyRemoteText(text);
    } finally {
      applying = false;
    }
  };
  changeHooks.add(onChange);
  unsubSel = subscribe(() => {
    const k = state.selection.join(',');
    if (k !== lastSel && session) {
      lastSel = k;
      session.selection(state.selection);
    }
  });
  try {
    localStorage.setItem('ohm.collab.name', name);
    if (server !== undefined) localStorage.setItem('ohm.collab.server', server);
  } catch {
    /* egal */
  }
  toast(`Live-Sitzung „${room}“ gestartet`);
  update();
}

export function stopCollab() {
  if (!session) return;
  session.close();
  session = null;
  changeHooks.delete(onChange);
  unsubSel?.();
  update();
}

export function useCollab() {
  return useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    () => snap,
  );
}

/** Wer hat welches Teil gerade ausgewählt (für farbige Rahmen in den Ansichten) */
export function remoteSelections(): Map<string, { name: string; color: string }> {
  const m = new Map<string, { name: string; color: string }>();
  for (const p of snap.peers) for (const id of p.selection) m.set(id, { name: p.name, color: p.color });
  return m;
}
