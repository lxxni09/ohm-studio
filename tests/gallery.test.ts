import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-ignore – Server-Modul ohne Typen
import { createGallery } from '../server/gallery.mjs';

let clock = Date.now();
let base = '';
let srv: http.Server;
const dir = mkdtempSync(join(tmpdir(), 'galerie-'));

beforeAll(async () => {
  const g = createGallery({ dataDir: dir, examplesDir: join(__dirname, '..', 'examples'), adminToken: 'geheim-admin', now: () => clock });
  srv = http.createServer(async (req, res) => {
    if (!(await g.handle(req, res, new URL(req.url!, 'http://x')))) res.writeHead(404).end();
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
});
afterAll(() => srv.close());

async function api(path: string, body?: unknown, token?: string, ip = '10.0.0.1') {
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json()) as any };
}
const OHM = (n: number) => `ohm: 1\nprojekt:\n  name: Test ${n}\nteile:\n  R1: { typ: widerstand, wert: ${n} }\n`;

describe('Community-Galerie (Server)', () => {
  let anna = '';
  let ben = '';
  let id = '';
  it('die 10 Beispiele sind die ersten Einträge', async () => {
    const r = await api('/v1/galerie');
    expect(r.body.gesamt).toBe(10);
    expect(r.body.eintraege.every((e: any) => e.autor === 'Nodaris' && e.offiziell)).toBe(true);
    expect(r.body.kategorien).toContain('Smart Home');
  });
  it('Konto: Spitzname + Passwort, Alters-Bestätigung, Honeypot', async () => {
    expect((await api('/v1/galerie/konto', { name: 'anna_l', passwort: 'sicher123' })).status).toBe(400);
    expect((await api('/v1/galerie/konto', { name: 'bot', passwort: 'sicher123', alterOk: true, website: 'x' })).status).toBe(400);
    expect((await api('/v1/galerie/konto', { name: 'Nodaris-Team', passwort: 'sicher123', alterOk: true })).status).toBe(400);
    const a = await api('/v1/galerie/konto', { name: 'anna_l', passwort: 'sicher123', alterOk: true });
    expect(a.status).toBe(201);
    anna = a.body.token;
    expect((await api('/v1/galerie/konto', { name: 'Anna_L', passwort: 'sicher123', alterOk: true })).status).toBe(409);
    ben = (await api('/v1/galerie/konto', { name: 'ben', passwort: 'sicher123', alterOk: true }, undefined, '10.0.0.2')).body.token;
    expect((await api('/v1/galerie/anmelden', { name: 'anna_l', passwort: 'falsch!!' })).status).toBe(401);
    expect((await api('/v1/galerie/anmelden', { name: 'anna_l', passwort: 'sicher123' })).status).toBe(200);
  });
  it('veröffentlichen, doppelt abgelehnt, Spam-Links abgelehnt', async () => {
    expect((await api('/v1/galerie', { titel: 'Mein Projekt', kategorie: 'Licht', ohm: OHM(1) })).status).toBe(401);
    const r = await api('/v1/galerie', { titel: 'Mein Licht', beschreibung: 'Erstes Projekt', kategorie: 'Licht', ohm: OHM(1) }, anna);
    expect(r.status).toBe(201);
    id = r.body.id;
    expect((await api('/v1/galerie', { titel: 'Kopie', kategorie: 'Licht', ohm: OHM(1) }, ben)).status).toBe(409);
    expect((await api('/v1/galerie', { titel: 'Spam', beschreibung: 'https://a.de https://b.de www.c.de', kategorie: 'Licht', ohm: OHM(2) }, ben)).status).toBe(400);
    expect((await api('/v1/galerie', { titel: 'Kaputt', kategorie: 'Licht', ohm: 'hallo' }, ben)).status).toBe(400);
  });
  it('Remix mit Herkunft, Likes, Suche, Kategorie', async () => {
    const r = await api('/v1/galerie', { titel: 'Mein Licht – heller', kategorie: 'Licht', ohm: OHM(3), remixVon: id }, ben);
    expect(r.body.remixVon).toBe(id);
    expect(r.body.remixVonTitel).toBe('Mein Licht');
    const d = await api(`/v1/galerie/${id}`);
    expect(d.body.remixe).toBe(1);
    expect(d.body.remixListe[0].autor).toBe('ben');
    expect(d.body.ohm).toContain('teile:');
    expect((await api(`/v1/galerie/${id}/like`, {}, ben)).body).toEqual({ likes: 1, gefaelltMir: true });
    expect((await api(`/v1/galerie/${id}/like`, {}, ben)).body.likes).toBe(0);
    await api(`/v1/galerie/${id}/like`, {}, ben);
    const pop = await api('/v1/galerie?sort=beliebt&kategorie=Licht');
    expect(pop.body.eintraege[0].id).toBe(id);
    expect((await api('/v1/galerie?q=heller')).body.gesamt).toBe(1);
  });
  it('Kommentare: erst nach 30 s, Ratenbegrenzung, keine Wiederholung', async () => {
    expect((await api(`/v1/galerie/${id}/kommentar`, { text: 'Cool!' }, ben)).status).toBe(429);
    clock += 31e3;
    expect((await api(`/v1/galerie/${id}/kommentar`, { text: 'Cool!' }, ben)).status).toBe(201);
    expect((await api(`/v1/galerie/${id}/kommentar`, { text: 'Cool!' }, ben)).status).toBe(409);
    for (let i = 0; i < 9; i++) await api(`/v1/galerie/${id}/kommentar`, { text: `Kommentar ${i}` }, ben);
    expect((await api(`/v1/galerie/${id}/kommentar`, { text: 'noch einer' }, ben)).status).toBe(429);
    // 10 Versuche in 10 Minuten (auch der abgelehnte doppelte zählt) → 9 gespeichert
    expect((await api(`/v1/galerie/${id}`)).body.kommentarListe.length).toBe(9);
  });
  it('Melden: ab 3 verschiedenen Meldungen verborgen, Admin gibt wieder frei', async () => {
    await api(`/v1/galerie/${id}/melden`, { grund: 'Spam' }, undefined, '1.1.1.1');
    await api(`/v1/galerie/${id}/melden`, { grund: 'Spam' }, undefined, '1.1.1.1'); // gleiche Person zählt einmal
    await api(`/v1/galerie/${id}/melden`, { grund: 'Spam' }, undefined, '2.2.2.2');
    expect((await api(`/v1/galerie/${id}`)).status).toBe(200);
    await api(`/v1/galerie/${id}/melden`, { grund: 'Beleidigung' }, ben);
    expect((await api(`/v1/galerie/${id}`)).status).toBe(404);
    expect((await api('/v1/galerie/admin/meldungen', undefined, ben)).status).toBe(403);
    const m = await api('/v1/galerie/admin/meldungen', undefined, 'geheim-admin');
    expect(m.body.eintraege[0].meldungen.length).toBe(3);
    expect((await api(`/v1/galerie/admin/${id}`, { aktion: 'freigeben' }, 'geheim-admin')).status).toBe(200);
    expect((await api(`/v1/galerie/${id}`)).status).toBe(200);
    expect((await api('/v1/galerie/admin/meldungen', undefined, 'geheim-admin')).body.eintraege.length).toBe(0);
  });
  it('offizielle Beispiele werden durch Meldungen nicht automatisch verborgen', async () => {
    for (const ip of ['3.3.3.1', '3.3.3.2', '3.3.3.3']) await api('/v1/galerie/bsp-blink/melden', { grund: 'Spam' }, undefined, ip);
    expect((await api('/v1/galerie/bsp-blink')).status).toBe(200);
  });
});

describe('Teilen-Seite mit Vorschau', () => {
  it('liefert Open-Graph-Tags, Bild und .ohm-Datei; Text wird maskiert', async () => {
    const r = await fetch(`${base}/p/bsp-ampel`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toMatch(/<meta property="og:title" content="Fußgängerampel">/);
    expect(html).toMatch(/og:image" content="http:\/\/127\.0\.0\.1:\d+\/v1\/galerie\/bsp-ampel\/bild"/);
    expect(html).toMatch(/ohmstudio:\/\/galerie\/bsp-ampel\?server=/);
    const img = await fetch(`${base}/v1/galerie/bsp-ampel/bild`);
    expect(img.headers.get('content-type')).toBe('image/jpeg');
    expect((await img.arrayBuffer()).byteLength).toBeGreaterThan(10000);
    const f = await fetch(`${base}/v1/galerie/bsp-ampel/datei`);
    expect(await f.text()).toContain('teile:');
    expect((await fetch(`${base}/p/gibtsnicht`)).status).toBe(404);
  });
  it('maskiert HTML in Titeln (kein Einschleusen von Skripten)', async () => {
    const t = (await (await fetch(`${base}/v1/galerie/konto`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' }, body: JSON.stringify({ name: 'xss_test', passwort: 'sicher123', alterOk: true }) })).json()).token;
    const e = await (await fetch(`${base}/v1/galerie`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, 'x-forwarded-for': '9.9.9.9' }, body: JSON.stringify({ titel: '<script>alert(1)</script>', kategorie: 'Licht', ohm: 'teile:\n  R9: { typ: widerstand }\n' }) })).json();
    const html = await (await fetch(`${base}/p/${e.id}`)).text();
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
});
