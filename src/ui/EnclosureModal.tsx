import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { checkCollisions, DEFAULT_ENCLOSURE, designEnclosure, enclosureMeshes, enclosureStep, stlBinary, type EnclosureParams, type Tri } from '../mech/enclosure';
import { download, exportName } from './files';
import { zip } from '../export/exporters';

export function EnclosureBody() {
  const project = useStore((s) => s.project);
  const [p, setP] = useState<EnclosureParams>(() => {
    try {
      return { ...DEFAULT_ENCLOSURE, ...JSON.parse(localStorage.getItem('ohm.gehaeuse') ?? '{}') };
    } catch {
      return DEFAULT_ENCLOSURE;
    }
  });
  const [explode, setExplode] = useState(true);
  const e = useMemo(() => designEnclosure(project, p), [project, p]);
  const meshes = useMemo(() => enclosureMeshes(e), [e]);
  const coll = useMemo(() => checkCollisions(e), [e]);
  const upd = (k: keyof EnclosureParams, v: number | boolean) => {
    const n = { ...p, [k]: v };
    setP(n);
    try {
      localStorage.setItem('ohm.gehaeuse', JSON.stringify(n));
    } catch {
      /* egal */
    }
  };
  const num = (k: keyof EnclosureParams, label: string, step = 0.5) => (
    <>
      <label>{label}</label>
      <input className="field" type="number" step={step} value={p[k] as number} onChange={(ev) => upd(k, Number(ev.target.value))} />
    </>
  );
  return (
    <div className="team-grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.6fr)' }}>
      <div>
        <div className="row-form">
          {num('wand', 'Wandstärke (mm)')}
          {num('boden', 'Boden (mm)')}
          {num('deckel', 'Deckel (mm)')}
          {num('spiel', 'Spiel zur Platine')}
          {num('domHoehe', 'Domhöhe')}
          {num('luftOben', 'Luft über Bauteilen')}
          {num('lochD', 'Schraubloch Ø')}
        </div>
        <label className="chk">
          <input type="checkbox" checked={p.ausschnitte} onChange={(ev) => upd('ausschnitte', ev.target.checked)} /> Ausschnitte automatisch (USB, LEDs, Taster, Drehknöpfe, Anzeigen)
        </label>
        <label className="chk">
          <input type="checkbox" checked={p.knoepfe} onChange={(ev) => upd('knoepfe', ev.target.checked)} /> Knopf-Verlängerungen für Taster
        </label>
        <div className="info-text">
          Außenmaß {e.ow.toFixed(1)} × {e.oh.toFixed(1)} × {(e.hz + p.deckel).toFixed(1)} mm · {e.holes.length} Ausschnitte · {e.bosses.length} Schraubdome (M3 selbstschneidend)
        </div>
        <div className="emc-list" style={{ margin: '10px 0' }}>
          {coll.map((c, i) => (
            <div key={i} className="emc-item" style={{ gridTemplateColumns: 'auto 1fr' }}>
              <span className={`lvl lvl-${c.level}`} />
              <span>{c.text}</span>
            </div>
          ))}
        </div>
        <div className="btn-row">
          <button
            className="btn primary"
            onClick={() =>
              download(
                exportName('-gehaeuse.zip'),
                zip([
                  { name: 'unterschale.stl', data: stlBinary(meshes.unterschale, 'Unterschale') },
                  { name: 'deckel.stl', data: stlBinary(meshes.deckel, 'Deckel') },
                  ...(meshes.knoepfe.length ? [{ name: 'knopf-verlaengerungen.stl', data: stlBinary(meshes.knoepfe, 'Knoepfe') }] : []),
                  { name: 'gehaeuse.step', data: enclosureStep(project, e) },
                  { name: 'LIESMICH.txt', data: `Gehäuse für ${project.name}\n\nDruck: PLA/PETG, 0,2 mm Schichthöhe, 3 Wände. Deckel mit der Oberseite nach unten drucken.\nPlatine mit 4 × M3-Schrauben (selbstschneidend, 6 mm) auf die Dome schrauben.\nKnopf-Verlängerungen stehend drucken.\n\nAußenmaß: ${e.ow.toFixed(1)} × ${e.oh.toFixed(1)} × ${(e.hz + p.deckel).toFixed(1)} mm\n` },
                ]),
              )
            }
          >
            STL + STEP herunterladen
          </button>
          <label className="chk">
            <input type="checkbox" checked={explode} onChange={(ev) => setExplode(ev.target.checked)} /> Deckel anheben
          </label>
        </div>
      </div>
      <EnclosureView tris={meshes} e={e} explode={explode} />
    </div>
  );
}

function EnclosureView({ tris, e, explode }: { tris: { unterschale: Tri[]; deckel: Tri[]; knoepfe: Tri[] }; e: ReturnType<typeof designEnclosure>; explode: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    void (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      if (disposed || !host.current) return;
      const el = host.current;
      const w = el.clientWidth;
      const h = el.clientHeight;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(2, devicePixelRatio));
      renderer.setSize(w, h);
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const cam = new THREE.PerspectiveCamera(35, w / h, 1, 5000);
      const size = Math.max(e.ow, e.oh, e.hz);
      cam.position.set(e.ow * 1.4, -e.oh * 1.3, size * 1.5);
      cam.up.set(0, 0, 1);
      const ctl = new OrbitControls(cam, renderer.domElement);
      ctl.target.set(e.ow / 2, e.oh / 2, e.hz / 2);
      ctl.update();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
      const dl = new THREE.DirectionalLight(0xffffff, 1.6);
      dl.position.set(e.ow, -e.oh, size * 2);
      scene.add(dl);
      const geo = (t: Tri[]) => {
        const g = new THREE.BufferGeometry();
        const arr = new Float32Array(t.length * 9);
        t.forEach((tri, i) => tri.forEach((v, k) => arr.set(v, i * 9 + k * 3)));
        g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        g.computeVertexNormals();
        return g;
      };
      const shell = new THREE.Mesh(geo(tris.unterschale), new THREE.MeshStandardMaterial({ color: 0xe8e8ed, roughness: 0.6, side: THREE.DoubleSide }));
      const lid = new THREE.Mesh(geo(tris.deckel), new THREE.MeshStandardMaterial({ color: 0x0a84ff, roughness: 0.5, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
      lid.position.z = explode ? e.hz * 0.6 + 10 : 0;
      const knobs = new THREE.Mesh(geo(tris.knoepfe), new THREE.MeshStandardMaterial({ color: 0xff9f0a, roughness: 0.4 }));
      scene.add(shell, lid, knobs);
      // Platine und Bauteile
      const pcb = new THREE.Mesh(new THREE.BoxGeometry(e.pcbW, e.pcbH, 1.6), new THREE.MeshStandardMaterial({ color: 0x1f6f43, roughness: 0.4 }));
      pcb.position.set(e.pcbX + e.pcbW / 2, e.pcbY + e.pcbH / 2, e.pcbZ + 0.8);
      scene.add(pcb);
      for (const part of e.parts) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(part.x1 - part.x0, part.y1 - part.y0, part.z1), new THREE.MeshStandardMaterial({ color: 0x333336, roughness: 0.5 }));
        b.position.set((part.x0 + part.x1) / 2, (part.y0 + part.y1) / 2, e.pcbZ + 1.6 + part.z1 / 2);
        scene.add(b);
      }
      let raf = 0;
      const loop = () => {
        raf = requestAnimationFrame(loop);
        renderer.render(scene, cam);
      };
      loop();
      cleanup = () => {
        cancelAnimationFrame(raf);
        ctl.dispose();
        renderer.dispose();
        el.removeChild(renderer.domElement);
      };
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, [tris, e, explode]);
  return <div ref={host} className="enclosure-view" />;
}
