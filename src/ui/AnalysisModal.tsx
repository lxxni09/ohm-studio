import { useMemo, useState } from 'react';
import { useStore, set } from '../state/store';
import { runProject } from '../analysis/runner';
import { emcCheck, fmea, lifetime, monteCarlo, powerIntegrity, signalIntegrity, thermalAnalysis, type FmeaRow, type McResult } from '../analysis/analyses';
import { computePcb } from '../views/pcbLayout';
import { formatValue } from '../lib/units';
import { can } from '../license/license';
import { download, exportName } from './files';

type Tab = 'uebersicht' | 'waerme' | 'montecarlo' | 'fmea' | 'lebensdauer' | 'pi' | 'si' | 'emv';
const TABS: [Tab, string][] = [
  ['uebersicht', 'Übersicht'],
  ['waerme', 'Wärme'],
  ['montecarlo', 'Monte Carlo'],
  ['fmea', 'FMEA'],
  ['lebensdauer', 'Lebensdauer'],
  ['pi', 'Power Integrity'],
  ['si', 'Signalintegrität'],
  ['emv', 'EMV'],
];

const Dot = ({ l }: { l: 'ok' | 'warn' | 'error' }) => <span className={`lvl lvl-${l}`} />;
const fmt = (v: number, u: string) => (u === 'A' ? formatValue(v, 'A') : u === 'W' ? formatValue(v, 'W') : `${v.toFixed(3)} ${u}`);

export function AnalysisBody() {
  const project = useStore((s) => s.project);
  const rev = useStore((s) => s.rev);
  const [tab, setTab] = useState<Tab>('uebersicht');
  const [ambient, setAmbient] = useState(25);
  const [mc, setMc] = useState<McResult | null>(null);
  const [fm, setFm] = useState<FmeaRow[] | null>(null);
  const [busy, setBusy] = useState('');
  const [mcSel, setMcSel] = useState(0);
  const [runs, setRuns] = useState(200);

  const m = useMemo(() => runProject(project), [project, rev]);
  const L = useMemo(() => computePcb(project), [project, rev]);
  const th = useMemo(() => thermalAnalysis(project, m, ambient), [project, m, ambient]);
  const life = useMemo(() => lifetime(project, m, ambient), [project, m, ambient]);
  const pi = useMemo(() => powerIntegrity(project, m, L), [project, m, L]);
  const si = useMemo(() => signalIntegrity(project, L), [project, L]);
  const emc = useMemo(() => emcCheck(project, L), [project, L]);

  if (!can('analyses'))
    return (
      <p className="info-text">
        Die Analysen (Wärme, Monte Carlo, FMEA, SI/PI, EMV) gehören zu Nodaris Pro.{' '}
        <button className="chip-btn" onClick={() => set({ modal: 'account' })}>
          Pläne ansehen
        </button>
      </p>
    );

  const worst = (xs: { level: 'ok' | 'warn' | 'error' }[]): 'ok' | 'warn' | 'error' => (xs.some((x) => x.level === 'error') ? 'error' : xs.some((x) => x.level === 'warn') ? 'warn' : 'ok');

  return (
    <div className="analysis">
      <div className="seg seg-scroll" style={{ marginBottom: 14 }}>
        {TABS.map(([k, v]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {v}
          </button>
        ))}
      </div>

      {tab === 'uebersicht' && (
        <div className="an-cards">
          {(
            [
              ['waerme', 'Wärme', worst(th), th.length ? `heißestes Teil: ${th.slice().sort((a, b) => b.t - a.t)[0].id} ${th.slice().sort((a, b) => b.t - a.t)[0].t.toFixed(0)} °C` : 'keine Wärmequellen'],
              ['lebensdauer', 'Zuverlässigkeit', life.years < 5 ? 'warn' : 'ok', `MTBF ≈ ${Number.isFinite(life.mtbf) ? Math.round(life.mtbf).toLocaleString('de-DE') : '∞'} h (${Number.isFinite(life.years) ? life.years.toFixed(0) : '∞'} Jahre)`],
              ['pi', 'Power Integrity', worst(pi), pi.length ? `max. Spannungsabfall ${Math.max(...pi.map((r) => r.drop * 1000)).toFixed(1)} mV` : 'keine Versorgungsbahnen'],
              ['si', 'Signalintegrität', worst(si), `${si.length} Signalnetze geprüft`],
              ['emv', 'EMV', worst(emc), `${emc.filter((e) => e.level !== 'ok').length} Hinweise`],
              ['montecarlo', 'Toleranzen', mc ? 'ok' : 'warn', mc ? `${mc.runs} Läufe berechnet` : 'noch nicht berechnet'],
              ['fmea', 'FMEA', fm ? (fm.some((r) => r.rpn >= 200) ? 'error' : fm.some((r) => r.rpn >= 100) ? 'warn' : 'ok') : 'warn', fm ? `${fm.length} Fehlerarten, höchste RPZ ${fm[0]?.rpn ?? 0}` : 'noch nicht berechnet'],
            ] as [Tab, string, 'ok' | 'warn' | 'error', string][]
          ).map(([k, t, l, d]) => (
            <button key={k} className="an-card" onClick={() => setTab(k)}>
              <Dot l={l} />
              <b>{t}</b>
              <small>{d}</small>
            </button>
          ))}
          <p className="info-text" style={{ gridColumn: '1 / -1' }}>
            Alle Analysen rechnen lokal mit dem Simulator und dem Platinenlayout. Sie sind Ingenieurs-Abschätzungen nach gängigen Normen (IPC-2221, IPC-2141, SN 29500, Arrhenius) und ersetzen keine Messung am Prototyp.
          </p>
        </div>
      )}

      {tab === 'waerme' && (
        <div className="team-grid">
          <div>
            <div className="row-form">
              <label>Umgebung</label>
              <input className="field" type="number" value={ambient} onChange={(e) => setAmbient(Number(e.target.value))} style={{ width: 90 }} />
            </div>
            <HeatMap L={L} rows={th} ambient={ambient} />
          </div>
          <div className="table-wrap" style={{ maxHeight: 420 }}>
            <table className="bom-table">
              <thead>
                <tr>
                  <th />
                  <th>Teil</th>
                  <th>Gehäuse</th>
                  <th>Leistung</th>
                  <th>Temp.</th>
                  <th>Hinweis</th>
                </tr>
              </thead>
              <tbody>
                {th.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Dot l={r.level} />
                    </td>
                    <td>{r.id}</td>
                    <td>
                      <small>{r.pkg}</small>
                    </td>
                    <td>
                      {formatValue(r.p, 'W')}
                      {r.pmax ? <small> / {formatValue(r.pmax, 'W')}</small> : null}
                    </td>
                    <td>
                      {r.t.toFixed(0)} °C <small>/ {r.tmax}</small>
                    </td>
                    <td>
                      <small>{r.hint ?? ''}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'montecarlo' && (
        <div>
          <div className="btn-row" style={{ alignItems: 'center' }}>
            <span className="info-text" style={{ margin: 0 }}>
              Läufe:
            </span>
            <select className="field" style={{ width: 'auto' }} value={runs} onChange={(e) => setRuns(Number(e.target.value))}>
              {[50, 100, 200, 500, 1000].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
            <button
              className="btn primary"
              disabled={!!busy}
              onClick={async () => {
                setBusy('0');
                setMc(await monteCarlo(project, runs, (k) => setBusy(String(k))));
                setBusy('');
              }}
            >
              {busy ? `Rechne … ${busy}/${runs}` : 'Monte Carlo + Worst-Case starten'}
            </button>
          </div>
          <p className="info-text">Bauteilwerte werden innerhalb ihrer Toleranz (Widerstände 5 %, Kondensatoren 10 %, Elkos 20 % – oder Eigenschaft „toleranz“) normalverteilt variiert. Worst-Case setzt alle Toleranzen an die Grenzen.</p>
          {mc && (
            <div className="team-grid">
              <div className="table-wrap" style={{ maxHeight: 380 }}>
                <table className="bom-table">
                  <thead>
                    <tr>
                      <th>Größe</th>
                      <th>Nominal</th>
                      <th>σ</th>
                      <th>Worst-Case</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mc.metrics.map((x, i) => (
                      <tr key={x.key} className={mcSel === i ? 'sel-row' : ''} onClick={() => setMcSel(i)} style={{ cursor: 'pointer' }}>
                        <td>{x.label}</td>
                        <td>{fmt(x.nominal, x.unit)}</td>
                        <td>{x.nominal ? `${((x.sd / Math.abs(x.nominal)) * 100).toFixed(2)} %` : fmt(x.sd, x.unit)}</td>
                        <td>
                          <small>
                            {fmt(mc.worst[i].low, x.unit)} … {fmt(mc.worst[i].high, x.unit)}
                          </small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {mc.metrics[mcSel] && <Histogram m={mc.metrics[mcSel]} />}
            </div>
          )}
        </div>
      )}

      {tab === 'fmea' && (
        <div>
          <div className="btn-row">
            <button
              className="btn primary"
              disabled={!!busy}
              onClick={async () => {
                setBusy('…');
                setFm(await fmea(project, (k, n) => setBusy(`${k}/${n}`)));
                setBusy('');
              }}
            >
              {busy ? `Simuliere Fehler … ${busy}` : 'FMEA berechnen'}
            </button>
            {fm && (
              <button className="btn" onClick={() => download(exportName('-fmea.csv'), '﻿' + ['Teil;Typ;Fehlerart;Auswirkung;S;O;D;RPZ;Maßnahme', ...fm.map((r) => [r.id, r.type, r.mode, `"${r.effect}"`, r.s, r.o, r.d, r.rpn, `"${r.action}"`].join(';'))].join('\r\n'), 'text/csv')}>
                Als CSV
              </button>
            )}
          </div>
          <p className="info-text">Jede Fehlerart (Unterbrechung, Kurzschluss, Drift) wird wirklich simuliert und mit dem Normalbetrieb verglichen. S = Schwere, O = Auftreten (aus Ausfallraten), D = Entdeckung (besser mit Tests im Projekt), RPZ = S × O × D.</p>
          {fm && (
            <div className="table-wrap" style={{ maxHeight: 420 }}>
              <table className="bom-table">
                <thead>
                  <tr>
                    <th>Teil</th>
                    <th>Fehlerart</th>
                    <th>Auswirkung</th>
                    <th>S</th>
                    <th>O</th>
                    <th>D</th>
                    <th>RPZ</th>
                    <th>Maßnahme</th>
                  </tr>
                </thead>
                <tbody>
                  {fm.map((r, i) => (
                    <tr key={i}>
                      <td>{r.id}</td>
                      <td>{r.mode}</td>
                      <td>
                        <small>{r.effect}</small>
                      </td>
                      <td>{r.s}</td>
                      <td>{r.o}</td>
                      <td>{r.d}</td>
                      <td>
                        <b className={r.rpn >= 200 ? 'txt-err' : r.rpn >= 100 ? 'txt-warn' : ''}>{r.rpn}</b>
                      </td>
                      <td>
                        <small>{r.action}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'lebensdauer' && (
        <div>
          <div className="an-cards">
            <div className="an-card">
              <b>{life.fit.toFixed(0)} FIT</b>
              <small>Ausfälle je 10⁹ Betriebsstunden</small>
            </div>
            <div className="an-card">
              <b>{Number.isFinite(life.mtbf) ? Math.round(life.mtbf).toLocaleString('de-DE') : '∞'} h</b>
              <small>MTBF (mittlere Zeit bis zum Ausfall)</small>
            </div>
            <div className="an-card">
              <b>{Number.isFinite(life.years) ? `${life.years.toFixed(1)} Jahre` : '∞'}</b>
              <small>bei Dauerbetrieb und {ambient} °C</small>
            </div>
          </div>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="bom-table">
              <thead>
                <tr>
                  <th>Teil</th>
                  <th>Verschleiß</th>
                  <th>Lebensdauer</th>
                  <th>Annahme</th>
                </tr>
              </thead>
              <tbody>
                {life.rows.map((r) => (
                  <tr key={r.id + r.what}>
                    <td>{r.id}</td>
                    <td>{r.what}</td>
                    <td>
                      {Math.round(r.hours).toLocaleString('de-DE')} h <small>({(r.hours / 8760).toFixed(1)} Jahre)</small>
                    </td>
                    <td>
                      <small>{r.note}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'pi' && (
        <div className="table-wrap">
          <table className="bom-table">
            <thead>
              <tr>
                <th />
                <th>Netz</th>
                <th>Strom</th>
                <th>Länge</th>
                <th>Breite</th>
                <th>Widerstand</th>
                <th>IR-Drop</th>
                <th>Belastbarkeit (IPC-2221, ΔT 10 K)</th>
              </tr>
            </thead>
            <tbody>
              {pi.map((r) => (
                <tr key={r.net}>
                  <td>
                    <Dot l={r.level} />
                  </td>
                  <td>{r.net}</td>
                  <td>{formatValue(r.current, 'A')}</td>
                  <td>{r.lengthMm.toFixed(0)} mm</td>
                  <td>{r.widthMm.toFixed(2)} mm</td>
                  <td>{(r.r * 1000).toFixed(1)} mΩ</td>
                  <td>
                    {(r.drop * 1000).toFixed(2)} mV {r.dropPct > 0 && <small>({(r.dropPct * 100).toFixed(2)} %)</small>}
                  </td>
                  <td>{r.capacity.toFixed(2)} A</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!pi.length && <div className="empty-diff">Keine Versorgungsbahnen auf der Platine.</div>}
        </div>
      )}

      {tab === 'si' && (
        <div className="table-wrap">
          <table className="bom-table">
            <thead>
              <tr>
                <th />
                <th>Netz</th>
                <th>Art</th>
                <th>Länge</th>
                <th>Z₀</th>
                <th>Laufzeit</th>
                <th>krit. Länge</th>
                <th>Bewertung</th>
              </tr>
            </thead>
            <tbody>
              {si.map((r) => (
                <tr key={r.net}>
                  <td>
                    <Dot l={r.level} />
                  </td>
                  <td>{r.net}</td>
                  <td>{r.kind}</td>
                  <td>{r.lengthMm.toFixed(0)} mm</td>
                  <td>{r.z0.toFixed(0)} Ω</td>
                  <td>{(r.delayNs * 1000).toFixed(0)} ps</td>
                  <td>{r.critMm.toFixed(0)} mm</td>
                  <td>
                    <small>{r.note}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!si.length && <div className="empty-diff">Keine Signalnetze an Mikrocontrollern auf der Platine.</div>}
        </div>
      )}

      {tab === 'emv' && (
        <div className="emc-list">
          {emc.map((e, i) => (
            <div key={i} className="emc-item">
              <Dot l={e.level} />
              <b>{e.rule}</b>
              <span>{e.text}</span>
            </div>
          ))}
          {!emc.length && <div className="empty-diff">Keine Auffälligkeiten.</div>}
        </div>
      )}
    </div>
  );
}

function HeatMap({ L, rows, ambient }: { L: ReturnType<typeof computePcb>; rows: ReturnType<typeof thermalAnalysis>; ambient: number }) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const tMax = Math.max(ambient + 20, ...rows.map((r) => r.t));
  const color = (t: number) => {
    const k = Math.max(0, Math.min(1, (t - ambient) / (tMax - ambient)));
    const h = 60 - 60 * k;
    return `hsla(${h} 100% 55% / ${0.25 + 0.7 * k})`;
  };
  return (
    <svg viewBox={`-5 -5 ${L.w + 10} ${L.h + 10}`} className="heatmap">
      <defs>
        <filter id="blur-h">
          <feGaussianBlur stdDeviation="10" />
        </filter>
      </defs>
      <rect x={0} y={0} width={L.w} height={L.h} rx={4} fill="#123d2b" />
      <g filter="url(#blur-h)" opacity={0.9}>
        {L.footprints.map((f) => {
          const r = byId.get(f.id);
          if (!r || r.t - ambient < 1) return null;
          return <ellipse key={f.id} cx={f.x + f.w / 2} cy={f.y + f.h / 2} rx={f.w / 2 + 10} ry={f.h / 2 + 10} fill={color(r.t)} />;
        })}
      </g>
      {L.footprints.map((f) => (
        <g key={f.id}>
          <rect x={f.x} y={f.y} width={f.w} height={f.h} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={0.6} rx={2} />
          <text x={f.x + f.w / 2} y={f.y + f.h / 2 + 3} textAnchor="middle" fontSize={8} fill="#fff">
            {f.id} {byId.get(f.id) ? `${byId.get(f.id)!.t.toFixed(0)}°` : ''}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Histogram({ m }: { m: McResult['metrics'][number] }) {
  const bins = 24;
  const lo = m.min;
  const hi = m.max === m.min ? m.min + 1e-9 : m.max;
  const counts = new Array(bins).fill(0);
  for (const v of m.values) counts[Math.min(bins - 1, Math.floor(((v - lo) / (hi - lo)) * bins))]++;
  const cmax = Math.max(...counts);
  return (
    <div>
      <b style={{ fontSize: 13 }}>{m.label}</b>
      <svg viewBox="0 0 240 120" className="histogram">
        {counts.map((c, i) => (
          <rect key={i} x={i * 10 + 1} y={110 - (c / cmax) * 100} width={8} height={(c / cmax) * 100} rx={1.5} fill="#0a84ff" />
        ))}
        <line x1={((m.nominal - lo) / (hi - lo)) * 240} x2={((m.nominal - lo) / (hi - lo)) * 240} y1={0} y2={110} stroke="#ff9f0a" strokeDasharray="3 2" />
        <line x1={0} x2={240} y1={110} y2={110} stroke="var(--border-strong)" />
      </svg>
      <div className="info-text" style={{ display: 'flex', justifyContent: 'space-between', margin: 0 }}>
        <span>{fmt(m.min, m.unit)}</span>
        <span style={{ color: '#ff9f0a' }}>nominal</span>
        <span>{fmt(m.max, m.unit)}</span>
      </div>
      <p className="info-text">
        Mittelwert {fmt(m.mean, m.unit)}, Standardabweichung {fmt(m.sd, m.unit)}. 99,7 % aller Geräte liegen zwischen {fmt(m.mean - 3 * m.sd, m.unit)} und {fmt(m.mean + 3 * m.sd, m.unit)}.
      </p>
    </div>
  );
}
