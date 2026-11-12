/**
 * Firmenfunktionen des Nodaris-Servers (ohne Abhängigkeiten):
 *  - Anmeldung: lokale Konten (scrypt) mit Zwei-Faktor (TOTP, RFC 6238) und Single Sign-On per OpenID Connect (PKCE)
 *  - Sitzungstoken: HMAC-SHA256-signiert, 12 h gültig
 *  - SCIM 2.0: /scim/v2/Users, /scim/v2/Groups (Bearer-Token) – automatische Benutzerverwaltung
 *  - Projektspeicher: AES-256-GCM verschlüsselt auf der Platte
 *  - Audit-Log für alle schreibenden Aktionen
 *
 * Umgebungsvariablen:
 *   SESSION_SECRET   (Pflicht in Produktion) Schlüssel für Sitzungstoken
 *   DATA_KEY         64 Hex-Zeichen = AES-256-Schlüssel für Projektdaten
 *   SCIM_TOKEN       Bearer-Token für den SCIM-Endpunkt
 *   OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, PUBLIC_URL   (z. B. Entra ID, Google Workspace, Okta, Keycloak)
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, createPublicKey, randomBytes, randomUUID, scryptSync, timingSafeEqual, verify as cverify } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function createEnterprise({ dataDir, audit }) {
  const SECRET = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
  const DATA_KEY = process.env.DATA_KEY ? Buffer.from(process.env.DATA_KEY, 'hex') : null;
  const SCIM_TOKEN = process.env.SCIM_TOKEN || '';
  const OIDC = process.env.OIDC_ISSUER ? { issuer: process.env.OIDC_ISSUER.replace(/\/$/, ''), id: process.env.OIDC_CLIENT_ID, secret: process.env.OIDC_CLIENT_SECRET, pub: (process.env.PUBLIC_URL || '').replace(/\/$/, '') } : null;
  const usersFile = join(dataDir, 'users.json');
  const groupsFile = join(dataDir, 'groups.json');
  const projDir = join(dataDir, 'projects');
  mkdirSync(projDir, { recursive: true });

  const load = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : []);
  const save = (f, v) => writeFileSync(f, JSON.stringify(v, null, 2));
  let users = load(usersFile);
  let groups = load(groupsFile);
  const classesFile = join(dataDir, 'classes.json');
  const classes = load(classesFile);
  const pending = new Map(); // OIDC state → { verifier, nonce, redirect }

  /* ---------- Sitzungstoken ---------- */
  const b64u = (b) => Buffer.from(b).toString('base64url');
  function issue(user) {
    const body = b64u(JSON.stringify({ sub: user.id, name: user.displayName, email: user.userName, rolle: user.rolle ?? 'bearbeiter', exp: Date.now() + 12 * 3600e3 }));
    return `${body}.${b64u(createHmac('sha256', SECRET).update(body).digest())}`;
  }
  function session(req) {
    const t = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (!t) return null;
    const [body, sig] = t.split('.');
    const want = createHmac('sha256', SECRET).update(body ?? '').digest();
    const got = Buffer.from(sig ?? '', 'base64url');
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    const s = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (s.exp < Date.now()) return null;
    const u = users.find((x) => x.id === s.sub);
    return u && u.active !== false ? s : null;
  }

  /* ---------- Passwörter & TOTP ---------- */
  const hashPw = (pw, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(pw, salt, 32).toString('hex')}`;
  const checkPw = (pw, stored) => {
    const [salt, h] = String(stored ?? '').split(':');
    if (!salt || !h) return false;
    const a = Buffer.from(hashPw(pw, salt).split(':')[1], 'hex');
    return timingSafeEqual(a, Buffer.from(h, 'hex'));
  };
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const b32enc = (buf) => {
    let bits = '';
    for (const b of buf) bits += b.toString(2).padStart(8, '0');
    return bits.match(/.{1,5}/g).map((c) => B32[parseInt(c.padEnd(5, '0'), 2)]).join('');
  };
  const b32dec = (s) => {
    let bits = '';
    for (const c of s.replace(/=+$/, '').toUpperCase()) bits += B32.indexOf(c).toString(2).padStart(5, '0');
    return Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  };
  function totp(secret, t = Date.now(), step = 30) {
    const ctr = Buffer.alloc(8);
    ctr.writeBigUInt64BE(BigInt(Math.floor(t / 1000 / step)));
    const h = createHmac('sha1', b32dec(secret)).update(ctr).digest();
    const o = h[h.length - 1] & 15;
    return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
  }
  const checkTotp = (secret, code) => [-1, 0, 1].some((w) => totp(secret, Date.now() + w * 30000) === String(code));

  /* ---------- Verschlüsselung ---------- */
  function encrypt(text) {
    if (!DATA_KEY) return Buffer.from('PLAIN:' + text);
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', DATA_KEY, iv);
    const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
    return Buffer.concat([Buffer.from('AES1'), iv, c.getAuthTag(), enc]);
  }
  function decrypt(buf) {
    if (buf.subarray(0, 6).toString() === 'PLAIN:') return buf.subarray(6).toString('utf8');
    if (!DATA_KEY) throw new Error('DATA_KEY fehlt');
    const d = createDecipheriv('aes-256-gcm', DATA_KEY, buf.subarray(4, 16));
    d.setAuthTag(buf.subarray(16, 32));
    return Buffer.concat([d.update(buf.subarray(32)), d.final()]).toString('utf8');
  }

  /* ---------- OIDC ---------- */
  let discovery = null;
  async function disc() {
    discovery ??= await (await fetch(`${OIDC.issuer}/.well-known/openid-configuration`)).json();
    return discovery;
  }
  async function verifyIdToken(idToken, nonce) {
    const [h, p, s] = idToken.split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    const jwks = await (await fetch((await disc()).jwks_uri)).json();
    const jwk = jwks.keys.find((k) => k.kid === header.kid) ?? jwks.keys[0];
    const alg = { RS256: 'sha256', RS384: 'sha384', RS512: 'sha512', ES256: 'sha256' }[header.alg];
    if (!alg) throw new Error(`Algorithmus ${header.alg} nicht unterstützt`);
    const ok = cverify(alg, Buffer.from(`${h}.${p}`), { key: createPublicKey({ key: jwk, format: 'jwk' }), ...(header.alg === 'ES256' ? { dsaEncoding: 'ieee-p1363' } : {}) }, Buffer.from(s, 'base64url'));
    if (!ok) throw new Error('Signatur ungültig');
    if (payload.iss.replace(/\/$/, '') !== OIDC.issuer) throw new Error('Aussteller passt nicht');
    if (![].concat(payload.aud).includes(OIDC.id)) throw new Error('Zielgruppe passt nicht');
    if (payload.exp * 1000 < Date.now()) throw new Error('abgelaufen');
    if (payload.nonce !== nonce) throw new Error('Nonce passt nicht');
    return payload;
  }

  function upsertUser(fields) {
    let u = users.find((x) => (fields.externalId && x.externalId === fields.externalId) || x.userName === fields.userName);
    if (!u) {
      u = { id: randomUUID(), active: true, rolle: 'bearbeiter', created: new Date().toISOString(), ...fields };
      users.push(u);
    } else Object.assign(u, fields);
    save(usersFile, users);
    return u;
  }

  /* ---------- SCIM ---------- */
  const scimUser = (u) => ({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], id: u.id, externalId: u.externalId, userName: u.userName, displayName: u.displayName, active: u.active !== false, emails: [{ value: u.userName, primary: true }], meta: { resourceType: 'User', created: u.created } });
  const scimGroup = (g) => ({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], id: g.id, displayName: g.displayName, members: g.members ?? [], meta: { resourceType: 'Group' } });
  const list = (items) => ({ schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'], totalResults: items.length, startIndex: 1, itemsPerPage: items.length, Resources: items });

  /* ---------- Routen ---------- */
  const readBody = (req) =>
    new Promise((res, rej) => {
      let b = '';
      req.on('data', (c) => {
        b += c;
        if (b.length > 2e7) req.destroy();
      });
      req.on('end', () => {
        try {
          res(b ? JSON.parse(b) : {});
        } catch (e) {
          rej(e);
        }
      });
    });
  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };

  /** liefert true, wenn die Anfrage behandelt wurde */
  async function handle(req, res, url) {
    const path = url.pathname;
    try {
      /* ----- Anmeldung ----- */
      if (path === '/auth/config') return send(res, 200, { sso: !!OIDC, lokal: true, zweiFaktor: true }), true;
      if (path === '/auth/register' && req.method === 'POST') {
        const b = await readBody(req);
        if (users.length && !(session(req)?.rolle === 'admin')) return send(res, 403, { error: 'Nur Admins legen Konten an (das erste Konto wird Admin).' }), true;
        if (!b.email || !b.passwort || String(b.passwort).length < 10) return send(res, 400, { error: 'E-Mail und Passwort (mind. 10 Zeichen) nötig' }), true;
        const u = upsertUser({ userName: String(b.email).toLowerCase(), displayName: String(b.name ?? b.email), pw: hashPw(String(b.passwort)), rolle: users.length ? b.rolle ?? 'bearbeiter' : 'admin' });
        audit({ wer: u.userName, aktion: 'konto.angelegt' });
        return send(res, 201, { id: u.id, rolle: u.rolle }), true;
      }
      if (path === '/auth/login' && req.method === 'POST') {
        const b = await readBody(req);
        const u = users.find((x) => x.userName === String(b.email ?? '').toLowerCase());
        if (!u || u.active === false || !checkPw(String(b.passwort ?? ''), u.pw)) {
          audit({ wer: String(b.email ?? '?'), aktion: 'anmeldung.fehlgeschlagen' });
          return send(res, 401, { error: 'E-Mail oder Passwort falsch' }), true;
        }
        if (u.totp && !checkTotp(u.totp, b.code)) return send(res, 401, { error: 'Zwei-Faktor-Code erforderlich', zweiFaktor: true }), true;
        audit({ wer: u.userName, aktion: 'anmeldung' });
        return send(res, 200, { token: issue(u), name: u.displayName, rolle: u.rolle }), true;
      }
      if (path === '/auth/2fa/setup' && req.method === 'POST') {
        const s = session(req);
        if (!s) return send(res, 401, { error: 'Anmeldung nötig' }), true;
        const secret = b32enc(randomBytes(20));
        const u = users.find((x) => x.id === s.sub);
        u.totpPending = secret;
        save(usersFile, users);
        return send(res, 200, { secret, uri: `otpauth://totp/Nodaris:${encodeURIComponent(u.userName)}?secret=${secret}&issuer=Nodaris` }), true;
      }
      if (path === '/auth/2fa/enable' && req.method === 'POST') {
        const s = session(req);
        const b = await readBody(req);
        const u = s && users.find((x) => x.id === s.sub);
        if (!u?.totpPending || !checkTotp(u.totpPending, b.code)) return send(res, 400, { error: 'Code passt nicht' }), true;
        u.totp = u.totpPending;
        delete u.totpPending;
        save(usersFile, users);
        audit({ wer: u.userName, aktion: '2fa.aktiviert' });
        return send(res, 200, { ok: true }), true;
      }
      if (path === '/auth/me') {
        const s = session(req);
        return send(res, s ? 200 : 401, s ?? { error: 'nicht angemeldet' }), true;
      }
      if (path === '/auth/sso' && OIDC) {
        const d = await disc();
        const st = randomBytes(16).toString('hex');
        const verifier = randomBytes(32).toString('base64url');
        const nonce = randomBytes(16).toString('hex');
        pending.set(st, { verifier, nonce, back: url.searchParams.get('zurueck') || '/' });
        setTimeout(() => pending.delete(st), 600e3);
        const q = new URLSearchParams({ response_type: 'code', client_id: OIDC.id, redirect_uri: `${OIDC.pub}/auth/callback`, scope: 'openid email profile', state: st, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
        res.writeHead(302, { Location: `${d.authorization_endpoint}?${q}` });
        res.end();
        return true;
      }
      if (path === '/auth/callback' && OIDC) {
        const p = pending.get(url.searchParams.get('state') ?? '');
        if (!p) return send(res, 400, 'Anmeldung abgelaufen – bitte erneut versuchen.', 'text/plain; charset=utf-8'), true;
        pending.delete(url.searchParams.get('state'));
        const d = await disc();
        const tok = await (
          await fetch(d.token_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'authorization_code', code: url.searchParams.get('code') ?? '', redirect_uri: `${OIDC.pub}/auth/callback`, client_id: OIDC.id, client_secret: OIDC.secret ?? '', code_verifier: p.verifier }),
          })
        ).json();
        const claims = await verifyIdToken(tok.id_token, p.nonce);
        const u = upsertUser({ externalId: claims.sub, userName: String(claims.email ?? claims.preferred_username ?? claims.sub).toLowerCase(), displayName: claims.name ?? claims.email });
        if (u.active === false) return send(res, 403, 'Konto deaktiviert.', 'text/plain; charset=utf-8'), true;
        audit({ wer: u.userName, aktion: 'anmeldung.sso' });
        const t = issue(u);
        // Token als Fragment zurück an die App (Web) bzw. zum Kopieren (Desktop)
        return send(res, 200, `<!doctype html><meta charset="utf-8"><title>Angemeldet</title><body style="font:15px system-ui;padding:40px;text-align:center"><h2>Angemeldet bei Nodaris</h2><p>Du kannst dieses Fenster schließen. Falls Ohm Studio nicht automatisch fortfährt, kopiere diesen Code in die App:</p><textarea readonly style="width:90%;height:90px">${t}</textarea><script>try{window.opener&&window.opener.postMessage({nodarisToken:${JSON.stringify(t)}},'*');}catch(e){};if(${JSON.stringify(p.back)}.startsWith('/'))location.hash='';</script>`, 'text/html; charset=utf-8'), true;
      }

      /* ----- SCIM ----- */
      if (path.startsWith('/scim/v2/')) {
        if (!SCIM_TOKEN || req.headers.authorization !== `Bearer ${SCIM_TOKEN}`) return send(res, 401, { schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: '401', detail: 'Ungültiges Token' }), true;
        const m = /^\/scim\/v2\/(Users|Groups)(?:\/([\w-]+))?$/.exec(path);
        if (path === '/scim/v2/ServiceProviderConfig') return send(res, 200, { schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'], patch: { supported: true }, bulk: { supported: false }, filter: { supported: true, maxResults: 200 }, changePassword: { supported: false }, sort: { supported: false }, etag: { supported: false }, authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Bearer' }] }), true;
        if (!m) return send(res, 404, { detail: 'unbekannt' }), true;
        const [, kind, id] = m;
        const coll = kind === 'Users' ? users : groups;
        const fmt = kind === 'Users' ? scimUser : scimGroup;
        const file = kind === 'Users' ? usersFile : groupsFile;
        if (req.method === 'GET' && !id) {
          const f = /(\w+) eq "([^"]*)"/.exec(url.searchParams.get('filter') ?? '');
          return send(res, 200, list(coll.filter((x) => !f || String(x[f[1]] ?? '').toLowerCase() === f[2].toLowerCase()).map(fmt))), true;
        }
        const item = id && coll.find((x) => x.id === id);
        if (req.method === 'GET') return item ? send(res, 200, fmt(item)) : send(res, 404, { detail: 'nicht gefunden' }), true;
        if (req.method === 'POST') {
          const b = await readBody(req);
          const n = kind === 'Users' ? upsertUser({ externalId: b.externalId, userName: String(b.userName).toLowerCase(), displayName: b.displayName ?? b.name?.formatted ?? b.userName, active: b.active !== false }) : { id: randomUUID(), displayName: b.displayName, members: b.members ?? [] };
          if (kind === 'Groups') {
            groups.push(n);
            save(file, groups);
          }
          audit({ wer: 'scim', aktion: `scim.${kind}.angelegt`, details: { id: n.id } });
          return send(res, 201, fmt(n)), true;
        }
        if (!item) return send(res, 404, { detail: 'nicht gefunden' }), true;
        if (req.method === 'PUT') {
          const b = await readBody(req);
          Object.assign(item, kind === 'Users' ? { userName: String(b.userName ?? item.userName).toLowerCase(), displayName: b.displayName ?? item.displayName, active: b.active !== false, externalId: b.externalId ?? item.externalId } : { displayName: b.displayName, members: b.members ?? [] });
        } else if (req.method === 'PATCH') {
          const b = await readBody(req);
          for (const op of b.Operations ?? []) {
            const o = String(op.op).toLowerCase();
            if (op.path === 'active' || (op.value && typeof op.value === 'object' && 'active' in op.value)) item.active = op.path ? !!op.value : !!op.value.active;
            else if (op.path === 'members' && o === 'add') item.members = [...(item.members ?? []), ...op.value];
            else if (/^members/.test(op.path ?? '') && o === 'remove') {
              const vid = /value eq "([^"]+)"/.exec(op.path)?.[1];
              item.members = (item.members ?? []).filter((x) => x.value !== vid);
            } else if (op.path && o !== 'remove') item[op.path] = op.value;
          }
        } else if (req.method === 'DELETE') {
          coll.splice(coll.indexOf(item), 1);
          save(file, coll);
          audit({ wer: 'scim', aktion: `scim.${kind}.geloescht`, details: { id } });
          return res.writeHead(204).end(), true;
        }
        save(file, coll);
        audit({ wer: 'scim', aktion: `scim.${kind}.geaendert`, details: { id } });
        return send(res, 200, fmt(item)), true;
      }

      /* ----- Klassenräume ----- */
      const cm = /^\/v1\/classes(?:\/(join|[\w-]+))?(?:\/(assignments|progress))?(?:\/([\w-]+))?(?:\/(submit))?$/.exec(path);
      if (cm) {
        const s = session(req);
        if (!s) return send(res, 401, { error: 'Anmeldung nötig' }), true;
        const [, cid, sub, aid, submit] = cm;
        const saveC = () => save(classesFile, classes);
        if (!cid && req.method === 'POST') {
          const b = await readBody(req);
          const c = { id: randomUUID(), name: String(b.name ?? 'Klasse').slice(0, 80), lehrer: s.sub, lehrerName: s.name, code: randomBytes(3).toString('hex').toUpperCase(), mitglieder: [], aufgaben: [], abgaben: [] };
          classes.push(c);
          saveC();
          audit({ wer: s.email, aktion: 'klasse.angelegt', details: { id: c.id } });
          return send(res, 201, { id: c.id, code: c.code }), true;
        }
        if (!cid) return send(res, 200, classes.filter((c) => c.lehrer === s.sub || c.mitglieder.some((m) => m.id === s.sub)).map((c) => ({ id: c.id, name: c.name, code: c.lehrer === s.sub ? c.code : undefined, lehrer: c.lehrer === s.sub, lehrerName: c.lehrerName, mitglieder: c.mitglieder.length, aufgaben: c.aufgaben.length }))), true;
        if (cid === 'join') {
          const b = await readBody(req);
          const c = classes.find((x) => x.code === String(b.code ?? '').toUpperCase().trim());
          if (!c) return send(res, 404, { error: 'Klassencode unbekannt' }), true;
          if (!c.mitglieder.some((m) => m.id === s.sub)) c.mitglieder.push({ id: s.sub, name: s.name });
          saveC();
          return send(res, 200, { id: c.id, name: c.name }), true;
        }
        const c = classes.find((x) => x.id === cid);
        if (!c) return send(res, 404, { error: 'Klasse nicht gefunden' }), true;
        const teacher = c.lehrer === s.sub;
        if (!teacher && !c.mitglieder.some((m) => m.id === s.sub)) return send(res, 403, { error: 'Kein Mitglied' }), true;
        if (sub === 'assignments' && !aid) {
          if (req.method === 'POST') {
            if (!teacher) return send(res, 403, { error: 'Nur Lehrkräfte' }), true;
            const b = await readBody(req);
            const a = { id: randomUUID(), titel: String(b.titel ?? 'Aufgabe').slice(0, 120), text: String(b.text ?? '').slice(0, 5000), kriterien: Array.isArray(b.kriterien) ? b.kriterien.slice(0, 30) : [], vorlage: String(b.vorlage ?? '').slice(0, 2e6), faellig: b.faellig ?? null };
            c.aufgaben.push(a);
            saveC();
            return send(res, 201, a), true;
          }
          const mine = (a) => c.abgaben.filter((x) => x.aufgabe === a.id && x.schueler === s.sub).sort((x, y) => y.zeit.localeCompare(x.zeit))[0];
          return send(res, 200, c.aufgaben.map((a) => ({ ...a, meine: teacher ? undefined : mine(a) && { punkte: mine(a).punkte, max: mine(a).max, zeit: mine(a).zeit } }))), true;
        }
        if (sub === 'assignments' && aid && submit && req.method === 'POST') {
          const b = await readBody(req);
          if (!c.aufgaben.some((a) => a.id === aid)) return send(res, 404, { error: 'Aufgabe nicht gefunden' }), true;
          c.abgaben.push({ aufgabe: aid, schueler: s.sub, name: s.name, punkte: Number(b.punkte) || 0, max: Number(b.max) || 0, text: String(b.text ?? '').slice(0, 2e6), zeit: new Date().toISOString() });
          saveC();
          return send(res, 201, { ok: true }), true;
        }
        if (sub === 'progress') {
          if (!teacher) return send(res, 403, { error: 'Nur Lehrkräfte' }), true;
          return send(res, 200, { mitglieder: c.mitglieder, aufgaben: c.aufgaben.map((a) => ({ id: a.id, titel: a.titel })), abgaben: c.abgaben.map(({ text, ...r }) => ({ ...r, hatProjekt: !!text })) }), true;
        }
        return send(res, 404, { error: 'unbekannt' }), true;
      }

      /* ----- Projekte (verschlüsselt) ----- */
      const pm = /^\/v1\/projects(?:\/([\w-]{1,80}))?$/.exec(path);
      if (pm) {
        const s = session(req);
        if (!s) return send(res, 401, { error: 'Anmeldung nötig' }), true;
        if (!pm[1]) return send(res, 200, readdirSync(projDir).filter((f) => f.endsWith('.ohm.enc')).map((f) => f.replace('.ohm.enc', ''))), true;
        const f = join(projDir, `${pm[1]}.ohm.enc`);
        if (req.method === 'PUT') {
          if (s.rolle === 'betrachter') return send(res, 403, { error: 'Betrachter dürfen nicht speichern' }), true;
          const b = await readBody(req);
          writeFileSync(f, encrypt(String(b.text ?? '')));
          audit({ wer: s.email, aktion: 'projekt.gespeichert', projekt: pm[1] });
          return send(res, 200, { ok: true }), true;
        }
        if (!existsSync(f)) return send(res, 404, { error: 'nicht gefunden' }), true;
        audit({ wer: s.email, aktion: 'projekt.geoeffnet', projekt: pm[1] });
        return send(res, 200, { text: decrypt(readFileSync(f)) }), true;
      }
    } catch (e) {
      return send(res, 500, { error: String(e.message ?? e) }), true;
    }
    return false;
  }

  return { handle, session, totp, encrypt, decrypt, issue };
}
