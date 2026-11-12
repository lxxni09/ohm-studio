import { useState } from 'react';
import { getPart, findPin } from '../parts/registry';
import type { PropDef } from '../parts/types';
import { parseValue, formatValue } from '../lib/units';
import { changed, checkpoint, duplicateSelection, engine, removeSelection, renamePart, rotateSelection, set, setProp, state, useStore } from '../state/store';
import { PartThumb } from './Library';
import { Icon } from './icons';
import { netColor } from '../views/wires';
import { splitRef } from '../ohm/model';
import { bomRows } from '../export/bom';
import { NetWireOptions } from '../views/WireControls';

function PropField({ id, p, value }: { id: string; p: PropDef; value: unknown }) {
  const [draft, setDraft] = useState<string | null>(null);
  const live = p.live || state.sim === 'stopped' ? p.live : false;
  switch (p.type) {
    case 'range':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="range" min={p.min} max={p.max} step={p.step} value={Number(value)} onChange={(e) => setProp(id, p.key, Number(e.target.value), true)} onPointerDown={() => checkpoint()} />
          <span style={{ minWidth: 54, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
            {Number(value).toLocaleString('de-DE', { maximumFractionDigits: (p.step ?? 1) < 1 ? 2 : 0 })} {p.unit}
          </span>
        </div>
      );
    case 'bool':
      return <button className={`toggle ${value ? 'on' : ''}`} onClick={() => setProp(id, p.key, !value, !!p.live)} aria-label={p.label} aria-pressed={!!value} />;
    case 'select':
      return (
        <select className="field" value={String(value)} onChange={(e) => {
          const opt = (p.options ?? []).find((o) => String(typeof o === 'string' ? o : o.value) === e.target.value);
          const v = typeof opt === 'object' ? opt.value : e.target.value;
          setProp(id, p.key, v === 'true' ? true : v === 'false' ? false : v, !!live);
        }}>
          {(p.options ?? []).map((o) => {
            const v = typeof o === 'string' ? o : String(o.value);
            return (
              <option key={v} value={v}>
                {typeof o === 'string' ? o : o.label}
              </option>
            );
          })}
        </select>
      );
    case 'value': {
      const text = draft ?? String(value ?? '');
      const ok = Number.isFinite(parseValue(text, NaN));
      return (
        <input
          className={`field ${ok ? '' : 'bad'}`}
          value={text}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== null && ok) setProp(id, p.key, draft, false);
            setDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          title={ok ? formatValue(parseValue(text), p.unit ?? '') : 'Ungültiger Wert'}
        />
      );
    }
    case 'number':
      return <input className="field" type="number" value={Number(value ?? 0)} onChange={(e) => setProp(id, p.key, Number(e.target.value), !!p.live)} />;
    default:
      return <input className="field" value={String(value ?? '')} onChange={(e) => setProp(id, p.key, e.target.value, !!p.live)} />;
  }
}

function Readings({ st }: { st: Record<string, any> }) {
  const items: [string, string][] = [];
  if (typeof st.v === 'number') items.push(['Spannung', formatValue(st.v, 'V')]);
  if (typeof st.i === 'number') items.push(['Strom', formatValue(Math.abs(st.i), 'A')]);
  if (typeof st.p === 'number') items.push(['Leistung', formatValue(st.p, 'W')]);
  if (typeof st.ic === 'number') items.push(['I_C', formatValue(Math.abs(st.ic), 'A')]);
  if (typeof st.id === 'number') items.push(['I_D', formatValue(Math.abs(st.id), 'A')]);
  if (typeof st.brightness === 'number') items.push(['Helligkeit', `${Math.round(Math.min(1, st.brightness) * 100)} %`]);
  if (typeof st.soc === 'number') items.push(['Ladung', `${(st.soc * 100).toFixed(1)} %`]);
  if (typeof st.angle === 'number' && st.target !== undefined) items.push(['Winkel', `${Math.round(st.angle)}°`]);
  if (typeof st.rpm === 'number') items.push(['Drehzahl', `${Math.round(st.rpm)} U/min`]);
  if (typeof st.reading === 'string') items.push(['Anzeige', `${st.reading} ${st.unit ?? ''}`]);
  if (st.powered !== undefined) items.push(['Versorgt', st.powered ? 'ja' : 'nein']);
  if (st.sleep) items.push(['Modus', st.sleep === 'deep' ? 'Deep-Sleep' : 'aktiv']);
  if (!items.length) return null;
  return (
    <div className="readings">
      {items.slice(0, 6).map(([k, v]) => (
        <div className="reading" key={k}>
          <small>{k}</small>
          <b>{v}</b>
        </div>
      ))}
    </div>
  );
}

function PartInspector({ id }: { id: string }) {
  useStore((s) => s.tick);
  const sim = useStore((s) => s.sim);
  const inst = state.project.parts.find((p) => p.id === id);
  const [name, setName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!inst) return null;
  const def = getPart(inst.type);
  if (!def) return null;
  const st = engine.states.get(id) ?? {};
  const pins = def.pins(inst.props).filter((p) => p.x > -100);
  const netOf = (pinId: string) => state.project.nets.find((n) => n.pins.some((r) => splitRef(r)[0] === id && findPin(def, inst.props, splitRef(r)[1])?.id === pinId));
  const search = encodeURIComponent(def.bom?.(inst.props) ?? def.name);
  return (
    <div className="insp">
      <div className="insp-head">
        <div className="insp-thumb">
          <PartThumb def={def} props={inst.props} size={50} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <input
            className="field"
            style={{ fontWeight: 600, fontSize: 15, border: 'none', padding: 0, height: 24, background: 'transparent', boxShadow: 'none' }}
            value={name ?? inst.id}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name !== null && name !== inst.id) setErr(renamePart(inst.id, name));
              setName(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            title="Bezeichner umbenennen"
          />
          <div className="info-text" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {def.name}
          </div>
          {err && <div style={{ color: 'var(--red)', fontSize: 11 }}>{err}</div>}
        </div>
      </div>
      {sim !== 'stopped' && <Readings st={st} />}
      {(def.props?.length ?? 0) > 0 && (
        <div>
          <h3>Eigenschaften</h3>
          <div className="card" style={{ padding: '6px 12px' }}>
            {def.props!.map((p) => (
              <div className="row" key={p.key} title={p.hint}>
                <label>{p.label}</label>
                <PropField id={id} p={p} value={inst.props[p.key]} />
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="btn-row">
        <button className="btn" onClick={rotateSelection} title="Drehen (R)">
          <Icon.rotate size={14} /> Drehen
        </button>
        <button className="btn" onClick={duplicateSelection} title="Duplizieren (⌘D)">
          <Icon.copy size={14} /> Duplizieren
        </button>
        <button className="btn danger" onClick={removeSelection} title="Löschen (⌫)">
          <Icon.trash size={14} />
        </button>
        {def.board && !def.board.linux && (
          <button className="btn" onClick={() => set({ codeTarget: id, bottomOpen: true, bottomTab: 'code' })}>
            <Icon.code size={14} /> Code
          </button>
        )}
        {def.board?.linux && (
          <button className="btn primary" onClick={() => set({ piMonitor: id })}>
            <Icon.monitor size={14} /> Monitor
          </button>
        )}
      </div>
      {pins.length > 0 && (
        <div>
          <h3>Anschlüsse</h3>
          <div className="card" style={{ padding: 4 }}>
            <div className="pinlist">
              {pins.map((p) => {
                const net = netOf(p.id);
                const v = sim !== 'stopped' ? engine.pinVoltage(id, p.id) : null;
                return (
                  <div className="pinrow" key={p.id}>
                    <span className="pn">{p.label ?? p.id}</span>
                    <span className="net">
                      {net ? (
                        <>
                          <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 4, background: netColor(net.name, state.project), marginRight: 5 }} />
                          {net.name}
                        </>
                      ) : (
                        '—'
                      )}
                    </span>
                    {v !== null && <span className="v">{v.toFixed(2)} V</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <div>
        <h3>Datenblatt</h3>
        <div className="card">
          <div className="info-text">{def.info}</div>
          {def.specs && (
            <dl className="kv" style={{ marginTop: 10 }}>
              {Object.entries(def.specs).map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {!def.noBom && def.price !== undefined && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12 }}>
              <Icon.cart size={14} />
              <span>ca. {def.price.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</span>
              <span className="spacer" />
              <a className="link" href={`https://www.reichelt.de/index.html?ACTION=446&SEARCH=${search}`} target="_blank" rel="noreferrer">
                Reichelt
              </a>
              <a className="link" href={`https://www.berrybase.de/search?search=${search}`} target="_blank" rel="noreferrer">
                BerryBase
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NetInspector({ name }: { name: string }) {
  const net = state.project.nets.find((n) => n.name === name);
  const [draft, setDraft] = useState<string | null>(null);
  useStore((s) => s.tick);
  if (!net) return null;
  const colors = ['#e03131', '#26272b', '#2b6fd6', '#f2b705', '#2f9e44', '#f07c1b', '#8e44ad', '#f1f3f5'];
  return (
    <div className="insp">
      <div>
        <h3>Netz</h3>
        <input
          className="field"
          value={draft ?? net.name}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const n = (draft ?? '').trim();
            if (draft !== null && n && !state.project.nets.some((x) => x.name === n)) {
              checkpoint();
              if (state.project.wireColors?.[net.name]) {
                state.project.wireColors[n] = state.project.wireColors[net.name];
              }
              net.name = n;
              set({ selectedNet: n });
              changed(false);
            }
            setDraft(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
      <div>
        <h3>Kabelfarbe</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          {colors.map((c) => (
            <button
              key={c}
              onClick={() => {
                state.project.wireColors = { ...(state.project.wireColors ?? {}), [net.name]: c };
                changed(false);
              }}
              style={{ width: 22, height: 22, borderRadius: 11, border: netColor(net.name, state.project) === c ? '2px solid var(--accent)' : '1px solid var(--border-strong)', background: c, cursor: 'pointer' }}
            />
          ))}
        </div>
      </div>
      <NetWireOptions net={net.name} />
      <div>
        <h3>Verbundene Pins ({net.pins.length})</h3>
        <div className="card" style={{ padding: 4 }}>
          {net.pins.map((r) => (
            <div className="pinrow" key={r}>
              <span className="pn">{r}</span>
              <span className="spacer" />
              <button
                className="icon-btn"
                style={{ width: 22, height: 22 }}
                title="Pin aus dem Netz lösen"
                onClick={() => {
                  checkpoint();
                  net.pins = net.pins.filter((x) => x !== r);
                  if (net.pins.length < 2) state.project.nets = state.project.nets.filter((x) => x !== net);
                  changed();
                }}
              >
                <Icon.close size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>
      {state.sim !== 'stopped' && (
        <div className="card">
          <div className="info-text">Spannung</div>
          <div className="big-number">{formatValue(engine.pinVoltage(splitRef(net.pins[0])[0], (() => {
            const [pid, pn] = splitRef(net.pins[0]);
            const inst = state.project.parts.find((p) => p.id === pid);
            const d = inst && getPart(inst.type);
            return (d && findPin(d, inst!.props, pn)?.id) ?? pn;
          })()) ?? 0, 'V')}</div>
        </div>
      )}
      <button className="btn danger" onClick={removeSelection}>
        <Icon.trash size={14} /> Netz löschen
      </button>
    </div>
  );
}

function ProjectInspector() {
  const project = useStore((s) => s.project);
  const issues = useStore((s) => s.issues);
  useStore((s) => s.dirty);
  useStore((s) => s.rev);
  const rows = bomRows(project);
  const total = rows.reduce((s, r) => s + r.preis * r.anzahl, 0);
  const errs = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warn').length;
  const upd = (k: 'name' | 'autor' | 'beschreibung', v: string) => {
    project[k] = v;
    changed(false);
  };
  return (
    <div className="insp">
      <div>
        <h3>Projekt</h3>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input className="field" value={project.name} onChange={(e) => upd('name', e.target.value)} placeholder="Projektname" style={{ fontWeight: 600 }} />
          <input className="field" value={project.autor ?? ''} onChange={(e) => upd('autor', e.target.value)} placeholder="Autor" />
          <textarea className="field" rows={3} value={project.beschreibung ?? ''} onChange={(e) => upd('beschreibung', e.target.value)} placeholder="Was macht das Projekt?" />
        </div>
      </div>
      <div className="readings">
        <div className="reading">
          <small>Teile</small>
          <b>{project.parts.length}</b>
        </div>
        <div className="reading">
          <small>Netze</small>
          <b>{project.nets.length}</b>
        </div>
        <div className="reading">
          <small>Kosten</small>
          <b>{total.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}</b>
        </div>
      </div>
      <div>
        <h3>Prüfung</h3>
        <button className="card" style={{ width: '100%', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => set({ bottomOpen: true, bottomTab: 'messages' })}>
          {errs ? <span className="badge err">{errs} Fehler</span> : warns ? <span className="badge warn">{warns} Hinweise</span> : <span className="badge ok">Alles in Ordnung</span>}
          <span className="info-text">Details anzeigen</span>
        </button>
      </div>
      <VariantCard />
      <div>
        <h3>Simulation</h3>
        <div className="card" style={{ padding: '6px 12px' }}>
          <div className="row" title="Bauteiltoleranzen, Rauschen, Tasterprellen, Bauteile können zerstört werden">
            <label>Realismus-Modus</label>
            <button className={`toggle ${project.settings.realism ? 'on' : ''}`} aria-label="Realismus-Modus" aria-pressed={!!project.settings.realism} onClick={() => {
              project.settings.realism = !project.settings.realism;
              changed(false);
            }} />
          </div>
          <div className="row">
            <label>Zeitschritt</label>
            <select className="field" aria-label="Zeitschritt" value={project.settings.dt} onChange={(e) => {
              project.settings.dt = Number(e.target.value);
              changed(false);
            }}>
              <option value={0.0001}>0,1 ms (genau)</option>
              <option value={0.0005}>0,5 ms</option>
              <option value={0.001}>1 ms (Standard)</option>
              <option value={0.005}>5 ms (schnell)</option>
            </select>
          </div>
          <div className="row">
            <label>Schaltplan-Symbole</label>
            <div className="seg">
              {(['IEC', 'ANSI'] as const).map((s) => (
                <button key={s} className={(project.views.schaltplan?.symbole ?? 'IEC') === s ? 'on' : ''} onClick={() => {
                  project.views.schaltplan = { ...(project.views.schaltplan ?? {}), symbole: s };
                  changed(false);
                }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="info-text">
        Tipp: Klicke auf einen Pin und dann auf einen zweiten, um ein Kabel zu ziehen. Mit <b>R</b> drehst du ein Teil, mit <b>⌫</b> löschst du es.
      </div>
    </div>
  );
}

function VariantCard() {
  useStore((s) => s.rev);
  const p = state.project;
  const names = Object.keys(p.variants ?? {});
  const [draft, setDraft] = useState('');
  return (
    <div>
      <h3>Varianten</h3>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <select className="field" aria-label="Bestückungsvariante" value={p.activeVariant ?? ''} onChange={(e) => {
          p.activeVariant = e.target.value || undefined;
          changed();
        }}>
          <option value="">Alle Teile bestückt</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n} (ohne {p.variants![n].ohne.length})
            </option>
          ))}
        </select>
        {p.activeVariant && state.selection.length === 1 && (
          <button className="btn" onClick={() => {
            checkpoint();
            const v = p.variants![p.activeVariant!];
            const id = state.selection[0];
            v.ohne = v.ohne.includes(id) ? v.ohne.filter((x) => x !== id) : [...v.ohne, id];
            changed();
          }}>
            Auswahl in dieser Variante (nicht) bestücken
          </button>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="field" placeholder="Neue Variante, z. B. ohne-wlan" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button className="btn" onClick={() => {
            const n = draft.trim();
            if (!n) return;
            checkpoint();
            p.variants = { ...(p.variants ?? {}), [n]: { ohne: [] } };
            p.activeVariant = n;
            setDraft('');
            changed();
          }}>
            Anlegen
          </button>
        </div>
        <div className="info-text">Nicht bestückte Teile fehlen in Simulation und Stückliste.</div>
      </div>
    </div>
  );
}

export function Inspector() {
  const sel = useStore((s) => s.selection);
  const net = useStore((s) => s.selectedNet);
  const open = useStore((s) => s.inspectorOpen);
  return (
    <aside className={`sidebar right ${open ? '' : 'collapsed'}`}>
      <div className="side-scroll" style={{ padding: 0 }}>
        {sel.length === 1 ? <PartInspector key={sel[0]} id={sel[0]} /> : net ? <NetInspector name={net} /> : sel.length > 1 ? (
          <div className="insp">
            <h2>{sel.length} Teile ausgewählt</h2>
            <div className="btn-row">
              <button className="btn" onClick={rotateSelection}>
                <Icon.rotate size={14} /> Drehen
              </button>
              <button className="btn" onClick={duplicateSelection}>
                <Icon.copy size={14} /> Duplizieren
              </button>
              <button className="btn danger" onClick={removeSelection}>
                <Icon.trash size={14} /> Löschen
              </button>
            </div>
          </div>
        ) : (
          <ProjectInspector />
        )}
      </div>
    </aside>
  );
}
