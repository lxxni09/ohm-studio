import { memo, useMemo, useState } from 'react';
import { ALL_PARTS, searchParts } from '../parts/registry';
import { catalog } from '../parts/catalog';

const catalogSize = () => catalog().length;
import { CATEGORIES, type PartDef } from '../parts/types';
import { SvgDefs } from '../parts/svg';
import { addPart, requestFit, useStore } from '../state/store';
import { Icon } from './icons';
import { t } from '../i18n';

/** Vorschaubild eines Bauteils (verkleinerte echte Grafik) */
export const PartThumb = memo(function PartThumb({ def, props, size = 36 }: { def: PartDef; props?: Record<string, unknown>; size?: number }) {
  const p = { ...def.defaults, ...(props ?? {}) };
  const s = def.size(p);
  const pad = Math.max(s.w, s.h) * 0.12 + 6;
  return (
    <svg viewBox={`${-pad} ${-pad} ${s.w + pad * 2} ${s.h + pad * 2}`} width={size} height={size * 0.85} preserveAspectRatio="xMidYMid meet">
      <SvgDefs />
      {def.render({ props: p, state: {}, running: false, id: 'thumb-' + def.type })}
    </svg>
  );
});

export function Library() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ Mikrocontroller: true, Passiv: true, Halbleiter: true });
  const libOpen = useStore((s) => s.libraryOpen);
  const hits = useMemo(() => searchParts(q), [q]);
  const grouped = useMemo(() => {
    const m = new Map<string, typeof hits>();
    for (const c of CATEGORIES) m.set(c, []);
    for (const h of hits) m.get(h.part.category)?.push(h);
    return m;
  }, [hits]);

  const add = (def: PartDef, preset?: Record<string, unknown>) => {
    addPart(def.type, NaN, NaN, preset);
    requestFit();
  };

  return (
    <aside className={`sidebar left ${libOpen ? '' : 'collapsed'}`}>
      <div className="side-head">
        <div className="search">
          <Icon.search size={14} />
          <input placeholder={t("Suchen: „widerstand 1k“, „esp32 c3“ …")} aria-label={t("Suchen: „widerstand 1k“, „esp32 c3“ …")} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => {
            if (e.key === 'Enter' && hits[0]) add(hits[0].part, hits[0].preset);
            if (e.key === 'Escape') setQ('');
          }} spellCheck={false} />
          {q && (
            <button className="icon-btn" style={{ width: 20, height: 20 }} onClick={() => setQ('')}>
              <Icon.close size={12} />
            </button>
          )}
        </div>
      </div>
      <div className="side-scroll">
        {q && !hits.length && <div className="empty">Nichts gefunden.<br />Versuch es mit „led“, „sensor“ oder „esp32“.</div>}
        {CATEGORIES.map((c) => {
          const list = grouped.get(c) ?? [];
          if (!list.length) return null;
          const isOpen = q ? true : !!open[c];
          return (
            <div className="cat" key={c}>
              <button className="cat-head" onClick={() => setOpen({ ...open, [c]: !open[c] })}>
                <Icon.chevron size={11} className={`chev ${isOpen ? 'open' : ''}`} />
                {t(c)}
                <span className="count">{list.length}</span>
              </button>
              {isOpen &&
                list.map(({ part, preset, variant }) => (
                  <div
                    key={part.type + (variant ?? '')}
                    className="part-item"
                    draggable
                    title={part.info}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-ohm-part', JSON.stringify({ type: part.type, preset }));
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onDoubleClick={() => add(part, preset)}
                  >
                    <div className="part-thumb">
                      <PartThumb def={part} props={preset} />
                    </div>
                    <div className="part-meta">
                      <b>{variant ? variant.split(' · ')[0] : part.name}</b>
                      <span>{variant ? variant.split(' · ')[1] : preset ? Object.values(preset).join(' · ') : part.board ? `${part.board.chip} · ${part.board.vcc} V` : part.keywords?.split(' ').slice(0, 4).join(' · ')}</span>
                    </div>
                  </div>
                ))}
            </div>
          );
        })}
        <div className="info-text" style={{ padding: '14px 8px 0' }}>
          {ALL_PARTS.length} Bauteiltypen · {(catalogSize() + ALL_PARTS.length).toLocaleString('de-DE')} Bestellvarianten · Ziehen oder doppelklicken zum Einfügen
        </div>
      </div>
    </aside>
  );
}
