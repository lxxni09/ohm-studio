/** Schaltplan-Ansicht mit Symbolen nach IEC oder ANSI */
import { useMemo } from 'react';
import { useRef } from 'react';
import { getPart, findPin } from '../parts/registry';
import { pinWorld } from '../sim/engine';
import { changed, checkpoint, emit, engine, set, state, useStore } from '../state/store';
import { Viewport } from './Viewport';
import { netSegments } from './wires';
import { routeAll, crossings, hopsByWire, pathWithHops } from './router';
import { formatValue, parseValue } from '../lib/units';
import { ledColor } from '../parts/library/basic';
import type { PartInst } from '../ohm/model';
import type { SymbolKind } from '../parts/types';

const STROKE = 'var(--text)';

/** Symbol zwischen zwei Punkten (Länge L, Mitte im Ursprung, horizontal) */
function TwoPinSymbol({ kind, L, ansi, inst, st }: { kind: SymbolKind; L: number; ansi: boolean; inst: PartInst; st: Record<string, any> }) {
  const half = L / 2;
  const bw = Math.min(28, L * 0.6);
  const lead = (w: number) => (
    <>
      <line x1={-half} y1={0} x2={-w / 2} y2={0} stroke={STROKE} strokeWidth={1.2} />
      <line x1={w / 2} y1={0} x2={half} y2={0} stroke={STROKE} strokeWidth={1.2} />
    </>
  );
  switch (kind) {
    case 'resistor':
      return ansi ? (
        <g>
          {lead(bw)}
          <polyline points={Array.from({ length: 7 }, (_, i) => `${-bw / 2 + (i * bw) / 6},${i === 0 || i === 6 ? 0 : i % 2 ? -5 : 5}`).join(' ')} fill="none" stroke={STROKE} strokeWidth={1.2} strokeLinejoin="round" />
        </g>
      ) : (
        <g>
          {lead(bw)}
          <rect x={-bw / 2} y={-4.5} width={bw} height={9} fill="var(--canvas)" stroke={STROKE} strokeWidth={1.2} />
        </g>
      );
    case 'capacitor':
    case 'elko':
      return (
        <g>
          {lead(6)}
          <line x1={-3} y1={-9} x2={-3} y2={9} stroke={STROKE} strokeWidth={1.6} />
          {kind === 'elko' ? <path d="M3 -9 q3 9 0 18" fill="none" stroke={STROKE} strokeWidth={1.6} /> : <line x1={3} y1={-9} x2={3} y2={9} stroke={STROKE} strokeWidth={1.6} />}
          {kind === 'elko' && <text x={-9} y={-8} fontSize={7} fill={STROKE}>+</text>}
        </g>
      );
    case 'inductor':
      return (
        <g>
          {lead(bw)}
          {ansi ? (
            <path d={`M${-bw / 2} 0 ${[0, 1, 2, 3].map((i) => `a${bw / 8} ${bw / 8} 0 0 1 ${bw / 4} 0`).join(' ')}`} fill="none" stroke={STROKE} strokeWidth={1.2} />
          ) : (
            <rect x={-bw / 2} y={-4.5} width={bw} height={9} fill={STROKE} />
          )}
        </g>
      );
    case 'diode':
    case 'zener':
    case 'schottky':
    case 'led': {
      const col = kind === 'led' ? ledColor(inst.props.farbe).hex : STROKE;
      return (
        <g>
          {lead(14)}
          <path d="M-7 -7 L7 0 L-7 7 Z" fill={kind === 'led' && (st.brightness ?? 0) > 0.05 ? col : 'var(--canvas)'} stroke={STROKE} strokeWidth={1.2} strokeLinejoin="round" />
          {kind === 'zener' ? <path d="M5 -8 L7 -7 V7 L9 8" fill="none" stroke={STROKE} strokeWidth={1.4} /> : kind === 'schottky' ? <path d="M9 -5 V-7 H7 V7 H5 V5" fill="none" stroke={STROKE} strokeWidth={1.4} /> : <line x1={7} y1={-7} x2={7} y2={7} stroke={STROKE} strokeWidth={1.4} />}
          {kind === 'led' && (
            <g stroke={col} strokeWidth={1.1} fill="none">
              <path d="M0 -10 l5 -6 M2 -15 h3 v3" />
              <path d="M5 -9 l5 -6 M7 -14 h3 v3" />
            </g>
          )}
        </g>
      );
    }
    case 'battery':
      return (
        <g>
          {lead(10)}
          <line x1={-5} y1={-10} x2={-5} y2={10} stroke={STROKE} strokeWidth={1.4} />
          <line x1={-1} y1={-5} x2={-1} y2={5} stroke={STROKE} strokeWidth={3} />
          <line x1={3} y1={-10} x2={3} y2={10} stroke={STROKE} strokeWidth={1.4} />
          <line x1={7} y1={-5} x2={7} y2={5} stroke={STROKE} strokeWidth={3} />
          <text x={-10} y={-11} fontSize={7} fill={STROKE}>+</text>
        </g>
      );
    case 'switch':
    case 'button': {
      const closed = st.pressed || st.closed || inst.props.an;
      return (
        <g>
          {lead(16)}
          <circle cx={-8} cy={0} r={1.6} fill={STROKE} />
          <circle cx={8} cy={0} r={1.6} fill={STROKE} />
          <line x1={-8} y1={0} x2={8} y2={closed ? 0 : -7} stroke={STROKE} strokeWidth={1.3} />
          {kind === 'button' && <path d={`M0 ${closed ? -1 : -4} V-11 M-4 -11 h8`} stroke={STROKE} strokeWidth={1.2} />}
        </g>
      );
    }
    case 'fuse':
      return (
        <g>
          {lead(bw)}
          <rect x={-bw / 2} y={-4} width={bw} height={8} fill="var(--canvas)" stroke={STROKE} strokeWidth={1.2} />
          <line x1={-bw / 2} y1={0} x2={bw / 2} y2={0} stroke={STROKE} strokeWidth={1} />
        </g>
      );
    case 'buzzer':
    case 'motor':
    case 'lamp':
      return (
        <g>
          {lead(20)}
          <circle cx={0} cy={0} r={10} fill="var(--canvas)" stroke={STROKE} strokeWidth={1.2} />
          <text x={0} y={0.5} fontSize={9} fill={STROKE} textAnchor="middle" dominantBaseline="middle" fontWeight={600}>
            {kind === 'motor' ? 'M' : kind === 'buzzer' ? '♪' : '×'}
          </text>
        </g>
      );
    default:
      return null;
  }
}

function TransistorSymbol({ kind, pts }: { kind: SymbolKind; pts: Record<string, { x: number; y: number }> }) {
  const ids = Object.keys(pts);
  const c = ids.reduce((a, k) => ({ x: a.x + pts[k].x / ids.length, y: a.y + pts[k].y / ids.length }), { x: 0, y: 0 });
  const mos = kind === 'nmos' || kind === 'pmos';
  const g = pts[mos ? 'G' : 'B'];
  const top = pts[mos ? 'D' : 'C'];
  const bot = pts[mos ? 'S' : 'E'];
  if (!g || !top || !bot) return null;
  const r = 13;
  const bx = c.x - 4;
  return (
    <g>
      <circle cx={c.x} cy={c.y} r={r} fill="var(--canvas)" stroke={STROKE} strokeWidth={1.1} />
      <polyline points={`${g.x},${g.y} ${g.x},${c.y} ${bx - (mos ? 3 : 0)},${c.y}`} fill="none" stroke={STROKE} strokeWidth={1.1} />
      {mos ? (
        <>
          <line x1={bx - 3} y1={c.y - 7} x2={bx - 3} y2={c.y + 7} stroke={STROKE} strokeWidth={1.4} />
          <line x1={bx} y1={c.y - 8} x2={bx} y2={c.y + 8} stroke={STROKE} strokeWidth={1.4} strokeDasharray="4 2" />
        </>
      ) : (
        <line x1={bx} y1={c.y - 8} x2={bx} y2={c.y + 8} stroke={STROKE} strokeWidth={2} />
      )}
      <polyline points={`${bx},${c.y - 4} ${c.x + 5},${c.y - 9} ${top.x},${c.y - 9} ${top.x},${top.y}`} fill="none" stroke={STROKE} strokeWidth={1.1} />
      <polyline points={`${bx},${c.y + 4} ${c.x + 5},${c.y + 9} ${bot.x},${c.y + 9} ${bot.x},${bot.y}`} fill="none" stroke={STROKE} strokeWidth={1.1} />
      {!mos && (kind === 'npn' ? <path d={`M${c.x + 1} ${c.y + 6.5} l4 2.5 l-3.5 2z`} fill={STROKE} /> : <path d={`M${bx + 4} ${c.y + 6} l-4 -2 l3 -2.5z`} fill={STROKE} />)}
      {mos && <path d={kind === 'nmos' ? `M${bx + 1} ${c.y + 4} l4 -2 v4z` : `M${bx + 5} ${c.y + 4} l-4 -2 v4z`} fill={STROKE} />}
    </g>
  );
}

function valueLabel(inst: PartInst): string {
  const p = inst.props;
  if (inst.type === 'widerstand') return formatValue(parseValue(p.wert, 0), 'Ω').replace(' ', '');
  if (['kondensator', 'elko', 'folienkondensator'].includes(inst.type)) return formatValue(parseValue(p.wert, 0), 'F').replace(' ', '');
  if (inst.type === 'spule') return formatValue(parseValue(p.wert, 0), 'H').replace(' ', '');
  if (inst.type === 'led') return `${p.farbe}`;
  if (inst.type === 'zener') return String(p.wert);
  if (inst.type === 'potentiometer' || inst.type === 'trimmer') return formatValue(parseValue(p.wert, 0), 'Ω').replace(' ', '');
  if (inst.type === 'batteriehalter') return String(p.zellen);
  return getPart(inst.type)?.name.split(' ')[0] ?? '';
}

export function Schematic() {
  const project = useStore((s) => s.project);
  const sel = useStore((s) => s.selection);
  const tick = useStore((s) => s.tick);
  const sim = useStore((s) => s.sim);
  useStore((s) => s.dirty);
  useStore((s) => s.rev);
  void tick;
  const ansi = (project.views.schaltplan?.symbole ?? 'IEC') === 'ANSI';
  const labels = (project.views.schaltplan as { netzlabels?: boolean } | undefined)?.netzlabels !== false;
  const drag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const segs = netSegments(project);
  const running = sim !== 'stopped';
  const routedSch = routeAll(project, segs, { style: '90', grid: project.views.schaltplan?.raster ?? 5, manual: undefined, fast: !!drag.current?.moved });
  const schHops = useMemo(() => hopsByWire(crossings(routedSch)), [routedSch]);
  const pinCount = new Map<string, number>();
  for (const s of segs) {
    pinCount.set(s.a, (pinCount.get(s.a) ?? 0) + 1);
    pinCount.set(s.b, (pinCount.get(s.b) ?? 0) + 1);
  }
  let x0 = 0;
  let y0 = 0;
  let x1 = 600;
  let y1 = 400;
  for (const p of project.parts) {
    const d = getPart(p.type);
    if (!d) continue;
    const s = d.size(p.props);
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + s.w);
    y1 = Math.max(y1, p.y + s.h);
  }
  return (
    <Viewport
      lod={project.parts.length > 250}
      persistKey="sch"
      bounds={{ x: x0 - 30, y: y0 - 30, w: x1 - x0 + 60, h: y1 - y0 + 60 }}
      grid="lines"
      onBackgroundDown={() => {
        set({ selection: [], selectedNet: null });
        return false;
      }}
      onMove={(e, api) => {
        const d = drag.current;
        if (!d) return;
        const w = api.toWorld(e.clientX, e.clientY);
        if (!d.moved && Math.hypot(w.x - d.sx, w.y - d.sy) < 2) return;
        if (!d.moved) checkpoint();
        d.moved = true;
        const p = project.parts.find((x) => x.id === d.id)!;
        p.x = Math.round((d.ox + w.x - d.sx) / 5) * 5;
        p.y = Math.round((d.oy + w.y - d.sy) / 5) * 5;
        engine.needsRebuild = true;
        emit();
      }}
      onUp={() => {
        if (drag.current?.moved) changed();
        drag.current = null;
      }}
    >
      {(api) => (
        <g
          onPointerDown={(e) => {
            const id = (e.target as Element).closest('[data-sym]')?.getAttribute('data-sym');
            const wire = (e.target as Element).getAttribute('data-wire');
            if (wire) {
              set({ selectedNet: wire, selection: [] });
              e.stopPropagation();
              return;
            }
            if (!id) return;
            const p = project.parts.find((x) => x.id === id)!;
            const w = api.toWorld(e.clientX, e.clientY);
            set({ selection: [id], selectedNet: null });
            drag.current = { id, sx: w.x, sy: w.y, ox: p.x, oy: p.y, moved: false };
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
            e.stopPropagation();
          }}
        >
          {/* Leitungen orthogonal */}
          {segs.map((s, i) => {
            const r = routedSch[i];
            const d = r ? pathWithHops(r.pts, schHops.get(r) ?? [], 1.5) : `M${s.ax} ${s.ay} L${s.bx} ${s.by}`;
            const isSel = state.selectedNet === s.net;
            const len = Math.abs(s.ax - s.bx) + Math.abs(s.ay - s.by);
            const isGnd = /^(GND|MASSE|VSS)$/i.test(s.net);
            const isPwr = /^(VCC|VBAT|VIN|5V|3V3|12V|VDD|\+)/i.test(s.net);
            const named = !/^(N|V)\d+$/.test(s.net);
            // Lange Verbindungen benannter Netze als Netzlabels bzw. Masse-/Versorgungssymbole
            if (labels && named && (isGnd || isPwr || len > 160)) {
              const sym = (x: number, y: number, k: string) =>
                isGnd ? (
                  <g key={k} data-wire={s.net} style={{ cursor: 'pointer' }}>
                    <path d={`M${x} ${y} v6 M${x - 6} ${y + 6} h12 M${x - 4} ${y + 8.5} h8 M${x - 2} ${y + 11} h4`} stroke="var(--muted)" strokeWidth={1.1} fill="none" />
                  </g>
                ) : isPwr ? (
                  <g key={k} data-wire={s.net} style={{ cursor: 'pointer' }}>
                    <path d={`M${x} ${y} v-6 M${x - 5} ${y - 6} h10`} stroke="#e03131" strokeWidth={1.2} fill="none" />
                    <text x={x} y={y - 9} fontSize={5.5} textAnchor="middle" fill="#e03131" fontFamily="Inter" fontWeight={600}>{s.net}</text>
                  </g>
                ) : (
                  <g key={k} data-wire={s.net} style={{ cursor: 'pointer' }}>
                    <path d={`M${x} ${y} h6 l3 -3.5 h${s.net.length * 3.4 + 4} v7 h-${s.net.length * 3.4 + 4} z`} fill={isSel ? 'var(--accent-soft)' : 'var(--panel-solid)'} stroke="var(--accent-strong)" strokeWidth={0.9} />
                    <text x={x + 11} y={y + 0.3} fontSize={5} dominantBaseline="middle" fill="var(--accent-strong)" fontFamily="Inter" fontWeight={600}>{s.net}</text>
                  </g>
                );
              return <g key={i}>{sym(s.ax, s.ay, 'a')}{sym(s.bx, s.by, 'b')}</g>;
            }
            return (
              <g key={i}>
                <path d={d} stroke="transparent" strokeWidth={8} fill="none" data-wire={s.net} style={{ cursor: 'pointer' }} />
                <path d={d} stroke={isSel ? 'var(--accent)' : /GND/i.test(s.net) ? 'var(--muted)' : 'var(--accent-strong)'} strokeWidth={isSel ? 1.8 : 1.1} fill="none" pointerEvents="none" />
              </g>
            );
          })}
          {[...pinCount.entries()]
            .filter(([, n]) => n >= 2)
            .map(([ref]) => {
              const s = segs.find((x) => x.a === ref || x.b === ref)!;
              const p = s.a === ref ? { x: s.ax, y: s.ay } : { x: s.bx, y: s.by };
              return <circle key={ref} cx={p.x} cy={p.y} r={2.3} fill="var(--accent-strong)" />;
            })}
          {/* Symbole */}
          {project.parts.map((inst) => {
            const def = getPart(inst.type);
            if (!def || inst.type.startsWith('steckbrett')) return null;
            const st = engine.states.get(inst.id) ?? {};
            const pins = def.pins(inst.props).filter((p) => p.x > -100);
            const world = Object.fromEntries(pins.map((p) => [p.id, pinWorld(inst, def, p)]));
            const kind = def.symbol ?? 'box';
            const selected = sel.includes(inst.id);
            const twoPin = pins.length === 2 && kind !== 'box';
            if (twoPin) {
              const [a, b] = pins.map((p) => world[p.id]);
              const L = Math.hypot(b.x - a.x, b.y - a.y);
              const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              return (
                <g key={inst.id} data-sym={inst.id} style={{ cursor: 'move' }}>
                  <rect x={Math.min(a.x, b.x) - 12} y={Math.min(a.y, b.y) - 14} width={Math.abs(b.x - a.x) + 24} height={Math.abs(b.y - a.y) + 28} fill="transparent" stroke={selected ? 'var(--accent)' : 'none'} rx={4} strokeDasharray="3 2" />
                  <g transform={`translate(${mx} ${my}) rotate(${ang})`}>
                    <TwoPinSymbol kind={kind} L={L} ansi={ansi} inst={inst} st={st} />
                  </g>
                  <text x={mx} y={my - 15} fontSize={7} fill="var(--text)" textAnchor="middle" fontWeight={600} fontFamily="Inter">
                    {inst.id}
                  </text>
                  <text x={mx} y={my + 20} fontSize={6.5} fill="var(--muted)" textAnchor="middle" fontFamily="Inter">
                    {valueLabel(inst)}
                  </text>
                </g>
              );
            }
            if (['npn', 'pnp', 'nmos', 'pmos'].includes(kind)) {
              const c = Object.values(world).reduce((acc, p) => ({ x: acc.x + p.x / pins.length, y: acc.y + p.y / pins.length }), { x: 0, y: 0 });
              return (
                <g key={inst.id} data-sym={inst.id} style={{ cursor: 'move' }}>
                  {selected && <circle cx={c.x} cy={c.y} r={20} fill="none" stroke="var(--accent)" strokeDasharray="3 2" />}
                  <TransistorSymbol kind={kind} pts={world} />
                  <text x={c.x + 18} y={c.y - 4} fontSize={7} fill="var(--text)" fontWeight={600} fontFamily="Inter">
                    {inst.id}
                  </text>
                  <text x={c.x + 18} y={c.y + 5} fontSize={6} fill="var(--muted)" fontFamily="Inter">
                    {inst.type}
                  </text>
                </g>
              );
            }
            // Kasten (ICs, Boards, Module)
            const s = def.size(inst.props);
            let bx0 = Infinity;
            let by0 = Infinity;
            let bx1 = -Infinity;
            let by1 = -Infinity;
            for (const p of Object.values(world)) {
              bx0 = Math.min(bx0, p.x);
              by0 = Math.min(by0, p.y);
              bx1 = Math.max(bx1, p.x);
              by1 = Math.max(by1, p.y);
            }
            if (!pins.length) {
              bx0 = inst.x;
              by0 = inst.y;
              bx1 = inst.x + s.w;
              by1 = inst.y + s.h;
            }
            const pad = 7;
            const rx = Math.min(bx0 + pad, inst.x + 6);
            const ry = Math.min(by0 + pad, inst.y + 6);
            const rw = Math.max(bx1 - pad, inst.x + s.w - 6) - rx;
            const rh = Math.max(by1 - pad, inst.y + s.h - 6) - ry;
            return (
              <g key={inst.id} data-sym={inst.id} style={{ cursor: 'move' }}>
                <rect x={rx} y={ry} width={Math.max(rw, 20)} height={Math.max(rh, 16)} fill="var(--panel-solid)" stroke={selected ? 'var(--accent)' : STROKE} strokeWidth={selected ? 1.6 : 1.1} rx={2} />
                <text x={rx + rw / 2} y={ry + rh / 2 - 4} fontSize={9} fill="var(--text)" textAnchor="middle" fontWeight={700} fontFamily="Inter">
                  {inst.id}
                </text>
                <text x={rx + rw / 2} y={ry + rh / 2 + 7} fontSize={6.5} fill="var(--muted)" textAnchor="middle" fontFamily="Inter">
                  {def.name}
                </text>
                {pins.map((p) => {
                  const w = world[p.id];
                  const inside = { x: Math.min(Math.max(w.x, rx), rx + rw), y: Math.min(Math.max(w.y, ry), ry + rh) };
                  const left = w.x <= rx + 1;
                  const right = w.x >= rx + rw - 1;
                  const top = w.y <= ry + 1;
                  return (
                    <g key={p.id}>
                      <line x1={w.x} y1={w.y} x2={inside.x} y2={inside.y} stroke={STROKE} strokeWidth={1} />
                      <text
                        x={inside.x + (left ? 2.5 : right ? -2.5 : 0)}
                        y={inside.y + (top ? 5 : !left && !right ? -3.5 : 0)}
                        fontSize={4.2}
                        fill="var(--muted)"
                        textAnchor={left ? 'start' : right ? 'end' : 'middle'}
                        dominantBaseline="middle"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {p.label ?? p.id}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
          {/* Netzspannungen während der Simulation */}
          {running &&
            project.nets.map((n) => {
              const s = segs.find((x) => x.net === n.name);
              if (!s) return null;
              const [pid, pn] = n.pins[0].split('.');
              const inst = project.parts.find((p) => p.id === pid);
              const def = inst && getPart(inst.type);
              const pin = def && findPin(def, inst!.props, pn);
              const v = pin ? engine.pinVoltage(pid, pin.id) : null;
              if (v === null) return null;
              return (
                <g key={n.name} pointerEvents="none">
                  <rect x={(s.ax + s.bx) / 2 - 16} y={(s.ay + s.by) / 2 - 12} width={32} height={10} rx={5} fill="var(--accent)" opacity={0.92} />
                  <text x={(s.ax + s.bx) / 2} y={(s.ay + s.by) / 2 - 6.6} fontSize={6} fill="#fff" textAnchor="middle" dominantBaseline="middle" fontFamily="JetBrains Mono, monospace">
                    {v.toFixed(2)} V
                  </text>
                </g>
              );
            })}
        </g>
      )}
    </Viewport>
  );
}
