/**
 * Community-Galerie für den Nodaris-Server (ohne Abhängigkeiten).
 *
 * Datensparsam: Konten bestehen nur aus Spitzname + Passwort (scrypt), keine E-Mail. Gespeichert wird in
 * DATA_DIR/galerie.json. Die 10 Beispielprojekte sind die ersten Einträge (Autor „Nodaris“).
 *
 * Endpunkte (JSON):
 *   POST /v1/galerie/konto            { name, passwort, alterOk, website? }  → { token, name }
 *   POST /v1/galerie/anmelden         { name, passwort }                      → { token, name, admin }
 *   GET  /v1/galerie?q=&kategorie=&sort=neu|beliebt|remixe&seite=           → { eintraege, gesamt, kategorien }
 *   GET  /v1/galerie/:id                                                     → Eintrag mit .ohm, Kommentaren, Remixen
 *   POST /v1/galerie                  { titel, beschreibung, kategorie, ohm, vorschau?, remixVon?, website? }
 *   POST /v1/galerie/:id/like         (umschalten)
 *   POST /v1/galerie/:id/kommentar    { text, website? }
 *   POST /v1/galerie/:id/melden       { grund, kommentar? }   (auch ohne Konto, je IP begrenzt)
 *   GET  /v1/galerie/admin/meldungen  (Admin)
 *   POST /v1/galerie/admin/:id        { aktion: verbergen|freigeben|loeschen, kommentar? } (Admin)
 *   GET  /v1/galerie/:id/bild          Vorschaubild (JPEG/PNG) – für Link-Vorschauen in Messengern
 *   GET  /v1/galerie/:id/datei         .ohm-Datei zum Herunterladen
 *   Marktplatz (nur wenn MARKETPLACE=1; Nodaris behält 15 %, Zahlungen nur im Testmodus):
 *   GET  /v1/markt                    Angebote
 *   POST /v1/markt                    { eintrag, art: datei|bausatz, preis (Cent) } – eigenes Projekt anbieten
 *   POST /v1/markt/:id/kaufen         → Bezahlvorgang (Test)
 *   POST /v1/markt/zahlung/:sid       Test-Zahlung bestätigen → Bestellung bezahlt
 *   GET  /v1/markt/meine              meine Käufe und Verkäufe mit Gebühren-Aufstellung
 *   GET  /p/:id                        Teilen-Seite mit Vorschau (Open Graph), „In Ohm Studio öffnen“
 *
 * Spamschutz: Honeypot-Feld „website“, Ratenbegrenzung je Konto und IP, höchstens 2 Links pro Text,
 * gleiche Datei nicht doppelt, Mindestalter des Kontos für Kommentare (30 s). Ab 3 Meldungen
 * verschiedener Personen wird ein Eintrag automatisch verborgen, bis ein Admin entscheidet.
 */
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPayments } from './payments.mjs';

const OG_STANDARD = fileURLToPath(new URL('./og-standard.jpg', import.meta.url));
const DOWNLOAD_URL = process.env.DOWNLOAD_URL ?? 'https://github.com/lxxni09/ohm-studio/releases/latest';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const KATEGORIEN = ['Einsteiger', 'Licht', 'Sensoren', 'Smart Home', 'Spiele', 'Roboter & Motoren', 'Audio', 'Werkzeuge', 'Sonstiges'];
const MAX_OHM = 512 * 1024;
const MAX_VORSCHAU = 300 * 1024;
const AUTO_HIDE = 3;

const SEED = {
  blink: 'Einsteiger',
  ampel: 'Einsteiger',
  nachtlicht: 'Licht',
  'lauflicht-595': 'Licht',
  timer555: 'Einsteiger',
  thermometer: 'Sensoren',
  pflanzenwaechter: 'Smart Home',
  'schluessel-tuerwaechter': 'Smart Home',
  abstandswarner: 'Sensoren',
  'servo-poti': 'Roboter & Motoren',
};

export const MARKT_GEBUEHR = 0.15;

export function createGallery({ dataDir, examplesDir, adminToken = '', secret = randomBytes(32).toString('hex'), now = () => Date.now(), marketplace = process.env.MARKETPLACE === '1', payments = createPayments() }) {
  const file = join(dataDir, 'galerie.json');
  /** @type {{ konten: any[], eintraege: any[], meldungen: any[] }} */
  let db = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { konten: [], eintraege: [], meldungen: [] };
  db.angebote ??= [];
  db.bestellungen ??= [];
  const persist = () => {
    writeFileSync(file + '.tmp', JSON.stringify(db));
    renameSync(file + '.tmp', file);
  };

  // Beispiele als erste Einträge
  if (!db.eintraege.length && examplesDir && existsSync(examplesDir)) {
    let t = now() - 1000 * 60 * 60 * 24 * 30;
    for (const f of readdirSync(examplesDir).filter((x) => x.endsWith('.ohm')).sort()) {
      const key = f.replace(/\.ohm$/, '');
      const ohm = readFileSync(join(examplesDir, f), 'utf8');
      db.eintraege.push({
        id: `bsp-${key}`,
        titel: /^\s*name:\s*(.+)$/m.exec(ohm)?.[1]?.trim() ?? key,
        beschreibung: /^\s*beschreibung:\s*(.+)$/m.exec(ohm)?.[1]?.trim() ?? '',
        kategorie: SEED[key] ?? 'Sonstiges',
        autor: 'Nodaris',
        autorId: 'nodaris',
        ohm,
        hash: sha(ohm),
        vorschau: null,
        remixVon: null,
        likes: [],
        kommentare: [],
        erstellt: (t += 3600e3),
        verborgen: false,
        offiziell: true,
      });
    }
    persist();
  }

  /* ---------- Hilfen ---------- */
  function sha(s) {
    return createHash('sha256').update(s).digest('hex');
  }
  const b64u = (b) => Buffer.from(b).toString('base64url');
  function token(k) {
    const body = b64u(JSON.stringify({ sub: k.id, exp: now() + 90 * 24 * 3600e3 }));
    return `${body}.${b64u(createHmac('sha256', secret).update(body).digest())}`;
  }
  function who(req) {
    const t = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (!t) return null;
    if (adminToken && t === adminToken) return { id: 'admin', name: 'Admin', admin: true, erstellt: 0 };
    const [body, sig] = t.split('.');
    const want = createHmac('sha256', secret).update(body ?? '').digest();
    const got = Buffer.from(sig ?? '', 'base64url');
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    let s;
    try {
      s = JSON.parse(Buffer.from(body, 'base64url').toString());
    } catch {
      return null;
    }
    if (s.exp < now()) return null;
    const k = db.konten.find((x) => x.id === s.sub);
    return k && !k.gesperrt ? k : null;
  }
  const hashPw = (pw, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(pw, salt, 32).toString('hex')}`;
  const checkPw = (pw, stored) => {
    const [salt, h] = String(stored ?? '').split(':');
    if (!salt || !h) return false;
    return timingSafeEqual(Buffer.from(hashPw(pw, salt).split(':')[1], 'hex'), Buffer.from(h, 'hex'));
  };

  // Ratenbegrenzung (gleitendes Fenster, im Speicher)
  const hits = new Map();
  function limited(key, max, windowMs) {
    const t = now();
    const arr = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (arr.length >= max) {
      hits.set(key, arr);
      return true;
    }
    arr.push(t);
    hits.set(key, arr);
    return false;
  }
  const ipOf = (req) => String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? '?').split(',')[0].trim();
  const links = (s) => (String(s).match(/https?:\/\/|www\./gi) ?? []).length;
  const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

  function summary(e, me) {
    return {
      id: e.id,
      titel: e.titel,
      beschreibung: e.beschreibung,
      kategorie: e.kategorie,
      autor: e.autor,
      vorschau: e.vorschau,
      remixVon: e.remixVon,
      remixVonTitel: e.remixVon ? db.eintraege.find((x) => x.id === e.remixVon)?.titel ?? null : null,
      remixe: db.eintraege.filter((x) => x.remixVon === e.id && !x.verborgen).length,
      likes: e.likes.length,
      gefaelltMir: !!me && e.likes.includes(me.id),
      kommentare: e.kommentare.filter((k) => !k.verborgen).length,
      erstellt: e.erstellt,
      offiziell: !!e.offiziell,
      teile: (e.ohm.match(/^\s{2}[A-Za-z][\w-]*\s*:\s*\{?\s*typ:/gm) ?? []).length,
    };
  }

  async function readBody(req, max = MAX_OHM + MAX_VORSCHAU + 8192) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > max) {
          reject(Object.assign(new Error('Zu groß'), { code: 413 }));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
        } catch {
          reject(Object.assign(new Error('Ungültiges JSON'), { code: 400 }));
        }
      });
      req.on('error', reject);
    });
  }

  const send = (res, code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
    return true;
  };

  /* ---------- Anfragen ---------- */
  function publicBase(req) {
    if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
    const proto = String(req.headers['x-forwarded-proto'] ?? (req.socket?.encrypted ? 'https' : 'http')).split(',')[0];
    return `${proto}://${req.headers['x-forwarded-host'] ?? req.headers.host}`;
  }

  function sharePage(req, res, e) {
    const base = publicBase(req);
    const url = `${base}/p/${e.id}`;
    const img = `${base}/v1/galerie/${e.id}/bild`;
    const desc = e.beschreibung || `Ein Elektronik-Projekt von ${e.autor} – in Ohm Studio simulieren, remixen und als Platine bestellen.`;
    const open = `ohmstudio://galerie/${e.id}?server=${encodeURIComponent(base)}`;
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(e.titel)} – Ohm Studio</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Ohm Studio by Nodaris">
<meta property="og:title" content="${esc(e.titel)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(img)}"><meta property="og:image:alt" content="Schaltung: ${esc(e.titel)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(e.titel)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(img)}">
<style>:root{--a:#0a84ff;--bg:#f5f5f7;--fg:#1d1d1f;--m:#6e6e73;--card:#fff}@media (prefers-color-scheme:dark){:root{--bg:#000;--fg:#f5f5f7;--m:#a1a1a6;--card:#161617}}
body{margin:0;font-family:Inter,-apple-system,"Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--fg)}main{max-width:760px;margin:0 auto;padding:28px 16px 48px}
img{width:100%;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.18);background:#eceef1}h1{font-size:30px;margin:22px 0 6px;letter-spacing:-.02em}.m{color:var(--m)}
.b{display:inline-block;padding:12px 20px;border-radius:999px;background:var(--a);color:#fff;text-decoration:none;font-weight:600;margin:8px 8px 0 0}.g{background:transparent;color:var(--a);border:1px solid var(--a)}
.card{background:var(--card);border-radius:16px;padding:14px 18px;margin-top:22px;font-size:14px;line-height:1.5}</style></head>
<body><main><img src="${esc(img)}" alt="Vorschau: ${esc(e.titel)}" width="1200" height="630">
<h1>${esc(e.titel)}</h1><div class="m">von ${esc(e.autor)} · ${esc(e.kategorie)}${e.remixVon ? ' · Remix' : ''} · ♥ ${e.likes.length}</div>
${e.beschreibung ? `<p>${esc(e.beschreibung)}</p>` : ''}
<a class="b" href="${esc(open)}">In Ohm Studio öffnen</a><a class="b g" href="${esc(DOWNLOAD_URL)}">Ohm Studio für Windows laden</a><a class="b g" href="/v1/galerie/${esc(e.id)}/datei">.ohm-Datei</a>
<div class="card">Ohm Studio simuliert Elektronik wie in echt: Schaltung bauen, echten Code ausführen und die Platine bestellen. „In Ohm Studio öffnen“ funktioniert, wenn das Programm auf diesem Windows-PC installiert ist.</div>
</main></body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    res.end(html);
    return true;
  }

  async function handle(req, res, url) {
    const p = url.pathname;
    const share = /^\/p\/([\w-]{1,40})$/.exec(p);
    if (share && req.method === 'GET') {
      const e = db.eintraege.find((x) => x.id === share[1] && !x.verborgen);
      if (!e) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><meta charset="utf-8"><title>Nicht gefunden</title><p style="font-family:sans-serif">Dieses Projekt gibt es nicht (mehr).</p>');
        return true;
      }
      return sharePage(req, res, e);
    }
    if (p.startsWith('/v1/markt')) return markt(req, res, url);
    if (!p.startsWith('/v1/galerie')) return false;
    const asset = /^\/v1\/galerie\/([\w-]{1,40})\/(bild|datei)$/.exec(p);
    if (asset && req.method === 'GET') {
      const e = db.eintraege.find((x) => x.id === asset[1] && !x.verborgen);
      if (!e) return send(res, 404, { error: 'Nicht gefunden' });
      if (asset[2] === 'datei') {
        res.writeHead(200, { 'Content-Type': 'text/yaml; charset=utf-8', 'Content-Disposition': `attachment; filename="${encodeURIComponent(e.titel.replace(/[^\w äöüÄÖÜß-]+/g, '-'))}.ohm"` });
        res.end(e.ohm);
        return true;
      }
      const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(e.vorschau ?? '');
      const body = m ? Buffer.from(m[2], 'base64') : readFileSync(OG_STANDARD);
      res.writeHead(200, { 'Content-Type': m ? m[1] : 'image/jpeg', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
      res.end(body);
      return true;
    }
    try {
      const me = who(req);
      const ip = ipOf(req);

      if (p === '/v1/galerie/konto' && req.method === 'POST') {
        const b = await readBody(req, 4096);
        if (b.website) return send(res, 400, { error: 'Abgelehnt' }); // Honeypot
        if (limited(`konto:${ip}`, 5, 3600e3)) return send(res, 429, { error: 'Zu viele neue Konten von dieser Adresse. Bitte später noch einmal.' });
        const name = clean(b.name, 24);
        if (!/^[\p{L}\p{N}_.-]{3,24}$/u.test(name)) return send(res, 400, { error: 'Spitzname: 3–24 Zeichen, nur Buchstaben, Ziffern, _ . -' });
        if (/nodaris|admin|moderat/i.test(name)) return send(res, 400, { error: 'Dieser Spitzname ist reserviert.' });
        if (String(b.passwort ?? '').length < 8) return send(res, 400, { error: 'Passwort: mindestens 8 Zeichen' });
        if (!b.alterOk) return send(res, 400, { error: 'Bitte bestätige: mindestens 16 Jahre alt oder Eltern sind einverstanden.' });
        if (db.konten.some((k) => k.name.toLowerCase() === name.toLowerCase())) return send(res, 409, { error: 'Dieser Spitzname ist schon vergeben.' });
        const k = { id: randomBytes(9).toString('base64url'), name, pw: hashPw(String(b.passwort)), erstellt: now(), admin: false, gesperrt: false };
        db.konten.push(k);
        persist();
        return send(res, 201, { token: token(k), name: k.name, admin: false });
      }

      if (p === '/v1/galerie/anmelden' && req.method === 'POST') {
        const b = await readBody(req, 4096);
        if (limited(`login:${ip}`, 20, 600e3)) return send(res, 429, { error: 'Zu viele Versuche. Bitte in 10 Minuten noch einmal.' });
        const k = db.konten.find((x) => x.name.toLowerCase() === clean(b.name, 24).toLowerCase());
        if (!k || k.gesperrt || !checkPw(String(b.passwort ?? ''), k.pw)) return send(res, 401, { error: 'Spitzname oder Passwort falsch' });
        return send(res, 200, { token: token(k), name: k.name, admin: !!k.admin });
      }

      /* ----- Admin ----- */
      if (p === '/v1/galerie/admin/meldungen' && req.method === 'GET') {
        if (!me?.admin) return send(res, 403, { error: 'Nur für Admins' });
        const offen = db.meldungen.filter((m) => !m.erledigt);
        const ids = [...new Set(offen.map((m) => m.eintrag))];
        return send(res, 200, {
          eintraege: ids.map((id) => {
            const e = db.eintraege.find((x) => x.id === id);
            return e && { ...summary(e, me), verborgen: e.verborgen, meldungen: offen.filter((m) => m.eintrag === id).map((m) => ({ grund: m.grund, kommentar: m.kommentar ?? null, zeit: m.zeit })), kommentarTexte: e.kommentare.map((k) => ({ id: k.id, autor: k.autor, text: k.text, verborgen: !!k.verborgen })) };
          }).filter(Boolean),
        });
      }
      const adm = /^\/v1\/galerie\/admin\/([\w-]+)$/.exec(p);
      if (adm && req.method === 'POST') {
        if (!me?.admin) return send(res, 403, { error: 'Nur für Admins' });
        const b = await readBody(req, 4096);
        const e = db.eintraege.find((x) => x.id === adm[1]);
        if (!e) return send(res, 404, { error: 'Nicht gefunden' });
        if (b.kommentar) {
          const k = e.kommentare.find((x) => x.id === b.kommentar);
          if (k) k.verborgen = b.aktion !== 'freigeben';
        } else if (b.aktion === 'verbergen') e.verborgen = true;
        else if (b.aktion === 'freigeben') e.verborgen = false;
        else if (b.aktion === 'loeschen') db.eintraege = db.eintraege.filter((x) => x !== e);
        else return send(res, 400, { error: 'Unbekannte Aktion' });
        for (const m of db.meldungen) if (m.eintrag === e.id) m.erledigt = true;
        persist();
        return send(res, 200, { ok: true });
      }

      /* ----- Liste ----- */
      if (p === '/v1/galerie' && req.method === 'GET') {
        const q = clean(url.searchParams.get('q'), 80).toLowerCase();
        const kat = url.searchParams.get('kategorie') ?? '';
        const sort = url.searchParams.get('sort') ?? 'neu';
        const seite = Math.max(0, Number(url.searchParams.get('seite') ?? 0) || 0);
        let list = db.eintraege.filter((e) => !e.verborgen);
        if (kat) list = list.filter((e) => e.kategorie === kat);
        if (q) list = list.filter((e) => `${e.titel} ${e.beschreibung} ${e.autor} ${e.kategorie}`.toLowerCase().includes(q));
        const remixCount = (e) => db.eintraege.filter((x) => x.remixVon === e.id).length;
        list.sort((a, b) => (sort === 'beliebt' ? b.likes.length - a.likes.length : sort === 'remixe' ? remixCount(b) - remixCount(a) : 0) || b.erstellt - a.erstellt);
        return send(res, 200, { gesamt: list.length, kategorien: KATEGORIEN, eintraege: list.slice(seite * 24, seite * 24 + 24).map((e) => summary(e, me)) });
      }

      /* ----- Veröffentlichen ----- */
      if (p === '/v1/galerie' && req.method === 'POST') {
        if (!me) return send(res, 401, { error: 'Zum Veröffentlichen bitte anmelden.' });
        const b = await readBody(req);
        if (b.website) return send(res, 400, { error: 'Abgelehnt' });
        if (limited(`post:${me.id}`, 5, 3600e3) || limited(`postip:${ip}`, 20, 24 * 3600e3)) return send(res, 429, { error: 'Du hast gerade viel veröffentlicht – bitte später weitermachen.' });
        const titel = clean(b.titel, 80);
        const beschreibung = clean(b.beschreibung, 1000);
        const ohm = String(b.ohm ?? '');
        if (titel.length < 3) return send(res, 400, { error: 'Bitte einen Titel mit mindestens 3 Zeichen.' });
        if (!/\bteile\s*:/.test(ohm) || ohm.length > MAX_OHM) return send(res, 400, { error: 'Das ist keine gültige .ohm-Datei (oder sie ist zu groß).' });
        if (links(titel) + links(beschreibung) > 2) return send(res, 400, { error: 'Bitte höchstens 2 Links.' });
        if (!KATEGORIEN.includes(b.kategorie)) return send(res, 400, { error: 'Unbekannte Kategorie' });
        const vorschau = typeof b.vorschau === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(b.vorschau) && b.vorschau.length <= MAX_VORSCHAU ? b.vorschau : null;
        const hash = sha(ohm);
        const dup = db.eintraege.find((e) => e.hash === hash);
        if (dup) return send(res, 409, { error: `Genau dieses Projekt gibt es schon: „${dup.titel}“. Ändere etwas, dann ist es ein Remix.`, id: dup.id });
        const remixVon = b.remixVon && db.eintraege.some((e) => e.id === b.remixVon) ? b.remixVon : null;
        const e = { id: randomBytes(6).toString('base64url'), titel, beschreibung, kategorie: b.kategorie, autor: me.name, autorId: me.id, ohm, hash, vorschau, remixVon, likes: [], kommentare: [], erstellt: now(), verborgen: false };
        db.eintraege.push(e);
        persist();
        return send(res, 201, summary(e, me));
      }

      const m = /^\/v1\/galerie\/([\w-]+)(?:\/(like|kommentar|melden))?$/.exec(p);
      if (!m) return send(res, 404, { error: 'Nicht gefunden' });
      const e = db.eintraege.find((x) => x.id === m[1]);
      if (!e || (e.verborgen && !me?.admin)) return send(res, 404, { error: 'Dieses Projekt gibt es nicht (mehr).' });

      if (!m[2] && req.method === 'GET') {
        const remixe = db.eintraege.filter((x) => x.remixVon === e.id && !x.verborgen).map((x) => ({ id: x.id, titel: x.titel, autor: x.autor }));
        return send(res, 200, { ...summary(e, me), ohm: e.ohm, remixListe: remixe, kommentarListe: e.kommentare.filter((k) => !k.verborgen).map((k) => ({ id: k.id, autor: k.autor, text: k.text, zeit: k.zeit })) });
      }
      if (m[2] === 'like' && req.method === 'POST') {
        if (!me) return send(res, 401, { error: 'Bitte anmelden' });
        const i = e.likes.indexOf(me.id);
        if (i >= 0) e.likes.splice(i, 1);
        else e.likes.push(me.id);
        persist();
        return send(res, 200, { likes: e.likes.length, gefaelltMir: i < 0 });
      }
      if (m[2] === 'kommentar' && req.method === 'POST') {
        if (!me) return send(res, 401, { error: 'Zum Kommentieren bitte anmelden.' });
        const b = await readBody(req, 8192);
        if (b.website) return send(res, 400, { error: 'Abgelehnt' });
        if (now() - me.erstellt < 30e3) return send(res, 429, { error: 'Neue Konten können nach 30 Sekunden kommentieren.' });
        if (limited(`kom:${me.id}`, 10, 600e3)) return send(res, 429, { error: 'Langsam – höchstens 10 Kommentare in 10 Minuten.' });
        const text = clean(b.text, 1000);
        if (text.length < 2) return send(res, 400, { error: 'Kommentar ist leer.' });
        if (links(text) > 2) return send(res, 400, { error: 'Bitte höchstens 2 Links.' });
        if (e.kommentare.some((k) => k.autorId === me.id && k.text === text)) return send(res, 409, { error: 'Diesen Kommentar hast du schon geschrieben.' });
        const k = { id: randomBytes(6).toString('base64url'), autor: me.name, autorId: me.id, text, zeit: now() };
        e.kommentare.push(k);
        persist();
        return send(res, 201, { id: k.id, autor: k.autor, text: k.text, zeit: k.zeit });
      }
      if (m[2] === 'melden' && req.method === 'POST') {
        const b = await readBody(req, 4096);
        if (limited(`melden:${ip}`, 10, 3600e3)) return send(res, 429, { error: 'Zu viele Meldungen – danke, wir schauen es uns an.' });
        const wer = me?.id ?? `ip:${sha(ip).slice(0, 16)}`;
        if (!db.meldungen.some((x) => x.eintrag === e.id && x.wer === wer && !x.erledigt)) {
          db.meldungen.push({ eintrag: e.id, wer, grund: clean(b.grund, 60) || 'Sonstiges', kommentar: b.kommentar ? clean(b.kommentar, 20) : undefined, zeit: now(), erledigt: false });
          const n = new Set(db.meldungen.filter((x) => x.eintrag === e.id && !x.erledigt).map((x) => x.wer)).size;
          if (n >= AUTO_HIDE && !e.offiziell) e.verborgen = true;
          persist();
        }
        return send(res, 200, { ok: true, text: 'Danke! Ein Mensch aus dem Nodaris-Team schaut sich das an.' });
      }
      return send(res, 405, { error: 'Methode nicht erlaubt' });
    } catch (err) {
      return send(res, err.code === 413 ? 413 : err.code === 400 ? 400 : 500, { error: err.code ? err.message : 'Serverfehler' });
    }
  }

  /* ---------- Marktplatz ---------- */
  const euro = (c) => (c / 100).toFixed(2).replace('.', ',') + ' €';
  function angebotOut(a) {
    const e = db.eintraege.find((x) => x.id === a.eintrag);
    return { id: a.id, eintrag: a.eintrag, titel: e?.titel ?? '?', art: a.art, preis: a.preis, preisText: euro(a.preis), verkaeufer: a.verkaeufer, gebuehr: Math.round(a.preis * MARKT_GEBUEHR), testmodus: payments.mode === 'test' };
  }
  async function markt(req, res, url) {
    const p = url.pathname;
    try {
      if (!marketplace) return send(res, 404, { error: 'Der Marktplatz ist ausgeschaltet.' });
      const me = who(req);
      if (p === '/v1/markt' && req.method === 'GET') return send(res, 200, { gebuehr: MARKT_GEBUEHR, testmodus: payments.mode === 'test', angebote: db.angebote.filter((a) => a.aktiv).map(angebotOut) });
      if (p === '/v1/markt' && req.method === 'POST') {
        if (!me) return send(res, 401, { error: 'Bitte anmelden' });
        const b = await readBody(req, 4096);
        const e = db.eintraege.find((x) => x.id === b.eintrag && !x.verborgen);
        if (!e) return send(res, 404, { error: 'Projekt nicht gefunden' });
        // Nur eigene Projekte verkaufen; Bausätze offizieller Projekte nur Nodaris (Admin)
        if (e.autorId !== me.id && !(me.admin && e.offiziell)) return send(res, 403, { error: 'Du kannst nur deine eigenen Projekte anbieten.' });
        if (e.remixVon && !me.admin) return send(res, 403, { error: 'Remixe können nicht verkauft werden – das Original gehört jemand anderem.' });
        const preis = Math.round(Number(b.preis));
        if (!['datei', 'bausatz'].includes(b.art) || !(preis >= 50 && preis <= 50000)) return send(res, 400, { error: 'Preis zwischen 0,50 € und 500 €, Art „datei“ oder „bausatz“.' });
        const a = { id: randomBytes(6).toString('base64url'), eintrag: e.id, art: b.art, preis, verkaeufer: me.admin && e.offiziell ? 'Nodaris' : me.name, verkaeuferId: me.id, aktiv: true, erstellt: now() };
        db.angebote.push(a);
        persist();
        return send(res, 201, angebotOut(a));
      }
      if (p === '/v1/markt/meine' && req.method === 'GET') {
        if (!me) return send(res, 401, { error: 'Bitte anmelden' });
        const kauf = db.bestellungen.filter((o) => o.kaeuferId === me.id);
        const verkauf = db.bestellungen.filter((o) => o.verkaeuferId === me.id && o.bezahlt);
        return send(res, 200, {
          kaeufe: kauf.map((o) => ({ id: o.id, titel: o.titel, preis: o.preis, bezahlt: o.bezahlt, art: o.art })),
          verkaeufe: verkauf.map((o) => ({ id: o.id, titel: o.titel, preis: o.preis, gebuehr: o.gebuehr, auszahlung: o.preis - o.gebuehr })),
          summe: { umsatz: verkauf.reduce((x, o) => x + o.preis, 0), gebuehren: verkauf.reduce((x, o) => x + o.gebuehr, 0), auszahlung: verkauf.reduce((x, o) => x + o.preis - o.gebuehr, 0) },
        });
      }
      const k = /^\/v1\/markt\/([\w-]+)\/kaufen$/.exec(p);
      if (k && req.method === 'POST') {
        if (!me) return send(res, 401, { error: 'Bitte anmelden' });
        const a = db.angebote.find((x) => x.id === k[1] && x.aktiv);
        if (!a) return send(res, 404, { error: 'Angebot nicht gefunden' });
        if (a.verkaeuferId === me.id) return send(res, 400, { error: 'Eigene Angebote kann man nicht kaufen.' });
        const e = db.eintraege.find((x) => x.id === a.eintrag);
        const z = payments.create(a.preis, `${a.art} ${e?.titel}`);
        const o = { id: randomBytes(6).toString('base64url'), angebot: a.id, eintrag: a.eintrag, titel: e?.titel ?? '?', art: a.art, preis: a.preis, gebuehr: Math.round(a.preis * MARKT_GEBUEHR), kaeuferId: me.id, verkaeuferId: a.verkaeuferId, zahlung: z.id, bezahlt: false, zeit: now() };
        db.bestellungen.push(o);
        persist();
        return send(res, 201, { bestellung: o.id, zahlung: z, preisText: euro(a.preis), gebuehrText: euro(o.gebuehr), auszahlungText: euro(o.preis - o.gebuehr) });
      }
      const z = /^\/v1\/markt\/zahlung\/([\w-]+)$/.exec(p);
      if (z && req.method === 'POST') {
        if (!me) return send(res, 401, { error: 'Bitte anmelden' });
        const o = db.bestellungen.find((x) => x.zahlung === z[1] && x.kaeuferId === me.id);
        if (!o) return send(res, 404, { error: 'Bestellung nicht gefunden' });
        payments.confirm(z[1]);
        o.bezahlt = true;
        persist();
        const e = db.eintraege.find((x) => x.id === o.eintrag);
        return send(res, 200, { ok: true, art: o.art, ohm: o.art === 'datei' ? e?.ohm : undefined, text: o.art === 'bausatz' ? 'Bausatz bestellt (Testmodus – es wird nichts verschickt).' : 'Gekauft (Testmodus – kein echtes Geld).' });
      }
      return send(res, 404, { error: 'Nicht gefunden' });
    } catch (err) {
      return send(res, err.code === 503 ? 503 : err.code === 413 ? 413 : err.code === 400 ? 400 : err.code === 404 ? 404 : 500, { error: err.code ? err.message : 'Serverfehler' });
    }
  }

  return {
    handle,
    /** Für den Betreiber: Konto zum Admin machen (z. B. per Kommandozeile) */
    makeAdmin(name) {
      const k = db.konten.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
      if (!k) return false;
      k.admin = true;
      persist();
      return true;
    },
    get db() {
      return db;
    },
  };
}
