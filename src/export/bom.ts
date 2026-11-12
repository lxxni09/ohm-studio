/** Stückliste mit Preisen und Bestell-Suchlinks */
import { getPart } from '../parts/registry';
import type { Project } from '../ohm/model';

export interface BomRow {
  bezeichnung: string;
  refs: string[];
  anzahl: number;
  preis: number;
  kategorie: string;
}

export function bomRows(project: Project): BomRow[] {
  const map = new Map<string, BomRow>();
  const notFitted = new Set(project.activeVariant ? project.variants?.[project.activeVariant]?.ohne ?? [] : []);
  for (const p of project.parts) {
    const def = getPart(p.type);
    if (!def || def.noBom || notFitted.has(p.id)) continue;
    const name = def.bom?.(p.props) ?? def.name;
    const r = map.get(name) ?? { bezeichnung: name, refs: [], anzahl: 0, preis: def.price ?? 0, kategorie: def.category };
    r.refs.push(p.id);
    r.anzahl++;
    map.set(name, r);
  }
  return [...map.values()].sort((a, b) => a.kategorie.localeCompare(b.kategorie) || a.bezeichnung.localeCompare(b.bezeichnung));
}

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

export function bomCsv(project: Project): string {
  const rows = bomRows(project);
  const lines = ['Pos;Referenzen;Anzahl;Bauteil;Kategorie;Einzelpreis (ca.);Summe;Reichelt;Mouser;AliExpress'];
  rows.forEach((r, i) => {
    const s = encodeURIComponent(r.bezeichnung);
    lines.push(
      [
        i + 1,
        q(r.refs.join(', ')),
        r.anzahl,
        q(r.bezeichnung),
        q(r.kategorie),
        r.preis.toFixed(2).replace('.', ','),
        (r.preis * r.anzahl).toFixed(2).replace('.', ','),
        `https://www.reichelt.de/index.html?ACTION=446&SEARCH=${s}`,
        `https://www.mouser.de/c/?q=${s}`,
        `https://www.aliexpress.com/wholesale?SearchText=${s}`,
      ].join(';'),
    );
  });
  const total = rows.reduce((a, r) => a + r.preis * r.anzahl, 0);
  lines.push(`;;;;;Gesamt;${total.toFixed(2).replace('.', ',')};;;`);
  return '﻿' + lines.join('\r\n');
}
