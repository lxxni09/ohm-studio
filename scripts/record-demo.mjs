/**
 * Nimmt das Vorstellungsvideo für die Website auf – mit dem echten Programm, keine nachgestellten Bilder.
 * Aufruf: npx vite build && node scripts/record-demo.mjs   → website/media/ohm-studio-demo.webm + Vorschaubild
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { renameSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA = join(ROOT, 'website', 'media');
const TMP = join(MEDIA, '_aufnahme');
mkdirSync(TMP, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4318', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch();
const size = { width: 1280, height: 720 };
const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: TMP, size } });
await ctx.addInitScript(() => localStorage.setItem('ohm.tourDone', '1'));
const page = await ctx.newPage();
const pause = (ms) => page.waitForTimeout(ms);
try {
  await page.goto('http://localhost:4318/');
  await page.waitForSelector('.toolbar');
  await pause(1200);
  // 1) Idee eintippen
  await page.click('button.idea-btn');
  await pause(400);
  await page.locator('.idea-input').pressSequentially('Eine Ampel mit Fußgängertaste', { delay: 55 });
  await pause(500);
  await page.getByRole('button', { name: 'Los geht’s' }).click();
  await pause(1200);
  await page.getByRole('button', { name: 'Projekt bauen' }).click();
  await page.waitForSelector('[data-verdict="ok"]');
  await pause(1800);
  await page.getByRole('button', { name: 'Weiter →' }).click();
  await page.getByRole('button', { name: 'Öffnen und simulieren' }).click();
  await pause(900);
  await page.getByRole('button', { name: 'Assistent verkleinern und ausprobieren' }).click();
  await pause(1500);
  // 2) Ausprobieren: Taster drücken
  const btn = page.locator('[data-interact*="pressed"]').first();
  if (await btn.count()) {
    await btn.dispatchEvent('pointerdown');
    await pause(300);
    await btn.dispatchEvent('pointerup');
  }
  await pause(4000);
  // 3) Schaltplan und Platine
  await page.getByRole('button', { name: 'Schaltplan', exact: true }).click();
  await pause(2200);
  await page.getByRole('button', { name: 'Platine', exact: true }).click();
  await pause(2200);
  await pause(1500);
  // 4) zurück zum Assistenten: Kosten
  await page.locator('.idea-chip').click();
  await pause(1500);
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Weiter →' }).click();
    await pause(1300);
  }
  await page.screenshot({ path: join(MEDIA, 'ohm-studio-demo.png') });
  await pause(1800);
} finally {
  await ctx.close();
  await browser.close();
  server.kill();
}
const f = readdirSync(TMP).find((x) => x.endsWith('.webm'));
renameSync(join(TMP, f), join(MEDIA, 'ohm-studio-demo.webm'));
rmSync(TMP, { recursive: true, force: true });
console.log('Video gespeichert: website/media/ohm-studio-demo.webm');
