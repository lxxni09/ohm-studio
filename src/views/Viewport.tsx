/**
 * Zoom- und verschiebbare Zeichenfläche (für alle drei Ansichten).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../ui/icons';
import { fitVersion, useStore } from '../state/store';

export interface View {
  x: number;
  y: number;
  k: number;
}

export interface ViewportApi {
  view: View;
  /** sichtbarer Ausschnitt in Weltkoordinaten (mit Rand), für das Weglassen unsichtbarer Teile */
  visible: { x0: number; y0: number; x1: number; y1: number } | null;
  toWorld(clientX: number, clientY: number): { x: number; y: number };
}

interface Props {
  bounds: { x: number; y: number; w: number; h: number } | null;
  children: (api: ViewportApi) => ReactNode;
  onBackgroundDown?: (e: React.PointerEvent, api: ViewportApi) => boolean | void;
  onMove?: (e: React.PointerEvent, api: ViewportApi) => void;
  onUp?: (e: React.PointerEvent, api: ViewportApi) => void;
  onDrop?: (e: React.DragEvent, api: ViewportApi) => void;
  grid?: 'dots' | 'lines' | 'none';
  background?: string;
  overlay?: ReactNode;
  persistKey: string;
  /** Detailstufe: bei großen Projekten Schatten/Filter weglassen */
  lod?: boolean;
}

const views = new Map<string, View>();

export function Viewport({ bounds, children, onBackgroundDown, onMove, onUp, onDrop, grid = 'dots', background, overlay, persistKey, lod }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [view, setViewState] = useState<View>(() => views.get(persistKey) ?? { x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gRef = useRef<SVGGElement>(null);
  const patRef = useRef<SVGPatternElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  if (!pending.current) viewRef.current = view;
  views.set(persistKey, viewRef.current);
  const setView = (v: View) => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    viewRef.current = v;
    setViewState(v);
  };
  /** Schnelles Verschieben/Zoomen: nur die Transformation im DOM ändern, React-Neuzeichnen erst nach der Bewegung */
  const setViewFast = (v: View) => {
    viewRef.current = v;
    views.set(persistKey, v);
    gRef.current?.setAttribute('transform', `translate(${v.x} ${v.y}) scale(${v.k})`);
    const gs = 10 * v.k;
    if (patRef.current) {
      patRef.current.setAttribute('width', String(gs));
      patRef.current.setAttribute('height', String(gs));
      patRef.current.setAttribute('x', String(v.x % gs));
      patRef.current.setAttribute('y', String(v.y % gs));
    }
    dotRef.current?.setAttribute('cx', String(gs / 2));
    dotRef.current?.setAttribute('cy', String(gs / 2));
    ref.current?.classList.add('moving');
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      pending.current = null;
      ref.current?.classList.remove('moving');
      setViewState(viewRef.current);
    }, 140);
  };
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const fv = useStore(() => fitVersion());
  const fitted = useRef(-1);

  const toWorld = (cx: number, cy: number) => {
    const r = ref.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
  };
  const rect = ref.current?.getBoundingClientRect();
  const visible = rect && rect.width > 0 ? { x0: -view.x / view.k - 200, y0: -view.y / view.k - 200, x1: (rect.width - view.x) / view.k + 200, y1: (rect.height - view.y) / view.k + 200 } : null;
  const api: ViewportApi = { view, toWorld, visible };

  const fit = () => {
    if (!bounds || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    if (r.width < 10) return;
    const pad = 60;
    const k = Math.min(3, Math.max(0.15, Math.min((r.width - pad * 2) / Math.max(bounds.w, 50), (r.height - pad * 2) / Math.max(bounds.h, 50))));
    setView({ k, x: r.width / 2 - (bounds.x + bounds.w / 2) * k, y: r.height / 2 - (bounds.y + bounds.h / 2) * k });
  };

  useEffect(() => {
    if (fitted.current !== fv || !views.has(persistKey + ':fitted')) {
      fitted.current = fv;
      views.set(persistKey + ':fitted', view);
      const t = setTimeout(fit, 20);
      return () => clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fv, bounds && Math.round(bounds.w), bounds && Math.round(bounds.h)]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = viewRef.current;
      const mouseLike = e.deltaMode === 1 || (Math.abs(e.deltaY) >= 50 && e.deltaX === 0 && Number.isInteger(e.deltaY));
      if (e.ctrlKey || e.metaKey || mouseLike) {
        const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
        const k = Math.min(6, Math.max(0.1, v.k * f));
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        setViewFast({ k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k });
      } else {
        setViewFast({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    // Zwei-Finger-Zoom und -Verschieben (Tablet/Touch)
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; mx: number; my: number; v: { k: number; x: number; y: number } } | null = null;
    const geo = () => {
      const [a, b] = [...touches.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        pinch = { ...geo(), v: { ...viewRef.current } };
        pan.current = null;
        setPanning(false);
        e.stopPropagation();
      }
    };
    const move = (e: PointerEvent) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!pinch || touches.size < 2) return;
      e.stopPropagation();
      const g = geo();
      const r = el.getBoundingClientRect();
      const k = Math.min(6, Math.max(0.1, pinch.v.k * (g.d / Math.max(10, pinch.d))));
      const mx0 = pinch.mx - r.left;
      const my0 = pinch.my - r.top;
      const wx = (mx0 - pinch.v.x) / pinch.v.k;
      const wy = (my0 - pinch.v.y) / pinch.v.k;
      setViewFast({ k, x: g.mx - r.left - wx * k, y: g.my - r.top - wy * k });
    };
    const up = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
    };
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move, true);
    el.addEventListener('pointerup', up, true);
    el.addEventListener('pointercancel', up, true);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move, true);
      el.removeEventListener('pointerup', up, true);
      el.removeEventListener('pointercancel', up, true);
    };
  }, []);

  const zoomBy = (f: number) => {
    const r = ref.current!.getBoundingClientRect();
    const v = viewRef.current;
    const k = Math.min(6, Math.max(0.1, v.k * f));
    const mx = r.width / 2;
    const my = r.height / 2;
    setView({ k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k });
  };

  const gs = 10 * view.k;
  const content = children(api);
  return (
    <>
      <svg
        ref={ref}
        className={`canvas-svg ${panning ? 'panning' : ''} ${lod ? 'lod' : ''}`}
        onPointerDown={(e) => {
          const t = e.target as Element;
          const isBg = t === ref.current || t.classList.contains('bg');
          if (e.button === 1 || (isBg && e.button === 0)) {
            if (isBg && onBackgroundDown?.(e, api)) return;
            pan.current = { sx: e.clientX, sy: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y };
            setPanning(true);
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          if (pan.current) {
            const p = pan.current;
            setViewFast({ ...viewRef.current, x: p.vx + e.clientX - p.sx, y: p.vy + e.clientY - p.sy });
            return;
          }
          onMove?.(e, api);
        }}
        onPointerUp={(e) => {
          if (pan.current) {
            pan.current = null;
            setPanning(false);
            setView(viewRef.current);
            return;
          }
          onUp?.(e, api);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-ohm-part')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          onDrop?.(e, api);
        }}
        style={background ? { background } : undefined}
      >
        <defs>
          <pattern ref={patRef} id={`grid-${persistKey}`} width={gs} height={gs} patternUnits="userSpaceOnUse" x={view.x % gs} y={view.y % gs}>
            {grid === 'dots' && <circle ref={dotRef} cx={gs / 2} cy={gs / 2} r={Math.max(0.6, Math.min(1.2, view.k * 0.9))} fill="var(--canvas-dot)" />}
            {grid === 'lines' && <path d={`M ${gs} 0 L 0 0 0 ${gs}`} fill="none" stroke="var(--canvas-dot)" strokeWidth={0.6} />}
          </pattern>
        </defs>
        {grid !== 'none' && view.k > 0.35 && <rect className="bg" x={0} y={0} width="100%" height="100%" fill={`url(#grid-${persistKey})`} />}
        {(grid === 'none' || view.k <= 0.35) && <rect className="bg" x={0} y={0} width="100%" height="100%" fill="transparent" />}
        <g ref={gRef} transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>{content}</g>
      </svg>
      <div className="floating zoom-ctl">
        <button className="icon-btn" title="Verkleinern" aria-label="Verkleinern" onClick={() => zoomBy(1 / 1.25)}>
          <Icon.minus />
        </button>
        <span>{Math.round(view.k * 100)} %</span>
        <button className="icon-btn" title="Vergrößern" aria-label="Vergrößern" onClick={() => zoomBy(1.25)}>
          <Icon.plus />
        </button>
        <button className="icon-btn" title="Alles zeigen (F)" aria-label="Alles zeigen (F)" onClick={fit}>
          <Icon.fit />
        </button>
      </div>
      {overlay}
    </>
  );
}
