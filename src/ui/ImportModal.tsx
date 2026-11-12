/**
 * Importieren aus KiCad (7/8/9: .kicad_sch, dazu optional .kicad_pcb) und Altium (.SchDoc, binär oder ASCII).
 * Zeigt ehrlich, was übernommen wurde und was nicht, und öffnet das Ergebnis zum Simulieren.
 */
import { useEffect, useState } from 'react';
import { loadOhmText, set, startSim } from '../state/store';
import { serializeOhm } from '../ohm/format';
import { unlockAudio } from '../audio';
import type { ImportResult } from '../eda/kicadImport';
import { Modal } from './Modals';

interface Picked {
  name: string;
  bytes: Uint8Array;
}

async function pick(accept: string[], title: string): Promise<Picked | null> {
  const d = (globalThis as unknown as { ohmNative?: { openDialog(o: { title?: string; filters?: { name: string; extensions: string[] }[]; binary?: boolean }): Promise<{ name: string; base64?: string } | null> } }).ohmNative;
  if (d) {
    const r = await d.openDialog({ title, binary: true, filters: [{ name: 'KiCad / Altium', extensions: accept }] });
    if (!r?.base64) return null;
    const bin = atob(r.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { name: r.name, bytes };
  }
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept.map((a) => `.${a}`).join(',');
    inp.onchange = async () => {
      const f = inp.files?.[0];
      resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    inp.click();
  });
}

const text = (b: Uint8Array) => new TextDecoder('utf-8').decode(b);

/** Für Tests und Drag & Drop: eine Datei importieren */
export async function importFile(p: Picked): Promise<ImportResult> {
  if (/\.kicad_sch$/i.test(p.name)) {
    const { importKicadSch } = await import('../eda/kicadImport');
    return importKicadSch(text(p.bytes), p.name);
  }
  if (/\.schdoc$/i.test(p.name)) {
    const { importAltiumSch } = await import('../eda/altiumImport');
    return importAltiumSch(p.bytes, p.name);
  }
  if (/\.kicad_pcb$/i.test(p.name)) throw new Error('Bitte zuerst den Schaltplan (.kicad_sch) importieren – die Platine wird danach dazugeladen.');
  if (/\.pcbdoc$/i.test(p.name)) throw new Error('Altium-Platinen (.PcbDoc) werden nicht unterstützt. Importiere den Schaltplan (.SchDoc); Ohm Studio legt die Platine neu an.');
  if (/\.kicad_pro$/i.test(p.name)) throw new Error('Bitte die Schaltplandatei (.kicad_sch) wählen, nicht die Projektdatei.');
  throw new Error('Unbekanntes Format. Unterstützt: KiCad .kicad_sch (7, 8, 9) und Altium .SchDoc.');
}

export function ImportModal() {
  const [res, setRes] = useState<ImportResult | null>(null);
  const [err, setErr] = useState('');
  const [pcb, setPcb] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async (p: Picked) => {
    setErr('');
    setBusy(true);
    try {
      setRes(await importFile(p));
      setPcb('');
    } catch (e) {
      setRes(null);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const choose = async () => {
    setErr('');
    const p = await pick(['kicad_sch', 'SchDoc', 'schdoc', 'kicad_pcb', 'PcbDoc'], 'Schaltplan importieren');
    if (p) await load(p);
  };
  // Drag & Drop und Tests übergeben die Datei direkt
  useEffect(() => {
    const g = globalThis as unknown as { __ohmImportDrop?: (p: Picked) => void };
    g.__ohmImportDrop = (p) => void load(p);
    return () => void delete g.__ohmImportDrop;
  }, []);
  const addPcb = async () => {
    if (!res) return;
    const p = await pick(['kicad_pcb'], 'KiCad-Platine dazuladen');
    if (!p) return;
    try {
      const { applyKicadPcb } = await import('../eda/kicadImport');
      applyKicadPcb(res.project, text(p.bytes), res.report);
      setPcb(p.name);
      setRes({ ...res });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const open = () => {
    if (!res) return;
    const issues = loadOhmText(serializeOhm(res.project), `${res.project.name}.ohm`);
    if (issues.some((i) => i.level === 'error')) {
      setErr(`Das importierte Projekt hat Fehler: ${issues.filter((i) => i.level === 'error').map((i) => i.text).join('; ')}`);
      return;
    }
    set({ modal: null });
    if (res.project.parts.length) {
      unlockAudio();
      setTimeout(startSim, 300);
    }
  };
  const r = res?.report;
  return (
    <Modal title="Importieren aus KiCad oder Altium" wide>
      {!res && (
        <>
          <p className="info-text" style={{ marginTop: 0 }}>
            Unterstützt: <b>KiCad 7, 8 und 9</b> (Schaltplan .kicad_sch, dazu optional die Platine .kicad_pcb) und <b>Altium</b>-Schaltpläne (.SchDoc, binär oder als ASCII gespeichert).
          </p>
          <ul className="idea-list">
            <li>Übernommen werden Bauteile, für die es ein Simulationsmodell gibt (Widerstände, Kondensatoren, Spulen, Dioden, LEDs, Transistoren, Taster, Quellen, 555, OPV, Arduino …), und alle Verbindungen.</li>
            <li>Nicht übernommen: Bauteile ohne Modell (werden aufgelistet), Unterblätter, Busse, SPICE-Modelldateien, Altium-Platinen.</li>
          </ul>
          <div className="btn-row">
            <button className="btn primary" disabled={busy} onClick={() => void choose()}>
              {busy ? 'Lese Datei …' : 'Datei wählen …'}
            </button>
          </div>
        </>
      )}
      {r && (
        <div className="imp-report">
          <p style={{ marginTop: 0 }}>
            <b>{r.quelle}</b> · {r.version} · {r.teile.length} Bauteile übernommen · {r.netze} Netze
            {pcb && <> · Platine: {pcb}</>}
          </p>
          {!!r.teile.length && (
            <details open={r.teile.length <= 12}>
              <summary className="idea-sub">Übernommen ({r.teile.length})</summary>
              <ul className="idea-list imp-cols">{r.teile.map((t) => <li key={t.ref}>✓ {t.ref} <small>({t.symbol.split(':').pop()} → {t.typ})</small></li>)}</ul>
            </details>
          )}
          {!!r.ausgelassen.length && (
            <details open>
              <summary className="idea-sub">Weggelassen ({r.ausgelassen.length})</summary>
              <ul className="idea-list imp-cols">{r.ausgelassen.map((t, i) => <li key={i}>– {t.ref} <small>({t.symbol.split(':').pop()}: {t.grund})</small></li>)}</ul>
            </details>
          )}
          {!!r.hinweise.length && (
            <>
              <div className="idea-sub">Hinweise</div>
              <ul className="idea-list">{r.hinweise.slice(0, 12).map((h, i) => <li key={i}>{h}</li>)}</ul>
            </>
          )}
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={open}>
              Öffnen{res!.project.parts.length ? ' und simulieren' : ''}
            </button>
            {/kicad/i.test(r.version) && !pcb && <button className="btn" onClick={() => void addPcb()}>Platine (.kicad_pcb) dazuladen …</button>}
            <button className="btn" onClick={() => (setRes(null), setErr(''))}>Andere Datei</button>
          </div>
        </div>
      )}
      {err && <div className="idea-error">{err}</div>}
    </Modal>
  );
}
