import type { JSX } from 'react';
/**
 * Steckbrett-Ansicht: realistische Bauteile, hängende Kabel, Bedienung während der Simulation.
 */
import { remoteSelections, useCollab } from '../team/collabStore';
import { memo, useMemo, useRef, useState } from 'react';
import { getPart, findPin } from '../parts/registry';
import { SvgDefs } from '../parts/svg';
import { pinWorld } from '../sim/engine';
import type { PartInst } from '../ohm/model';
import { addPart, changed, checkpoint, connect, emit, engine, set, setProp, state, useStore } from '../state/store';
import { netSegments, segmentCurrents, voltColor, wirePath, netColor } from './wires';
import { routeAll, roundedPath, pathWithHops, crossings, hopsByWire, simplify, type RoutedWire, type Pt } from './router';
import { Viewport, type ViewportApi } from './Viewport';
import { WireControls } from './WireControls';
import { formatValue } from '../lib/units';
import { splitRef } from '../ohm/model';

function bounds() {
  const ps = state.project.parts;
  if (!ps.length) return { x: 0, y: 0, w: 800, h: 500 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of ps) {
    const d = getPart(p.type);
    if (!d) continue;
    const s = d.size(p.props);
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + s.w);
    y1 = Math.max(y1, p.y + s.h);
  }
  return { x: x0 - 20, y: y0 - 30, w: x1 - x0 + 40, h: y1 - y0 + 60 };
}

interface PartViewProps {
  inst: PartInst;
  selected: boolean;
  tick: number;
  running: boolean;
  propsKey: string;
  x: number;
  y: number;
  rot: number;
}

const PartView = memo(
  function PartView({ inst, selected, running }: PartViewProps) {
    const def = getPart(inst.type);
    if (!def) return null;
    const s = def.size(inst.props);
    const st = engine.states.get(inst.id) ?? {};
    const areas = [...(def.areas?.(inst.props) ?? []), ...(def.interaction?.area ? [{ ...def.interaction, area: def.interaction.area, key: def.interaction.key ?? (def.interaction.kind === 'toggle' ? 'an' : 'pressed') }] : [])];
    return (
      <g className={`part ${selected ? 'sel' : ''}`} data-part={inst.id} transform={`translate(${inst.x} ${inst.y}) rotate(${inst.rot} ${s.w / 2} ${s.h / 2})`}>
        <rect className="sel-box" x={-6} y={-6} width={s.w + 12} height={s.h + 12} />
        <g data-body={inst.id}>
          <rect x={0} y={0} width={s.w} height={s.h} fill="transparent" />
          {def.render({ props: inst.props, state: st, running, id: inst.id })}
        </g>
        {areas.map((a) => (
          <rect key={a.key} className="interact" data-interact={`${inst.id}|${a.key}|${a.kind}`} x={a.area.x} y={a.area.y} width={a.area.w} height={a.area.h} rx={4}>
            <title>{a.label}</title>
          </rect>
        ))}
      </g>
    );
  },
  (a, b) => a.inst === b.inst && a.selected === b.selected && a.propsKey === b.propsKey && a.x === b.x && a.y === b.y && a.rot === b.rot && a.running === b.running && (!a.running || a.tick === b.tick),
);

/** Pins als Klickflächen (oberste Ebene) */
function PinLayer({ hot }: { hot: string | null }) {
  const out: JSX.Element[] = [];
  for (const inst of state.project.parts) {
    const def = getPart(inst.type);
    if (!def || inst.type.startsWith('steckbrett')) continue;
    for (const pin of def.pins(inst.props)) {
      if (pin.x < -100) continue;
      const w = pinWorld(inst, def, pin);
      const ref = `${inst.id}.${pin.id}`;
      out.push(<rect key={ref} className={`pin-hit ${hot === ref ? 'hot' : ''}`} data-pin={ref} x={w.x - 4} y={w.y - 4} width={8} height={8} rx={2} />);
    }
  }
  return <g>{out}</g>;
}

const isStatic = (type: string) => type.startsWith('steckbrett');

export function Breadboard() {
  const project = useStore((s) => s.project);
  const sel = useStore((s) => s.selection);
  const selNet = useStore((s) => s.selectedNet);
  // Große Projekte: Ansicht nur jedes 8. Bild neu zeichnen, damit die Simulation genug Rechenzeit bekommt
  const tick = useStore((s) => (s.project.parts.length > 250 ? Math.floor(s.tick / 8) : s.tick));
  const partTick = tick;
  const sim = useStore((s) => s.sim);
  const wiring = useStore((s) => s.wiring);
  const learn = useStore((s) => s.learnMode);
  useStore((s) => s.issues);
  useStore((s) => s.rev);
  const running = sim !== 'stopped';
  const drag = useRef<{ ids: string[]; sx: number; sy: number; orig: Map<string, { x: number; y: number }>; moved: boolean; pot?: { id: string; start: number } } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const pressed = useRef<{ id: string; key: string } | null>(null);

  const segs = useMemo(() => netSegments(project), [project, project.parts.map((p) => `${p.x},${p.y},${p.rot}`).join(';'), project.nets.map((n) => n.pins.join(',')).join('|'), tick % 1 === 0 && drag.current?.moved ? tick : 0]);
  const b = useMemo(bounds, [project.parts.length]);
  const kabel = project.views.kabel ?? { stil: '90' };
  const dragging = !!drag.current?.moved;
  const routed: RoutedWire[] = routeAll(project, segs, { style: kabel.stil ?? '90', manual: kabel.knicke, netStyle: kabel.netze, fast: dragging });
  const hopMap = useMemo(() => hopsByWire(kabel.kreuzungen === 'keine' ? [] : crossings(routed)), [routed, kabel.kreuzungen]);
  const bend = useRef<{ key: string; idx: number; pts: Pt[] } | null>(null);
  const wireD = (w: RoutedWire) =>
    w.style === 'weich' && !w.manual ? wirePath(w.ax, w.ay, w.bx, w.by) : w.style === 'direkt' && !w.manual ? `M${w.ax} ${w.ay} L${w.bx} ${w.by}` : pathWithHops(w.pts, hopMap.get(w) ?? [], 2);

  // Lernmodus: Ströme in den Kabeln
  let flows: Map<(typeof segs)[number], number> | null = null;
  let vmax = 5;
  if (learn && running && engine.circuit) {
    const pinI = engine.pinCurrents();
    const canon = (r: string) => {
      const [pid, pn] = splitRef(r);
      const inst = project.parts.find((p) => p.id === pid);
      const def = inst && getPart(inst.type);
      const pin = def && findPin(def, inst!.props, pn);
      return `${pid}.${pin?.id ?? pn}`;
    };
    flows = segmentCurrents(segs, pinI, canon);
    vmax = Math.max(1, ...Array.from(engine.circuit.x));
  }

  const onPointerDown = (e: React.PointerEvent, api: ViewportApi) => {
    void api;
    void e;
    return false;
  };

  const handleDown = (e: React.PointerEvent<SVGGElement>, api: ViewportApi) => {
    const t = e.target as Element;
    const w = api.toWorld(e.clientX, e.clientY);
    // Bedienelement während der Simulation
    const inter = t.closest('[data-interact]')?.getAttribute('data-interact');
    if (inter && running) {
      const [id, key, kind] = inter.split('|');
      const st = engine.stateOf(id);
      const inst = project.parts.find((p) => p.id === id)!;
      if (kind === 'press') {
        st[key] = true;
        pressed.current = { id, key };
        engine.markDirty();
      } else if (kind === 'toggle') {
        if (key in inst.props || key === 'an' || key === 'bewegung') setProp(id, key, !inst.props[key], true);
        else st[key] = !st[key];
      } else if (kind === 'drag' && inst.props.position !== undefined) {
        drag.current = { ids: [], sx: w.x, sy: w.y, orig: new Map(), moved: false, pot: { id, start: Number(inst.props.position) } };
      }
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      e.stopPropagation();
      emit();
      return;
    }
    const bendAttr = t.getAttribute('data-bend');
    if (bendAttr) {
      const [key, idxS] = bendAttr.split('#');
      const w = routed.find((x) => x.key === key);
      if (w) {
        checkpoint();
        bend.current = { key, idx: Number(idxS), pts: w.pts.map((p) => ({ ...p })) };
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      }
      e.stopPropagation();
      return;
    }
    const pin = t.getAttribute('data-pin');
    if (pin) {
      if (state.wiring) {
        if (state.wiring.from !== pin) connect(state.wiring.from, pin);
        set({ wiring: null });
      } else set({ wiring: { from: pin }, selection: [], selectedNet: null });
      e.stopPropagation();
      return;
    }
    const wire = t.getAttribute('data-wire');
    if (wire) {
      set({ selectedNet: wire, selection: [] });
      e.stopPropagation();
      return;
    }
    const partId = t.closest('[data-part]')?.getAttribute('data-part');
    if (partId) {
      let ids = state.selection;
      if (e.shiftKey || e.metaKey) ids = ids.includes(partId) ? ids.filter((x) => x !== partId) : [...ids, partId];
      else if (!ids.includes(partId)) ids = [partId];
      set({ selection: ids, selectedNet: null, wiring: null });
      const orig = new Map(project.parts.filter((p) => ids.includes(p.id)).map((p) => [p.id, { x: p.x, y: p.y }]));
      drag.current = { ids, sx: w.x, sy: w.y, orig, moved: false };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      e.stopPropagation();
    }
  };

  const onMove = (e: React.PointerEvent, api: ViewportApi) => {
    const w = api.toWorld(e.clientX, e.clientY);
    if (state.wiring) setCursor(w);
    const t = e.target as Element;
    const pin = t.getAttribute?.('data-pin');
    if (pin !== hot) setHot(pin ?? null);
    if (pin) state.hoverPin = { ref: pin, x: e.clientX, y: e.clientY };
    else if (state.hoverPin) state.hoverPin = null;
    if (pin || state.hoverPin === null) emit();
    if (bend.current) {
      const B = bend.current;
      const pts = B.pts;
      const i = B.idx;
      const nx = Math.round(w.x / 5) * 5;
      const ny = Math.round(w.y / 5) * 5;
      const ortho = (project.views.kabel?.netze?.[state.selectedNet ?? ''] ?? project.views.kabel?.stil ?? '90') === '90';
      if (ortho) {
        // Nachbarpunkte mitziehen, damit alles rechtwinklig bleibt
        for (const j of [i - 1, i + 1]) {
          const q = pts[j];
          const horiz = Math.abs(q.y - pts[i].y) < 0.01;
          const isEnd = j === 0 || j === pts.length - 1;
          if (isEnd) {
            const helper = horiz ? { x: q.x, y: ny } : { x: nx, y: q.y };
            if (j === 0) {
              pts.splice(1, 0, helper);
              B.idx++;
            } else pts.splice(j, 0, helper);
          } else if (horiz) q.y = ny;
          else q.x = nx;
        }
      }
      pts[B.idx] = { x: nx, y: ny };
      const k = (project.views.kabel ??= {});
      k.knicke = { ...(k.knicke ?? {}), [B.key]: orientInterior(B.key, pts) };
      emit();
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (d.pot) {
      const inst = project.parts.find((p) => p.id === d.pot!.id)!;
      const v = Math.min(1, Math.max(0, d.pot.start + (w.x - d.sx) / 120 - (w.y - d.sy) / 120));
      setProp(inst.id, 'position', Math.round(v * 100) / 100, true);
      return;
    }
    const dx = w.x - d.sx;
    const dy = w.y - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 2) return;
    if (!d.moved) {
      checkpoint();
      d.moved = true;
    }
    for (const id of d.ids) {
      const p = project.parts.find((x) => x.id === id);
      const o = d.orig.get(id);
      if (!p || !o) continue;
      const snap = e.altKey ? 1 : 5;
      p.x = Math.round((o.x + dx) / snap) * snap;
      p.y = Math.round((o.y + dy) / snap) * snap;
    }
    engine.needsRebuild = true;
    engine.markDirty();
    emit();
  };

  /** Doppelklick: Knickpunkt einfügen (auf Kabel) oder entfernen (auf Knickpunkt) */
  const handleDbl = (e: React.MouseEvent, api: ViewportApi) => {
    const t = e.target as Element;
    const bendAttr = t.getAttribute('data-bend');
    const k = (project.views.kabel ??= {});
    if (bendAttr) {
      const [key, idxS] = bendAttr.split('#');
      const w = routed.find((x) => x.key === key);
      if (!w) return;
      checkpoint();
      const pts = w.pts.filter((_, i) => i !== Number(idxS));
      const inner = orientInterior(key, pts);
      const kn = { ...(k.knicke ?? {}) };
      if (inner.length) kn[key] = inner;
      else delete kn[key];
      k.knicke = kn;
      changed(false);
      return;
    }
    const key = t.getAttribute('data-wkey');
    if (!key) return;
    const w = routed.find((x) => x.key === key);
    if (!w) return;
    const p = api.toWorld(e.clientX, e.clientY);
    const q = { x: Math.round(p.x / 5) * 5, y: Math.round(p.y / 5) * 5 };
    // Segment mit kleinstem Abstand finden
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < w.pts.length - 1; i++) {
      const a = w.pts[i];
      const b = w.pts[i + 1];
      const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
      const tt = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
      const dd = Math.hypot(a.x + tt * (b.x - a.x) - p.x, a.y + tt * (b.y - a.y) - p.y);
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    }
    checkpoint();
    const pts = [...w.pts.slice(0, best + 1), q, ...w.pts.slice(best + 1)];
    k.knicke = { ...(k.knicke ?? {}), [key]: orientInterior(key, pts) };
    set({ selectedNet: w.net, selection: [] });
    changed(false);
  };

  const orientInterior = (key: string, pts: Pt[]) => {
    // Knicke werden immer von der alphabetisch ersten Seite aus gespeichert
    const w = routed.find((x) => x.key === key)!;
    const interior = pts.slice(1, -1).map((p) => ({ ...p }));
    return w.a < w.b ? interior : interior.reverse();
  };

  const onUp = (e: React.PointerEvent) => {
    if (bend.current) {
      bend.current = null;
      changed(false);
      return;
    }
    if (pressed.current) {
      const { id, key } = pressed.current;
      engine.stateOf(id)[key] = false;
      pressed.current = null;
      engine.markDirty();
      emit();
    }
    const d = drag.current;
    drag.current = null;
    if (d?.moved) changed();
    // Kabel durch Ziehen von Pin zu Pin
    const pin = (e.target as Element).getAttribute?.('data-pin');
    if (state.wiring && pin && pin !== state.wiring.from) {
      connect(state.wiring.from, pin);
      set({ wiring: null });
    }
  };

  const onDrop = (e: React.DragEvent, api: ViewportApi) => {
    const data = e.dataTransfer.getData('application/x-ohm-part');
    if (!data) return;
    const { type, preset } = JSON.parse(data);
    const def = getPart(type);
    if (!def) return;
    const w = api.toWorld(e.clientX, e.clientY);
    const s = def.size({ ...def.defaults, ...preset });
    addPart(type, w.x - s.w / 2, w.y - s.h / 2, preset);
  };

  const fromPos = wiring ? (() => {
    const [pid, pn] = splitRef(wiring.from);
    const inst = project.parts.find((p) => p.id === pid);
    const def = inst && getPart(inst.type);
    const pin = def && findPin(def, inst!.props, pn);
    return pin ? pinWorld(inst!, def!, pin) : null;
  })() : null;

  const staticParts = project.parts.filter((p) => isStatic(p.type));
  const otherParts = project.parts.filter((p) => !isStatic(p.type));

  return (
    <Viewport
      lod={project.parts.length > 250}
      persistKey="bb"
      bounds={b}
      onBackgroundDown={(e, api) => {
        onPointerDown(e, api);
        if (state.wiring) {
          set({ wiring: null });
          return true;
        }
        set({ selection: [], selectedNet: null });
        return false;
      }}
      onMove={onMove}
      onUp={onUp}
      onDrop={onDrop}
      overlay={<>{!running && <WireControls />}{
        wiring ? (
          <div className="hint">Kabel ziehen: Klicke auf den Ziel-Pin · Esc bricht ab</div>
        ) : running && project.parts.some((p) => getPart(p.type)?.interaction || getPart(p.type)?.areas) ? (
          <div className="hint">Simulation läuft – Taster, Schalter und Regler sind bedienbar</div>
        ) : null
      }</>}
    >
      {(api) => (
        <g onPointerDown={(e) => handleDown(e, api)} onDoubleClick={(e) => handleDbl(e, api)}>
          <SvgDefs />
          {staticParts.map((p) => (
            <PartView key={p.id} inst={p} selected={sel.includes(p.id)} tick={0} running={false} propsKey={JSON.stringify(p.props)} x={p.x} y={p.y} rot={p.rot} />
          ))}
          {(project.parts.length > 250 && api.visible ? otherParts.filter((p) => inView(p, api.visible!)) : otherParts).map((p) => (
            <PartView key={p.id} inst={p} selected={sel.includes(p.id)} tick={partTick} running={running} propsKey={JSON.stringify(p.props)} x={p.x} y={p.y} rot={p.rot} />
          ))}
          <RemoteSelections parts={project.parts} />
          {/* Kabel */}
          <g>
            {routed.map((s, i) => {
              const d = wireD(s);
              const flow = flows?.get(segs[i]) ?? 0;
              const v = learn && running ? engine.pinVoltage(splitRef(s.a)[0], (() => {
                const inst = project.parts.find((p) => p.id === splitRef(s.a)[0]);
                const def = inst && getPart(inst.type);
                return (def && findPin(def, inst!.props, splitRef(s.a)[1])?.id) ?? splitRef(s.a)[1];
              })()) : null;
              const col = learn && running && v !== null ? voltColor(v, vmax) : s.color;
              const aflow = Math.abs(flow);
              const dur = aflow > 1e-5 ? Math.max(0.25, Math.min(6, 0.04 / Math.pow(aflow, 0.5))) : 0;
              return (
                <g key={i}>
                  <path className="wire-hit" data-wire={s.net} data-wkey={s.key} d={d} />
                  <path className={`wire-sel ${selNet === s.net ? 'on' : ''}`} d={d} />
                  <path className="wire" d={d} stroke="rgba(0,0,0,0.25)" strokeWidth={3.6} transform="translate(0 1.5)" />
                  <path className="wire" d={d} stroke={col} strokeWidth={2.6} />
                  <path className="wire" d={d} stroke="#fff" strokeOpacity={0.28} strokeWidth={0.8} transform="translate(-0.4 -0.6)" />
                  {dur > 0 && <path className={`flow ${flow < 0 ? 'rev' : ''}`} d={d} stroke="#fff" strokeWidth={2} strokeDasharray="0.1 12" style={{ animationDuration: `${dur}s` }} />}
                  {[
                    [s.ax, s.ay],
                    [s.bx, s.by],
                  ].map(([x, y], k) => (
                    <g key={k} pointerEvents="none">
                      <rect x={x - 2.4} y={y - 2.4} width={4.8} height={4.8} rx={1} fill="#1d1d1f" />
                      <rect x={x - 1.6} y={y - 1.6} width={3.2} height={3.2} rx={0.6} fill={col} opacity={0.9} />
                    </g>
                  ))}
                </g>
              );
            })}
          </g>
          {selNet &&
            routed
              .filter((w) => w.net === selNet && w.style !== 'weich')
              .flatMap((w) =>
                w.pts.slice(1, -1).map((p, k) => (
                  <rect key={`${w.key}-${k}`} className="bend" data-bend={`${w.key}#${k + 1}`} x={p.x - 2.6} y={p.y - 2.6} width={5.2} height={5.2} rx={1.2}>
                    <title>Knickpunkt ziehen · Doppelklick entfernt ihn</title>
                  </rect>
                )),
              )}
          {wiring && fromPos && cursor && <path d={roundedPath(simplify([fromPos, { x: cursor.x, y: fromPos.y }, cursor]), 2)} stroke="var(--accent)" strokeWidth={2.4} fill="none" strokeDasharray="5 4" pointerEvents="none" />}
          <PinLayer hot={hot} />
        </g>
      )}
    </Viewport>
  );
}

/** Tooltip mit Pin-Spannung */
export function PinTooltip() {
  const hp = useStore((s) => s.hoverPin);
  useStore((s) => s.tick);
  if (!hp) return null;
  const [pid, pn] = splitRef(hp.ref);
  const inst = state.project.parts.find((p) => p.id === pid);
  const def = inst && getPart(inst.type);
  const pin = def?.pins(inst!.props).find((p) => p.id === pn);
  const net = state.project.nets.find((n) => n.pins.some((r) => r === hp.ref || (splitRef(r)[0] === pid && def && findPin(def, inst!.props, splitRef(r)[1])?.id === pn)));
  const v = state.sim !== 'stopped' ? engine.pinVoltage(pid, pn) : null;
  return (
    <div className="tooltip" style={{ left: hp.x, top: hp.y }}>
      <b>
        {pid}.{pin?.label ?? pn}
      </b>
      {pin?.gpio !== undefined && !pin.power ? ` · GPIO ${pin.gpio}` : ''}
      {net ? (
        <>
          {' '}
          · Netz <span style={{ color: netColor(net.name) === '#26272b' ? '#bbb' : netColor(net.name) }}>{net.name}</span>
        </>
      ) : (
        ' · nicht verbunden'
      )}
      {v !== null && <div>{formatValue(v, 'V')}</div>}
    </div>
  );
}

/** Auswahl der anderen Teammitglieder als farbige Rahmen mit Namen */
function RemoteSelections({ parts }: { parts: { id: string; type: string; props: Record<string, any>; x: number; y: number }[] }) {
  const c = useCollab();
  if (!c.active || !c.peers.length) return null;
  const sel = remoteSelections();
  return (
    <g pointerEvents="none">
      {parts.map((p) => {
        const who = sel.get(p.id);
        const def = who && getPart(p.type);
        if (!who || !def) return null;
        const s = def.size(p.props);
        return (
          <g key={p.id}>
            <rect x={p.x - 4} y={p.y - 4} width={s.w + 8} height={s.h + 8} rx={6} fill="none" stroke={who.color} strokeWidth={2} strokeDasharray="6 3" />
            <rect x={p.x - 4} y={p.y - 20} width={who.name.length * 6.5 + 10} height={15} rx={4} fill={who.color} />
            <text x={p.x + 1} y={p.y - 9} fontSize={10} fill="#fff" fontWeight={600}>
              {who.name}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** liegt ein Teil (grob) im sichtbaren Ausschnitt? */
function inView(p: { type: string; props: Record<string, any>; x: number; y: number }, v: { x0: number; y0: number; x1: number; y1: number }) {
  const def = getPart(p.type);
  const s = def ? def.size(p.props) : { w: 50, h: 50 };
  const r = Math.max(s.w, s.h);
  return p.x + r >= v.x0 && p.x - r <= v.x1 && p.y + r >= v.y0 && p.y - r <= v.y1;
}
