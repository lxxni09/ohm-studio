/**
 * Abnahmetest „Echter ESP32“: Der Schlüssel-Türwächter im echten Modus (arduino-cli + Espressif-QEMU)
 * im Desktop-Programm, bedient über die Oberfläche. Braucht die installierten ESP32-Werkzeuge
 * (Umgebungsvariable OHM_ESP32_TOOLS oder Einstellungen → Emulatoren). Aufruf: node e2e/esp32-tuerwaechter.mjs
 */
import { _electron } from 'playwright';
import electronPath from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'e2e', 'out');
mkdirSync(OUT, { recursive: true });
const app = await _electron.launch({ executablePath: electronPath, args: ['--no-sandbox', ROOT, join(ROOT, 'examples', 'schluessel-tuerwaechter.ohm')], cwd: ROOT, env: { ...process.env } });
let win;
for (let i = 0; i < 80 && !win; i++) {
  win = app.windows().find((w) => w.url().startsWith('app://'));
  if (!win) await new Promise((r) => setTimeout(r, 100));
}
await win.waitForSelector('.toolbar');
await win.waitForTimeout(1500);
const serial = () => win.evaluate(() => __ohm.state.serial.U1 ?? '');
const waitSerial = async (re, ms) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (re.test(await serial())) return Date.now() - t;
    await win.waitForTimeout(200);
  }
  throw new Error(`Nicht im seriellen Monitor: ${re}\n--- Ausgabe ---\n${(await serial()).slice(-1500)}`);
};
try {
  // Sprache „echter ESP32“ im Code-Bereich wählen
  await win.locator('select.speed').filter({ hasText: 'echter ESP32' }).selectOption('esp32-echt');
  await win.evaluate(() => __ohm.setProp('TAG1', 'entfernung', 0.1, true));
  await win.click('button[title^="Start"]');
  const tBoot = await waitSerial(/Tür-Wächter bereit/, 420000);
  console.log(`✓ Firmware übersetzt und im Emulator gestartet (${(tBoot / 1000).toFixed(1)} s)`);
  assert.match(await serial(), /ESP-ROM:esp32c3/, 'echter ROM-Bootloader des ESP32-C3');
  // LERNEN drücken (Taster in der Arbeitsfläche)
  // Blink-Zähler im Programm selbst (alle 5 ms), damit kein Blinken zwischen zwei Abfragen verloren geht
  await win.evaluate(() => {
    const g = globalThis;
    g.__blink = { n: 0, was: false, first: 0, last: 0 };
    setInterval(() => {
      const st = g.__ohm.engine.states.get('D1');
      const lit = !!st && st.brightness > 0.3;
      if (lit && !g.__blink.was) {
        g.__blink.n++;
        if (!g.__blink.first) g.__blink.first = performance.now();
        g.__blink.last = performance.now();
      }
      g.__blink.was = lit;
    }, 5);
  });
  const sw2 = win.locator('[data-interact="SW2|pressed|press"]');
  const b = await sw2.boundingBox();
  await win.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await win.mouse.down();
  await win.waitForTimeout(800);
  await win.mouse.up();
  await waitSerial(/Gelernt: aa:bb:cc:dd:ee:ff/, 15000);
  console.log('✓ Schlüssel gelernt (BLE-Scan gegen den simulierten Anhänger TAG1)');
  // LED-Blinken zählen über die Helligkeit von D1
  await waitSerial(/Gehe schlafen/, 20000);
  const bl = await win.evaluate(() => globalThis.__blink);
  const blinks = bl.n;
  const dauer = (bl.last - bl.first) / 1000;
  console.log(`  LED-Blinken: ${blinks}× (erstes bis letztes: ${dauer.toFixed(2)} s, Soll 0,96 s)`);
  assert.equal(blinks, 5, 'D1 blinkt 5x');
  await waitSerial(/Gehe schlafen/, 20000);
  console.log('✓ Deep-Sleep nach dem Lernfenster');
  // Schlüssel weit weg, Magnet wegziehen (Tür auf)
  await win.evaluate(() => __ohm.setProp('TAG1', 'entfernung', 20, true));
  const mag = win.locator('[data-part="MAG1"]');
  const m = await mag.boundingBox();
  await win.mouse.move(m.x + m.width / 2, m.y + m.height / 2);
  await win.mouse.down();
  await win.mouse.move(m.x + m.width / 2 + 300, m.y + m.height / 2 + 200, { steps: 10 });
  await win.mouse.up();
  const t0 = Date.now();
  await waitSerial(/Tür geöffnet - suche Schlüssel/, 15000);
  console.log('✓ Aus dem Deep-Sleep geweckt (Tür auf)');
  // Summer beobachten
  let beepAt = null;
  while (Date.now() - t0 < 8000 && beepAt === null) {
    const st = await win.evaluate(() => { const s = __ohm.engine.states.get('BZ1'); return !!(s && s.sound > 0); });
    if (st) beepAt = Date.now() - t0;
    await win.waitForTimeout(50);
  }
  await waitSerial(/ALARM: Schlüssel nicht in der Nähe/, 10000);
  console.log(`✓ ALARM, Summer piept nach ${beepAt !== null ? (beepAt / 1000).toFixed(2) + ' s' : '–'}`);
  await win.screenshot({ path: join(OUT, 'esp32-tuerwaechter.png') });
  assert.ok(beepAt !== null && beepAt < 3000, 'Summer innerhalb von 3 s');
} catch (e) {
  // In GitHub Actions als Anmerkung ausgeben (über die API lesbar, auch ohne Log-Download)
  const msg = String(e?.stack || e);
  console.error(msg);
  if (process.env.GITHUB_ACTIONS) {
    const esc = (t) => t.replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A');
    console.log(`::error title=Abnahmetest Türwächter::${esc(msg.slice(0, 3000))}`);
    let ser = '';
    try { ser = await serial(); } catch {}
    console.log(`::notice title=Serieller Monitor (Anfang)::${esc(ser.slice(0, 3500))}`);
    console.log(`::notice title=Serieller Monitor (Ende)::${esc(ser.slice(-2500))}`);
    try {
      const { readFileSync } = await import('node:fs');
      const log = readFileSync(join(process.env.OHM_ESP32_TOOLS, 'esp32.log'), 'utf8');
      console.log(`::notice title=esp32.log (Ende)::${esc(log.slice(-2500))}`);
    } catch {}
  }
  try { await win.screenshot({ path: join(OUT, 'esp32-tuerwaechter-fehler.png') }); } catch {}
  // Kurzfassung als letzte Zeile (gut sichtbar im Log)
  let bl = null;
  try { bl = await win.evaluate(() => globalThis.__blink); } catch {}
  console.log(`KURZ: ${String(e?.message ?? e).split('\n')[0].slice(0, 300)} | Blinken: ${bl ? `${bl.n}× in ${((bl.last - bl.first) / 1000).toFixed(2)} s` : '–'}`);
  await app.evaluate(({ app }) => app.exit(1)).catch(() => {});
  process.exit(1);
}
await app.evaluate(({ app }) => app.exit(0));
console.log('\nAbnahmetest Türwächter im echten ESP32-Modus: bestanden');
