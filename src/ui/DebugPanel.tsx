/** Debugger: Haltepunkte, Einzelschritt, Register, Variablen, Peripherie, Speicher */
import { useState } from 'react';
import { debugContinue, engine, set, state, toggleBreakpoint, useStore } from '../state/store';
import { Icon } from './icons';

function hexdump(bytes: Uint8Array, base: number): string {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const row = Array.from(bytes.subarray(i, i + 16));
    const hex = row.map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const asc = row.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join('');
    lines.push(`${(base + i).toString(16).padStart(6, '0')}  ${hex.padEnd(47)}  ${asc}`);
  }
  return lines.join('\n');
}

export function DebugPanel() {
  const target = useStore((s) => s.codeTarget);
  const sim = useStore((s) => s.sim);
  useStore((s) => s.tick);
  const bps = useStore((s) => (s.codeTarget ? s.breakpoints[s.codeTarget] ?? [] : []));
  const [addr, setAddr] = useState(0x100);
  const [bpInput, setBpInput] = useState('');
  const slot = target ? engine.mcus.get(target) : undefined;
  const rt = slot?.runtime;
  const dv = rt?.debug?.() ?? null;
  if (!target)
    return (
      <div className="empty" style={{ paddingTop: 40 }}>
        Kein Mikrocontroller ausgewählt.
      </div>
    );
  const kindName = rt?.kind === 'avr' ? 'AVR-Emulator (avr8js)' : rt?.kind === 'rp2040' ? 'RP2040-Emulator (rp2040js)' : 'Schnellmodus (Übersetzer)';
  return (
    <div className="dbg">
      <div className="card">
        <h4 style={{ margin: '0 0 8px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <Icon.chip size={14} /> {target} · {kindName}
        </h4>
        <div className="btn-row" style={{ marginBottom: 8 }}>
          <button className="btn primary" disabled={sim === 'stopped'} onClick={() => debugContinue(false)}>
            <Icon.play size={12} /> Weiter
          </button>
          <button className="btn" disabled={sim === 'stopped'} onClick={() => debugContinue(true)}>
            Einzelschritt
          </button>
          <button className="btn" onClick={() => set({ bottomTab: 'code' })}>
            <Icon.code size={13} /> Code
          </button>
        </div>
        <div className="info-text">
          {sim === 'stopped'
            ? 'Starte die Simulation. Haltepunkte setzt du mit einem Klick auf die Zeilennummer im Code.'
            : rt?.paused
              ? `Angehalten${dv?.line ? ` in Zeile ${dv.line}` : dv ? ` bei 0x${dv.pc.toString(16)}` : ''}.`
              : 'Läuft.'}
        </div>
        <h3 style={{ marginTop: 12 }}>Haltepunkte</h3>
        <div className="info-text">{bps.length ? bps.sort((a, b) => a - b).map((b) => (rt?.kind === 'schnell' || !rt ? `Zeile ${b}` : `0x${b.toString(16)}`)).join(', ') : 'keine'}</div>
        {rt && rt.kind !== 'schnell' && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input className="field" placeholder="Adresse, z. B. 0x1a4" value={bpInput} onChange={(e) => setBpInput(e.target.value)} />
            <button
              className="btn"
              onClick={() => {
                const n = parseInt(bpInput, 16);
                if (Number.isFinite(n)) toggleBreakpoint(target, rt.kind === 'avr' ? n / 2 : n);
                setBpInput('');
              }}
            >
              Setzen
            </button>
          </div>
        )}
      </div>
      {dv && (
        <div className="card">
          <h3>Register</h3>
          <div className="regs">
            {dv.registers.map((r) => (
              <div key={r.name} style={{ display: 'contents' }}>
                <span>{r.name}</span>
                <span>{r.bits ? `0x${(r.value >>> 0).toString(16).padStart(r.bits / 4, '0')}` : r.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {dv?.variables && (
        <div className="card">
          <h3>Globale Variablen</h3>
          <dl className="kv">
            {Object.entries(dv.variables()).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt style={{ fontFamily: 'var(--mono)' }}>{k}</dt>
                <dd style={{ fontFamily: 'var(--mono)' }}>{Array.isArray(v) ? `[${v.slice(0, 8).join(', ')}${v.length > 8 ? ', …' : ''}]` : typeof v === 'string' ? JSON.stringify(v) : String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {dv && (
        <div className="card">
          <h3>Peripherie</h3>
          <dl className="kv">
            {Object.entries(dv.peripherals()).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd style={{ fontFamily: 'var(--mono)', fontSize: 11, wordBreak: 'break-all' }}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {dv && dv.memorySize > 0 && (
        <div className="card" style={{ gridColumn: 'span 2' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Speicher · {dv.memoryName}
            <input className="field" style={{ width: 110, height: 24 }} value={'0x' + addr.toString(16)} onChange={(e) => setAddr(Math.max(0, parseInt(e.target.value, 16) || 0))} />
          </h3>
          <div className="hexdump">{hexdump(dv.memory(addr, 256), addr)}</div>
        </div>
      )}
    </div>
  );
}

void state;
