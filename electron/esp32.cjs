// Ohm Studio – echter ESP32-Modus im Windows-Programm.
// Übersetzt den Arduino-Sketch mit arduino-cli (ESP32-Kern von Espressif) zu echtem Maschinencode und führt ihn im
// Espressif-QEMU aus. Pins, ADC, PWM, Deep-Sleep und BLE-Scan sind über die Ohm-Studio-Brücke (UART1) mit der
// simulierten Schaltung verbunden. GPL-Programme (QEMU) laufen als eigener Prozess und werden nicht mitgeliefert,
// sondern beim ersten Gebrauch von Espressif heruntergeladen.
const { ipcMain, app } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const https = require('https');
const { StringDecoder } = require('string_decoder');

const IS_WIN = process.platform === 'win32';
const EXE = IS_WIN ? '.exe' : '';
const CORE = 'esp32:esp32@3.3.12';
const INDEX = 'https://espressif.github.io/arduino-esp32/package_esp32_index.json';
const QEMU_TAG = 'esp-develop-9.2.2-20260417';
const QEMU_VER = 'esp_develop_9.2.2_20260417';
const WRAPS = ['_Z5setupv', 'analogReadMilliVolts', 'ledcAttach', 'ledcWrite', 'ledcWriteTone', 'analogWrite', 'esp_deep_sleep_start', 'esp_deep_sleep_enable_gpio_wakeup', 'esp_sleep_enable_ext0_wakeup', 'esp_sleep_enable_ext1_wakeup', 'esp_sleep_enable_timer_wakeup', 'esp_sleep_get_wakeup_cause'];

const BOARDS = {
  'ESP32-C3': { fqbn: 'esp32:esp32:esp32c3:FlashMode=dio', qemu: 'riscv32', machine: 'esp32c3' },
  // Klassischer Zweikern-ESP32: ohne Befehlszählung (-icount) löst der Emulator zufällig falsche „Cache error“-Abstürze
  // aus (in Tests 4 von 10 Starts, auch ohne Ohm-Brücke). Mit -icount läuft er stabil, aber etwa 0,65× so schnell.
  'ESP32-WROOM-32': { fqbn: 'esp32:esp32:esp32:FlashMode=dio', qemu: 'xtensa', machine: 'esp32', extra: ['-icount', 'shift=auto'] },
  ESP32: { fqbn: 'esp32:esp32:esp32:FlashMode=dio', qemu: 'xtensa', machine: 'esp32', extra: ['-icount', 'shift=auto'] },
};

function root() {
  return process.env.OHM_ESP32_TOOLS || path.join(app.getPath('userData'), 'werkzeuge', 'esp32');
}
const p = {
  cli: () => path.join(root(), `arduino-cli${EXE}`),
  data: () => path.join(root(), 'arduino'),
  qemu: (arch) => path.join(root(), `qemu-${arch}`, 'qemu', 'bin', `qemu-system-${arch}${EXE}`),
  bridge: () => (app.isPackaged ? path.join(process.resourcesPath, 'esp32') : path.join(__dirname, 'esp32')),
};
const cliEnv = () => ({ ...process.env, ARDUINO_DIRECTORIES_DATA: p.data(), ARDUINO_DIRECTORIES_USER: path.join(root(), 'sketchbook'), ARDUINO_BOARD_MANAGER_ADDITIONAL_URLS: INDEX });

function elog(msg) {
  try {
    fs.mkdirSync(root(), { recursive: true });
    fs.appendFileSync(path.join(root(), 'esp32.log'), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* egal */
  }
}

function status() {
  const coreDir = path.join(p.data(), 'packages', 'esp32', 'hardware', 'esp32');
  return {
    cli: fs.existsSync(p.cli()),
    core: fs.existsSync(coreDir) && fs.readdirSync(coreDir).length > 0,
    riscv32: fs.existsSync(p.qemu('riscv32')),
    xtensa: fs.existsSync(p.qemu('xtensa')),
    root: root(),
  };
}

/* ------------------------------ Installation ------------------------------ */

function download(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const get = (u, depth) =>
      https
        .get(u, { headers: { 'User-Agent': 'OhmStudio' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 6) return get(new URL(res.headers.location, u).toString(), depth + 1);
          if (res.statusCode !== 200) return reject(new Error(`Download fehlgeschlagen (${res.statusCode}): ${u}`));
          const total = Number(res.headers['content-length'] || 0);
          let got = 0;
          const out = fs.createWriteStream(file);
          res.on('data', (c) => {
            got += c.length;
            onProgress?.(total ? got / total : 0);
          });
          res.pipe(out);
          out.on('finish', () => out.close(() => resolve(file)));
          out.on('error', reject);
        })
        .on('error', reject);
    get(url, 0);
  });
}

function run(cmd, args, opts = {}, onLine) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { env: cliEnv(), ...opts });
    let log = '';
    const feed = (d) => {
      const s = d.toString();
      log += s;
      onLine?.(s);
    };
    c.stdout.on('data', feed);
    c.stderr.on('data', feed);
    c.on('close', (code) => resolve({ code, log }));
    c.on('error', (e) => resolve({ code: -1, log: String(e) }));
  });
}

function extract(archive, dest) {
  fs.mkdirSync(dest, { recursive: true });
  // Windows 10/11 bringt tar.exe (bsdtar) mit – kann .zip und .tar.xz entpacken
  const tar = IS_WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  return run(tar, ['-xf', archive, '-C', dest]).then((r) => {
    if (r.code !== 0) throw new Error(`Entpacken fehlgeschlagen (${path.basename(archive)}):\n${r.log.slice(-600)}`);
    return r;
  });
}

async function install(progress) {
  fs.mkdirSync(root(), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ohm-esp32-'));
  const say = (stage, frac, text) => progress({ stage, frac, text });
  if (!status().cli) {
    const name = IS_WIN ? 'arduino-cli_latest_Windows_64bit.zip' : process.platform === 'darwin' ? 'arduino-cli_latest_macOS_ARM64.tar.gz' : 'arduino-cli_latest_Linux_64bit.tar.gz';
    const f = await download(`https://downloads.arduino.cc/arduino-cli/${name}`, path.join(tmp, name), (x) => say('cli', x, 'Lade arduino-cli …'));
    await extract(f, root());
  }
  for (const arch of ['riscv32', 'xtensa']) {
    if (status()[arch]) continue;
    const plat = IS_WIN ? 'x86_64-w64-mingw32' : process.platform === 'darwin' ? 'aarch64-apple-darwin' : 'x86_64-linux-gnu';
    const name = `qemu-${arch}-softmmu-${QEMU_VER}-${plat}.tar.xz`;
    const f = await download(`https://github.com/espressif/qemu/releases/download/${QEMU_TAG}/${name}`, path.join(tmp, name), (x) => say(`qemu-${arch}`, x, `Lade ESP32-Emulator (${arch === 'riscv32' ? 'ESP32-C3' : 'ESP32'}) …`));
    await extract(f, path.join(root(), `qemu-${arch}`));
  }
  if (!status().core) {
    say('core', 0, 'Lade den ESP32-Kern von Espressif (einmalig ca. 1,5 GB) …');
    let r = await run(p.cli(), ['core', 'update-index']);
    if (r.code !== 0) throw new Error(`Paketliste nicht ladbar:\n${r.log.slice(-800)}`);
    r = await run(p.cli(), ['core', 'install', CORE], {}, (s) => {
      const m = /([\d.]+)%/.exec(s);
      const what = /(esp32:[\w.-]+@[\w.-]+)/.exec(s)?.[1];
      if (m) say('core', Number(m[1]) / 100, `Lade ${what ?? 'ESP32-Kern'} …`);
    });
    if (r.code !== 0) throw new Error(`ESP32-Kern nicht installierbar:\n${r.log.slice(-800)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  say('fertig', 1, 'ESP32-Werkzeuge bereit');
  return status();
}

/* ------------------------------ Übersetzen ------------------------------ */

async function compile(chip, code, onLog) {
  const b = BOARDS[chip];
  if (!b) throw new Error(`Der echte Modus unterstützt ${chip} noch nicht (ESP32 und ESP32-C3 gehen).`);
  const work = path.join(root(), 'bau', chip.replace(/\W/g, ''));
  const sk = path.join(work, 'sketch');
  fs.mkdirSync(sk, { recursive: true });
  for (const f of fs.readdirSync(sk)) fs.rmSync(path.join(sk, f), { recursive: true, force: true });
  fs.writeFileSync(path.join(sk, 'sketch.ino'), code);
  for (const f of ['ohm_bridge.cpp', 'ohm_bridge.h']) fs.copyFileSync(path.join(p.bridge(), f), path.join(sk, f));
  const out = path.join(work, 'build');
  const r = await run(
    p.cli(),
    ['compile', '--fqbn', b.fqbn, '--library', path.join(p.bridge(), 'BLE'), '--build-property', `compiler.c.elf.extra_flags=-Wl,${WRAPS.map((w) => `--wrap=${w}`).join(',')}`, '--output-dir', out, sk],
    {},
    onLog,
  );
  if (r.code !== 0) return { ok: false, log: r.log };
  const flash = path.join(work, 'flash.bin');
  fs.copyFileSync(path.join(out, 'sketch.ino.merged.bin'), flash);
  return { ok: true, log: r.log, flash, board: b };
}

/* ------------------------------ Ausführen ------------------------------ */

const sessions = new Map();

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

async function start(id, chip, code, wc) {
  stop(id);
  const send = (ch, data) => !wc.isDestroyed() && wc.send(ch, { id, ...data });
  const st = status();
  if (!st.cli || !st.core) {
    send('ohm:esp32:event', { type: 'needsInstall' });
    return { ok: false, needsInstall: true };
  }
  send('ohm:esp32:event', { type: 'status', text: 'Übersetze den Sketch für den echten ESP32 …' });
  elog(`start ${id} ${chip}`);
  let c;
  try {
    c = await compile(chip, code);
  } catch (e) {
    send('ohm:esp32:event', { type: 'error', text: String(e.message || e) });
    return { ok: false };
  }
  elog(`compile ok=${c.ok}`);
  if (!c.ok) {
    send('ohm:esp32:event', { type: 'compileError', text: c.log });
    return { ok: false };
  }
  const qemu = p.qemu(c.board.qemu);
  if (!fs.existsSync(qemu)) {
    send('ohm:esp32:event', { type: 'needsInstall' });
    return { ok: false, needsInstall: true };
  }
  // Bekannte Schwäche des Zweikern-Emulators (klassischer ESP32): Beim Hochfahren löst Espressif-QEMU je nach
  // Zeitablauf manchmal einen falschen „Cache error“ aus oder bleibt hängen. Das passiert vor dem Anwenderprogramm,
  // also starten wir dann still neu (wie ein zweiter Druck auf Reset). Erst ab der Brückenmeldung „H“ zählt es.
  const fresh = path.join(path.dirname(c.flash), 'sketch-flash.bin');
  fs.copyFileSync(c.flash, fresh);
  // unter Windows scheitert der klassische ESP32 im Emulator öfter mehrmals hintereinander (GitHub Actions: bis 8×)
  const MAX_TRIES = 15;
  // wake: beim klassischen ESP32 nach Deep-Sleep gesicherter Weckgrund + RTC-Speicher (Kaltstart, siehe ohm_bridge.cpp)
  const launch = async (attempt, wake, prev) => {
    const port = await freePort();
    if (prev && sessions.get(id) !== prev) return; // inzwischen gestoppt
    fs.copyFileSync(fresh, c.flash);
    const args = ['-nographic', '-machine', c.board.machine, '-drive', `file=${c.flash},if=mtd,format=raw`, '-serial', 'stdio', '-chardev', `socket,id=u1,host=127.0.0.1,port=${port},server=on,wait=on`, '-serial', 'chardev:u1', '-monitor', 'none', ...(c.board.extra ?? [])];
    elog(`qemu (Versuch ${attempt}) ${qemu} ${args.join(' ')}`);
    const q = spawn(qemu, args, { windowsHide: true });
    const sess = { q, sock: null, buf: '', attempt, booted: false, bootLog: '', retired: false, timer: null, wake, saving: null };
    sessions.set(id, sess);
    const retry = (why) => {
      if (sess.retired || sess.booted) return;
      sess.retired = true;
      clearTimeout(sess.timer);
      elog(`Startfehler des Emulators (${why}), Versuch ${attempt}`);
      try {
        sess.sock?.destroy();
        q.kill('SIGKILL');
      } catch {
        /* egal */
      }
      if (sessions.get(id) !== sess) return;
      if (attempt >= MAX_TRIES) {
        sessions.delete(id);
        send('ohm:esp32:event', { type: 'error', text: `Der ESP32-Emulator ist ${MAX_TRIES}-mal beim Hochfahren gescheitert (${why}). Bitte noch einmal starten.` });
        send('ohm:esp32:event', { type: 'exit', code: 1, text: '' });
        return;
      }
      if (attempt === 1) send('ohm:esp32:event', { type: 'status', text: 'Emulator startet neu (bekannte Startschwäche des Emulators, nicht dein Programm) …' });
      void launch(attempt + 1, wake, sess);
    };
    sess.timer = setTimeout(() => retry('keine Rückmeldung'), 15000);
    // UTF-8 sauber über Paketgrenzen hinweg dekodieren (Umlaute im seriellen Monitor)
    const dec = new StringDecoder('utf8');
    q.stdout.on('data', (d) => {
      if (sess.retired) return;
      const t = dec.write(d);
      if (sess.booted) return send('ohm:esp32:event', { type: 'serial', text: t });
      sess.bootLog += t;
      if (/Guru Meditation|Cache disabled but cached memory/.test(sess.bootLog)) retry('Cache-Fehler beim Hochfahren');
    });
    let errText = '';
    q.stderr.on('data', (d) => (errText = (errText + d.toString()).slice(-2000)));
    q.on('error', (e) => send('ohm:esp32:event', { type: 'error', text: `Emulator ließ sich nicht starten: ${e.message}` }));
    q.on('exit', (code) => {
      clearTimeout(sess.timer);
      if (sess.retired) return;
      elog(`qemu exit ${code} ${errText.slice(-300)}`);
      if (sessions.get(id) === sess) sessions.delete(id);
      if (!sess.booted && sess.bootLog) send('ohm:esp32:event', { type: 'serial', text: sess.bootLog });
      send('ohm:esp32:event', { type: 'exit', code, text: errText });
    });
    const connect = (tries) => {
      if (sess.retired) return;
      const s = net.connect(port, '127.0.0.1');
      s.on('connect', () => {
        elog('bridge connected');
        sess.sock = s;
      });
      s.on('error', () => tries > 0 && !sess.retired && setTimeout(() => connect(tries - 1), 100));
      s.on('data', (d) => {
        if (sess.retired) return;
        sess.buf += d.toString('utf8');
        let i;
        while ((i = sess.buf.indexOf('\n')) >= 0) {
          const line = sess.buf.slice(0, i).trim();
          sess.buf = sess.buf.slice(i + 1);
          if (!line) continue;
          // ESP32 wacht auf: RTC-Speicher einsammeln, dann kalt neu starten (Soft-Reset im Emulator unzuverlässig)
          if (line[0] === 'W' && line[1] === ' ') {
            sess.saving = { cause: Number(line.slice(2)) || 0, data: [] };
            continue;
          }
          if (sess.saving && line[0] === 'D' && line[1] === ' ') {
            sess.saving.data.push(line);
            continue;
          }
          if (sess.saving && line === 'X') {
            const w = sess.saving;
            sess.retired = true;
            clearTimeout(sess.timer);
            try {
              s.destroy();
              q.kill('SIGKILL');
            } catch {
              /* egal */
            }
            elog(`Aufwachen (Grund ${w.cause}), Kaltstart mit ${w.data.length} RTC-Zeilen`);
            // Flash-Inhalt bleibt wie auf echter Hardware erhalten (Grundlage für spätere Neustarts)
            q.once('exit', () => {
              try {
                fs.copyFileSync(c.flash, fresh);
              } catch {
                /* egal */
              }
              void launch(1, w, sess);
            });
            continue;
          }
          if (line[0] === 'H') {
            // Weckgrund und RTC-Speicher zurückspielen (oder nur „E“ beim Einschalten)
            const w = sess.wake;
            const out = [`W ${w ? w.cause : 0}`, ...(w ? w.data : []), 'E'];
            s.write(out.join('\n') + '\n');
          }
          if (!sess.booted && line[0] === 'H') {
            // Firmware ist durchgestartet: Startprotokoll nachreichen, ab jetzt live
            sess.booted = true;
            clearTimeout(sess.timer);
            elog(`gebootet nach Versuch ${attempt}`);
            if (!sess.wake) send('ohm:esp32:event', { type: 'status', text: 'ESP32 läuft (echter Maschinencode im Emulator)' });
            if (sess.bootLog) send('ohm:esp32:event', { type: 'serial', text: sess.bootLog });
            sess.bootLog = '';
          }
          send('ohm:esp32:event', { type: 'bridge', line });
        }
      });
    };
    connect(50);
  };
  await launch(1, null, null);
  return { ok: true };
}

function stop(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  s.retired = true;
  clearTimeout(s.timer);
  try {
    s.sock?.destroy();
  } catch {
    /* egal */
  }
  try {
    s.q.kill();
  } catch {
    /* egal */
  }
}

function register() {
  ipcMain.handle('ohm:esp32:status', () => status());
  ipcMain.handle('ohm:esp32:install', async (e) => {
    try {
      return { ok: true, status: await install((pr) => !e.sender.isDestroyed() && e.sender.send('ohm:esp32:progress', pr)) };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });
  ipcMain.handle('ohm:esp32:start', (e, id, chip, code) => start(String(id), String(chip), String(code), e.sender));
  ipcMain.handle('ohm:esp32:stop', (_e, id) => stop(String(id)));
  ipcMain.on('ohm:esp32:bridge', (_e, id, line) => sessions.get(String(id))?.sock?.write(`${line}\n`));
  ipcMain.on('ohm:esp32:serialIn', (_e, id, text) => sessions.get(String(id))?.q.stdin.write(String(text)));
  const stopAll = () => {
    for (const id of [...sessions.keys()]) stop(id);
  };
  app.on('before-quit', stopAll);
  app.on('will-quit', stopAll);
  process.on('exit', stopAll);
}

module.exports = { register, status, install, compile, start, stop, BOARDS };
