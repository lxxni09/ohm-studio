/**
 * Fotorealistische 3D-Platine (Three.js, physikbasierte Materialien).
 * Modi: Normal, Werkbank (Lötmatte), Röntgen, Explosion (Lagen aufgeklappt), Foto (4K-Export).
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { PcbLayout, Footprint } from './pcbLayout';
import { SURFACE_COLORS } from './pcbLayout';
import { getPart } from '../parts/registry';
import { ledColor } from '../parts/library/basic';
import { resistorBands, parseValue, formatValue } from '../lib/units';
import { engine, state } from '../state/store';
import { download } from '../ui/files';

const U = 0.254; // mm je Einheit
type Mode = 'normal' | 'werkbank' | 'roentgen' | 'explosion';

/** Textur aus Canvas zeichnen */
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function maskMaterial(L: PcbLayout): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(L.color),
    roughness: L.matte ? 0.75 : 0.28,
    clearcoat: L.matte ? 0.1 : 0.9,
    clearcoatRoughness: L.matte ? 0.6 : 0.12,
    transmission: 0,
    sheen: 0.2,
  });
}

function surfaceMaterial(L: PcbLayout): THREE.MeshPhysicalMaterial {
  const c = SURFACE_COLORS[L.surface];
  const rough = { enig: 0.18, hasl: 0.42, osp: 0.3, silber: 0.15, zinn: 0.35 }[L.surface];
  return new THREE.MeshPhysicalMaterial({ color: new THREE.Color(c.base), metalness: 1, roughness: rough, clearcoat: L.surface === 'hasl' ? 0.3 : 0 });
}

/** Leiterplatten-Deckseite: Lack, darunter leicht erhabene Kupferbahnen, Bestückungsdruck */
function topTexture(L: PcbLayout, scale: number, layer: 'top' | 'bottom') {
  const W = Math.round(L.w * scale);
  const H = Math.round(L.h * scale);
  const color = canvasTex(W, H, (g) => {
    g.fillStyle = L.color;
    g.fillRect(0, 0, W, H);
    // Glasfaser-Struktur ganz dezent
    g.globalAlpha = 0.035;
    for (let y = 0; y < H; y += 3) {
      g.fillStyle = y % 6 ? '#000' : '#fff';
      g.fillRect(0, y, W, 1);
    }
    g.globalAlpha = 1;
    // Kupfer unter Lack: etwas heller
    g.save();
    g.scale(scale, scale);
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const t of L.traces.filter((t) => t.layer === layer)) {
      g.lineWidth = t.width;
      g.beginPath();
      t.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
    }
    if (L.pour?.layers.includes(layer)) {
      g.globalAlpha = 0.06;
      g.fillStyle = '#fff';
      g.fillRect(5, 5, L.w - 10, L.h - 10);
      g.globalCompositeOperation = 'destination-out';
      g.globalAlpha = 1;
      for (const p of L.footprints.flatMap((f) => f.pads).filter((p) => p.net !== L.pour!.net)) {
        g.beginPath();
        g.arc(p.x, p.y, p.d / 2 + L.pour!.clearance, 0, Math.PI * 2);
        g.fill();
      }
      g.globalCompositeOperation = 'source-over';
      // Lack über den Freistellungen wieder einfärben
      g.globalCompositeOperation = 'destination-over';
      g.fillStyle = L.color;
      g.fillRect(0, 0, L.w, L.h);
      g.globalCompositeOperation = 'source-over';
    }
    // Bestückungsdruck (nur oben)
    if (layer === 'top') {
      const silk = L.color === '#ececec' ? '#222' : '#f6f6f2';
      g.strokeStyle = silk;
      g.fillStyle = silk;
      g.lineWidth = 0.8;
      g.font = '600 5px Inter, sans-serif';
      for (const f of L.footprints) {
        g.strokeRect(f.x, f.y, f.w, f.h);
        g.fillText(f.label, f.x + 1.5, f.y - 2);
      }
      g.font = '600 6px Inter, sans-serif';
      g.textAlign = 'right';
      g.fillText(`${state.project.name}`, L.w - 10, L.h - 14);
      g.font = '500 4.5px Inter, sans-serif';
      g.fillText('Ohm Studio by Nodaris', L.w - 10, L.h - 7);
      // kleiner QR-artiger Code als Fertigungsmarke
      g.textAlign = 'left';
      const qx = 14;
      const qy = L.h - 30;
      let seed = state.project.name.length * 7919;
      for (let i = 0; i < 9; i++)
        for (let j = 0; j < 9; j++) {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          const finder = (i < 3 && j < 3) || (i > 5 && j < 3) || (i < 3 && j > 5);
          if (finder || seed % 3 === 0) g.fillRect(qx + i * 1.8, qy + j * 1.8, 1.8, 1.8);
        }
    }
    g.restore();
  });
  // Höhenkarte: Bahnen leicht erhaben unter dem Lack
  const bump = canvasTex(W, H, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.scale(scale, scale);
    g.strokeStyle = '#fff';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const t of L.traces.filter((t) => t.layer === layer)) {
      g.lineWidth = t.width;
      g.beginPath();
      t.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
    }
    if (layer === 'top') {
      g.fillStyle = '#888';
      for (const f of L.footprints) g.fillRect(f.x, f.y - 6, f.label.length * 3, 5);
    }
  });
  bump.colorSpace = THREE.NoColorSpace;
  return { color, bump };
}

function bodyColor(f: Footprint): { color: string; kind: 'box' | 'cyl' | 'dome' | 'board'; metal?: boolean; label?: string } {
  const def = getPart(f.kind);
  const t = f.kind;
  if (def?.board) return { color: def.board.color, kind: 'board', label: def.board.chip };
  if (t === 'widerstand') return { color: String(f.inst.props.ringe) === '5' ? '#7fb0de' : '#e6c99a', kind: 'cyl' };
  if (t === 'led') return { color: ledColor(f.inst.props.farbe).body, kind: 'dome' };
  if (t === 'elko') return { color: '#1d3f9e', kind: 'cyl' };
  if (t === 'kondensator') return { color: '#e8892b', kind: 'dome' };
  if (t === 'summer') return { color: '#141414', kind: 'cyl' };
  if (t === 'taster') return { color: '#2b2b2b', kind: 'box' };
  if (def?.category === 'Halbleiter') return { color: '#161616', kind: 'box', label: f.kind.toUpperCase() };
  if (def?.category === 'ICs') return { color: '#161616', kind: 'box', label: f.kind.toUpperCase() };
  if (def?.category === 'Displays') return { color: '#0d0d0d', kind: 'box' };
  return { color: '#1f5fbf', kind: 'box' };
}

function chipTexture(label: string, sub: string) {
  return canvasTex(256, 128, (g) => {
    g.fillStyle = '#161616';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#bdbdbd';
    g.font = '600 30px Inter, sans-serif';
    g.textAlign = 'center';
    g.fillText(label.slice(0, 14), 128, 60);
    g.fillStyle = '#8c8c8c';
    g.font = '400 18px Inter, sans-serif';
    g.fillText(sub, 128, 92);
    g.beginPath();
    g.arc(18, 18, 7, 0, Math.PI * 2);
    g.fillStyle = '#0a0a0a';
    g.fill();
  });
}

function resistorTexture(ohm: number, five: boolean, body: string) {
  // Kapsel-UV: v läuft entlang der Länge → Ringe als waagerechte Streifen
  return canvasTex(64, 256, (g) => {
    g.fillStyle = body;
    g.fillRect(0, 0, 64, 256);
    const bands = resistorBands(ohm, five);
    const pos = five ? [52, 82, 112, 142, 190] : [56, 92, 128, 184];
    bands.forEach((c, i) => {
      g.fillStyle = c;
      g.fillRect(0, pos[i], 64, 20);
    });
  });
}

export default function Pcb3DPro({ L }: { L: PcbLayout }) {
  const host = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('normal');
  const api = useRef<{ photo: () => void; video: () => void } | null>(null);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.45;
    const Wmm = L.w * U;
    const Hmm = L.h * U;
    const camera = new THREE.PerspectiveCamera(35, el.clientWidth / el.clientHeight, 1, 5000);
    const dist = Math.max(Wmm, Hmm) * 1.6 + 30;
    camera.position.set(Wmm * 0.15, dist * 0.75, dist * 0.8);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);
    controls.maxPolarAngle = Math.PI * 0.49;

    // Licht: weiches Hauptlicht mit Schatten, Fülllicht
    const key = new THREE.DirectionalLight(0xfff6ea, 2.6);
    key.position.set(-Wmm * 0.6, dist * 1.2, dist * 0.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 6;
    key.shadow.bias = -0.0004;
    const sc = Math.max(Wmm, Hmm);
    Object.assign(key.shadow.camera, { left: -sc, right: sc, top: sc, bottom: -sc, near: 1, far: dist * 4 });
    scene.add(key, new THREE.HemisphereLight(0xffffff, 0x404040, 0.6));

    const root = new THREE.Group();
    scene.add(root);
    const thick = 1.6;
    const toX = (x: number) => x * U - Wmm / 2;
    const toZ = (y: number) => y * U - Hmm / 2;

    // Untergrund
    let ground: THREE.Mesh;
    if (mode === 'werkbank') {
      const mat = canvasTex(1024, 1024, (g) => {
        g.fillStyle = '#2f6b78';
        g.fillRect(0, 0, 1024, 1024);
        g.strokeStyle = 'rgba(255,255,255,0.25)';
        for (let i = 0; i <= 1024; i += 32) {
          g.lineWidth = i % 128 ? 1 : 2;
          g.beginPath();
          g.moveTo(i, 0);
          g.lineTo(i, 1024);
          g.moveTo(0, i);
          g.lineTo(1024, i);
          g.stroke();
        }
        g.fillStyle = 'rgba(255,255,255,0.5)';
        g.font = '600 26px Inter';
        g.fillText('SILIKON-LÖTMATTE · 500 °C', 40, 990);
      });
      ground = new THREE.Mesh(new THREE.PlaneGeometry(sc * 5, sc * 5), new THREE.MeshStandardMaterial({ map: mat, roughness: 0.9 }));
      // Lötkolben
      const iron = new THREE.Group();
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(6, 7, 70, 24), new THREE.MeshStandardMaterial({ color: '#1d1d1f', roughness: 0.6 }));
      handle.rotation.z = Math.PI / 2;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 40, 16), new THREE.MeshStandardMaterial({ color: '#c9cdd1', metalness: 1, roughness: 0.25 }));
      shaft.rotation.z = Math.PI / 2;
      shaft.position.x = -55;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(2.2, 10, 16), new THREE.MeshStandardMaterial({ color: '#888', metalness: 1, roughness: 0.3 }));
      tip.rotation.z = Math.PI / 2;
      tip.position.x = -80;
      iron.add(handle, shaft, tip);
      iron.position.set(Wmm * 0.2, 7, Hmm / 2 + 40);
      iron.rotation.y = 0.3;
      iron.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      scene.add(iron);
      // Multimeter
      const mm = new THREE.Mesh(new RoundedBoxGeometry(70, 16, 130, 4, 6), new THREE.MeshStandardMaterial({ color: '#f2b705', roughness: 0.6 }));
      mm.position.set(-Wmm / 2 - 70, 8, 10);
      mm.rotation.y = 0.15;
      mm.castShadow = true;
      const lcd = new THREE.Mesh(new THREE.PlaneGeometry(50, 26), new THREE.MeshStandardMaterial({ map: canvasTex(256, 128, (g) => {
        g.fillStyle = '#c3d1b0';
        g.fillRect(0, 0, 256, 128);
        g.fillStyle = '#1d2a12';
        g.font = '64px monospace';
        g.textAlign = 'right';
        g.fillText('4.512', 240, 90);
      }) }));
      lcd.rotation.x = -Math.PI / 2;
      lcd.position.set(0, 8.1, -35);
      mm.add(lcd);
      scene.add(mm);
    } else {
      ground = new THREE.Mesh(new THREE.PlaneGeometry(sc * 6, sc * 6), new THREE.ShadowMaterial({ opacity: 0.22 }));
    }
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -thick / 2 - 0.01 - (mode === 'explosion' ? 20 : 0);
    ground.receiveShadow = true;
    scene.add(ground);

    // Platine: Kante FR4, Ober- und Unterseite
    const shape = new THREE.Shape();
    const r = 2;
    shape.moveTo(-Wmm / 2 + r, -Hmm / 2);
    shape.lineTo(Wmm / 2 - r, -Hmm / 2);
    shape.quadraticCurveTo(Wmm / 2, -Hmm / 2, Wmm / 2, -Hmm / 2 + r);
    shape.lineTo(Wmm / 2, Hmm / 2 - r);
    shape.quadraticCurveTo(Wmm / 2, Hmm / 2, Wmm / 2 - r, Hmm / 2);
    shape.lineTo(-Wmm / 2 + r, Hmm / 2);
    shape.quadraticCurveTo(-Wmm / 2, Hmm / 2, -Wmm / 2, Hmm / 2 - r);
    shape.lineTo(-Wmm / 2, -Hmm / 2 + r);
    shape.quadraticCurveTo(-Wmm / 2, -Hmm / 2, -Wmm / 2 + r, -Hmm / 2);
    for (const [hx, hy] of [[10, 10], [L.w - 10, 10], [10, L.h - 10], [L.w - 10, L.h - 10]]) {
      const hole = new THREE.Path();
      hole.absarc(toX(hx), toZ(hy), 1.6, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
    const fr4 = canvasTex(64, 64, (g) => {
      for (let y = 0; y < 64; y++) {
        g.fillStyle = y % 8 < 4 ? '#c8b98a' : '#b5a374';
        g.fillRect(0, y, 64, 1);
      }
    });
    fr4.wrapS = fr4.wrapT = THREE.RepeatWrapping;
    const edgeMat = new THREE.MeshStandardMaterial({ map: fr4, roughness: 0.85 });
    const xray = mode === 'roentgen';
    const boardGeo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 24 });
    boardGeo.rotateX(Math.PI / 2);
    boardGeo.translate(0, thick / 2, 0);
    const scale = Math.min(8, 4096 / Math.max(L.w, L.h));
    const top = topTexture(L, scale, 'top');
    const bot = topTexture(L, scale, 'bottom');
    const topMat = maskMaterial(L);
    topMat.map = top.color;
    topMat.bumpMap = top.bump;
    topMat.bumpScale = 1.2;
    if (xray) {
      topMat.transparent = true;
      topMat.opacity = 0.35;
      topMat.depthWrite = false;
    }
    const board = new THREE.Mesh(boardGeo, [edgeMat, edgeMat]);
    board.castShadow = true;
    board.receiveShadow = true;
    root.add(board);
    const topPlane = new THREE.Mesh(new THREE.PlaneGeometry(Wmm, Hmm), topMat);
    topPlane.rotation.x = -Math.PI / 2;
    topPlane.position.y = thick / 2 + 0.02;
    topPlane.receiveShadow = true;
    root.add(topPlane);
    const botMat = maskMaterial(L);
    botMat.map = bot.color;
    botMat.bumpMap = bot.bump;
    const botPlane = new THREE.Mesh(new THREE.PlaneGeometry(Wmm, Hmm), botMat);
    botPlane.rotation.x = Math.PI / 2;
    botPlane.position.y = -thick / 2 - 0.02 - (mode === 'explosion' ? 12 : 0);
    root.add(botPlane);
    if (mode === 'explosion' || xray) {
      // Kupferlagen einzeln
      const copper = new THREE.MeshStandardMaterial({ color: '#c87533', metalness: 1, roughness: 0.3, transparent: xray, opacity: xray ? 0.8 : 1 });
      for (const [layer, yOff] of [['top', mode === 'explosion' ? 8 : 0.4], ['bottom', mode === 'explosion' ? -8 : -0.4]] as const) {
        for (const t of L.traces.filter((tr) => tr.layer === layer)) {
          for (let i = 1; i < t.pts.length; i++) {
            const a = t.pts[i - 1];
            const b = t.pts[i];
            const len = Math.hypot(b.x - a.x, b.y - a.y) * U;
            const seg = new THREE.Mesh(new THREE.BoxGeometry(len + t.width * U, 0.07, t.width * U), copper);
            seg.position.set((toX(a.x) + toX(b.x)) / 2, yOff, (toZ(a.y) + toZ(b.y)) / 2);
            seg.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
            root.add(seg);
          }
        }
      }
      if (mode === 'explosion') {
        topPlane.position.y += 16;
        board.material = [edgeMat, edgeMat];
      }
    }

    // Pads, Bohrungen, Lötkegel
    const surf = surfaceMaterial(L);
    const solder = new THREE.MeshPhysicalMaterial({ color: '#d8dce0', metalness: 1, roughness: 0.12, clearcoat: 0.4 });
    const holeMat = new THREE.MeshStandardMaterial({ color: '#0d0d0d', roughness: 1 });
    const pads = L.footprints.flatMap((f) => f.pads);
    for (const p of pads) {
      const rr = (p.d / 2) * U;
      const geo = p.square ? new THREE.BoxGeometry(rr * 2, 0.06, rr * 2) : new THREE.CylinderGeometry(rr, rr, 0.06, 24);
      for (const side of [1, -1]) {
        const m = new THREE.Mesh(geo, surf);
        m.position.set(toX(p.x), side * (thick / 2 + 0.05) + (mode === 'explosion' && side > 0 ? 16 : 0), toZ(p.y));
        root.add(m);
      }
      const hole = new THREE.Mesh(new THREE.CylinderGeometry((p.drill / 2) * U * 0.55, (p.drill / 2) * U * 0.55, thick + 0.2, 16), holeMat);
      hole.position.set(toX(p.x), 0, toZ(p.y));
      root.add(hole);
      // Lötkegel (Fillet) mit Pin
      if (mode !== 'explosion') {
        const fillet = new THREE.Mesh(new THREE.ConeGeometry(rr * 0.95, 1.1, 24, 1, true), solder);
        fillet.position.set(toX(p.x), thick / 2 + 0.55 + 0.06, toZ(p.y));
        fillet.castShadow = true;
        root.add(fillet);
        const fb = fillet.clone();
        fb.rotation.x = Math.PI;
        fb.position.y = -thick / 2 - 0.6;
        root.add(fb);
      }
    }
    // Vias
    for (const v of L.vias) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.2, 8, 20), surf);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(toX(v.x), thick / 2 + 0.03, toZ(v.y));
      root.add(ring);
    }

    // Bauteile
    for (const f of L.footprints) {
      const def = getPart(f.kind);
      const b = bodyColor(f);
      const h = Math.max(1, f.height * (b.kind === 'board' ? 0.2 : 1));
      const st = engine.states.get(f.id) ?? {};
      const cx = toX(f.x + f.w / 2);
      const cz = toZ(f.y + f.h / 2);
      const base = thick / 2 + 0.1 + (mode === 'explosion' ? 30 : 0);
      let mesh: THREE.Object3D;
      if (b.kind === 'board') {
        const g = new THREE.Group();
        const pcb = new THREE.Mesh(new RoundedBoxGeometry(f.w * U, 1.6, f.h * U, 2, 0.6), new THREE.MeshPhysicalMaterial({ color: b.color, roughness: 0.35, clearcoat: 0.7 }));
        pcb.position.y = 9;
        const chip = new THREE.Mesh(new THREE.BoxGeometry(Math.min(12, f.w * U * 0.5), 1, Math.min(12, f.w * U * 0.5)), [
          new THREE.MeshStandardMaterial({ color: '#161616' }),
          new THREE.MeshStandardMaterial({ color: '#161616' }),
          new THREE.MeshStandardMaterial({ map: chipTexture(b.label ?? '', def?.board?.family.toUpperCase() ?? '') }),
          new THREE.MeshStandardMaterial({ color: '#161616' }),
          new THREE.MeshStandardMaterial({ color: '#161616' }),
          new THREE.MeshStandardMaterial({ color: '#161616' }),
        ]);
        chip.position.y = 10.3;
        // Stiftleisten
        const hdr = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.7 });
        const pinMat = new THREE.MeshStandardMaterial({ color: '#d9a93c', metalness: 1, roughness: 0.25 });
        for (const p of f.pads) {
          const blk = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 2.5), hdr);
          blk.position.set(toX(p.x) - cx, 6.8, toZ(p.y) - cz);
          const pin = new THREE.Mesh(new THREE.BoxGeometry(0.64, 11, 0.64), pinMat);
          pin.position.set(toX(p.x) - cx, 4.5, toZ(p.y) - cz);
          g.add(blk, pin);
        }
        g.add(pcb, chip);
        mesh = g;
      } else if (f.kind === 'widerstand') {
        const len = Math.max(6.3, (f.w - 18) * U);
        const tex = resistorTexture(parseValue(f.inst.props.wert, 220), String(f.inst.props.ringe) === '5', b.color);
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.25, len - 2.5, 8, 24), new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.35, clearcoat: 0.8 }));
        body.rotation.z = Math.PI / 2;
        body.position.y = 1.6;
        const g = new THREE.Group();
        g.add(body);
        const lead = new THREE.MeshStandardMaterial({ color: '#cfd3d6', metalness: 1, roughness: 0.3 });
        for (const p of f.pads) {
          const l = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 2, 8), lead);
          l.position.set(toX(p.x) - cx, 0.6, toZ(p.y) - cz);
          g.add(l);
        }
        const bend = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, f.w * U - 4, 8), lead);
        bend.rotation.z = Math.PI / 2;
        bend.position.y = 1.6;
        g.add(bend);
        if (f.rot % 180) g.rotation.y = Math.PI / 2;
        mesh = g;
      } else if (b.kind === 'dome') {
        const g = new THREE.Group();
        const isLed = f.kind === 'led';
        const glow = isLed ? Math.min(1, st.brightness ?? 0) : 0;
        const col = isLed ? ledColor(f.inst.props.farbe).hex : b.color;
        const mat = isLed
          ? new THREE.MeshPhysicalMaterial({ color: b.color, transmission: 0.85, thickness: 3, roughness: 0.05, ior: 1.5, emissive: new THREE.Color(col), emissiveIntensity: glow * 3 })
          : new THREE.MeshPhysicalMaterial({ color: b.color, roughness: 0.4, clearcoat: 0.5 });
        const rr = isLed ? (f.inst.props.groesse === '3mm' ? 1.5 : 2.5) : 2.4;
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, isLed ? 5.6 : 1.8, 32), mat);
        cyl.position.y = isLed ? 2.8 + 1 : 3;
        const dome = new THREE.Mesh(new THREE.SphereGeometry(rr, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat);
        dome.position.y = isLed ? 5.6 + 1 : 3.9;
        g.add(cyl, dome);
        if (isLed) {
          const rim = new THREE.Mesh(new THREE.TorusGeometry(rr + 0.25, 0.25, 8, 32), mat);
          rim.rotation.x = Math.PI / 2;
          rim.position.y = 1.2;
          const chipM = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.6), new THREE.MeshStandardMaterial({ color: '#222', emissive: new THREE.Color(col), emissiveIntensity: glow * 6 }));
          chipM.position.y = 4;
          g.add(rim, chipM);
          if (glow > 0.05) {
            const light = new THREE.PointLight(new THREE.Color(col), glow * 60, 40, 2);
            light.position.y = 7;
            g.add(light);
          }
        }
        mesh = g;
      } else if (b.kind === 'cyl') {
        const rr = Math.min(f.w, f.h) * U * 0.45;
        const hh = Math.max(4, h);
        const mat = new THREE.MeshPhysicalMaterial({ color: b.color, roughness: 0.3, clearcoat: 0.6 });
        const g = new THREE.Group();
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, hh, 40), mat);
        cyl.position.y = hh / 2 + 0.4;
        g.add(cyl);
        if (f.kind === 'elko') {
          const stripe = new THREE.Mesh(new THREE.CylinderGeometry(rr + 0.02, rr + 0.02, hh * 0.98, 40, 1, true, 0, Math.PI / 3), new THREE.MeshStandardMaterial({ color: '#b9c3d6' }));
          stripe.position.y = hh / 2 + 0.4;
          const cap = new THREE.Mesh(new THREE.CircleGeometry(rr * 0.98, 40), new THREE.MeshStandardMaterial({ color: '#c9ccd1', metalness: 1, roughness: 0.35 }));
          cap.rotation.x = -Math.PI / 2;
          cap.position.y = hh + 0.42;
          // Sollbruchkerbe (bei geplatztem Elko aufgerissen)
          const notch = new THREE.Mesh(new THREE.TorusGeometry(rr * 0.4, 0.15, 6, 3), new THREE.MeshStandardMaterial({ color: '#7d8389', metalness: 1 }));
          notch.rotation.x = Math.PI / 2;
          notch.position.y = hh + 0.45;
          g.add(stripe, cap, notch);
          if (st.burst) {
            cap.position.y += 1.5;
            cap.rotation.z = 0.5;
          }
        }
        mesh = g;
      } else {
        const mats = new THREE.MeshPhysicalMaterial({ color: b.color, roughness: 0.45, clearcoat: 0.3 });
        const topMatC = b.label ? new THREE.MeshStandardMaterial({ map: chipTexture(b.label, 'Nodaris · 2645') }) : mats;
        const box = new THREE.Mesh(new RoundedBoxGeometry(Math.max(2, f.w * U * 0.8), h, Math.max(2, f.h * U * 0.8), 2, 0.3), [mats, mats, topMatC, mats, mats, mats]);
        box.position.y = h / 2 + 0.5;
        mesh = box;
      }
      mesh.position.set(cx, base, cz);
      mesh.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      if (xray) mesh.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m && !Array.isArray(m)) {
          m.transparent = true;
          m.opacity = 0.25;
        }
      });
      root.add(mesh);
    }

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();
    const onResize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    api.current = {
      photo: () => {
        // 4K-Export
        const w0 = el.clientWidth;
        const h0 = el.clientHeight;
        renderer.setPixelRatio(1);
        renderer.setSize(3840, 2160, false);
        camera.aspect = 3840 / 2160;
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
        renderer.domElement.toBlob((b) => b && download(`${state.project.name}-4k.png`, b));
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
        renderer.setSize(w0, h0);
        onResize();
      },
      video: () => {
        // 360°-Drehung als WebM
        const stream = renderer.domElement.captureStream(60);
        const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => chunks.push(e.data);
        rec.onstop = () => download(`${state.project.name}-360.webm`, new Blob(chunks, { type: 'video/webm' }));
        const r0 = Math.hypot(camera.position.x, camera.position.z);
        const y0 = camera.position.y;
        const t0 = performance.now();
        controls.enabled = false;
        rec.start();
        const spin = () => {
          const t = (performance.now() - t0) / 6000;
          if (t >= 1) {
            rec.stop();
            controls.enabled = true;
            return;
          }
          camera.position.set(Math.sin(t * Math.PI * 2) * r0, y0, Math.cos(t * Math.PI * 2) * r0);
          camera.lookAt(0, 0, 0);
          requestAnimationFrame(spin);
        };
        spin();
      },
    };
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      pmrem.dispose();
      el.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L, mode]);

  return (
    <>
      <div ref={host} style={{ position: 'absolute', inset: 0, background: mode === 'werkbank' ? '#20484f' : 'radial-gradient(1200px 700px at 50% 30%, var(--panel-solid), var(--canvas))' }} />
      <div className="floating" style={{ left: 14, bottom: 14, alignItems: 'center', padding: '3px 6px', gap: 6 }}>
        <div className="seg">
          {(
            [
              ['normal', 'Normal'],
              ['werkbank', 'Werkbank'],
              ['roentgen', 'Röntgen'],
              ['explosion', 'Lagen'],
            ] as [Mode, string][]
          ).map(([m, l]) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              {l}
            </button>
          ))}
        </div>
        <span className="info-text hide-narrow" title="Ziehen dreht · Rechtsklick verschiebt · Mausrad zoomt">Ziehen zum Drehen</span>
        <button className="btn" title="Foto in 4K speichern" onClick={() => api.current?.photo()}>
          Foto 4K
        </button>
        <button className="btn" title="360°-Video für Produktseiten" onClick={() => api.current?.video()}>
          360°-Video
        </button>
      </div>
    </>
  );
}

void formatValue;
