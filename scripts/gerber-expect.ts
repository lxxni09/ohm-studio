// Gibt die erwarteten Werte (Bohrungen, Breite, Höhe in mm) für check_gerber.py aus – aus dem Platinenlayout berechnet.
import { readFileSync } from 'fs';
import { parseOhm } from '../src/ohm/format';
import { computePcb, mountHoles } from '../src/views/pcbLayout';
const p = parseOhm(readFileSync(process.argv[2], 'utf8')).project;
const L = computePcb(p);
const holes = L.footprints.reduce((a, f) => a + f.pads.length, 0) + L.vias.length + mountHoles(L.w, L.h).length;
console.log(`${holes} ${(L.w * 0.254).toFixed(2)} ${(L.h * 0.254).toFixed(2)}`);
