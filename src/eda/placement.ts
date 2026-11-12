/**
 * Automatisches Platzieren auf der Platine: kräftebasiert (Netze ziehen, Überlappungen stoßen ab),
 * danach Rasterung und Überlappungsauflösung. Ergebnis wird nur übernommen, wenn die Verbindungslänge sinkt.
 */
import { computePcb } from '../views/pcbLayout';
import { drc } from './drc';
import type { Project } from '../ohm/model';

export function wireLength(project: Project): number {
  const L = computePcb(project);
  let total = 0;
  for (const n of project.nets) {
    const pads = L.footprints.flatMap((f) => f.pads).filter((p) => p.net === n.name);
    if (pads.length < 2) continue;
    // Prim-MST
    const inT = [pads[0]];
    const rest = pads.slice(1);
    while (rest.length) {
      let best = Infinity;
      let bi = 0;
      for (let i = 0; i < rest.length; i++) for (const t of inT) {
        const d = Math.abs(rest[i].x - t.x) + Math.abs(rest[i].y - t.y);
        if (d < best) [best, bi] = [d, i];
      }
      total += best;
      inT.push(rest.splice(bi, 1)[0]);
    }
  }
  return total;
}

export function autoPlacePcb(project: Project, iterations = 300): { before: number; after: number; applied: boolean } {
  const before = wireLength(project);
  const drcBefore = drc(project).filter((v) => v.level === 'error').length;
  const L = computePcb(project);
  const fps = L.footprints.map((f) => ({ id: f.id, x: f.x, y: f.y, w: f.w, h: f.h, rot: f.rot, fixed: f.w * f.h > 20000 }));
  const idx = new Map(fps.map((f, i) => [f.id, i]));
  const edges: [number, number][] = [];
  for (const n of project.nets) {
    const ids = [...new Set(n.pins.map((r) => r.split('.')[0]).filter((id) => idx.has(id)))];
    const w = ids.length > 6 ? 0.3 : 1; // große Netze (GND) ziehen schwächer
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) for (let k = 0; k < (w === 1 ? 1 : 0); k++) edges.push([idx.get(ids[i])!, idx.get(ids[j])!]);
  }
  const m = 14;
  for (let it = 0; it < iterations; it++) {
    const temp = 1 - it / iterations;
    const fx = new Float64Array(fps.length);
    const fy = new Float64Array(fps.length);
    for (const [a, b] of edges) {
      const A = fps[a];
      const B = fps[b];
      const dx = B.x + B.w / 2 - (A.x + A.w / 2);
      const dy = B.y + B.h / 2 - (A.y + A.h / 2);
      fx[a] += dx * 0.02;
      fy[a] += dy * 0.02;
      fx[b] -= dx * 0.02;
      fy[b] -= dy * 0.02;
    }
    for (let i = 0; i < fps.length; i++)
      for (let j = i + 1; j < fps.length; j++) {
        const A = fps[i];
        const B = fps[j];
        const ox = Math.min(A.x + A.w + 8, B.x + B.w + 8) - Math.max(A.x, B.x);
        const oy = Math.min(A.y + A.h + 8, B.y + B.h + 8) - Math.max(A.y, B.y);
        if (ox > 0 && oy > 0) {
          const push = ox < oy ? [Math.sign(A.x - B.x || 1) * ox, 0] : [0, Math.sign(A.y - B.y || 1) * oy];
          fx[i] += push[0] * 0.5;
          fy[i] += push[1] * 0.5;
          fx[j] -= push[0] * 0.5;
          fy[j] -= push[1] * 0.5;
        }
      }
    for (let i = 0; i < fps.length; i++) {
      const f = fps[i];
      if (f.fixed) continue;
      const lim = 30 * temp + 2;
      f.x += Math.max(-lim, Math.min(lim, fx[i]));
      f.y += Math.max(-lim, Math.min(lim, fy[i]));
      f.x = Math.max(m, Math.min(L.w - m - f.w, f.x));
      f.y = Math.max(m, Math.min(L.h - m - f.h, f.y));
    }
  }
  // Raster + verbleibende Überlappungen auflösen
  for (const f of fps) {
    f.x = Math.round(f.x / 5) * 5;
    f.y = Math.round(f.y / 5) * 5;
  }
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (let i = 0; i < fps.length; i++)
      for (let j = 0; j < fps.length; j++) {
        if (i === j) continue;
        const A = fps[i];
        const B = fps[j];
        if (A.fixed || A.x >= B.x + B.w + 6 || B.x >= A.x + A.w + 6 || A.y >= B.y + B.h + 6 || B.y >= A.y + A.h + 6) continue;
        A.y = B.y + B.h + 10;
        if (A.y + A.h > L.h - m) {
          A.y = m;
          A.x = B.x + B.w + 10;
        }
        moved = true;
      }
    if (!moved) break;
  }
  const old = (project as any).pcb;
  (project as any).pcb = Object.fromEntries(fps.map((f) => [f.id, { x: f.x, y: f.y, rot: f.rot }]));
  const after = wireLength(project);
  if (after >= before || drc(project).filter((v) => v.level === 'error').length > drcBefore) {
    (project as any).pcb = old;
    return { before, after: before, applied: false };
  }
  return { before, after, applied: true };
}
