/** Datei öffnen/speichern (File System Access API mit Download-Fallback) */
import { loadOhmText, saveOhmText, set, state, toast } from '../state/store';
import { currentPath, desk, setCurrentPath } from '../desktop';

let handle: any = null;

export async function openFile() {
  const d = desk();
  if (d) {
    const f = await d.openDialog();
    if (f?.text !== undefined) {
      loadOhmText(f.text, f.name);
      setCurrentPath(f.path);
    }
    return;
  }
  const w = window as any;
  try {
    if (w.showOpenFilePicker) {
      const [h] = await w.showOpenFilePicker({ types: [{ description: 'Ohm-Studio-Projekt', accept: { 'text/yaml': ['.ohm', '.yaml', '.yml'] } }] });
      const f = await h.getFile();
      handle = h;
      loadOhmText(await f.text(), f.name);
      return;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
  }
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.ohm,.yaml,.yml,text/yaml';
  inp.onchange = async () => {
    const f = inp.files?.[0];
    if (f) loadOhmText(await f.text(), f.name);
  };
  inp.click();
}

export function download(name: string, data: string | Blob, mime = 'text/plain') {
  const d = desk();
  if (d) {
    // Desktop: nativer „Speichern unter“-Dialog statt Browser-Download
    void (async () => {
      const bytes = typeof data === 'string' ? data : new Uint8Array(await data.arrayBuffer());
      const r = await d.saveDialog(name, bytes, { title: 'Exportieren' });
      if (r) toast(`Gespeichert: ${r.name}`, 'info');
    })();
    return;
  }
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function safeName() {
  const base = state.project.name.trim().toLowerCase().replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[c] as string).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return base || 'projekt';
}

export async function saveFile(saveAs = false): Promise<boolean> {
  const text = saveOhmText();
  const d = desk();
  if (d) {
    if (currentPath && !saveAs) {
      await d.writeFile(currentPath, text);
    } else {
      const r = await d.saveDialog(`${safeName()}.ohm`, text, { title: saveAs ? 'Speichern unter' : 'Projekt speichern', kind: 'Ohm-Studio-Projekt' });
      if (!r) return false;
      setCurrentPath(r.path);
      set({ fileName: r.name });
    }
    set({ dirty: false });
    toast('Gespeichert', 'info');
    return true;
  }
  const w = window as any;
  try {
    if (w.showSaveFilePicker) {
      if (!handle || saveAs) handle = await w.showSaveFilePicker({ suggestedName: `${safeName()}.ohm`, types: [{ description: 'Ohm-Studio-Projekt', accept: { 'text/yaml': ['.ohm'] } }] });
      const wr = await handle.createWritable();
      await wr.write(text);
      await wr.close();
      set({ dirty: false, fileName: handle.name });
      toast('Gespeichert', 'info');
      return true;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return false;
  }
  download(`${safeName()}.ohm`, text, 'text/yaml');
  set({ dirty: false });
  return true;
}

export function exportName(ext: string) {
  return `${safeName()}${ext}`;
}

/** Projekt als Link teilen (komprimiert in der URL) */
export async function shareLink(): Promise<string> {
  const text = saveOhmText();
  const bytes = new TextEncoder().encode(text);
  let b64: string;
  if (typeof CompressionStream !== 'undefined') {
    const cs = new CompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(cs);
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    b64 = 'z' + toB64(buf);
  } else b64 = 'p' + toB64(bytes);
  const url = `${location.origin}${location.pathname}#ohm=${b64}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Link in die Zwischenablage kopiert', 'info');
  } catch {
    toast('Link erstellt', 'info');
  }
  return url;
}

function toB64(b: Uint8Array) {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64(s: string) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}

export async function loadFromHash(): Promise<boolean> {
  const m = /#ohm=([zp])([A-Za-z0-9_-]+)/.exec(location.hash);
  if (!m) return false;
  try {
    let bytes = fromB64(m[2]);
    if (m[1] === 'z') {
      const ds = new DecompressionStream('deflate-raw');
      const stream = new Blob([bytes]).stream().pipeThrough(ds);
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    loadOhmText(new TextDecoder().decode(bytes), 'geteilt.ohm');
    history.replaceState(null, '', location.pathname);
    return true;
  } catch {
    toast('Der geteilte Link ist beschädigt.', 'error');
    return false;
  }
}
