/**
 * Wiederverwendbare SVG-Bausteine für realistische Bauteile.
 * Alle Koordinaten in Einheiten (1 = 0,254 mm). Gradienten/Filter liegen in <SvgDefs/>.
 */
import type { ReactNode } from 'react';
import { PITCH } from './types';

export function SvgDefs() {
  return (
    <defs>
      <linearGradient id="g-metal" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f4f5f6" />
        <stop offset="0.45" stopColor="#b9bdc2" />
        <stop offset="1" stopColor="#7d8389" />
      </linearGradient>
      <linearGradient id="g-metal-h" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#8a9096" />
        <stop offset="0.5" stopColor="#eef0f2" />
        <stop offset="1" stopColor="#8a9096" />
      </linearGradient>
      <linearGradient id="g-gold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fff1b8" />
        <stop offset="0.5" stopColor="#d9a93c" />
        <stop offset="1" stopColor="#a87914" />
      </linearGradient>
      <linearGradient id="g-cyl" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#000" stopOpacity="0.35" />
        <stop offset="0.25" stopColor="#fff" stopOpacity="0.35" />
        <stop offset="0.5" stopColor="#fff" stopOpacity="0.05" />
        <stop offset="1" stopColor="#000" stopOpacity="0.45" />
      </linearGradient>
      <linearGradient id="g-cyl-v" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#000" stopOpacity="0.4" />
        <stop offset="0.3" stopColor="#fff" stopOpacity="0.3" />
        <stop offset="0.55" stopColor="#fff" stopOpacity="0.05" />
        <stop offset="1" stopColor="#000" stopOpacity="0.45" />
      </linearGradient>
      <linearGradient id="g-gloss" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
        <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="g-chip" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#3a3c40" />
        <stop offset="1" stopColor="#141517" />
      </linearGradient>
      <radialGradient id="g-dome" cx="0.35" cy="0.3" r="0.8">
        <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
        <stop offset="0.25" stopColor="#fff" stopOpacity="0.15" />
        <stop offset="1" stopColor="#000" stopOpacity="0.15" />
      </radialGradient>
      <radialGradient id="g-hole" cx="0.5" cy="0.4" r="0.6">
        <stop offset="0" stopColor="#3b3b3b" />
        <stop offset="1" stopColor="#111" />
      </radialGradient>
      <filter id="f-glow" x="-200%" y="-200%" width="500%" height="500%">
        <feGaussianBlur stdDeviation="6" />
      </filter>
      <filter id="f-glow-s" x="-200%" y="-200%" width="500%" height="500%">
        <feGaussianBlur stdDeviation="2.5" />
      </filter>
      <filter id="f-shadow" x="-20%" y="-20%" width="140%" height="160%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="2.2" />
        <feOffset dx="0" dy="2.5" result="o" />
        <feComponentTransfer>
          <feFuncA type="linear" slope="0.28" />
        </feComponentTransfer>
        <feMerge>
          <feMergeNode />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="f-smoke" x="-100%" y="-100%" width="300%" height="300%">
        <feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="2" seed="3" />
        <feDisplacementMap in="SourceGraphic" scale="12" />
        <feGaussianBlur stdDeviation="2" />
      </filter>
      <pattern id="p-fr4" width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill="none" />
        <path d="M0 6 L6 0" stroke="#000" strokeOpacity="0.04" strokeWidth="1" />
      </pattern>
    </defs>
  );
}

/** Anschlussdraht (verzinnt) */
export function Lead({ x1, y1, x2, y2, w = 1.6 }: { x1: number; y1: number; x2: number; y2: number; w?: number }) {
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#7d8389" strokeWidth={w + 0.6} strokeLinecap="round" />
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#d9dde1" strokeWidth={w * 0.55} strokeLinecap="round" />
    </g>
  );
}

/** Stiftleiste (männlich) mit schwarzem Kunststoffträger */
export function HeaderPins({ pins, horizontal = true }: { pins: { x: number; y: number }[]; horizontal?: boolean }) {
  return (
    <g>
      {pins.map((p, i) => (
        <g key={i}>
          <rect x={p.x - 5} y={p.y - 5} width={10} height={10} rx={1} fill="#1d1d1f" />
          <rect x={p.x - 2.1} y={p.y - 2.1} width={4.2} height={4.2} rx={0.6} fill="url(#g-gold)" />
        </g>
      ))}
      {void horizontal}
    </g>
  );
}

/** Lötpad mit Loch (für Module ohne Stiftleiste) */
export function Pad({ x, y, r = 3.6, gold = true }: { x: number; y: number; r?: number; gold?: boolean }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={gold ? 'url(#g-gold)' : 'url(#g-metal)'} />
      <circle cx={x} cy={y} r={r * 0.45} fill="#151515" />
    </g>
  );
}

export function Label({ x, y, children, size = 5, color = '#fff', anchor = 'middle', weight = 600, rotate, opacity = 0.92, font = 'Inter' }: { x: number; y: number; children: ReactNode; size?: number; color?: string; anchor?: 'start' | 'middle' | 'end'; weight?: number; rotate?: number; opacity?: number; font?: string }) {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      fill={color}
      textAnchor={anchor}
      fontWeight={weight}
      fontFamily={font === 'mono' ? 'JetBrains Mono, ui-monospace, monospace' : 'Inter, -apple-system, system-ui, sans-serif'}
      dominantBaseline="middle"
      opacity={opacity}
      transform={rotate ? `rotate(${rotate} ${x} ${y})` : undefined}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
    >
      {children}
    </text>
  );
}

/** Platine eines Moduls (Breakout-Board) */
export function Pcb({ w, h, color = '#1f5fbf', r = 3, holes = true, children }: { w: number; h: number; color?: string; r?: number; holes?: boolean; children?: ReactNode }) {
  return (
    <g filter="url(#f-shadow)">
      <rect x={0} y={0} width={w} height={h} rx={r} fill={color} />
      <rect x={0} y={0} width={w} height={h} rx={r} fill="url(#p-fr4)" />
      <rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={r} fill="none" stroke="#fff" strokeOpacity={0.12} />
      {holes && w > 60 && h > 40 && (
        <g fill="#d6d9dc" stroke="url(#g-gold)" strokeWidth={1.2}>
          <circle cx={6} cy={6} r={2.6} />
          <circle cx={w - 6} cy={6} r={2.6} />
          <circle cx={6} cy={h - 6} r={2.6} />
          <circle cx={w - 6} cy={h - 6} r={2.6} />
        </g>
      )}
      {children}
    </g>
  );
}

/** IC-Gehäuse (Chip) */
export function Chip({ x, y, w, h, label, sub, legs = 0, legSide = 'both' }: { x: number; y: number; w: number; h: number; label?: string; sub?: string; legs?: number; legSide?: 'both' | 'four' }) {
  const legEls: ReactNode[] = [];
  if (legs > 0) {
    const n = legs;
    for (let i = 0; i < n; i++) {
      const lx = x + ((i + 0.5) * w) / n;
      legEls.push(<rect key={'t' + i} x={lx - 0.8} y={y - 2} width={1.6} height={2} fill="#c9cdd1" />);
      legEls.push(<rect key={'b' + i} x={lx - 0.8} y={y + h} width={1.6} height={2} fill="#c9cdd1" />);
      if (legSide === 'four') {
        const ly = y + ((i + 0.5) * h) / n;
        legEls.push(<rect key={'l' + i} x={x - 2} y={ly - 0.8} width={2} height={1.6} fill="#c9cdd1" />);
        legEls.push(<rect key={'r' + i} x={x + w} y={ly - 0.8} width={2} height={1.6} fill="#c9cdd1" />);
      }
    }
  }
  return (
    <g>
      {legEls}
      <rect x={x} y={y} width={w} height={h} rx={1.2} fill="url(#g-chip)" />
      <rect x={x} y={y} width={w} height={h * 0.5} rx={1.2} fill="url(#g-gloss)" />
      <circle cx={x + 3} cy={y + 3} r={1} fill="#000" opacity={0.6} />
      {label && (
        <Label x={x + w / 2} y={y + h / 2 - (sub ? 2.5 : 0)} size={Math.min(5, (w / Math.max(label.length, 3)) * 1.5)} color="#d4d4d4" weight={500}>
          {label}
        </Label>
      )}
      {sub && (
        <Label x={x + w / 2} y={y + h / 2 + 3.5} size={3} color="#9a9a9a" weight={400}>
          {sub}
        </Label>
      )}
    </g>
  );
}

/** Glüheffekt (z. B. LED) */
export function Glow({ cx, cy, r, color, intensity }: { cx: number; cy: number; r: number; color: string; intensity: number }) {
  if (intensity <= 0.01) return null;
  const i = Math.min(1, intensity);
  return (
    <g style={{ pointerEvents: 'none', mixBlendMode: 'screen' }}>
      <circle cx={cx} cy={cy} r={r * (1.5 + 2.5 * i)} fill={color} opacity={0.18 + 0.4 * i} filter="url(#f-glow)" />
      <circle cx={cx} cy={cy} r={r * 0.9} fill={color} opacity={0.4 + 0.5 * i} filter="url(#f-glow-s)" />
      <circle cx={cx} cy={cy} r={r * 0.4} fill="#fff" opacity={0.5 * i} filter="url(#f-glow-s)" />
    </g>
  );
}

/** Rauchwölkchen bei Überlast */
export function Smoke({ x, y }: { x: number; y: number }) {
  return (
    <g style={{ pointerEvents: 'none' }} className="smoke">
      <circle cx={x} cy={y - 8} r={6} fill="#9aa0a6" opacity={0.55} filter="url(#f-smoke)" />
      <circle cx={x + 5} cy={y - 16} r={8} fill="#b0b5ba" opacity={0.4} filter="url(#f-smoke)" />
      <circle cx={x - 3} cy={y - 26} r={10} fill="#c4c8cc" opacity={0.28} filter="url(#f-smoke)" />
    </g>
  );
}

/** Taktile Taste 6×6 mm */
export function TactButton({ x, y, size = 24, capColor = '#1d1d1f', pressed }: { x: number; y: number; size?: number; capColor?: string; pressed?: boolean }) {
  const s = size;
  return (
    <g>
      <rect x={x} y={y} width={s} height={s} rx={1.5} fill="url(#g-metal)" stroke="#6b7076" strokeWidth={0.5} />
      <rect x={x + 2} y={y + 2} width={s - 4} height={s - 4} rx={1} fill="#222" />
      <circle cx={x + s / 2} cy={y + s / 2} r={s * 0.3} fill={capColor} stroke="#000" strokeOpacity={0.5} />
      <circle cx={x + s / 2} cy={y + s / 2} r={s * 0.3} fill="url(#g-dome)" opacity={pressed ? 0.2 : 0.7} />
      {[0, 1].map((i) => [0, 1].map((j) => <circle key={`${i}${j}`} cx={x + 2.5 + i * (s - 5)} cy={y + 2.5 + j * (s - 5)} r={0.9} fill="#6b7076" />))}
    </g>
  );
}

/** Stiftleisten-Reihe für Module: Positionen der Pins (relativ) */
export function rowPins(ids: string[], x0: number, y: number, dx = PITCH): { id: string; x: number; y: number; label: string }[] {
  return ids.map((id, i) => ({ id, label: id, x: x0 + i * dx, y }));
}
export function colPins(ids: string[], x: number, y0: number, dy = PITCH): { id: string; x: number; y: number; label: string }[] {
  return ids.map((id, i) => ({ id, label: id, x, y: y0 + i * dy }));
}

/** Stiftleiste mit Beschriftung für ein Modul */
export function ModuleHeader({ pins, labelSide = 'inside', h, labelColor = '#fff' }: { pins: { x: number; y: number; label?: string }[]; labelSide?: 'inside' | 'above' | 'below'; h?: number; labelColor?: string }) {
  return (
    <g>
      <HeaderPins pins={pins} />
      {pins.map((p, i) =>
        p.label ? (
          <Label key={i} x={p.x} y={labelSide === 'above' ? p.y - 9 : labelSide === 'below' ? p.y + 9 : (h ?? 0) > p.y ? p.y + 9 : p.y - 9} size={3.6} color={labelColor} weight={600}>
            {p.label}
          </Label>
        ) : null,
      )}
    </g>
  );
}

export function UsbPort({ x, y, kind, rot = 0 }: { x: number; y: number; kind: 'micro' | 'usbc' | 'usbb' | 'mini' | 'none'; rot?: number }) {
  if (kind === 'none') return null;
  const dims = { micro: [30, 22], usbc: [34, 26], mini: [30, 24], usbb: [48, 46] }[kind];
  const [w, h] = dims;
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={kind === 'usbc' ? 9 : 2} fill="url(#g-metal)" stroke="#6b7076" strokeWidth={0.6} />
      <rect x={-w / 2 + 3} y={-h / 2 + 3} width={w - 6} height={h - 6} rx={kind === 'usbc' ? 6 : 1.5} fill="#2b2d30" />
      {kind === 'usbb' && <rect x={-12} y={-10} width={24} height={20} rx={2} fill="#f0f0f0" />}
      {kind !== 'usbb' && <rect x={-w / 2 + 7} y={-2} width={w - 14} height={4} rx={1} fill="#9aa0a6" />}
    </g>
  );
}

export function SmdLed({ x, y, color, on, size = 5 }: { x: number; y: number; color: string; on: number; size?: number }) {
  return (
    <g>
      <rect x={x - size / 2} y={y - size * 0.35} width={size} height={size * 0.7} rx={0.6} fill="#f2efe6" stroke="#bcb6a6" strokeWidth={0.3} />
      <rect x={x - size * 0.3} y={y - size * 0.2} width={size * 0.6} height={size * 0.4} fill={on > 0.02 ? color : '#d8d2c4'} opacity={0.4 + 0.6 * on} />
      <Glow cx={x} cy={y} r={size * 0.8} color={color} intensity={on} />
    </g>
  );
}

export function Resistor0603({ x, y, w = 6, h = 3 }: { x: number; y: number; w?: number; h?: number }) {
  return (
    <g>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} fill="#1e1e1e" />
      <rect x={x - w / 2} y={y - h / 2} width={1.2} height={h} fill="#c9cdd1" />
      <rect x={x + w / 2 - 1.2} y={y - h / 2} width={1.2} height={h} fill="#c9cdd1" />
    </g>
  );
}

/** einfache Hex-Farbmischung */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (f < 0) {
    r *= 1 + f;
    g *= 1 + f;
    b *= 1 + f;
  } else {
    r += (255 - r) * f;
    g += (255 - g) * f;
    b += (255 - b) * f;
  }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}
