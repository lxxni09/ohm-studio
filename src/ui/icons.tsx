/** Feine Linien-Icons im Stil von SF Symbols */
import type { ReactNode, SVGProps } from 'react';

function I({ children, size = 16, ...rest }: { children: ReactNode; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {children}
    </svg>
  );
}

type P = { size?: number } & SVGProps<SVGSVGElement>;

export const Icon = {
  play: (p: P) => (
    <I {...p}>
      <path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.6-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8z" fill="currentColor" stroke="none" />
    </I>
  ),
  pause: (p: P) => (
    <I {...p}>
      <rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" />
    </I>
  ),
  stop: (p: P) => (
    <I {...p}>
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
    </I>
  ),
  reset: (p: P) => (
    <I {...p}>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 4v4.5h4.5" />
    </I>
  ),
  search: (p: P) => (
    <I {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </I>
  ),
  chevron: (p: P) => (
    <I {...p}>
      <path d="M9 6l6 6-6 6" />
    </I>
  ),
  chevronDown: (p: P) => (
    <I {...p}>
      <path d="M6 9l6 6 6-6" />
    </I>
  ),
  breadboard: (p: P) => (
    <I {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M6.5 9h.01M9.5 9h.01M12.5 9h.01M15.5 9h.01M6.5 15h.01M9.5 15h.01M12.5 15h.01M15.5 15h.01" strokeWidth={2.4} />
      <path d="M3 12h18" />
    </I>
  ),
  schematic: (p: P) => (
    <I {...p}>
      <path d="M2 12h4l1.5-4 3 8 3-8 3 8 1.5-4h4" />
    </I>
  ),
  pcb: (p: P) => (
    <I {...p}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.3" />
      <circle cx="15.5" cy="15.5" r="1.3" />
      <path d="M9.6 9.6l2.4 2.4h3.5M8.5 12v3.5h3.5" />
    </I>
  ),
  cube: (p: P) => (
    <I {...p}>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
    </I>
  ),
  code: (p: P) => (
    <I {...p}>
      <path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5" />
    </I>
  ),
  terminal: (p: P) => (
    <I {...p}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M7 10l3 2.5L7 15M12.5 15h4.5" />
    </I>
  ),
  gauge: (p: P) => (
    <I {...p}>
      <path d="M4.5 17a8.5 8.5 0 1 1 15 0" />
      <path d="M12 13l4-5" />
      <circle cx="12" cy="13.2" r="1.2" fill="currentColor" />
    </I>
  ),
  bell: (p: P) => (
    <I {...p}>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </I>
  ),
  checklist: (p: P) => (
    <I {...p}>
      <path d="M4 6.5l1.5 1.5 3-3M4 13.5l1.5 1.5 3-3M11.5 7h8.5M11.5 14h8.5M4 19.5h16" />
    </I>
  ),
  sparkles: (p: P) => (
    <I {...p}>
      <path d="M12 3.5l1.6 4.3a3 3 0 0 0 1.8 1.8l4.1 1.4-4.1 1.4a3 3 0 0 0-1.8 1.8L12 18.5l-1.6-4.3a3 3 0 0 0-1.8-1.8L4.5 11l4.1-1.4a3 3 0 0 0 1.8-1.8z" />
      <path d="M19 3v3M17.5 4.5h3" />
    </I>
  ),
  doc: (p: P) => (
    <I {...p}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </I>
  ),
  folder: (p: P) => (
    <I {...p}>
      <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </I>
  ),
  download: (p: P) => (
    <I {...p}>
      <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />
    </I>
  ),
  share: (p: P) => (
    <I {...p}>
      <path d="M12 3.5v11M8 7.5l4-4 4 4" />
      <path d="M7 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" />
    </I>
  ),
  more: (p: P) => (
    <I {...p}>
      <circle cx="6" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="18" cy="12" r="1.3" fill="currentColor" />
    </I>
  ),
  plus: (p: P) => (
    <I {...p}>
      <path d="M12 5v14M5 12h14" />
    </I>
  ),
  minus: (p: P) => (
    <I {...p}>
      <path d="M5 12h14" />
    </I>
  ),
  fit: (p: P) => (
    <I {...p}>
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
    </I>
  ),
  trash: (p: P) => (
    <I {...p}>
      <path d="M4.5 7h15M10 7V5h4v2M6.5 7l1 12a2 2 0 0 0 2 2h5a2 2 0 0 0 2-2l1-12" />
    </I>
  ),
  rotate: (p: P) => (
    <I {...p}>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 4v4.5h-4.5" />
    </I>
  ),
  copy: (p: P) => (
    <I {...p}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </I>
  ),
  sun: (p: P) => (
    <I {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </I>
  ),
  moon: (p: P) => (
    <I {...p}>
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
    </I>
  ),
  sidebarLeft: (p: P) => (
    <I {...p}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M9 4.5v15" />
    </I>
  ),
  sidebarRight: (p: P) => (
    <I {...p}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M15 4.5v15" />
    </I>
  ),
  panelBottom: (p: P) => (
    <I {...p}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M3 14.5h18" />
    </I>
  ),
  bolt: (p: P) => (
    <I {...p}>
      <path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z" />
    </I>
  ),
  graduation: (p: P) => (
    <I {...p}>
      <path d="M2.5 9.5L12 5l9.5 4.5L12 14z" />
      <path d="M6.5 11.5V16c3 2.5 8 2.5 11 0v-4.5M21.5 9.5v5" />
    </I>
  ),
  undo: (p: P) => (
    <I {...p}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </I>
  ),
  redo: (p: P) => (
    <I {...p}>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </I>
  ),
  close: (p: P) => (
    <I {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </I>
  ),
  info: (p: P) => (
    <I {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.5h.01" strokeWidth={2.2} />
    </I>
  ),
  warn: (p: P) => (
    <I {...p}>
      <path d="M10.3 4.2L2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4.5M12 17h.01" strokeWidth={2.2} />
    </I>
  ),
  error: (p: P) => (
    <I {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </I>
  ),
  check: (p: P) => (
    <I {...p}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </I>
  ),
  cart: (p: P) => (
    <I {...p}>
      <path d="M3 4h2.5l2.2 11.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L21 8H6.3" />
      <circle cx="10" cy="20.5" r="1" fill="currentColor" />
      <circle cx="17.5" cy="20.5" r="1" fill="currentColor" />
    </I>
  ),
  monitor: (p: P) => (
    <I {...p}>
      <rect x="3" y="4" width="18" height="12.5" rx="2" />
      <path d="M9 20.5h6M12 16.5v4" />
    </I>
  ),
  send: (p: P) => (
    <I {...p}>
      <path d="M4 12l16-8-6 16-2.5-6.5z" />
    </I>
  ),
  wire: (p: P) => (
    <I {...p}>
      <circle cx="5" cy="18" r="2" />
      <circle cx="19" cy="6" r="2" />
      <path d="M6.5 16.5C10 16 9 8 17.5 7.5" />
    </I>
  ),
  chip: (p: P) => (
    <I {...p}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
      <path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21" />
    </I>
  ),
  keyboard: (p: P) => (
    <I {...p}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10" strokeWidth={2} />
    </I>
  ),
};
