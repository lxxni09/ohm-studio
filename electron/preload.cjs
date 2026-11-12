// Sichere Brücke zwischen Oberfläche und Betriebssystem (nur freigegebene Funktionen)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ohmNative', {
  desktop: true,
  platform: process.platform,
  /** Oberfläche ist bereit → { files, install, version, packaged, platform, titleBarHeight } */
  ready: () => ipcRenderer.invoke('ohm:ready'),
  /** Natives Menü (Titelleiste, Kontextmenü) → gewählte ID oder null */
  popup: (items, x, y) => ipcRenderer.invoke('ohm:popup', items, x, y),
  openDialog: (opts) => ipcRenderer.invoke('ohm:openDialog', opts),
  saveDialog: (name, data, opts) => ipcRenderer.invoke('ohm:saveDialog', name, data, opts),
  writeFile: (p, data) => ipcRenderer.invoke('ohm:writeFile', p, data),
  message: (o) => ipcRenderer.invoke('ohm:message', o),
  setTitle: (t) => ipcRenderer.invoke('ohm:setTitle', t),
  setTheme: (dark) => ipcRenderer.invoke('ohm:setTheme', dark),
  windowCmd: (cmd) => ipcRenderer.invoke('ohm:window', cmd),
  closeNow: () => ipcRenderer.invoke('ohm:closeNow'),
  openExternal: (url) => ipcRenderer.invoke('ohm:openExternal', url),
  showItem: (p) => ipcRenderer.invoke('ohm:showItem', p),
  paths: () => ipcRenderer.invoke('ohm:paths'),
  onOpenFile: (fn) => ipcRenderer.on('ohm:openFile', (_e, f) => fn(f)),
  onOpenLink: (fn) => ipcRenderer.on('ohm:openLink', (_e, l) => fn(l)),
  onCloseRequest: (fn) => ipcRenderer.on('ohm:closeRequest', () => fn()),
  onWindowState: (fn) => ipcRenderer.on('ohm:windowState', (_e, s) => fn(s)),
  /** Pfad eines installierten Programms (arduino-cli, qemu-system-xtensa, renode …) */
  which: (cmd) => ipcRenderer.invoke('ohm:which', cmd),
  /** Sketch mit arduino-cli kompilieren → { ok, hex?, uf2Base64?, log } */
  compile: (fqbn, code) => ipcRenderer.invoke('ohm:compile', fqbn, code),
  /** Echter ESP32-Modus (Espressif-QEMU) */
  esp32: {
    status: () => ipcRenderer.invoke('ohm:esp32:status'),
    install: () => ipcRenderer.invoke('ohm:esp32:install'),
    start: (id, chip, code) => ipcRenderer.invoke('ohm:esp32:start', id, chip, code),
    stop: (id) => ipcRenderer.invoke('ohm:esp32:stop', id),
    bridge: (id, line) => ipcRenderer.send('ohm:esp32:bridge', id, line),
    serialIn: (id, text) => ipcRenderer.send('ohm:esp32:serialIn', id, text),
    onEvent: (fn) => {
      const h = (_e, ev) => fn(ev);
      ipcRenderer.on('ohm:esp32:event', h);
      return () => ipcRenderer.removeListener('ohm:esp32:event', h);
    },
    onProgress: (fn) => {
      const h = (_e, pr) => fn(pr);
      ipcRenderer.on('ohm:esp32:progress', h);
      return () => ipcRenderer.removeListener('ohm:esp32:progress', h);
    },
  },
  /** Nach Updates suchen (Kanal stabil/beta/lts) */
  updateCheck: (channel, interactive) => ipcRenderer.invoke('ohm:updateCheck', channel, interactive),
});
