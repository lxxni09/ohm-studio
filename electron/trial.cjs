/**
 * Testphase an das Gerät gebunden: Der Start der 14-Tage-Testphase wird mit einer anonymen Geräte-Kennung
 * (Hash der Windows-MachineGuid bzw. machine-id, sonst der Netzwerkadressen) an mehreren Stellen gespeichert,
 * die eine Neuinstallation überstehen (Registry HKCU\Software\Nodaris\OhmStudio und eine Datei im Benutzerprofil).
 * Fehlt eine Stelle, wird sie wiederhergestellt. Uhr zurückgestellt oder Eintrag verändert → Testphase beendet.
 *
 * Datenschutz: Die Kennung ist ein Einweg-Hash, bleibt auf dem Rechner und wird nirgendwohin gesendet.
 * Ehrliche Grenze: Ohne Lizenzserver lässt sich das mit Aufwand umgehen (Registry und Datei löschen,
 * andere Kennung vortäuschen). Für normale Nutzer reicht es; „Neu installieren“ setzt die Testphase nicht zurück.
 */
const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ipcMain } = require('electron');

const IS_WIN = process.platform === 'win32';
const REG_KEY = 'HKCU\\Software\\Nodaris\\OhmStudio';
const REG_VAL = 'T';
const PEPPER = 'nodaris-ohm-studio-testphase-v1';
const HOUR = 3600000;

const run = (cmd, args) =>
  new Promise((res) => execFile(cmd, args, { windowsHide: true, timeout: 5000 }, (err, out) => res(err ? '' : String(out))));

let deviceCache = null;
async function deviceId() {
  if (deviceCache) return deviceCache;
  let raw = '';
  if (IS_WIN) {
    const out = await run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']);
    raw = (/MachineGuid\s+REG_SZ\s+([0-9a-f-]+)/i.exec(out) || [])[1] || '';
  } else if (process.platform === 'darwin') {
    const out = await run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
    raw = (/"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out) || [])[1] || '';
  } else {
    for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
      try {
        raw = fs.readFileSync(f, 'utf8').trim();
        if (raw) break;
      } catch {
        /* weiter */
      }
    }
  }
  if (!raw) {
    // Rückfall: MAC-Adressen der echten Netzwerkkarten
    const macs = Object.values(os.networkInterfaces())
      .flat()
      .filter((n) => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00')
      .map((n) => n.mac)
      .sort();
    raw = [...new Set(macs)].join(',') || os.hostname();
  }
  deviceCache = crypto.createHash('sha256').update(`${PEPPER}:${raw.toLowerCase()}`).digest('hex').slice(0, 32);
  return deviceCache;
}

const sign = (d, s, l) => crypto.createHmac('sha256', `${PEPPER}:${d}`).update(`${s}:${l}`).digest('hex').slice(0, 24);
const encode = (rec) => Buffer.from(JSON.stringify(rec)).toString('base64');
function decode(txt) {
  try {
    return JSON.parse(Buffer.from(String(txt).trim(), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function fileDir() {
  if (process.env.OHM_TRIAL_DIR) return process.env.OHM_TRIAL_DIR;
  if (IS_WIN) return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Nodaris');
  return path.join(os.homedir(), '.config', 'nodaris');
}
const filePath = () => path.join(fileDir(), '.ohm-t');

async function readAll() {
  const recs = [];
  try {
    recs.push(decode(fs.readFileSync(filePath(), 'utf8')));
  } catch {
    recs.push(null);
  }
  if (IS_WIN && !process.env.OHM_TRIAL_DIR) {
    const out = await run('reg', ['query', REG_KEY, '/v', REG_VAL]);
    recs.push(decode((new RegExp(`${REG_VAL}\\s+REG_SZ\\s+(\\S+)`).exec(out) || [])[1] || ''));
  }
  return recs;
}

async function writeAll(rec) {
  const txt = encode(rec);
  try {
    fs.mkdirSync(fileDir(), { recursive: true });
    fs.writeFileSync(filePath(), txt);
  } catch {
    /* egal – die andere Stelle reicht */
  }
  if (IS_WIN && !process.env.OHM_TRIAL_DIR) await run('reg', ['add', REG_KEY, '/v', REG_VAL, '/t', 'REG_SZ', '/d', txt, '/f']);
}

/** Zustand der Testphase: { start: ms|null, ended: bool, reason?, device }. startAt: Testphase ab diesem Zeitpunkt beginnen, falls noch keine läuft */
async function status(startAt = null) {
  const d = await deviceId();
  const now = Date.now();
  const recs = (await readAll()).filter(Boolean);
  let start = null;
  let lastSeen = 0;
  let ended = false;
  let reason;
  for (const r of recs) {
    if (r.d !== d) continue; // von einem anderen Rechner kopiert → zählt hier nicht
    if (r.h !== sign(r.d, r.s, r.l)) {
      ended = true;
      reason = 'verändert';
      start = start ?? 0;
      continue;
    }
    start = start === null ? r.s : Math.min(start, r.s);
    lastSeen = Math.max(lastSeen, r.l);
  }
  if (start === null && startAt !== null) start = Math.min(now, Math.max(now - 365 * 24 * HOUR, Number(startAt) || now));
  if (start !== null && !ended && lastSeen && now < lastSeen - 2 * HOUR) {
    ended = true;
    reason = 'uhr';
  }
  if (start !== null) {
    const l = Math.max(lastSeen, now);
    await writeAll({ d, s: start, l, h: sign(d, start, l) });
  }
  return { start, ended, reason, device: d.slice(0, 8) };
}

function register() {
  ipcMain.handle('ohm:trial:status', () => status(null));
  ipcMain.handle('ohm:trial:start', (_e, at) => status(typeof at === 'number' ? at : Date.now()));
}

module.exports = { register, status, deviceId, _sign: sign };
