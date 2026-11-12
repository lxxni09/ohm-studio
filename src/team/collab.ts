/**
 * Echtzeit-Zusammenarbeit.
 * Transport: BroadcastChannel (mehrere Fenster auf diesem Rechner) oder WebSocket zum eigenen
 * Nodaris-Server (Cloud oder Self-Hosted, siehe server/). Es wird nur an den gewählten Server gesendet.
 * Abgleich: Projektstand als .ohm-Text mit Lamport-Zähler; der höhere Stand gewinnt, bei Gleichstand die kleinere Peer-ID.
 */
export interface Peer {
  id: string;
  name: string;
  color: string;
  selection: string[];
  seen: number;
}

type Msg =
  | { t: 'hello'; from: string; name: string; color: string; rev: number }
  | { t: 'doc'; from: string; text: string; clock: number }
  | { t: 'sel'; from: string; ids: string[] }
  | { t: 'bye'; from: string };

const COLORS = ['#ff375f', '#30d158', '#ff9f0a', '#bf5af2', '#64d2ff', '#ffd60a', '#ac8e68'];

export class CollabSession {
  readonly id = Math.random().toString(36).slice(2, 10);
  readonly color = COLORS[Math.floor(Math.random() * COLORS.length)];
  peers = new Map<string, Peer>();
  clock = 0;
  private bc?: BroadcastChannel;
  private ws?: WebSocket;
  private lastText = '';
  private timer?: ReturnType<typeof setTimeout>;
  private beat?: ReturnType<typeof setInterval>;
  onRemoteDoc?: (text: string) => void;
  onPeers?: () => void;
  status: 'verbinde' | 'verbunden' | 'getrennt' = 'verbinde';

  constructor(
    readonly room: string,
    readonly name: string,
    server?: string,
  ) {
    if (server) {
      const url = `${server.replace(/^http/, 'ws').replace(/\/$/, '')}/collab/${encodeURIComponent(room)}`;
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        this.status = 'verbunden';
        this.hello();
        this.onPeers?.();
      };
      this.ws.onclose = () => {
        this.status = 'getrennt';
        this.onPeers?.();
      };
      this.ws.onmessage = (e) => this.receive(JSON.parse(String(e.data)) as Msg);
    } else if (typeof BroadcastChannel !== 'undefined') {
      this.bc = new BroadcastChannel(`ohm-collab-${room}`);
      this.bc.onmessage = (e) => this.receive(e.data as Msg);
      this.status = 'verbunden';
      this.hello();
    }
    this.beat = setInterval(() => {
      this.hello();
      const now = Date.now();
      let changed = false;
      for (const [k, p] of this.peers)
        if (now - p.seen > 8000) {
          this.peers.delete(k);
          changed = true;
        }
      if (changed) this.onPeers?.();
    }, 3000);
  }

  private send(m: Msg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m));
    this.bc?.postMessage(m);
  }

  private hello() {
    this.send({ t: 'hello', from: this.id, name: this.name, color: this.color, rev: this.clock });
  }

  private receive(m: Msg) {
    if (m.from === this.id) return;
    const peer = this.peers.get(m.from);
    if (m.t === 'bye') {
      this.peers.delete(m.from);
      this.onPeers?.();
      return;
    }
    if (m.t === 'hello') {
      const isNew = !peer;
      this.peers.set(m.from, { id: m.from, name: m.name, color: m.color, selection: peer?.selection ?? [], seen: Date.now() });
      if (isNew) {
        this.onPeers?.();
        // Neuer Teilnehmer bekommt sofort unseren Stand
        if (this.lastText) this.send({ t: 'doc', from: this.id, text: this.lastText, clock: this.clock });
      }
      return;
    }
    if (peer) peer.seen = Date.now();
    if (m.t === 'sel' && peer) {
      peer.selection = m.ids;
      this.onPeers?.();
    }
    if (m.t === 'doc') {
      if (m.clock > this.clock || (m.clock === this.clock && m.from < this.id && m.text !== this.lastText)) {
        this.clock = m.clock;
        this.lastText = m.text;
        this.onRemoteDoc?.(m.text);
      }
    }
  }

  /** Lokale Änderung melden (entprellt) */
  localChange(text: string) {
    if (text === this.lastText) return;
    this.lastText = text;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.clock++;
      this.send({ t: 'doc', from: this.id, text: this.lastText, clock: this.clock });
    }, 120);
  }

  /** Startstand setzen, ohne zu senden */
  seed(text: string) {
    this.lastText = text;
  }

  selection(ids: string[]) {
    this.send({ t: 'sel', from: this.id, ids });
  }

  close() {
    this.send({ t: 'bye', from: this.id });
    clearInterval(this.beat);
    clearTimeout(this.timer);
    this.bc?.close();
    this.ws?.close();
  }
}

export function randomRoom(): string {
  const w = ['ohm', 'volt', 'ampere', 'farad', 'henry', 'tesla', 'watt', 'kelvin', 'joule', 'hertz'];
  return `${w[Math.floor(Math.random() * w.length)]}-${Math.random().toString(36).slice(2, 6)}`;
}
