// Ohm Studio by Nodaris – Desktop-Programm (Electron)
// Ziel: fühlt sich an wie ein natives Windows-Programm. Nichts darf nach Browser aussehen:
// eigene Titelleiste mit Windows-11-Fensterknöpfen und Mica, native Menüs, Kontextmenüs und Dateidialoge,
// kein Neuladen, keine Entwicklerwerkzeuge, kein Browser-Zoom, keine Navigation weg von der App.
const { app, BrowserWindow, Menu, shell, nativeTheme, protocol, net, ipcMain, dialog, screen } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const PACKAGED = app.isPackaged;
const DEVTOOLS = !PACKAGED || process.env.OHM_DEVTOOLS === '1';
const IS_WIN = process.platform === 'win32';
const TITLEBAR_H = 32;

// Eigenes Protokoll app://, damit Modul-Skripte, Fonts und Dateien sauber geladen werden (keine file://-URLs)
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const DIST = path.join(__dirname, '..', 'dist');

// Nur eine Instanz: ein zweiter Start (z. B. Doppelklick auf .ohm) übergibt die Datei an das offene Fenster
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.setAppUserModelId('com.nodaris.ohmstudio');

/* ------------------------------------------------------------------ */
/* Installationsoptionen (vom Setup-Assistenten geschrieben)           */
/* ------------------------------------------------------------------ */

function installInfo() {
  const base = { examples: true, course: true, emulator: false, autoUpdate: true, mode: 'portabel' };
  try {
    const f = path.join(path.dirname(app.getPath('exe')), 'install.json');
    if (fs.existsSync(f)) return { ...base, ...JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')) };
  } catch {
    /* Standardwerte */
  }
  return base;
}

/* ------------------------------------------------------------------ */
/* Fensterzustand merken                                               */
/* ------------------------------------------------------------------ */

const stateFile = () => path.join(app.getPath('userData'), 'fenster.json');
function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const area = screen.getDisplayMatching(b).workArea;
    if (b.width > 600 && b.height > 400 && b.x < area.x + area.width && b.y < area.y + area.height) return b;
  } catch {
    /* erster Start */
  }
  return null;
}
function saveBounds(win) {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch {
    /* egal */
  }
}

/* ------------------------------------------------------------------ */
/* Fenster                                                             */
/* ------------------------------------------------------------------ */

let win = null;
let splash = null;
let rendererReady = false;
const pendingFiles = [];
let allowClose = false;

function themeColors() {
  const dark = nativeTheme.shouldUseDarkColors;
  return { color: dark ? '#00000000' : '#00000000', symbolColor: dark ? '#f5f5f7' : '#1d1d1f', height: TITLEBAR_H };
}

function createSplash() {
  splash = new BrowserWindow({ width: 460, height: 260, frame: false, transparent: true, resizable: false, movable: true, skipTaskbar: false, alwaysOnTop: false, show: false, center: true, title: 'Ohm Studio', icon: path.join(__dirname, '..', 'build', 'icon.png'), webPreferences: { devTools: false, sandbox: true } });
  splash.loadFile(path.join(__dirname, 'splash.html'), { query: { v: app.getVersion() } });
  splash.once('ready-to-show', () => splash && !splash.isDestroyed() && splash.show());
}

function createWindow() {
  const b = loadBounds();
  win = new BrowserWindow({
    width: b?.width ?? 1440,
    height: b?.height ?? 900,
    x: b?.x,
    y: b?.y,
    minWidth: 1000,
    minHeight: 640,
    title: 'Ohm Studio by Nodaris',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    // Eigene Titelleiste im Windows-11-Stil: Inhalt bis ganz oben, echte Fensterknöpfe (inkl. Snap-Layouts) als Overlay
    titleBarStyle: 'hidden',
    titleBarOverlay: themeColors(),
    backgroundColor: IS_WIN ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7',
    backgroundMaterial: IS_WIN ? 'mica' : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: DEVTOOLS,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  if (b?.maximized) win.maximize();
  win.setMenuBarVisibility(false);
  win.loadURL('app://ohm/index.html');
  const wc = win.webContents;
  // Der Fenstertitel kommt von der App (Projektname), nicht vom HTML-<title>
  win.on('page-title-updated', (e) => e.preventDefault());

  // Kein Browser-Zoom (Strg+Mausrad, Strg +/-) und keine Zwei-Finger-Zoom-Geste – zoomen nur auf der Arbeitsfläche
  wc.setVisualZoomLevelLimits(1, 1);
  wc.on('zoom-changed', () => wc.setZoomFactor(1));

  // Browser-Tastenkürzel abfangen: Neu laden, Entwicklerwerkzeuge, Drucken, Seitenzoom, Vollbild-Browsermodus
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = String(input.key).toLowerCase();
    const ctrl = input.control || input.meta;
    const blocked =
      k === 'f5' ||
      (ctrl && k === 'r') ||
      (ctrl && ['+', '-', '=', '0', 'p', 'u'].includes(k)) ||
      (!DEVTOOLS && (k === 'f12' || (ctrl && input.shift && ['i', 'j', 'c'].includes(k))));
    if (blocked) e.preventDefault();
  });

  // Nie wegnavigieren (auch nicht beim Fallenlassen einer Datei) – Dateien öffnet die App selbst
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://ohm/')) e.preventDefault();
  });
  wc.on('will-redirect', (e, url) => {
    if (!url.startsWith('app://ohm/')) e.preventDefault();
  });
  // Links nur auf ausdrücklichen Klick im Standardbrowser öffnen; nie ein Browser-Fenster in der App
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Natives Kontextmenü für Textfelder (alles andere liefert die Oberfläche per ohm:popup)
  wc.on('context-menu', (_e, p) => {
    if (!p.isEditable) return;
    Menu.buildFromTemplate([
      { role: 'undo', label: 'Rückgängig', enabled: p.editFlags.canUndo },
      { role: 'redo', label: 'Wiederholen', enabled: p.editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', label: 'Ausschneiden', enabled: p.editFlags.canCut },
      { role: 'copy', label: 'Kopieren', enabled: p.editFlags.canCopy },
      { role: 'paste', label: 'Einfügen', enabled: p.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: 'Alles auswählen' },
    ]).popup({ window: win });
  });

  win.once('ready-to-show', () => {
    // Splash mindestens kurz zeigen, dann nahtlos wechseln
    win.show();
    if (splash && !splash.isDestroyed()) splash.destroy();
    splash = null;
  });
  // Sicherheitsnetz: falls ready-to-show ausbleibt
  setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) win.show();
    if (splash && !splash.isDestroyed()) splash.destroy();
  }, 8000);

  win.on('close', (e) => {
    saveBounds(win);
    if (allowClose || !rendererReady) return;
    e.preventDefault();
    wc.send('ohm:closeRequest');
  });
  win.on('closed', () => (win = null));
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, () => wc.send('ohm:windowState', { maximized: win.isMaximized(), fullscreen: win.isFullScreen() }));

  // Absturzsicherheit: Oberfläche abgestürzt → neu laden, das automatische Speichern stellt den Stand wieder her
  wc.on('render-process-gone', (_e, d) => {
    log(`Renderer beendet: ${d.reason}`);
    if (d.reason !== 'clean-exit' && win && !win.isDestroyed()) {
      rendererReady = false;
      win.loadURL('app://ohm/index.html#wiederhergestellt');
    }
  });
  wc.on('unresponsive', () => log('Fenster reagiert nicht'));
}

function log(msg) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'ohm-studio.log'), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* egal */
  }
}
process.on('uncaughtException', (e) => log(`Fehler: ${e.stack || e}`));

nativeTheme.on('updated', () => {
  if (win && !win.isDestroyed()) win.setTitleBarOverlay?.(themeColors());
});

/* ------------------------------------------------------------------ */
/* Dateien öffnen (Doppelklick, „Öffnen mit“, zweiter Start)           */
/* ------------------------------------------------------------------ */

function fileFromArgs(argv) {
  return argv.slice(1).find((a) => /\.(ohm|ya?ml)$/i.test(a) && fs.existsSync(a));
}
function openPath(p) {
  if (!p) return;
  try {
    const item = { path: p, name: path.basename(p), text: fs.readFileSync(p, 'utf8') };
    app.addRecentDocument?.(p);
    if (rendererReady && win) win.webContents.send('ohm:openFile', item);
    else pendingFiles.push(item);
  } catch (e) {
    log(`Datei nicht lesbar: ${p} ${e}`);
  }
}
/* Links „ohmstudio://galerie/<id>?server=…“ (z. B. „In Ohm Studio öffnen“ auf einer geteilten Projektseite) */
const pendingLinks = [];
function linkFromArgs(argv) {
  return argv.slice(1).find((a) => /^ohmstudio:\/\//i.test(a));
}
function openLink(url) {
  if (!url) return;
  let link;
  try {
    const u = new URL(url);
    const m = /^\/*galerie\/([\w-]{1,40})\/?$/.exec(`${u.host}${u.pathname}`);
    if (!m) return;
    const server = u.searchParams.get('server');
    // nur http(s)-Server zulassen
    link = { kind: 'galerie', id: m[1], server: server && /^https?:\/\/[\w.-]+(:\d+)?\/?$/.test(server) ? server : null };
  } catch {
    return;
  }
  if (rendererReady && win) win.webContents.send('ohm:openLink', link);
  else pendingLinks.push(link);
}
if (process.defaultApp) app.setAsDefaultProtocolClient('ohmstudio', process.execPath, [path.resolve(process.argv[1] ?? '.')]);
else app.setAsDefaultProtocolClient('ohmstudio');
app.on('open-url', (e, url) => {
  e.preventDefault();
  openLink(url);
});

app.on('second-instance', (_e, argv) => {
  openPath(fileFromArgs(argv));
  openLink(linkFromArgs(argv));
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.on('open-file', (e, p) => {
  e.preventDefault();
  openPath(p);
});

/* ------------------------------------------------------------------ */
/* IPC: native Bausteine für die Oberfläche                            */
/* ------------------------------------------------------------------ */

ipcMain.handle('ohm:ready', () => {
  rendererReady = true;
  const files = pendingFiles.splice(0);
  const links = pendingLinks.splice(0);
  return { files, links, install: installInfo(), version: app.getVersion(), packaged: PACKAGED, platform: process.platform, titleBarHeight: TITLEBAR_H };
});

// Natives Menü an einer Position (Titelleisten-Menüs und Kontextmenüs). Liefert die gewählte ID oder null.
ipcMain.handle('ohm:popup', (_e, items, x, y) => {
  return new Promise((resolve) => {
    let chosen = null;
    const build = (list) =>
      list.map((it) => {
        if (it.type === 'separator') return { type: 'separator' };
        return {
          label: String(it.label),
          accelerator: it.accelerator,
          registerAccelerator: false,
          enabled: it.enabled !== false,
          type: it.checked !== undefined ? 'checkbox' : undefined,
          checked: it.checked,
          submenu: it.submenu ? build(it.submenu) : undefined,
          click: it.submenu ? undefined : () => (chosen = it.id),
        };
      });
    const menu = Menu.buildFromTemplate(build(items));
    menu.popup({ window: win, x: Math.round(x), y: Math.round(y), callback: () => setTimeout(() => resolve(chosen), 0) });
  });
});

const FILTERS = {
  ohm: [{ name: 'Ohm-Studio-Projekt', extensions: ['ohm'] }],
  any: [{ name: 'Alle Dateien', extensions: ['*'] }],
};

ipcMain.handle('ohm:openDialog', async (_e, opts = {}) => {
  const r = await dialog.showOpenDialog(win, {
    title: opts.title || 'Projekt öffnen',
    defaultPath: opts.defaultPath || app.getPath('documents'),
    filters: opts.filters || [{ name: 'Ohm-Studio-Projekt', extensions: ['ohm', 'yaml', 'yml'] }, ...FILTERS.any],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  app.addRecentDocument?.(p);
  const buf = fs.readFileSync(p);
  return { path: p, name: path.basename(p), text: opts.binary ? undefined : buf.toString('utf8'), base64: opts.binary ? buf.toString('base64') : undefined };
});

ipcMain.handle('ohm:saveDialog', async (_e, name, data, opts = {}) => {
  const ext = path.extname(name).slice(1);
  const r = await dialog.showSaveDialog(win, {
    title: opts.title || 'Speichern unter',
    defaultPath: path.join(opts.dir || app.getPath('documents'), name),
    filters: ext ? [{ name: opts.kind || `${ext.toUpperCase()}-Datei`, extensions: [ext] }, ...FILTERS.any] : FILTERS.any,
  });
  if (r.canceled || !r.filePath) return null;
  writeData(r.filePath, data);
  if (ext === 'ohm') app.addRecentDocument?.(r.filePath);
  return { path: r.filePath, name: path.basename(r.filePath) };
});

ipcMain.handle('ohm:writeFile', (_e, p, data) => {
  if (!/\.(ohm|ya?ml)$/i.test(p)) throw new Error('Nur Projektdateien');
  writeData(p, data);
  return true;
});

function writeData(p, data) {
  const tmp = `${p}.speichern`;
  fs.writeFileSync(tmp, typeof data === 'string' ? data : Buffer.from(data));
  fs.renameSync(tmp, p); // atomar: bei Absturz bleibt die alte Datei heil
}

ipcMain.handle('ohm:message', async (_e, o) => {
  const r = await dialog.showMessageBox(win, { type: o.type || 'question', title: 'Ohm Studio', message: o.message, detail: o.detail, buttons: o.buttons || ['OK'], defaultId: o.defaultId ?? 0, cancelId: o.cancelId ?? (o.buttons ? o.buttons.length - 1 : 0), noLink: true });
  return r.response;
});

ipcMain.handle('ohm:setTitle', (_e, t) => {
  if (win) win.setTitle(String(t).slice(0, 200));
});
ipcMain.handle('ohm:setTheme', (_e, dark) => {
  nativeTheme.themeSource = dark === null ? 'system' : dark ? 'dark' : 'light';
  if (win) win.setTitleBarOverlay?.(themeColors());
});
ipcMain.handle('ohm:closeNow', () => {
  allowClose = true;
  if (win) win.close();
});
ipcMain.handle('ohm:window', (_e, cmd) => {
  if (!win) return;
  if (cmd === 'minimize') win.minimize();
  else if (cmd === 'maximize') (win.isMaximized() ? win.unmaximize() : win.maximize());
  else if (cmd === 'fullscreen') win.setFullScreen(!win.isFullScreen());
  else if (cmd === 'close') win.close();
});
ipcMain.handle('ohm:openExternal', (_e, url) => {
  if (/^https?:|^mailto:/.test(url)) return shell.openExternal(url);
  return false;
});
ipcMain.handle('ohm:showItem', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('ohm:paths', () => ({ documents: app.getPath('documents'), userData: app.getPath('userData'), examples: path.join(app.getPath('documents'), 'Ohm Studio', 'Beispiele') }));

/* ------------------------------------------------------------------ */
/* Native Werkzeuge (GPL-Engines und Compiler laufen als separate Prozesse) */
/* ------------------------------------------------------------------ */

const ALLOWED = ['arduino-cli', 'qemu-system-xtensa', 'qemu-system-riscv32', 'qemu-system-aarch64', 'renode', 'ngspice', 'simavr', 'pio'];
function which(cmd) {
  return new Promise((resolve) => {
    if (!ALLOWED.includes(cmd)) return resolve(null);
    execFile(IS_WIN ? 'where' : 'which', [cmd], (err, out) => resolve(err ? null : String(out).split(/\r?\n/)[0].trim() || null));
  });
}
ipcMain.handle('ohm:which', (_e, cmd) => which(String(cmd)));
ipcMain.handle('ohm:compile', async (_e, fqbn, code) => {
  const cli = await which('arduino-cli');
  if (!cli) return { ok: false, log: 'arduino-cli ist nicht installiert. Download: https://arduino.github.io/arduino-cli/' };
  if (!/^[a-z0-9_:.=,-]+$/i.test(String(fqbn))) return { ok: false, log: 'Ungültiges Board' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ohm-'));
  const sk = path.join(dir, 'sketch');
  fs.mkdirSync(sk);
  fs.writeFileSync(path.join(sk, 'sketch.ino'), String(code));
  const out = path.join(dir, 'build');
  return new Promise((resolve) => {
    execFile(cli, ['compile', '--fqbn', fqbn, '--output-dir', out, sk], { timeout: 180000, maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      const log2 = String(stdout) + String(stderr);
      if (err) return resolve({ ok: false, log: log2 });
      const hex = path.join(out, 'sketch.ino.hex');
      const uf2 = path.join(out, 'sketch.ino.uf2');
      resolve({ ok: true, log: log2, hex: fs.existsSync(hex) ? fs.readFileSync(hex, 'utf8') : undefined, uf2Base64: fs.existsSync(uf2) ? fs.readFileSync(uf2).toString('base64') : undefined });
    });
  });
});

// Echter ESP32-Modus (arduino-cli + Espressif-QEMU als eigene Prozesse)
require('./esp32.cjs').register();

/* ------------------------------------------------------------------ */
/* Automatische Updates                                                */
/* ------------------------------------------------------------------ */

let updater = null;
function getUpdater() {
  if (updater !== null) return updater || null;
  try {
    updater = require('electron-updater').autoUpdater;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
    updater.logger = { info: log, warn: log, error: log, debug: () => {} };
  } catch (e) {
    log(`Updater nicht verfügbar: ${e}`);
    updater = false;
  }
  return updater || null;
}

async function checkUpdates(interactive) {
  const u = getUpdater();
  // Nur das installierte Programm aktualisiert sich selbst (nicht die portable Version, nicht im Entwicklungsmodus)
  if (!u || !PACKAGED || process.env.PORTABLE_EXECUTABLE_DIR) return { ok: false, current: app.getVersion(), reason: 'nicht-installiert' };
  try {
    const r = await u.checkForUpdates();
    const latest = r?.updateInfo?.version;
    const newer = !!latest && latest.localeCompare(app.getVersion(), undefined, { numeric: true }) > 0;
    if (newer) {
      const a = await dialog.showMessageBox(win, { type: 'info', title: 'Ohm Studio', message: `Neue Version verfügbar: ${latest}`, detail: `Du hast Version ${app.getVersion()}. Jetzt herunterladen und installieren?`, buttons: ['Jetzt installieren', 'Später'], defaultId: 0, cancelId: 1, noLink: true });
      if (a.response === 0) {
        await u.downloadUpdate();
        const b = await dialog.showMessageBox(win, { type: 'info', title: 'Ohm Studio', message: 'Update ist bereit', detail: 'Ohm Studio wird kurz neu gestartet. Dein Projekt wurde automatisch gesichert.', buttons: ['Jetzt neu starten', 'Beim Beenden'], defaultId: 0, cancelId: 1, noLink: true });
        if (b.response === 0) {
          allowClose = true;
          u.quitAndInstall(false, true);
        }
      }
    } else if (interactive) {
      await dialog.showMessageBox(win, { type: 'info', title: 'Ohm Studio', message: 'Ohm Studio ist aktuell', detail: `Version ${app.getVersion()}`, buttons: ['OK'], noLink: true });
    }
    return { ok: true, current: app.getVersion(), latest, newer };
  } catch (e) {
    log(`Update-Prüfung fehlgeschlagen: ${e}`);
    return { ok: false, current: app.getVersion(), reason: 'nicht-erreichbar' };
  }
}
ipcMain.handle('ohm:updateCheck', (_e, channel, interactive) => {
  const u = getUpdater();
  if (u) {
    u.channel = channel === 'beta' ? 'beta' : 'latest';
    u.allowPrerelease = channel === 'beta';
  }
  return checkUpdates(!!interactive);
});

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) return new Response('verboten', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  Menu.setApplicationMenu(null);
  createSplash();
  createWindow();
  openPath(fileFromArgs(process.argv));
  openLink(linkFromArgs(process.argv));
  // Update-Suche einige Sekunden nach dem Start (abschaltbar im Setup und in den Einstellungen)
  if (installInfo().autoUpdate !== false) setTimeout(() => void checkUpdates(false), 8000);
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
