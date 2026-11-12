import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-ignore – Server-Module ohne Typen
import { createGallery } from '../server/gallery.mjs';
// @ts-ignore
import { createPayments } from '../server/payments.mjs';

function serve(opts: Record<string, unknown>) {
  const g = createGallery({ dataDir: mkdtempSync(join(tmpdir(), 'markt-')), examplesDir: join(__dirname, '..', 'examples'), adminToken: 'adm', now: () => Date.now() + 60_000, ...opts });
  const srv = http.createServer(async (req, res) => {
    if (!(await g.handle(req, res, new URL(req.url!, 'http://x')))) res.writeHead(404).end();
  });
  return new Promise<{ base: string; srv: http.Server }>((r) => srv.listen(0, '127.0.0.1', () => r({ base: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, srv })));
}
async function api(base: string, path: string, body?: unknown, token?: string) {
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-forwarded-for': String(Math.random()), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json()) as any };
}

describe('Marktplatz (vorbereitet, standardmäßig aus)', () => {
  it('ist ohne Schalter aus', async () => {
    const { base, srv } = await serve({});
    expect((await api(base, '/v1/markt')).status).toBe(404);
    srv.close();
  });
  let base = '';
  let srv: http.Server;
  beforeAll(async () => ({ base, srv } = await serve({ marketplace: true })));
  afterAll(() => srv.close());
  it('Verkaufen, Kaufen im Testmodus, 15 % Gebühr, Datei nach Bezahlung', async () => {
    const anna = (await api(base, '/v1/galerie/konto', { name: 'anna_m', passwort: 'sicher123', alterOk: true })).body.token;
    const ben = (await api(base, '/v1/galerie/konto', { name: 'ben_m', passwort: 'sicher123', alterOk: true })).body.token;
    const e = (await api(base, '/v1/galerie', { titel: 'Annas Uhr', kategorie: 'Werkzeuge', ohm: 'teile:\n  R1: { typ: widerstand }\n' }, anna)).body;
    expect((await api(base, '/v1/markt', { eintrag: 'bsp-blink', art: 'datei', preis: 199 }, anna)).status).toBe(403); // fremdes Projekt
    expect((await api(base, '/v1/markt', { eintrag: e.id, art: 'datei', preis: 10 }, anna)).status).toBe(400); // zu billig
    const a = (await api(base, '/v1/markt', { eintrag: e.id, art: 'datei', preis: 299 }, anna)).body;
    expect(a).toMatchObject({ preisText: '2,99 €', gebuehr: 45, verkaeufer: 'anna_m', testmodus: true });
    expect((await api(base, `/v1/markt/${a.id}/kaufen`, {}, anna)).status).toBe(400); // eigenes
    const k = (await api(base, `/v1/markt/${a.id}/kaufen`, {}, ben)).body;
    expect(k.zahlung.modus).toBe('test');
    expect(k.gebuehrText).toBe('0,45 €');
    const paid = (await api(base, `/v1/markt/zahlung/${k.zahlung.id}`, {}, ben)).body;
    expect(paid.ohm).toContain('teile:');
    const meine = (await api(base, '/v1/markt/meine', undefined, anna)).body;
    expect(meine.summe).toEqual({ umsatz: 299, gebuehren: 45, auszahlung: 254 });
  });
  it('Remixe dürfen nicht verkauft werden; offizielle Bausätze nur von Nodaris', async () => {
    const c = (await api(base, '/v1/galerie/konto', { name: 'carla_m', passwort: 'sicher123', alterOk: true })).body.token;
    const r = (await api(base, '/v1/galerie', { titel: 'Remix', kategorie: 'Licht', ohm: 'teile:\n  R7: { typ: widerstand }\n', remixVon: 'bsp-blink' }, c)).body;
    expect((await api(base, '/v1/markt', { eintrag: r.id, art: 'datei', preis: 100 }, c)).status).toBe(403);
    const kit = await api(base, '/v1/markt', { eintrag: 'bsp-ampel', art: 'bausatz', preis: 1490 }, 'adm');
    expect(kit.body.verkaeufer).toBe('Nodaris');
  });
  it('Live-Zahlungen sind absichtlich nicht eingebaut', () => {
    const p = createPayments('live');
    expect(() => p.create(100, 'x')).toThrow(/nicht eingerichtet/);
  });
});
