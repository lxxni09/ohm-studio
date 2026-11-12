/** Testphase am Gerät: übersteht Neuinstallation, erkennt Manipulation und zurückgestellte Uhr */
import { describe, expect, it, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const DAY = 86400000;

describe('Testphase am Gerät', () => {
  let dir: string;
  let trial: { status(at?: number | null): Promise<{ start: number | null; ended: boolean; reason?: string }>; _sign(d: string, s: number, l: number): string; deviceId(): Promise<string> };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohm-trial-'));
    process.env.OHM_TRIAL_DIR = dir;
    delete require.cache[require.resolve('../electron/trial.cjs')];
    trial = require('../electron/trial.cjs');
  });
  const file = () => join(dir, '.ohm-t');
  const rec = () => JSON.parse(Buffer.from(readFileSync(file(), 'utf8'), 'base64').toString());
  const put = (r: object) => writeFileSync(file(), Buffer.from(JSON.stringify(r)).toString('base64'));

  it('ohne Start: nichts gespeichert; Start bleibt beim ersten Zeitpunkt', async () => {
    expect((await trial.status(null)).start).toBeNull();
    const t0 = Date.now() - 3 * DAY;
    expect((await trial.status(t0)).start).toBe(t0);
    // „Neu installiert“ und neu gestartet: früherer Start gilt weiter
    expect((await trial.status(Date.now())).start).toBe(t0);
    expect((await trial.status(null)).start).toBe(t0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('veränderter Eintrag oder zurückgestellte Uhr beenden die Testphase', async () => {
    await trial.status(Date.now());
    const r = rec();
    put({ ...r, s: Date.now() + 10 * DAY }); // Startdatum nach vorn geschoben, Signatur passt nicht
    expect(await trial.status(null)).toMatchObject({ ended: true, reason: 'verändert' });
    const d = await trial.deviceId();
    const future = Date.now() + 5 * DAY;
    put({ d, s: Date.now() - DAY, l: future, h: trial._sign(d, Date.now() - DAY, future) });
    // gültig signiert, aber „zuletzt gesehen“ liegt in der Zukunft → Uhr wurde zurückgestellt
    const s2 = { d, s: Date.now() - DAY, l: future };
    put({ ...s2, h: trial._sign(d, s2.s, s2.l) });
    expect(await trial.status(null)).toMatchObject({ ended: true, reason: 'uhr' });
    rmSync(dir, { recursive: true, force: true });
  });

  it('Eintrag von einem anderen Rechner zählt nicht', async () => {
    const s = Date.now() - 20 * DAY;
    put({ d: 'anderer-rechner', s, l: s, h: trial._sign('anderer-rechner', s, s) });
    expect((await trial.status(null)).start).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});
