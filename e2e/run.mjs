/**
 * End-to-End-Tests: bedienen Ohm Studio wie ein Mensch (Klicks, Tastatur) – in der Oberfläche
 * und im echten Desktop-Programm (Electron). Aufruf: node e2e/run.mjs   (vorher: npx vite build)
 * Ergebnis: Exit-Code 0 = alles bestanden. Bildschirmfotos landen in e2e/out/.
 */
import { chromium, _electron } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startMockClaude } from './mock-claude.mjs';
import { createGallery } from '../server/gallery.mjs';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'e2e', 'out');
mkdirSync(OUT, { recursive: true });
const results = [];
async function test(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push([true, name, Date.now() - t]);
    console.log(`✓ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push([false, name, Date.now() - t]);
    console.log(`✗ ${name}\n   ${String(e.message || e).split('\n').slice(0, 6).join('\n   ')}`);
  }
}

// Vorschau-Server für die gebaute Oberfläche
const server = spawn('npx', ['vite', 'preview', '--port', '4317', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const URL = 'http://localhost:4317/';

const browser = await chromium.launch();
async function freshPage() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('ohm.tourDone', '1');
    } catch {}
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForSelector('.toolbar');
  return { page, ctx, errors };
}
async function openExample(page, name) {
  await page.getByRole('tab', { name: 'Start' }).click();
  await page.getByRole('button', { name: 'Beispiele', exact: true }).click();
  await page.locator('button.example', { hasText: name }).first().click();
  await page.waitForTimeout(600);
}
const reading = async (page, label) => Number(await page.locator('.reading', { hasText: label }).locator('b').textContent());

await test('Programm startet ohne Fehler', async () => {
  const { page, errors, ctx } = await freshPage();
  await page.waitForTimeout(800);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(OUT, 'start.png') });
  await ctx.close();
});

await test('Beispielprojekt öffnen', async () => {
  const { page, ctx } = await freshPage();
  await openExample(page, 'Fußgängerampel');
  assert.equal(await page.locator('.rb-name b').textContent(), 'Fußgängerampel');
  assert.equal(await reading(page, 'Teile'), 12);
  assert.ok((await page.locator('[data-part]').count()) >= 12);
  await ctx.close();
});

await test('Leeres Projekt: über Start-Reiter und im Ideen-Assistenten', async () => {
  const { page, ctx } = await freshPage();
  await openExample(page, 'Fußgängerampel');
  await page.locator('.blank-btn').click();
  assert.equal(await reading(page, 'Teile'), 0);
  assert.equal(await page.locator('[data-part]').count(), 0);
  await openExample(page, 'Fußgängerampel');
  await page.locator('.idea-btn').click();
  await page.getByRole('button', { name: 'Leer starten' }).click();
  await page.waitForSelector('.modal', { state: 'detached' });
  assert.equal(await page.locator('[data-part]').count(), 0);
  await ctx.close();
});

await test('Tastenkürzel: Liste über Reiter Einstellungen, Hinweise an Knöpfen, Tasten wirken', async () => {
  const { page, ctx } = await freshPage();
  await page.getByRole('tab', { name: 'Einstellungen' }).click();
  await page.locator('.keys-btn').click();
  await page.waitForSelector('.modal .shortcuts');
  const txt = await page.locator('.modal .shortcuts').textContent();
  for (const k of ['Strg', 'Leertaste', 'Rückgängig', 'Steckbrett / Schaltplan / Platine']) assert.ok(txt.includes(k), k);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Start' }).click();
  assert.equal(await page.locator('.blank-btn').getAttribute('title'), 'Leeres Projekt (von Null anfangen) (Strg+N)');
  await page.locator('.stage').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('2');
  assert.equal(await page.locator('.rb-views button.on').getAttribute('aria-keyshortcuts'), '2');
  await ctx.close();
});

await test('Bauteile einfügen und Kabel ziehen', async () => {
  const { page, ctx } = await freshPage();
  await page.fill('input[aria-label^="Suchen"]', 'widerstand');
  await page.locator('.part-item').first().dblclick();
  await page.fill('input[aria-label^="Suchen"]', 'led');
  await page.locator('.part-item', { hasText: 'LED' }).first().dblclick();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape'); // Auswahl aufheben → Inspektor zeigt das Projekt
  assert.equal(await reading(page, 'Teile'), 2);
  const nets0 = await reading(page, 'Netze');
  // Pin anklicken, dann Ziel-Pin anklicken
  const pins = page.locator('rect.pin-hit');
  const r1 = page.locator('[data-pin="R1.2"]');
  const d1 = page.locator('[data-pin="D1.A"]');
  assert.ok((await pins.count()) >= 4, 'Pins sichtbar');
  await r1.click({ force: true });
  await d1.click({ force: true });
  await page.waitForTimeout(300);
  assert.equal(await reading(page, 'Netze'), nets0 + 1, 'ein neues Netz durch das Kabel');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  assert.equal(await reading(page, 'Netze'), nets0, 'Rückgängig entfernt das Kabel');
  await ctx.close();
});

await test('Simulieren: Blink-LED leuchtet und serielle Ausgabe erscheint', async () => {
  const { page, ctx, errors } = await freshPage();
  await openExample(page, 'Blink – das erste Programm');
  await page.click('button[title^="Start"]');
  let lit = false;
  for (let i = 0; i < 40 && !lit; i++) {
    await page.waitForTimeout(100);
    const b = await page.locator('[data-part="D1"] [data-brightness]').getAttribute('data-brightness');
    lit = Number(b) > 0.3;
  }
  assert.ok(lit, 'LED D1 leuchtet');
  await page.getByText('Serieller Monitor').first().click();
  await page.waitForTimeout(500);
  assert.match(await page.locator('.bottom-panel, .bottom').first().textContent(), /Blink gestartet/);
  await page.screenshot({ path: join(OUT, 'blink-laeuft.png') });
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Exportieren: Gerber-ZIP herunterladen und unabhängig prüfen', async () => {
  const { page, ctx } = await freshPage();
  await openExample(page, 'Fußgängerampel');
  await page.getByRole('tab', { name: 'Datei' }).click();
  await page.getByRole('button', { name: 'Exportieren & bestellen' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('button.tile', { hasText: 'Gerber-Dateien (ZIP)' }).click()]);
  const zipPath = join(OUT, 'ampel-gerber.zip');
  await dl.saveAs(zipPath);
  const dir = join(OUT, 'ampel-gerber');
  mkdirSync(dir, { recursive: true });
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', dir]);
  const py = process.env.PYTHON || 'python3';
  const out = execFileSync(py, [join(ROOT, 'scripts', 'check_gerber.py'), dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assert.match(out, /alles gültig/);
  await ctx.close();
});

await test('Absturzsicherheit: Stand übersteht Neuladen der Seite', async () => {
  const { page, ctx } = await freshPage();
  await openExample(page, 'Fußgängerampel');
  await page.waitForTimeout(1200); // automatisches Speichern
  await page.reload();
  await page.waitForSelector('.toolbar');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.rb-name b').textContent(), 'Fußgängerampel');
  await ctx.close();
});


await test('Erster Start: 60-Sekunden-Tour läuft von selbst weiter und endet mit laufendem Blink-Projekt', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForSelector('.tour-card');
  assert.match(await page.locator('.tour-step').innerText(), /1 \/ 6/);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'tour-1.png') });
  // läuft ohne Klick nach ca. 10 s weiter
  await page.waitForFunction(() => document.querySelector('.tour-step')?.textContent?.startsWith('2'), null, { timeout: 12000 });
  for (let i = 2; i < 6; i++) await page.getByRole('button', { name: 'Weiter', exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'tour-6.png') });
  await page.getByRole('button', { name: 'Los: erstes Projekt starten' }).click();
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => ({ name: globalThis.__ohm.state.project.name, sim: globalThis.__ohm.state.sim }));
  assert.equal(st.sim, 'running');
  assert.match(st.name, /Blink/);
  // kommt beim nächsten Start nicht wieder
  await page.reload();
  await page.waitForSelector('.toolbar');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.tour-card').count(), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Leeres Projekt: „Probier mal …“ öffnet den Idee-Assistenten mit der Idee', async () => {
  const { page, errors, ctx } = await freshPage();
  await page.locator('.try-chip').first().click();
  await page.waitForSelector('.idea-input');
  assert.match(await page.inputValue('.idea-input'), /dunkel/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Galerie ohne Server: ehrlicher Hinweis, die 10 offiziellen Beispiele lassen sich öffnen', async () => {
  const { page, errors, ctx } = await freshPage();
  await page.click('button.gallery-btn');
  await page.waitForSelector('.gal-note');
  assert.equal(await page.locator('.gal-card').count(), 10);
  await page.locator('.gal-card', { hasText: 'Fußgängerampel' }).click();
  await page.getByRole('button', { name: 'Öffnen und ausprobieren' }).click();
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => globalThis.__ohm.state.project.name), 'Fußgängerampel');
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Community-Galerie mit Server: Konto, Remix, Teilen mit Vorschau, Like, Kommentar, Melden, Moderation', async () => {
  let offset = 0;
  const g = createGallery({ dataDir: mkdtempSync(join(tmpdir(), 'gal-e2e-')), examplesDir: join(ROOT, 'examples'), now: () => Date.now() + offset });
  const srv = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    if (!(await g.handle(req, res, new globalThis.URL(req.url, 'http://x')))) res.writeHead(404).end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const server = `http://127.0.0.1:${srv.address().port}`;
  const { page, errors, ctx } = await freshPage();
  await page.evaluate((s) => localStorage.setItem('ohm.galerie', JSON.stringify({ server: s })), server);
  await page.reload();
  await page.waitForSelector('.toolbar');
  await page.click('button.gallery-btn');
  await page.waitForSelector('.gal-card');
  assert.equal(await page.locator('.gal-card').count(), 10);
  // Konto anlegen
  await page.getByRole('button', { name: 'Anmelden / Konto anlegen' }).click();
  await page.getByRole('button', { name: 'Neues Konto' }).click();
  await page.fill('input[aria-label="Spitzname"]', 'tester_1');
  await page.fill('input[aria-label="Passwort"]', 'geheim1234');
  await page.getByRole('button', { name: 'Konto anlegen' }).click();
  await page.waitForSelector('.idea-error');
  assert.match(await page.locator('.idea-error').innerText(), /16/);
  await page.locator('.gal-login input[type=checkbox]').check();
  await page.getByRole('button', { name: 'Konto anlegen' }).click();
  await page.waitForSelector('text=Angemeldet als');
  // Beispiel remixen
  await page.locator('.gal-card', { hasText: 'Blink – das erste Programm' }).click();
  await page.getByRole('button', { name: '↻ Remixen' }).click();
  await page.waitForTimeout(500);
  assert.match(await page.evaluate(() => globalThis.__ohm.state.project.name), /\(Remix\)/);
  await page.evaluate(() => globalThis.__ohm.setProp('D1', 'farbe', 'gruen', true));
  // teilen
  await page.click('button.gallery-btn');
  await page.getByRole('button', { name: 'Mein Projekt teilen' }).click();
  await page.waitForSelector('text=Wird als Remix von');
  await page.waitForSelector('.gal-share img.gal-thumb');
  await page.locator('.gal-share input[type=checkbox]').check();
  await page.getByRole('button', { name: 'Veröffentlichen' }).click();
  await page.waitForSelector('.gal-detail');
  assert.match(await page.locator('.gal-detail').innerText(), /Remix von/);
  await page.screenshot({ path: join(OUT, 'galerie-detail.png') });
  // Like + Kommentar (neue Konten erst nach 30 s)
  await page.getByRole('button', { name: /♥ 0/ }).click();
  await page.waitForSelector('button:has-text("♥ 1")');
  offset = 31000;
  await page.fill('input[aria-label="Kommentar"]', 'Grün sieht besser aus!');
  await page.getByRole('button', { name: 'Senden' }).click();
  await page.waitForSelector('.gal-comment:has-text("Grün sieht besser aus!")');
  // Original zeigt den Remix
  await page.getByRole('link', { name: /Blink – das erste Programm/ }).click();
  await page.waitForSelector('text=Remixe (1)');
  // Melden
  await page.selectOption('select[aria-label="Grund der Meldung"]', 'Spam oder Werbung');
  await page.getByRole('button', { name: 'Melden', exact: true }).click();
  await page.waitForSelector('text=Ein Mensch aus dem Nodaris-Team');
  // Moderation
  g.makeAdmin('tester_1');
  await page.getByRole('button', { name: 'Abmelden' }).click();
  await page.getByRole('button', { name: 'Anmelden / Konto anlegen' }).click();
  await page.fill('input[aria-label="Spitzname"]', 'tester_1');
  await page.fill('input[aria-label="Passwort"]', 'geheim1234');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await page.getByRole('button', { name: 'Meldungen prüfen' }).click();
  await page.waitForSelector('.gal-admin');
  await page.screenshot({ path: join(OUT, 'galerie-moderation.png') });
  await page.getByRole('button', { name: 'In Ordnung – freigeben' }).click();
  await page.waitForSelector('text=Keine offenen Meldungen');
  assert.deepEqual(errors, []);
  await ctx.close();
  srv.close();
});

await test('Import: KiCad-Schaltplan wählen, Bericht ansehen, öffnen und simulieren; Altium mit ehrlicher Liste', async () => {
  const { page, errors, ctx } = await freshPage();
  await page.getByRole('tab', { name: 'Datei' }).click();
  await page.getByRole('button', { name: 'Importieren (KiCad, Altium)' }).click();
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Datei wählen …' }).click()]);
  await fc.setFiles(join(ROOT, 'tests', 'fixtures', 'kicad', 'v9', 'rectifier.kicad_sch'));
  await page.waitForSelector('.imp-report');
  const rep = await page.locator('.imp-report').innerText();
  assert.match(rep, /KiCad 10\.|KiCad 9\.|KiCad \(Format/);
  assert.match(rep, /5 Bauteile übernommen/);
  await page.screenshot({ path: join(OUT, 'import-kicad.png') });
  await page.getByRole('button', { name: 'Öffnen und simulieren' }).click();
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => ({ n: globalThis.__ohm.state.project.parts.length, sim: globalThis.__ohm.state.sim, err: globalThis.__ohm.state.messages.filter((m) => m.level === 'error').length }));
  assert.deepEqual(st, { n: 5, sim: 'running', err: 0 });
  // Altium
  await page.getByRole('tab', { name: 'Datei' }).click();
  await page.getByRole('button', { name: 'Importieren (KiCad, Altium)' }).click();
  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Datei wählen …' }).click()]);
  await fc2.setFiles(join(ROOT, 'tests', 'fixtures', 'altium', 'issue22908_3_mpcie.SchDoc'));
  await page.waitForSelector('.imp-report');
  assert.match(await page.locator('.imp-report').innerText(), /Weggelassen \(\d+\)/);
  await page.screenshot({ path: join(OUT, 'import-altium.png') });
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Einnahmen standardmäßig aus: Transparenz zeigt alles aus, keine Partner-Links, kein Kaufen', async () => {
  const { page, errors, ctx } = await freshPage();
  await page.getByRole('tab', { name: 'Einstellungen' }).click();
  await page.locator('.rb-body').getByRole('button', { name: 'Transparenz' }).click();
  const txt = await page.locator('.transparency').innerText();
  assert.equal((txt.match(/– eingeschaltet/g) ?? []).length, 0, txt);
  assert.equal((txt.match(/– ausgeschaltet/g) ?? []).length, 5);
  assert.match(txt, /keine Werbung/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Einnahmen eingeschaltet (Vorschau): Kaufen im Testmodus mit 15-%-Hinweis, Bausatz, Partner-Links mit Provisionshinweis', async () => {
  const g = createGallery({ dataDir: mkdtempSync(join(tmpdir(), 'markt-e2e-')), examplesDir: join(ROOT, 'examples'), adminToken: 'adm', marketplace: true, now: () => Date.now() + 60000 });
  const srv = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    if (!(await g.handle(req, res, new globalThis.URL(req.url, 'http://x')))) res.writeHead(404).end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const server = `http://127.0.0.1:${srv.address().port}`;
  const post = async (path, body, token) => (await fetch(server + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })).json();
  const anna = (await post('/v1/galerie/konto', { name: 'anna_v', passwort: 'sicher123', alterOk: true })).token;
  const e = await post('/v1/galerie', { titel: 'Annas Lichtwecker', kategorie: 'Licht', ohm: 'ohm: 1\nprojekt:\n  name: Annas Lichtwecker\nteile:\n  R1: { typ: widerstand, wert: 220 }\n' }, anna);
  await post('/v1/markt', { eintrag: e.id, art: 'datei', preis: 299 }, anna);
  await post('/v1/markt', { eintrag: 'bsp-ampel', art: 'bausatz', preis: 1490 }, 'adm');
  const { page, errors, ctx } = await freshPage();
  await page.evaluate((s) => {
    localStorage.setItem('ohm.galerie', JSON.stringify({ server: s }));
    localStorage.setItem('ohm.business.vorschau', JSON.stringify({ partnerLinks: true, kits: true, marketplace: true, tag_lcsc: 'nodaris-test' }));
  }, server);
  await page.reload();
  await page.waitForSelector('.toolbar');
  // Konto anlegen und kaufen
  await page.click('button.gallery-btn');
  await page.getByRole('button', { name: 'Anmelden / Konto anlegen' }).click();
  await page.getByRole('button', { name: 'Neues Konto' }).click();
  await page.fill('input[aria-label="Spitzname"]', 'ben_v');
  await page.fill('input[aria-label="Passwort"]', 'geheim1234');
  await page.locator('.gal-login input[type=checkbox]').check();
  await page.getByRole('button', { name: 'Konto anlegen' }).click();
  await page.waitForSelector('text=Angemeldet als');
  await page.locator('.gal-card', { hasText: 'Annas Lichtwecker' }).click();
  await page.waitForSelector('.market-offer');
  const offer = await page.locator('.market').innerText();
  assert.match(offer, /Kaufen – 2,99 €/);
  assert.match(offer, /15 % davon gehen an Nodaris/);
  assert.match(offer, /Testmodus – es wird kein echtes Geld bewegt/);
  await page.screenshot({ path: join(OUT, 'markt-kaufen.png') });
  await page.getByRole('button', { name: 'Kaufen – 2,99 €' }).click();
  await page.waitForSelector('text=davon 0,45 € für Nodaris');
  await page.getByRole('button', { name: 'Test-Zahlung bestätigen' }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => globalThis.__ohm.state.project.name), 'Annas Lichtwecker');
  // Bausatz für offizielles Beispiel
  await page.click('button.gallery-btn');
  await page.locator('.gal-card', { hasText: 'Fußgängerampel' }).click();
  await page.waitForSelector('text=Als Bausatz kaufen – 14,90 €');
  // Partner-Links im Idee-Assistenten mit Provisionshinweis
  await page.locator('.modal-head button[aria-label="Schließen"]').click();
  await page.click('button.idea-btn');
  await page.fill('.idea-input', 'Ampel mit Fußgängertaste');
  await page.getByRole('button', { name: 'Los geht’s' }).click();
  await page.getByRole('button', { name: 'Projekt bauen' }).click();
  await page.waitForSelector('[data-verdict="ok"]', { timeout: 30000 });
  await page.getByRole('button', { name: 'Weiter →' }).click();
  await page.getByRole('button', { name: 'Öffnen und simulieren' }).click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Weiter →' }).click();
  await page.waitForSelector('.partner-box', { timeout: 10000 });
  const pb = await page.locator('.partner-box').innerText();
  assert.match(pb, /LCSC \*/);
  assert.match(pb, /Nodaris erhält eine Provision, für dich ändert sich der Preis nicht/);
  await page.screenshot({ path: join(OUT, 'partner-links.png') });
  assert.deepEqual(errors, []);
  await ctx.close();
  srv.close();
});

await test('Barrierefreiheit (axe-core, WCAG 2 A/AA): Startseite hell und dunkel, Idee-Assistent, Galerie, Import, Transparenz ohne Verstöße', async () => {
  const { readFileSync } = await import('node:fs');
  const axe = readFileSync(join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
  const { page, errors, ctx } = await freshPage();
  const check = async (name) => {
    await page.addScriptTag({ content: axe });
    const v = await page.evaluate(async () => (await globalThis.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] }, resultTypes: ['violations'] })).violations.map((x) => `${x.id} (${x.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')})`));
    assert.deepEqual(v, [], name);
  };
  await check('Start hell');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(200);
  await check('Start dunkel');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.click('button.idea-btn');
  await check('Idee-Assistent');
  await page.keyboard.press('Escape');
  await page.click('button.gallery-btn');
  await page.waitForSelector('.gal-card');
  await check('Galerie');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Datei' }).click();
  await page.getByRole('button', { name: 'Importieren (KiCad, Altium)' }).click();
  await check('Import');
  assert.deepEqual(errors, []);
  await ctx.close();
});

await test('Idee-Assistent mit KI (Nachbau der Claude-API): Rückfrage, Bauen, Selbstprüfung mit Reparatur, Platine, Kosten', async () => {
  const mock = await startMockClaude();
  const { page, errors, ctx } = await freshPage();
  await page.evaluate((url) => localStorage.setItem('ohm.org', JSON.stringify({ aiEndpoint: url })), mock.url);
  await page.reload();
  await page.waitForSelector('.toolbar');
  await page.click('button.idea-btn');
  await page.fill('.idea-input', 'Ein Licht, das bei Dunkelheit angeht');
  await page.getByRole('button', { name: 'Los geht’s' }).click();
  await page.waitForSelector('.idea-q-title:has-text("Wie bekommt es Strom?")');
  await page.locator('.idea-q button', { hasText: 'USB' }).click();
  await page.getByRole('button', { name: 'Projekt bauen' }).click();
  await page.waitForSelector('[data-verdict="ok"]', { timeout: 30000 });
  const list = await page.locator('.idea-list').first().innerText();
  assert.match(list, /Erster Entwurf: [1-9]\d* Problem/, 'erster Entwurf soll Probleme haben');
  assert.match(list, /Reparatur 1: keine Probleme/);
  assert.deepEqual(mock.log.map((l) => l.kind), ['fragen', 'kaputt', 'repariert']);
  assert.ok(mock.log.every((l) => l.model === 'claude-opus-5-5' && l.stream && l.thinking === 'adaptive'));
  await page.screenshot({ path: join(OUT, 'idee-pruefung.png') });
  await page.getByRole('button', { name: 'Weiter →' }).click();
  await page.getByRole('button', { name: 'Öffnen und simulieren' }).click();
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => globalThis.__ohm.state.project.name), 'Dämmerungslicht');
  await page.getByRole('button', { name: 'Weiter →' }).click();
  await page.waitForSelector('text=alle Verbindungen geroutet');
  await page.getByRole('button', { name: 'Weiter →' }).click();
  await page.waitForSelector('text=Gehäuse zum 3D-Drucken');
  await page.getByRole('button', { name: 'Weiter →' }).click();
  const rows = await page.locator('.idea-table tbody tr').count();
  assert.equal(rows, 3);
  await page.screenshot({ path: join(OUT, 'idee-kosten.png') });
  await page.getByRole('button', { name: 'Weiter →' }).click();
  await page.waitForSelector('text=Eltern');
  assert.deepEqual(errors, []);
  await ctx.close();
  mock.close();
});

await test('Idee-Assistent ohne KI-Schlüssel: startet mit der besten Vorlage', async () => {
  const { page, errors, ctx } = await freshPage();
  await page.click('button.idea-btn');
  await page.fill('.idea-input', 'Ein Warner, der piept, wenn die Pflanze Wasser braucht');
  await page.getByRole('button', { name: 'Los geht’s' }).click();
  await page.getByRole('button', { name: 'Projekt bauen' }).click();
  await page.waitForSelector('[data-verdict="ok"]', { timeout: 30000 });
  assert.match(await page.locator('.idea-body').innerText(), /Vorlage: „Pflanzenwächter/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await browser.close();
server.kill();

// ---------- Echtes Desktop-Programm ----------
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
if (existsSync(ELECTRON)) {
  await test('Desktop: startet, Titel, Menüleiste, kein Neuladen mit F5', async () => {
    const t0 = Date.now();
    const app = await _electron.launch({ executablePath: ELECTRON, args: ['--no-sandbox', ROOT, join(ROOT, 'examples', 'ampel.ohm')], cwd: ROOT });
    let win;
    for (let i = 0; i < 60 && !win; i++) {
      win = app.windows().find((w) => w.url().startsWith('app://'));
      if (!win) await new Promise((r) => setTimeout(r, 100));
    }
    await win.waitForSelector('.toolbar');
    const startMs = Date.now() - t0;
    await win.waitForTimeout(1200);
    const titles = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()));
    assert.ok(titles.some((t) => t.includes('Fußgängerampel')), `Fenstertitel ${titles}`);
    assert.equal(await win.$$eval('.rb-tab', (b) => b.map((x) => x.textContent).join(',')), 'Datei,Start,Simulation,Platine & Fertigung,Analyse & KI,Team,Einstellungen,Hilfe');
    // Einstellungen über die Leiste erreichbar (früher schnitt die Leiste das Menü ab)
    await win.getByRole('tab', { name: 'Einstellungen' }).click();
    await win.locator('.rb-body').getByRole('button', { name: 'Emulatoren' }).click();
    await win.waitForSelector('.modal:has-text("Echter ESP32")');
    await win.keyboard.press('Escape');
    assert.deepEqual(await win.evaluate(() => window.__ohmDesk.menuItemsWithoutAction()), [], 'jeder Menüpunkt hat eine Aktion');
    await win.evaluate(() => (window.__marke = 1));
    await win.keyboard.press('F5');
    await win.keyboard.press('Control+r');
    await win.waitForTimeout(600);
    assert.equal(await win.evaluate(() => window.__marke), 1, 'F5/Strg+R laden nicht neu');
    assert.equal(await win.evaluate(() => getComputedStyle(document.body).userSelect), 'none');
    await win.screenshot({ path: join(OUT, 'desktop.png') });
    console.log(`   Start bis Fenster bereit: ${startMs} ms`);
    await app.close();
  });

  const launch = async (args) => {
    const app = await _electron.launch({ executablePath: ELECTRON, args: ['--no-sandbox', ROOT, ...args], cwd: ROOT });
    let win;
    for (let i = 0; i < 80 && !win; i++) {
      win = app.windows().find((w) => w.url().startsWith('app://'));
      if (!win) await new Promise((r) => setTimeout(r, 100));
    }
    await win.waitForSelector('.toolbar');
    return { app, win };
  };

  await test('Desktop: Link ohmstudio://galerie/… öffnet das Projekt in der Galerie', async () => {
    const { app, win } = await launch(['ohmstudio://galerie/bsp-ampel']);
    try {
      await win.waitForSelector('.gal-detail', { timeout: 10000 });
      assert.match(await win.locator('.gal-detail h3').innerText(), /Fußgängerampel/);
    } finally {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    }
  });
}

const failed = results.filter((r) => !r[0]).length;
writeFileSync(join(OUT, 'ergebnis.json'), JSON.stringify(results, null, 1));
console.log(`\n${results.length - failed} von ${results.length} End-to-End-Tests bestanden`);
process.exit(failed ? 1 : 0);
