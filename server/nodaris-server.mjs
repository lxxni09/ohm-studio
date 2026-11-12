#!/usr/bin/env node
/**
 * Nodaris-Server – ohne Abhängigkeiten (nur Node ≥ 20).
 *  - liefert die Web-Version von Ohm Studio aus (dist/)
 *  - Echtzeit-Zusammenarbeit: WebSocket-Relay unter /collab/<raum>
 *  - Lizenzprüfung für Self-Hosted: /v1/license/<id>
 *  - Audit-Log: POST /v1/audit (JSON-Zeilen in data/audit.log), GET /v1/audit (nur Admin-Token)
 *  - Anmeldung (lokal + 2FA, SSO per OIDC), SCIM 2.0, verschlüsselter Projektspeicher – siehe enterprise.mjs
 *  - Community-Galerie mit Remix, Likes, Kommentaren und Moderation: /v1/galerie – siehe gallery.mjs
 *  - Health-Check: /healthz
 *
 * Umgebungsvariablen:
 *   PORT=8787  DATA_DIR=./data  STATIC_DIR=./dist  ADMIN_TOKEN=…  LICENSES=id1,id2 (leer = alle gültig)
 *   ALLOWED_ORIGINS=https://ohm.firma.de (leer = alle)
 *   GALLERY_ADMINS=spitzname1,spitzname2 (Moderatoren der Galerie)  EXAMPLES_DIR=./examples
 */
import http from 'node:http';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createEnterprise } from './enterprise.mjs';
import { createGallery } from './gallery.mjs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 8787);
const DATA = process.env.DATA_DIR ?? './data';
const STATIC = process.env.STATIC_DIR ?? './dist';
const ADMIN = process.env.ADMIN_TOKEN ?? '';
const LICENSES = (process.env.LICENSES ?? '').split(',').filter(Boolean);
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean);
mkdirSync(DATA, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.uf2': 'application/octet-stream', '.wasm': 'application/wasm' };

function cors(req, res) {
  const o = req.headers.origin;
  if (o && (!ORIGINS.length || ORIGINS.includes(o))) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function audit(entry) {
  appendFileSync(join(DATA, 'audit.log'), JSON.stringify({ ...entry, zeit: new Date().toISOString() }) + '\n');
}

const ent = createEnterprise({ dataDir: DATA, audit });
const gallery = createGallery({
  dataDir: DATA,
  examplesDir: process.env.EXAMPLES_DIR ?? fileURLToPath(new URL('../examples', import.meta.url)),
  adminToken: ADMIN,
  secret: process.env.SESSION_SECRET || undefined,
});
for (const n of (process.env.GALLERY_ADMINS ?? '').split(',').filter(Boolean)) gallery.makeAdmin(n.trim());

const server = http.createServer(async (req, res) => {
  cors(req, res);
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  const url = new URL(req.url, 'http://x');
  if (await gallery.handle(req, res, url)) return;
  if (await ent.handle(req, res, url)) return;
  if (url.pathname === '/healthz') return json(res, 200, { ok: true, version: '2.0.0', rooms: rooms.size });
  const lic = /^\/v1\/license\/([\w-]+)$/.exec(url.pathname);
  if (lic) return json(res, 200, { valid: !LICENSES.length || LICENSES.includes(lic[1]) });
  if (url.pathname === '/v1/audit') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c).length > 1e5 && req.destroy());
      req.on('end', () => {
        try {
          const e = JSON.parse(body);
          audit({ wer: String(e.wer ?? '?').slice(0, 100), aktion: String(e.aktion ?? '').slice(0, 200), projekt: String(e.projekt ?? '').slice(0, 200), details: e.details ?? null, ip: req.socket.remoteAddress });
          json(res, 201, { ok: true });
        } catch {
          json(res, 400, { error: 'Ungültiges JSON' });
        }
      });
      return;
    }
    const isAdmin = (ADMIN && req.headers.authorization === `Bearer ${ADMIN}`) || ent.session(req)?.rolle === 'admin';
    if (!isAdmin) return json(res, 401, { error: 'Nur für Admins' });
    const f = join(DATA, 'audit.log');
    const lines = existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    return json(res, 200, lines.slice(-Number(url.searchParams.get('n') ?? 500)));
  }
  // statische Dateien
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(STATIC, p);
  if (!file.startsWith(normalize(STATIC))) return json(res, 403, { error: 'verboten' });
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC, 'index.html');
  if (!existsSync(file)) return json(res, 404, { error: 'Web-Version nicht gebaut (npm run build)' });
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
  res.end(readFileSync(file));
});

/* ---------------- WebSocket (RFC 6455, minimal) ---------------- */

/** @type {Map<string, Set<import('node:net').Socket>>} */
const rooms = new Map();

function frame(data) {
  const payload = Buffer.from(data);
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x81, len]) : len < 65536 ? Buffer.from([0x81, 126, len >> 8, len & 255]) : Buffer.concat([Buffer.from([0x81, 127, 0, 0, 0, 0]), Buffer.from([(len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255])]);
  return Buffer.concat([head, payload]);
}

function parseFrames(buf, onText, onClose) {
  let off = 0;
  while (buf.length - off >= 2) {
    const b0 = buf[off];
    const b1 = buf[off + 1];
    const op = b0 & 15;
    let len = b1 & 127;
    let p = off + 2;
    if (len === 126) {
      if (buf.length - p < 2) break;
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (buf.length - p < 8) break;
      len = Number(buf.readBigUInt64BE(p));
      p += 8;
    }
    const masked = b1 & 128;
    const mask = masked ? buf.subarray(p, p + 4) : null;
    if (masked) p += 4;
    if (buf.length - p < len) break;
    const data = Buffer.from(buf.subarray(p, p + len));
    if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
    if (op === 1) onText(data.toString('utf8'));
    else if (op === 8) onClose();
    off = p + len;
  }
  return buf.subarray(off);
}

server.on('upgrade', (req, socket) => {
  const m = /^\/collab\/([\w.-]{1,64})$/.exec(new URL(req.url, 'http://x').pathname);
  const o = req.headers.origin;
  if (!m || (o && ORIGINS.length && !ORIGINS.includes(o))) return socket.destroy();
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const room = m[1];
  if (!rooms.has(room)) rooms.set(room, new Set());
  const peers = rooms.get(room);
  peers.add(socket);
  let buf = Buffer.alloc(0);
  const leave = () => {
    peers.delete(socket);
    if (!peers.size) rooms.delete(room);
    socket.destroy();
  };
  socket.on('data', (d) => {
    buf = parseFrames(Buffer.concat([buf, d]), (text) => {
      if (text.length > 5e6) return;
      const f = frame(text);
      for (const s of peers) if (s !== socket && !s.destroyed) s.write(f);
    }, leave);
    if (buf.length > 1e7) leave();
  });
  socket.on('close', leave);
  socket.on('error', leave);
});

server.listen(PORT, () => console.log(`Nodaris-Server läuft auf http://localhost:${PORT}  (Daten: ${DATA}, Web: ${STATIC})`));
