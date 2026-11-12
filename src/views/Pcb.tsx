/** Platinenansicht (2D) und 3D-Ansicht */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
const Pcb3DPro = lazy(() => import('./Pcb3DPro'));
import { checkpoint, changed, emit, set, state, useStore } from '../state/store';
import { computePcb, SURFACE_COLORS, type PcbLayout, type Footprint } from './pcbLayout';
import { drc, DRC_PROFILES, type DrcViolation } from '../eda/drc';
import { Viewport } from './Viewport';
import { getPart } from '../parts/registry';
import { ledColor } from '../parts/library/basic';
import { Icon } from '../ui/icons';

function silk(color: string) {
  return color === '#ececec' ? '#222' : '#f4f4f0';
}

export function PcbSvg({ L, selected, showBottom = true, marks }: { L: PcbLayout; selected?: string[]; showBottom?: boolean; marks?: DrcViolation[] }) {
  const pad = 'url(#pcb-surf)';
  const sc = silk(L.color);
  const sf = SURFACE_COLORS[L.surface];
  const pourMaskId = 'pour-mask';
  return (
    <g>
      <defs>
        <linearGradient id="pcb-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe9a8" />
          <stop offset="0.5" stopColor="#d9a93c" />
          <stop offset="1" stopColor="#b8862a" />
        </linearGradient>
        <linearGradient id="pcb-silver" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f5f6f7" />
          <stop offset="0.5" stopColor="#c3c7cb" />
          <stop offset="1" stopColor="#9aa0a6" />
        </linearGradient>
        <linearGradient id="pcb-surf" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={sf.hi} />
          <stop offset="0.55" stopColor={sf.base} />
          <stop offset="1" stopColor={sf.base} stopOpacity={0.85} />
        </linearGradient>
        {L.pour && (
          <mask id={pourMaskId}>
            <rect x={5} y={5} width={L.w - 10} height={L.h - 10} rx={5} fill="#fff" />
            {L.footprints.flatMap((f) => f.pads).filter((p) => p.net !== L.pour!.net).map((p) => <circle key={p.ref} cx={p.x} cy={p.y} r={p.d / 2 + L.pour!.clearance} fill="#000" />)}
            {L.traces.filter((t) => t.net !== L.pour!.net && t.layer === 'top').map((t, i) => <polyline key={i} points={t.pts.map((q) => `${q.x},${q.y}`).join(' ')} fill="none" stroke="#000" strokeWidth={t.width + L.pour!.clearance * 2} strokeLinecap="round" strokeLinejoin="round" />)}
            {L.footprints.flatMap((f) => f.pads).filter((p) => p.net === L.pour!.net).map((p) => (
              <g key={'t' + p.ref}>
                <circle cx={p.x} cy={p.y} r={p.d / 2 + 3} fill="#000" />
                {[0, 90, 180, 270].map((a) => <rect key={a} x={p.x - 1.2} y={p.y - p.d / 2 - 3.5} width={2.4} height={p.d / 2 + 3.5} fill="#fff" transform={`rotate(${a} ${p.x} ${p.y})`} />)}
              </g>
            ))}
          </mask>
        )}
        <filter id="pcb-shadow" x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy="4" stdDeviation="6" floodOpacity="0.3" />
        </filter>
      </defs>
      <rect x={0} y={0} width={L.w} height={L.h} rx={8} fill={L.color} filter="url(#pcb-shadow)" />
      <rect x={0} y={0} width={L.w} height={L.h} rx={8} fill="none" stroke="#000" strokeOpacity={0.25} />
      {[
        [10, 10],
        [L.w - 10, 10],
        [10, L.h - 10],
        [L.w - 10, L.h - 10],
      ].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={6} fill={pad} />
          <circle cx={x} cy={y} r={3.4} fill="var(--canvas)" />
        </g>
      ))}
      {/* Massefläche unter dem Lack (leicht heller, wie Kupfer unter Lack) */}
      {L.pour && <rect x={0} y={0} width={L.w} height={L.h} fill="#fff" opacity={L.color === '#151515' ? 0.07 : 0.13} mask={`url(#${pourMaskId})`} />}
      {/* Durchkontaktierungen */}
      {L.vias.map((v, i) => (
        <g key={'v' + i}>
          <circle cx={v.x} cy={v.y} r={2.6} fill={sf.base} opacity={0.55} />
          <circle cx={v.x} cy={v.y} r={1.2} fill="#151515" />
        </g>
      ))}
      {/* Leiterbahnen unten (durchscheinend) */}
      {showBottom &&
        L.traces
          .filter((t) => t.layer === 'bottom')
          .map((t, i) => <polyline key={'b' + i} points={t.pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#000" strokeOpacity={0.22} strokeWidth={t.width} strokeLinecap="round" strokeLinejoin="round" />)}
      {/* Leiterbahnen oben: Kupfer unter Lötstopplack */}
      {L.traces
        .filter((t) => t.layer === 'top')
        .map((t, i) => (
          <g key={'t' + i}>
            <polyline points={t.pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#000" strokeOpacity={0.18} strokeWidth={t.width + 0.6} strokeLinecap="round" strokeLinejoin="round" transform="translate(0 0.5)" />
            <polyline points={t.pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={L.color === '#151515' ? '#3a3a3a' : '#fff'} strokeOpacity={L.color === '#151515' ? 1 : 0.3} strokeWidth={t.width} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ))}
      {/* Bestückungsdruck */}
      {L.footprints.map((f) => (
        <g key={f.id} data-fp={f.id}>
          <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={2} fill="transparent" stroke={selected?.includes(f.id) ? 'var(--accent)' : sc} strokeWidth={selected?.includes(f.id) ? 1.4 : 0.8} opacity={0.9} />
          <text x={f.x + 2} y={f.y - 2.5} fontSize={5} fill={sc} fontFamily="Inter" fontWeight={600}>
            {f.label}
          </text>
          {f.pads.map((p) =>
            p.square ? <rect key={p.ref} x={p.x - p.d / 2} y={p.y - p.d / 2} width={p.d} height={p.d} fill={pad} /> : <circle key={p.ref} cx={p.x} cy={p.y} r={p.d / 2} fill={pad} />,
          )}
          {f.pads.map((p) => (
            <circle key={'h' + p.ref} cx={p.x} cy={p.y} r={p.drill / 2} fill="#1a1a1a" />
          ))}
        </g>
      ))}
      {marks?.map((m, i) => (
        <g key={'drc' + i}>
          <circle cx={m.x} cy={m.y} r={7} fill="none" stroke={m.level === 'error' ? '#ff3b30' : '#ff9f0a'} strokeWidth={1.4} />
          <title>{m.rule}: {m.text}</title>
        </g>
      ))}
      <text x={L.w - 8} y={L.h - 6} fontSize={6} fill={sc} textAnchor="end" fontFamily="Inter" fontWeight={600} opacity={0.85}>
        {state.project.name} · Ohm Studio by Nodaris
      </text>
    </g>
  );
}

/** Farben/Formen für die 3D-Körper */
function body3d(f: Footprint): { color: string; round?: boolean; top?: string } {
  const def = getPart(f.kind);
  const t = f.kind;
  if (def?.board) return { color: def.board.color, top: '#1d1d1f' };
  if (t === 'widerstand') return { color: String(f.inst.props.ringe) === '5' ? '#7fb0de' : '#e6c99a', round: true };
  if (t === 'led') return { color: ledColor(f.inst.props.farbe).body, round: true };
  if (t === 'elko') return { color: '#1d3f9e', round: true, top: '#b9c3d6' };
  if (t === 'kondensator') return { color: '#e8892b', round: true };
  if (t === 'taster') return { color: '#2b2b2b', top: '#111' };
  if (t === 'summer') return { color: '#1d1d1f', round: true };
  if (def?.category === 'ICs' && !def.areas) return { color: '#1d1d1f' };
  if (def?.category === 'Halbleiter') return { color: '#1d1d1f' };
  if (def?.category === 'Displays') return { color: '#1d3f8f', top: '#0b0b0b' };
  if (def?.category === 'Stromversorgung') return { color: '#2b2b2b' };
  return { color: '#1f5fbf' };
}

function Pcb3D({ L }: { L: PcbLayout }) {
  const [rot, setRot] = useState({ x: 52, z: -24 });
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ x: number; y: number; rx: number; rz: number } | null>(null);
  const scale = Math.min(2.4, 900 / Math.max(L.w, L.h)) * zoom;
  const mm = 1 / 0.254;
  const thick = 1.6 * mm * scale;
  return (
    <div
      className="pcb3d-wrap"
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY, rx: rot.x, rz: rot.z };
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        setRot({ x: Math.max(0, Math.min(85, drag.current.rx - (e.clientY - drag.current.y) * 0.3)), z: drag.current.rz + (e.clientX - drag.current.x) * 0.4 });
      }}
      onPointerUp={() => (drag.current = null)}
      onWheel={(e) => setZoom((z) => Math.max(0.3, Math.min(3, z * Math.exp(-e.deltaY * 0.001))))}
    >
      <div className="pcb3d" style={{ width: L.w * scale, height: L.h * scale, transform: `rotateX(${rot.x}deg) rotateZ(${rot.z}deg)` }}>
        {/* Kante der Platine */}
        <div className="face" style={{ inset: 0, background: '#c9b27a', transform: `translateZ(${-thick}px)`, borderRadius: 8 * scale }} />
        <div className="face" style={{ left: 0, top: 0, width: L.w * scale, height: thick, background: '#b39a5e', transformOrigin: 'top', transform: 'rotateX(-90deg)' }} />
        <div className="face" style={{ left: 0, top: L.h * scale, width: L.w * scale, height: thick, background: '#9d854c', transformOrigin: 'top', transform: 'rotateX(-90deg)' }} />
        <svg width={L.w * scale} height={L.h * scale} viewBox={`0 0 ${L.w} ${L.h}`} style={{ position: 'absolute', inset: 0 }}>
          <PcbSvg L={L} showBottom={false} />
        </svg>
        {L.footprints.map((f) => {
          const b = body3d(f);
          const hpx = Math.max(2, f.height * mm * scale * 0.9);
          const isModule = !!getPart(f.kind)?.board || f.w * f.h > 3000;
          const inset = isModule ? 0 : Math.min(f.w, f.h) * 0.12;
          const w = (f.w - inset * 2) * scale;
          const d = (f.h - inset * 2) * scale;
          const left = (f.x + inset) * scale;
          const top = (f.y + inset) * scale;
          const side = (c: string, k: number) => `color-mix(in srgb, ${c} ${k}%, black)`;
          return (
            <div key={f.id} className="box3d" style={{ left, top, width: w, height: d }}>
              <div style={{ width: w, height: d, background: b.top ?? b.color, transform: `translateZ(${hpx}px)`, borderRadius: b.round ? Math.min(w, d) / 2 : 2, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)', display: 'grid', placeItems: 'center', color: '#ddd', fontSize: Math.max(6, Math.min(w, d) / 6), fontFamily: 'Inter', overflow: 'hidden' }}>
                {isModule ? f.label : ''}
              </div>
              <div style={{ width: w, height: hpx, background: side(b.color, 80), transformOrigin: 'top', transform: `translateY(${d}px) rotateX(-90deg)` }} />
              <div style={{ width: w, height: hpx, background: side(b.color, 70), transformOrigin: 'top', transform: 'rotateX(-90deg)' }} />
              <div style={{ width: hpx, height: d, background: side(b.color, 60), transformOrigin: 'left', transform: 'rotateY(90deg)' }} />
              <div style={{ width: hpx, height: d, background: side(b.color, 75), transformOrigin: 'left', transform: `translateX(${w}px) rotateY(90deg)` }} />
            </div>
          );
        })}
      </div>
      <div className="hint">Ziehen zum Drehen · Mausrad zum Zoomen</div>
    </div>
  );
}

export function PcbView() {
  const project = useStore((s) => s.project);
  useStore((s) => s.dirty);
  useStore((s) => s.rev);
  const sel = useStore((s) => s.selection);
  const is3d = useStore((s) => s.pcb3d);
  const [ver, setVer] = useState(0);
  const L = useMemo(() => computePcb(project), [project, ver, project.parts.length, project.nets.length, JSON.stringify(project.views.platine), JSON.stringify((project as any).pcb ?? {})]);
  const drag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const [profile, setProfile] = useState(() => localStorage.getItem('ohm.drc') ?? 'jlcpcb');
  useEffect(() => localStorage.setItem('ohm.drc', profile), [profile]);
  const violations = useMemo(() => drc(project, profile, L), [L, profile]);
  const colors = ['gruen', 'schwarz', 'schwarz-matt', 'blau', 'rot', 'weiss', 'gelb', 'lila'];
  const settings = (
    <div className="floating" style={{ left: 14, right: 14, top: 14, alignItems: 'center', padding: '4px 8px', gap: 8, flexWrap: 'wrap', width: 'fit-content', maxWidth: 'calc(100% - 28px)' }}>
      <span className="info-text">Lötstopplack</span>
      {colors.map((c) => (
        <button
          key={c}
          title={c}
          onClick={() => {
            checkpoint();
            project.views.platine = { ...(project.views.platine ?? {}), farbe: c };
            changed(false);
          }}
          style={{ width: 16, height: 16, borderRadius: 8, cursor: 'pointer', border: (project.views.platine?.farbe ?? 'gruen') === c ? '2px solid var(--accent)' : '1px solid var(--border-strong)', background: ({ gruen: '#1f6b3a', schwarz: '#151515', 'schwarz-matt': 'repeating-linear-gradient(45deg,#222,#222 2px,#151515 2px,#151515 4px)', blau: '#1d4fa8', rot: '#a51d1d', weiss: '#ececec', gelb: '#d4b106', lila: '#5b2a86' } as Record<string, string>)[c] }}
        />
      ))}
      <div className="divider" />
      <select
        className="speed"
        title="Oberfläche der Pads"
        value={L.surface}
        onChange={(e) => {
          project.views.platine = { ...(project.views.platine ?? {}), oberflaeche: e.target.value };
          changed(false);
        }}
      >
        {(Object.keys(SURFACE_COLORS) as (keyof typeof SURFACE_COLORS)[]).map((k) => (
          <option key={k} value={k}>
            {SURFACE_COLORS[k].name}
          </option>
        ))}
      </select>
      <span className="info-text">
        {(L.w * 0.254).toFixed(0)} × {(L.h * 0.254).toFixed(0)} mm
      </span>
      <button className="btn" title="Lagenaufbau & Impedanz" onClick={() => set({ modal: 'stackup' })}>
        {L.layers} Lagen
      </button>
      <select className="speed" title="Fertiger-Regeln für den DRC" value={profile} onChange={(e) => setProfile(e.target.value)}>
        {DRC_PROFILES.map((p) => (
          <option key={p.id} value={p.id}>
            DRC: {p.name}
          </option>
        ))}
      </select>
      <span className={`badge ${violations.some((v) => v.level === 'error') ? 'err' : violations.length ? 'warn' : 'ok'}`} title={violations.slice(0, 8).map((v) => v.text).join('\n')}>
        {violations.length ? `${violations.length} DRC-Fehler` : 'DRC ok'}
        {L.unrouted ? ` · ${L.unrouted} offen` : ''}
      </span>
      <button className="btn" onClick={() => set({ modal: 'export' })}>
        <Icon.download size={13} /> Gerber
      </button>
    </div>
  );
  if (is3d)
    return (
      <>
        <Suspense fallback={<div className="hint">3D-Ansicht wird geladen …</div>}>
          <Pcb3DPro L={L} />
        </Suspense>
        {settings}
      </>
    );
  return (
    <Viewport
      persistKey="pcb"
      bounds={{ x: -20, y: -20, w: L.w + 40, h: L.h + 40 }}
      grid="lines"
      onBackgroundDown={() => {
        set({ selection: [] });
        return false;
      }}
      onMove={(e, api) => {
        const d = drag.current;
        if (!d) return;
        const w = api.toWorld(e.clientX, e.clientY);
        if (!d.moved && Math.hypot(w.x - d.sx, w.y - d.sy) < 2) return;
        if (!d.moved) checkpoint();
        d.moved = true;
        const pcb = ((project as any).pcb ??= {}) as Record<string, { x: number; y: number; rot: number }>;
        const f = L.footprints.find((x) => x.id === d.id)!;
        pcb[d.id] = { x: Math.round((d.ox + w.x - d.sx) / 5) * 5, y: Math.round((d.oy + w.y - d.sy) / 5) * 5, rot: f.rot };
        setVer((v) => v + 1);
        emit();
      }}
      onUp={() => {
        if (drag.current?.moved) changed(false);
        drag.current = null;
      }}
      overlay={settings}
    >
      {(api) => (
        <g
          onPointerDown={(e) => {
            const id = (e.target as Element).closest('[data-fp]')?.getAttribute('data-fp');
            if (!id) return;
            const f = L.footprints.find((x) => x.id === id)!;
            const w = api.toWorld(e.clientX, e.clientY);
            set({ selection: [id] });
            drag.current = { id, sx: w.x, sy: w.y, ox: f.x, oy: f.y, moved: false };
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
            e.stopPropagation();
          }}
        >
          <PcbSvg L={L} selected={sel} marks={violations} />
        </g>
      )}
    </Viewport>
  );
}

void state;
