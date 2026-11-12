/** Lagenaufbau-Editor mit Impedanzrechner (Mikrostreifen nach IPC-2141) */
import { useState } from 'react';
import { limit } from '../license/license';
import { changed, checkpoint, set, state, useStore } from '../state/store';
import { microstripZ0, widthForZ0 } from '../eda/drc';
import { Icon } from './icons';

const MATERIALS: Record<string, { er: number; name: string }> = {
  fr4: { er: 4.5, name: 'FR4 (Standard)' },
  'fr4-tg170': { er: 4.4, name: 'FR4 High-Tg 170' },
  rogers4350: { er: 3.48, name: 'Rogers RO4350B (HF)' },
  aluminium: { er: 7, name: 'Aluminiumkern (IMS)' },
  polyimid: { er: 3.4, name: 'Polyimid (Flex)' },
};

export function stackupOf(layers: number, thickness = 1.6, material = 'fr4') {
  const copper = (i: number) => ({ kind: 'Kupfer' as const, name: i === 0 ? 'L1 oben' : i === layers - 1 ? `L${layers} unten` : `L${i + 1} innen`, t: i === 0 || i === layers - 1 ? 0.035 : 0.0175 });
  const out: { kind: 'Kupfer' | 'Dielektrikum' | 'Lötstopp'; name: string; t: number }[] = [{ kind: 'Lötstopp', name: 'Lötstopplack oben', t: 0.02 }];
  const diel = layers > 1 ? (thickness - 0.035 * 2 - 0.0175 * Math.max(0, layers - 2)) / (layers - 1) : thickness;
  for (let i = 0; i < layers; i++) {
    out.push(copper(i));
    if (i < layers - 1) out.push({ kind: 'Dielektrikum', name: `${MATERIALS[material]?.name ?? material} ${i % 2 === 0 ? '(Core)' : '(Prepreg)'}`, t: diel });
  }
  if (layers === 1) out.push({ kind: 'Dielektrikum', name: MATERIALS[material]?.name ?? material, t: diel });
  out.push({ kind: 'Lötstopp', name: 'Lötstopplack unten', t: 0.02 });
  return out;
}

export function StackupModal() {
  useStore((s) => s.rev);
  const p = state.project.views.platine ?? {};
  const layers = Number(p.lagen ?? 2);
  const maxLayers = limit('maxLayers');
  const thickness = Number((p as any).dicke ?? 1.6);
  const material = String((p as any).material ?? 'fr4');
  const [z, setZ] = useState(50);
  const st = stackupOf(layers, thickness, material);
  const firstDiel = st.find((x) => x.kind === 'Dielektrikum')!.t;
  const er = MATERIALS[material]?.er ?? 4.5;
  const w50 = widthForZ0(z, firstDiel, er);
  const upd = (patch: Record<string, unknown>) => {
    checkpoint();
    state.project.views.platine = { ...p, ...patch } as typeof p;
    changed(false);
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && set({ modal: null })}>
      <div className="modal">
        <div className="modal-head">
          <h2>Lagenaufbau (Stackup)</h2>
          <button className="icon-btn" onClick={() => set({ modal: null })}>
            <Icon.close />
          </button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div className="row">
              <label>Kupferlagen</label>
              <select className="field" value={layers} onChange={(e) => upd({ lagen: Number(e.target.value) })}>
                {[1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32].map((n) => (
                  <option key={n} value={n} disabled={n > maxLayers}>
                    {n}
                    {n > maxLayers ? ' (Pro)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <label>Dicke</label>
              <select className="field" value={thickness} onChange={(e) => upd({ dicke: Number(e.target.value) })}>
                {[0.4, 0.6, 0.8, 1.0, 1.2, 1.6, 2.0, 2.4].map((n) => (
                  <option key={n} value={n}>
                    {n.toFixed(1)} mm
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <label>Material</label>
              <select className="field" value={material} onChange={(e) => upd({ material: e.target.value })}>
                {Object.entries(MATERIALS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.name} (εr {v.er})
                  </option>
                ))}
              </select>
            </div>
            <h3 style={{ marginTop: 16 }}>Impedanzrechner (Mikrostreifen)</h3>
            <div className="row">
              <label>Zielimpedanz</label>
              <select className="field" value={z} onChange={(e) => setZ(Number(e.target.value))}>
                {[50, 75, 90, 100].map((n) => (
                  <option key={n} value={n}>
                    {n} Ω{n === 90 ? ' (USB, diff.)' : n === 100 ? ' (Ethernet, diff.)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="card" style={{ marginTop: 6 }}>
              <div className="big-number">{w50.toFixed(3)} mm</div>
              <div className="info-text">
                Bahnbreite auf L1 über {firstDiel.toFixed(3)} mm {MATERIALS[material]?.name}. Kontrolle: {microstripZ0(w50, firstDiel, er).toFixed(1)} Ω. Für Differenzialpaare gilt die Näherung je Leiter; der Abstand bestimmt die Kopplung.
              </div>
            </div>
          </div>
          <div>
            <h3>Aufbau</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {st.map((x, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <div style={{ width: 90, height: Math.max(5, Math.min(26, x.t * 60)), borderRadius: 2, background: x.kind === 'Kupfer' ? '#c87533' : x.kind === 'Lötstopp' ? '#1f6b3a' : '#c8b98a' }} />
                  <span style={{ flex: 1 }}>{x.name}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--muted)' }}>{x.t.toFixed(3)} mm</span>
                </div>
              ))}
            </div>
            <div className="info-text" style={{ marginTop: 10 }}>
              Gesamt: {st.reduce((a, x) => a + x.t, 0).toFixed(2)} mm. Bei mehr als 2 Lagen werden Innenlagen für Masse/Versorgung empfohlen.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
