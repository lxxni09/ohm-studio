/**
 * Virtueller HDMI-Monitor für Raspberry-Pi-Boards: Boot-Log, Desktop und Terminal mit GPIO-Befehlen.
 * (Ein echter Linux-Boot braucht QEMU als separaten Prozess – siehe ENTSCHEIDUNGEN.md.)
 */
import { useEffect, useRef, useState } from 'react';
import { engine, set, state, useStore } from '../state/store';
import { getPart } from '../parts/registry';

const BOOT = [
  '[    0.000000] Booting Linux on physical CPU 0x0000000000 [0x410fd083]',
  '[    0.000000] Linux version 6.6.31+rpt-rpi-v8 (gcc 12.2.0) #1 SMP PREEMPT Debian 1:6.6.31-1+rpt1',
  '[    0.000000] Machine model: Raspberry Pi',
  '[    0.000000] Memory: 1878520K/1997824K available',
  '[    0.012345] Console: colour dummy device 80x25',
  '[    0.523100] gpiomem-bcm2835 fe200000.gpiomem: Initialised: Registers at 0xfe200000',
  '[    1.104221] mmc0: new high speed SDHC card at address aaaa',
  '[    1.300112] EXT4-fs (mmcblk0p2): mounted filesystem with ordered data mode',
  '[  OK  ] Started systemd-udevd.service - Rule-based Manager for Device Events.',
  '[  OK  ] Reached target network.target - Network.',
  '[  OK  ] Started ssh.service - OpenBSD Secure Shell server.',
  '[  OK  ] Started lightdm.service - Light Display Manager.',
  '',
  'Raspberry Pi OS (64-bit) – Bookworm',
];

export function PiMonitor({ id }: { id: string }) {
  const inst = state.project.parts.find((p) => p.id === id);
  const def = inst && getPart(inst.type);
  const sim = useStore((s) => s.sim);
  useStore((s) => s.tick);
  const [phase, setPhase] = useState<'off' | 'boot' | 'desk'>('off');
  const [lines, setLines] = useState(0);
  const [log, setLog] = useState<string[]>(['pi@raspberrypi:~ $ pinout --help   # Tippe „help“']);
  const [cmd, setCmd] = useState('');
  const [pos, setPos] = useState({ x: window.innerWidth - 680, y: 76 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const powered = sim !== 'stopped' && !!engine.states.get(id)?.powered;

  useEffect(() => {
    if (!powered) {
      setPhase('off');
      setLines(0);
      return;
    }
    if (phase === 'off') setPhase('boot');
  }, [powered, phase]);
  useEffect(() => {
    if (phase !== 'boot') return;
    if (lines >= BOOT.length) {
      const t = setTimeout(() => setPhase('desk'), 700);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setLines((l) => l + 1), 140);
    return () => clearTimeout(t);
  }, [phase, lines]);

  if (!inst || !def) return null;
  const slot = engine.mcus.get(id);

  const run = (c: string) => {
    const out: string[] = [`pi@raspberrypi:~ $ ${c}`];
    const parts = c.trim().split(/\s+/);
    const gpio = (n: number) => slot?.pinNode.has(n);
    if (parts[0] === 'help') out.push('Befehle: pinctrl set <n> op dh|dl · pinctrl get <n> · gpio readall · uname -a · hostname -I · clear · vcgencmd measure_temp');
    else if (parts[0] === 'clear') {
      setLog([]);
      return;
    } else if (parts[0] === 'uname') out.push('Linux raspberrypi 6.6.31+rpt-rpi-v8 #1 SMP PREEMPT aarch64 GNU/Linux');
    else if (parts[0] === 'hostname') out.push('192.168.4.42');
    else if (parts[0] === 'vcgencmd') out.push("temp=48.3'C");
    else if (parts[0] === 'pinctrl' && parts[1] === 'set') {
      const n = Number(parts[2]);
      if (!gpio(n)) out.push(`Unbekannter GPIO ${parts[2]}`);
      else {
        const lvl = parts.includes('dh') ? 1 : parts.includes('dl') ? 0 : null;
        if (parts.includes('op')) slot!.pinMode(n, 'OUTPUT');
        if (parts.includes('ip')) slot!.pinMode(n, parts.includes('pu') ? 'INPUT_PULLUP' : 'INPUT');
        if (lvl !== null) {
          slot!.pinMode(n, 'OUTPUT');
          slot!.digitalWrite(n, lvl);
        }
      }
    } else if (parts[0] === 'pinctrl' && parts[1] === 'get') {
      const n = Number(parts[2]);
      if (!gpio(n)) out.push(`Unbekannter GPIO ${parts[2]}`);
      else {
        const v = slot!.readVoltage(n);
        out.push(` ${n}: ${slot!.modes.get(n) === 'OUTPUT' ? 'op' : 'ip'} | ${v > 1.65 ? 'hi' : 'lo'} (${v.toFixed(2)} V)`);
      }
    } else if (parts[0] === 'gpio' && parts[1] === 'readall') {
      for (const [n] of [...(slot?.pinNode ?? new Map())].sort((a, b) => a[0] - b[0])) out.push(` GPIO${String(n).padEnd(3)} ${slot!.modes.get(n) ?? 'INPUT'}  ${slot!.readVoltage(n) > 1.65 ? 1 : 0}`);
    } else if (c.trim()) out.push(`bash: ${parts[0]}: Befehl nicht gefunden`);
    setLog((l) => [...l, ...out].slice(-200));
  };

  return (
    <div className="pi-window" style={{ left: pos.x, top: pos.y, right: 'auto' }}>
      <div
        className="pi-titlebar"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
          (e.target as Element).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => drag.current && setPos({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y })}
        onPointerUp={() => (drag.current = null)}
      >
        <div className="traffic">
          <i onClick={() => set({ piMonitor: null })} style={{ cursor: 'pointer' }} />
          <i />
          <i />
        </div>
        HDMI · {id} · {def.name}
      </div>
      <div className="pi-screen">
        {phase === 'off' && <div className="pi-boot" style={{ display: 'grid', placeItems: 'center', color: '#666', fontFamily: 'var(--font)' }}>{sim === 'stopped' ? 'Kein Signal – starte die Simulation (▶)' : 'Kein Signal – der Pi bekommt keinen Strom'}</div>}
        {phase === 'boot' && <div className="pi-boot">{BOOT.slice(0, lines).map((l, i) => <div key={i} style={{ color: l.includes('OK') ? '#5f5' : undefined }}>{l}</div>)}</div>}
        {phase === 'desk' && (
          <div className="pi-desktop">
            <div className="pi-taskbar">
              <span style={{ color: '#c51a4a', fontWeight: 700 }}>●</span> Menü <span style={{ marginLeft: 'auto' }}>{new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div className="pi-icons">
              <span>🗑<br />Papierkorb</span>
              <span>📁<br />pi</span>
            </div>
            <div className="pi-term">
              <div className="pi-term-head">LXTerminal</div>
              <div className="pi-term-body" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}>
                {log.join('\n')}
                {'\n'}
                <span style={{ color: '#7f7' }}>pi@raspberrypi</span>:<span style={{ color: '#79f' }}>~</span> ${' '}
                <input
                  autoFocus
                  value={cmd}
                  onChange={(e) => setCmd(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      run(cmd);
                      setCmd('');
                    }
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
