/**
 * Desktop-Integration (Windows-Programm): Titelleiste mit nativen Menüs, native Kontextmenüs,
 * Datei-Dialoge, Fenstertitel, Nachfrage beim Schließen, Dateien per Doppelklick öffnen.
 * In der Web-Version ist das alles inaktiv.
 */
import { changed, duplicateSelection, loadOhmText, newProject, pauseSim, redo, removeSelection, requestFit, resetSim, rotateSelection, set, startSim, state, stopSim, subscribe, toast, undo } from './state/store';

export interface MenuItem {
  id?: string;
  label?: string;
  accelerator?: string;
  enabled?: boolean;
  checked?: boolean;
  type?: 'separator';
  submenu?: MenuItem[];
}

interface DesktopApi {
  desktop: true;
  platform: string;
  ready(): Promise<{ links?: OhmLink[]; files: { path: string; name: string; text: string }[]; install: InstallInfo; version: string; packaged: boolean; platform: string; titleBarHeight: number }>;
  popup(items: MenuItem[], x: number, y: number): Promise<string | null>;
  openDialog(o?: { title?: string; filters?: { name: string; extensions: string[] }[]; binary?: boolean }): Promise<{ path: string; name: string; text?: string; base64?: string } | null>;
  saveDialog(name: string, data: string | Uint8Array, o?: { title?: string; kind?: string; dir?: string }): Promise<{ path: string; name: string } | null>;
  writeFile(p: string, data: string | Uint8Array): Promise<boolean>;
  message(o: { type?: string; message: string; detail?: string; buttons?: string[]; defaultId?: number; cancelId?: number }): Promise<number>;
  setTitle(t: string): Promise<void>;
  setTheme(dark: boolean | null): Promise<void>;
  windowCmd(c: 'minimize' | 'maximize' | 'fullscreen' | 'close'): Promise<void>;
  closeNow(): Promise<void>;
  openExternal(url: string): Promise<void>;
  showItem(p: string): Promise<void>;
  paths(): Promise<{ documents: string; userData: string; examples: string }>;
  onOpenFile(fn: (f: { path: string; name: string; text: string }) => void): void;
  onOpenLink?(fn: (l: OhmLink) => void): void;
  onCloseRequest(fn: () => void): void;
  onWindowState(fn: (s: { maximized: boolean; fullscreen: boolean }) => void): void;
  updateCheck(channel: string, interactive?: boolean): Promise<unknown>;
  trial?: { status(): Promise<DeviceTrial>; start(at?: number): Promise<DeviceTrial> };
}

/** Testphase laut Gerät (überlebt Neuinstallation) */
export interface DeviceTrial {
  start: number | null;
  ended: boolean;
  reason?: 'verändert' | 'uhr';
  device: string;
}

export interface OhmLink {
  kind: 'galerie';
  id: string;
  server: string | null;
}

/** Link ohmstudio://galerie/<id>?server=… öffnen (aus einer geteilten Projektseite) */
async function openLink(d: DesktopApi, l: OhmLink) {
  const { gallery } = await import('./community/gallery');
  const cur = gallery.server();
  if (l.server && l.server.replace(/\/$/, '') !== cur) {
    if (cur) {
      const r = await d.message({ type: 'question', message: 'Projekt aus einer anderen Galerie öffnen?', detail: `Der Link führt zu ${l.server}. Deine Galerie ist ${cur}. Soll Ohm Studio zur Galerie aus dem Link wechseln?`, buttons: ['Wechseln und öffnen', 'Abbrechen'], defaultId: 0, cancelId: 1 });
      if (r !== 0) return;
    }
    gallery.setServer(l.server);
  }
  set({ modal: 'galerie', galerieOpen: l.id, galerieTab: 'entdecken' });
}

export interface InstallInfo {
  examples: boolean;
  course: boolean;
  emulator: boolean;
  autoUpdate: boolean;
  mode: string;
}

export function desk(): DesktopApi | null {
  const n = (globalThis as unknown as { ohmNative?: Partial<DesktopApi> }).ohmNative;
  return n?.desktop ? (n as DesktopApi) : null;
}

export const isDesktop = () => !!desk();

export let installInfo: InstallInfo = { examples: true, course: true, emulator: false, autoUpdate: true, mode: 'web' };
export let appVersion = '';

/** Pfad der aktuell geöffneten Projektdatei (nur Desktop) */
export let currentPath: string | null = null;
export function setCurrentPath(p: string | null) {
  currentPath = p;
}

let actionsImpl: Record<string, () => void> = {};
export function registerActions(a: Record<string, () => void>) {
  actionsImpl = { ...actionsImpl, ...a };
}
function run(id: string | null) {
  if (id && actionsImpl[id]) actionsImpl[id]();
}

/** Menüpunkte ohne hinterlegte Aktion (für den Test – jeder Menüpunkt muss etwas tun) */
export function menuItemsWithoutAction(): string[] {
  const out: string[] = [];
  const walk = (items: MenuItem[]) => {
    for (const it of items) {
      if (it.submenu) walk(it.submenu);
      else if (it.id && !actionsImpl[it.id]) out.push(it.id);
    }
  };
  for (const items of Object.values(menus())) walk(items);
  return out;
}

/* ------------------------------ Menüs ------------------------------ */

export function menus(): Record<string, MenuItem[]> {
  const sel = state.selection.length > 0;
  const running = state.sim === 'running';
  return {
    Datei: [
      { id: 'new', label: 'Neues Projekt', accelerator: 'Ctrl+N' },
      { id: 'idea', label: 'Neues Projekt aus Idee …' },
      { id: 'open', label: 'Öffnen …', accelerator: 'Ctrl+O' },
      { id: 'examples', label: 'Beispiele …' },
      { id: 'gallery', label: 'Community-Galerie …' },
      { type: 'separator' },
      { id: 'save', label: 'Speichern', accelerator: 'Ctrl+S' },
      { id: 'saveAs', label: 'Speichern unter …', accelerator: 'Ctrl+Shift+S' },
      { type: 'separator' },
      { id: 'import', label: 'Importieren (KiCad, Altium) …' },
      { id: 'export', label: 'Exportieren & bestellen …' },
      { id: 'share', label: 'Teilen …' },
      { type: 'separator' },
      { id: 'quit', label: 'Beenden', accelerator: 'Alt+F4' },
    ],
    Bearbeiten: [
      { id: 'undo', label: 'Rückgängig', accelerator: 'Ctrl+Z' },
      { id: 'redo', label: 'Wiederholen', accelerator: 'Ctrl+Y' },
      { type: 'separator' },
      { id: 'duplicate', label: 'Duplizieren', accelerator: 'Ctrl+D', enabled: sel },
      { id: 'rotate', label: 'Drehen', accelerator: 'R', enabled: sel },
      { id: 'delete', label: 'Löschen', accelerator: 'Delete', enabled: sel },
      { type: 'separator' },
      { id: 'settings', label: 'Einstellungen …' },
    ],
    Ansicht: [
      { id: 'view1', label: 'Steckbrett', accelerator: '1', checked: state.view === 'steckbrett' },
      { id: 'view2', label: 'Schaltplan', accelerator: '2', checked: state.view === 'schaltplan' },
      { id: 'view3', label: 'Platine', accelerator: '3', checked: state.view === 'platine' },
      { id: 'pcb3d', label: '3D-Ansicht der Platine', checked: state.pcb3d },
      { type: 'separator' },
      { id: 'fit', label: 'Alles zeigen', accelerator: 'F' },
      { id: 'library', label: 'Bibliothek', checked: state.libraryOpen },
      { id: 'inspector', label: 'Inspektor', checked: state.inspectorOpen },
      { id: 'bottom', label: 'Unteres Panel', checked: state.bottomOpen },
      { type: 'separator' },
      { id: 'learnMode', label: 'Lernmodus (Stromfluss)', checked: state.learnMode },
      { id: 'fullscreen', label: 'Vollbild', accelerator: 'F11' },
    ],
    Simulation: [
      { id: 'run', label: running ? 'Pause' : 'Start', accelerator: 'Space' },
      { id: 'reset', label: 'Zurücksetzen', enabled: state.sim !== 'stopped' },
      { id: 'stop', label: 'Stopp', enabled: state.sim !== 'stopped' },
      { type: 'separator' },
      { id: 'analysis', label: 'Analysen …' },
      { id: 'review', label: 'KI-Werkzeuge …' },
      { id: 'enclosure', label: 'Gehäuse …' },
    ],
    Hilfe: [
      { id: 'tour', label: 'Einführungstour' },
      { id: 'learn', label: 'Lernen & Klassenraum …' },
      { type: 'separator' },
      { id: 'updates', label: 'Nach Updates suchen …' },
      { id: 'account', label: 'Konto & Pläne …' },
      { id: 'shortcuts', label: 'Tastenkürzel' },
      { id: 'about', label: 'Über Ohm Studio' },
    ],
  };
}

export async function openMenu(name: string, el: HTMLElement) {
  const d = desk();
  if (!d) return;
  const r = el.getBoundingClientRect();
  run(await d.popup(menus()[name], r.left, r.bottom + 2));
}

/* ------------------------------ Start ------------------------------ */

let lastTitle = '';

export async function initDesktop(handlers: { open: (f: { path: string; name: string; text: string }) => void; save: () => Promise<boolean> }) {
  const d = desk();
  if (!d) return;
  const root = document.documentElement;
  root.classList.add('desktop');
  if (d.platform === 'win32') root.classList.add('win32');
  // Testphase mit dem Gerät abgleichen (Neuinstallation setzt sie nicht zurück)
  void import('./license/license').then((m) => m.syncDeviceTrial()).catch(() => undefined);

  // Standard-Aktionen
  registerActions({
    new: () => newProject(),
    open: () => void import('./ui/files').then((m) => m.openFile()),
    save: () => void handlers.save(),
    saveAs: () => void import('./ui/files').then((m) => m.saveFile(true)),
    idea: () => void import('./ui/IdeaWizard').then((m) => m.openIdeaWizard()),
    gallery: () => set({ modal: 'galerie' }),
    share: () => set({ modal: 'galerie', galerieTab: 'teilen' } as Partial<typeof state>),
    import: () => set({ modal: 'import' }),
    undo,
    redo,
    duplicate: duplicateSelection,
    rotate: rotateSelection,
    delete: removeSelection,
    view1: () => set({ view: 'steckbrett' }),
    view2: () => set({ view: 'schaltplan' }),
    view3: () => set({ view: 'platine' }),
    pcb3d: () => set({ view: 'platine', pcb3d: !state.pcb3d }),
    fit: requestFit,
    library: () => set({ libraryOpen: !state.libraryOpen }),
    inspector: () => set({ inspectorOpen: !state.inspectorOpen }),
    bottom: () => set({ bottomOpen: !state.bottomOpen }),
    learnMode: () => set({ learnMode: !state.learnMode }),
    fullscreen: () => void d.windowCmd('fullscreen'),
    run: () => (state.sim === 'running' ? pauseSim() : startSim()),
    reset: resetSim,
    stop: stopSim,
    examples: () => set({ modal: 'examples' }),
    export: () => set({ modal: 'export' }),
    settings: () => set({ modal: 'settings' }),
    analysis: () => set({ modal: 'analysis' }),
    review: () => set({ modal: 'review' }),
    enclosure: () => set({ modal: 'enclosure' }),
    learn: () => set({ modal: 'learn' }),
    tour: () => void import('./ui/Tour').then((m) => m.restartTour()),
    account: () => set({ modal: 'account' }),
    about: () => set({ modal: 'about' }),
    shortcuts: () => set({ modal: 'shortcuts' }),
    updates: () => void d.updateCheck('stabil', true),
    quit: () => void d.windowCmd('close'),
  });

  const info = await d.ready();
  installInfo = info.install;
  appVersion = info.version;
  for (const f of info.files) handlers.open(f);
  d.onOpenFile(handlers.open);
  for (const l of info.links ?? []) void openLink(d, l);
  d.onOpenLink?.((l) => void openLink(d, l));
  void offerEmulatorDownload(d);

  // Nachfrage beim Schließen mit ungespeicherten Änderungen
  d.onCloseRequest(async () => {
    if (!state.dirty) return void d.closeNow();
    const r = await d.message({ type: 'warning', message: `Änderungen an „${state.project.name}“ speichern?`, detail: 'Wenn du nicht speicherst, gehen die Änderungen verloren. (Eine automatische Sicherung bleibt erhalten.)', buttons: ['Speichern', 'Nicht speichern', 'Abbrechen'], defaultId: 0, cancelId: 2 });
    if (r === 2) return;
    if (r === 0 && !(await handlers.save())) return;
    await d.closeNow();
  });

  // Fenstertitel (Taskleiste) = Projektname; neues/anderes Projekt → kein Speicherpfad mehr
  let lastProject = state.project;
  const updateTitle = () => {
    if (state.project !== lastProject) {
      lastProject = state.project;
      currentPath = null;
    }
    const t = `${state.dirty ? '● ' : ''}${state.project.name} – Ohm Studio`;
    if (t !== lastTitle) {
      lastTitle = t;
      document.title = t;
      void d.setTitle(t);
    }
  };
  subscribe(updateTitle);
  updateTitle();

  // Natives Kontextmenü statt Browser-Menü
  window.addEventListener('contextmenu', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, [contenteditable="true"], .cm-editor, .code-editor')) return; // Textfelder: natives Bearbeiten-Menü kommt vom Hauptprozess
    e.preventDefault();
    const partEl = t.closest('[data-part]') as HTMLElement | null;
    if (partEl) {
      const id = partEl.dataset.part!;
      if (!state.selection.includes(id)) set({ selection: [id] });
    }
    const items: MenuItem[] = partEl
      ? [
          { id: 'rotate', label: 'Drehen', accelerator: 'R' },
          { id: 'duplicate', label: 'Duplizieren', accelerator: 'Ctrl+D' },
          { id: 'delete', label: 'Löschen', accelerator: 'Delete' },
          { type: 'separator' },
          { id: 'suggest', label: 'Alternative vorschlagen …' },
          { id: 'comment', label: 'Kommentar anheften …' },
        ]
      : t.closest('.canvas-svg, .canvas')
        ? [
            { id: 'undo', label: 'Rückgängig', accelerator: 'Ctrl+Z' },
            { id: 'redo', label: 'Wiederholen', accelerator: 'Ctrl+Y' },
            { type: 'separator' },
            { id: 'fit', label: 'Alles zeigen', accelerator: 'F' },
            { id: 'run', label: state.sim === 'running' ? 'Simulation pausieren' : 'Simulation starten', accelerator: 'Space' },
          ]
        : [];
    if (items.length) void d.popup(items, e.clientX, e.clientY).then(run);
  });

  registerActions({
    suggest: () => set({ modal: 'review' }),
    comment: () => set({ modal: 'history' }),
  });

  (globalThis as unknown as { __ohmDesk?: unknown }).__ohmDesk = { menuItemsWithoutAction };
  if (location.hash === '#wiederhergestellt') {
    history.replaceState(null, '', location.pathname);
    setTimeout(() => toast('Ohm Studio wurde nach einem Fehler neu gestartet – dein Projekt ist wiederhergestellt.', 'warn'), 600);
  }
  void changed;
}

export async function openExternal(url: string) {
  const d = desk();
  if (d) await d.openExternal(url);
  else window.open(url, '_blank', 'noopener');
}

/** Im Setup wurde „ESP32-Emulator“ angehakt: beim ersten Start einmal anbieten, die Werkzeuge jetzt zu laden
 *  (das Setup selbst lädt nichts nach, damit es klein und offline bleibt). */
async function offerEmulatorDownload(d: DesktopApi) {
  if (!installInfo.emulator) return;
  try {
    if (localStorage.getItem('ohm.emuAngeboten') === appVersion) return;
    localStorage.setItem('ohm.emuAngeboten', appVersion);
  } catch {
    return;
  }
  const { esp32Api } = await import('./mcu/cores/esp32qemu');
  const st = await esp32Api()?.status();
  if (!st || (st.cli && st.core && st.riscv32 && st.xtensa)) return;
  await new Promise((r) => setTimeout(r, 1200));
  const r = await d.message({
    type: 'question',
    message: 'ESP32-Emulator jetzt herunterladen?',
    detail: 'Du hast im Setup den ESP32-Emulator ausgewählt. Er wird einmalig von Espressif und Arduino geladen (ca. 1,5 GB, Platzbedarf ca. 8 GB). Du kannst währenddessen weiterarbeiten. Später geht es auch über Einstellungen → Emulatoren.',
    buttons: ['Jetzt laden', 'Später'],
    defaultId: 0,
    cancelId: 1,
  });
  if (r !== 0) return;
  const { settingsIntent } = await import('./ui/SettingsModal');
  settingsIntent.tab = 'emulatoren';
  settingsIntent.installEmu = true;
  set({ modal: 'settings' });
}
