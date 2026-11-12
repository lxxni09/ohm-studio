/** Bildzeichen: Schaltungsknoten (Punkt mit drei abgehenden Linien) und Wortmarke „nodaris“ */
export function NodeMark({ size = 24, color = 'currentColor', bg }: { size?: number; color?: string; bg?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="Nodaris">
      {bg && <rect width="32" height="32" rx="8" fill={bg} />}
      <g stroke={bg ? '#fff' : color} strokeWidth={3} strokeLinecap="round" fill="none">
        <path d="M16 16 L16 5" />
        <path d="M16 16 L6.5 21.5" />
        <path d="M16 16 L25.5 21.5" />
      </g>
      <circle cx="16" cy="16" r="5" fill={bg ? '#fff' : color} />
    </svg>
  );
}

export function Wordmark({ height = 20, color = 'currentColor' }: { height?: number; color?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: height * 0.35, color, fontWeight: 600, fontSize: height, letterSpacing: '-0.02em', lineHeight: 1 }}>
      <NodeMark size={height * 1.1} color={color} />
      nodaris
    </span>
  );
}
