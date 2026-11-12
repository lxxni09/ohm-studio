import { changed, checkpoint, state, useStore } from '../state/store';

const STYLES: [string, string, string][] = [
  ['90', '90°', 'Rechtwinklig (Standard)'],
  ['45', '45°', 'Wie Leiterbahnen'],
  ['direkt', 'Direkt', 'Gerade Linie'],
  ['weich', 'Weich', 'Durchhängend wie v1'],
];

export function WireControls() {
  useStore((s) => s.rev);
  const k = state.project.views.kabel ?? {};
  return (
    <div className="floating" style={{ left: 14, top: 14, alignItems: 'center', padding: '3px 8px 3px 10px', gap: 8 }}>
      <span className="info-text">Kabel</span>
      <div className="seg">
        {STYLES.map(([v, l, t]) => (
          <button
            key={v}
            title={t}
            className={(k.stil ?? '90') === v ? 'on' : ''}
            onClick={() => {
              checkpoint();
              state.project.views.kabel = { ...k, stil: v as '90' };
              changed(false);
            }}
          >
            {l}
          </button>
        ))}
      </div>
      <label className="info-text" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} title="Kreuzungen verschiedener Netze mit kleinem Bogen zeichnen">
        <input
          type="checkbox"
          checked={(k.kreuzungen ?? 'bogen') === 'bogen'}
          onChange={(e) => {
            state.project.views.kabel = { ...k, kreuzungen: e.target.checked ? 'bogen' : 'keine' };
            changed(false);
          }}
        />
        Brücken
      </label>
    </div>
  );
}

export function NetWireOptions({ net }: { net: string }) {
  useStore((s) => s.rev);
  const k = state.project.views.kabel ?? {};
  const cur = k.netze?.[net] ?? '';
  const hasManual = Object.keys(k.knicke ?? {}).some((key) => state.project.nets.find((n) => n.name === net)?.pins.some((p) => key.split('|').includes(p)));
  return (
    <div>
      <h3>Kabelführung</h3>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <select
          className="field"
          value={cur}
          onChange={(e) => {
            checkpoint();
            const netze = { ...(k.netze ?? {}) };
            if (e.target.value) netze[net] = e.target.value as '90';
            else delete netze[net];
            state.project.views.kabel = { ...k, netze };
            changed(false);
          }}
        >
          <option value="">Wie im Projekt ({k.stil ?? '90'})</option>
          {STYLES.map(([v, l, t]) => (
            <option key={v} value={v}>
              {l} – {t}
            </option>
          ))}
        </select>
        <div className="info-text">Knickpunkte ziehen · Doppelklick aufs Kabel fügt einen hinzu, Doppelklick auf einen Punkt entfernt ihn.</div>
        {hasManual && (
          <button
            className="btn"
            onClick={() => {
              checkpoint();
              const pins = state.project.nets.find((n) => n.name === net)?.pins ?? [];
              const kn = Object.fromEntries(Object.entries(k.knicke ?? {}).filter(([key]) => !key.split('|').some((p) => pins.includes(p))));
              state.project.views.kabel = { ...k, knicke: kn };
              changed(false);
            }}
          >
            Automatisch verlegen
          </button>
        )}
      </div>
    </div>
  );
}
