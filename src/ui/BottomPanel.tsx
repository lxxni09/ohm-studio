import { t as tr } from '../i18n';
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { getPart } from '../parts/registry';
import { engine, serialVersion, set, setCode, state, toast, toggleBreakpoint, useStore } from '../state/store';
import { DebugPanel } from './DebugPanel';
import { bytesToB64 } from '../mcu/core';
import { compileNative, nativeAvailable } from '../native';
import { CodeEditor } from './CodeEditor';
import { Icon } from './icons';
import { formatValue } from '../lib/units';
import { runTests, type TestResult } from '../sim/testrunner';
import type { BottomTab } from '../state/store';

const LANGS: { value: string; label: string }[] = [
  { value: 'arduino', label: 'Arduino C++ · Schnellmodus' },
  { value: 'esp32-echt', label: 'Arduino C++ · echter ESP32 (Emulator)' },
  { value: 'micropython', label: 'MicroPython · echt (Pico)' },
  { value: 'hex', label: 'Firmware .hex · echt (AVR)' },
  { value: 'uf2', label: 'Firmware .uf2 · echt (Pico)' },
];

const MP_EXAMPLE = `# MicroPython auf dem Raspberry Pi Pico (echte Firmware im Emulator)
from machine import Pin
import time

led = Pin(25, Pin.OUT)
print("Hallo aus MicroPython!")
while True:
    led.toggle()
    time.sleep(0.5)
`;

function CodeTab() {
  const target = useStore((s) => s.codeTarget);
  const project = useStore((s) => s.project);
  const errs = useStore((s) => s.compileErrors);
  const bps = useStore((s) => (s.codeTarget ? s.breakpoints[s.codeTarget] ?? [] : []));
  useStore((s) => s.dirty);
  useStore((s) => s.tick);
  const [, force] = useState(0);
  const boards = project.parts.filter((p) => getPart(p.type)?.board && !getPart(p.type)?.board?.linux);
  const code = project.code.find((c) => c.ziel === target);
  if (!boards.length)
    return (
      <div className="empty" style={{ paddingTop: 40 }}>
        <Icon.chip size={28} />
        <p>
          Noch kein Mikrocontroller im Projekt.
          <br />
          Zieh z. B. einen <b>Arduino Uno</b> oder <b>ESP32-C3 SuperMini</b> aus der Bibliothek auf die Arbeitsfläche.
        </p>
      </div>
    );
  const lang = (code?.sprache ?? 'arduino').toLowerCase();
  const firmware = lang === 'hex' || lang === 'uf2';
  const rt = target ? engine.mcus.get(target)?.runtime : undefined;
  const err = target ? errs[target] ?? (rt?.error ? { line: rt.errorLine, text: rt.error } : null) : null;
  const curLine = rt?.kind === 'schnell' && rt.paused ? rt.debug?.()?.line ?? null : null;
  const loadFirmware = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.hex,.ihex,.uf2,.bin,.elf';
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f || !target) return;
      if (/\.uf2$/i.test(f.name)) setCode(target, bytesToB64(new Uint8Array(await f.arrayBuffer())), 'uf2');
      else if (/\.(hex|ihex)$/i.test(f.name)) setCode(target, await f.text(), 'hex');
      else {
        toast('.bin/.elf bitte als .hex (AVR) oder .uf2 (Pico) exportieren – z. B. mit „avr-objcopy -O ihex“ bzw. „picotool uf2 convert“.', 'warn');
        return;
      }
      toast(`Firmware „${f.name}“ geladen – läuft im Präzisionsmodus`, 'info');
      force((x) => x + 1);
    };
    inp.click();
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, padding: '6px 14px 4px', flex: 'none' }}>
        <select
          className="speed"
          value={LANGS.some((l) => l.value === lang) ? lang : 'arduino'}
          onChange={(e) => {
            if (!target) return;
            const v = e.target.value;
            if (v === 'hex' || v === 'uf2') return loadFirmware();
            if (v === 'micropython' && !/^\s*(from|import|#)/m.test(code?.datei ?? '')) setCode(target, MP_EXAMPLE, v);
            else setCode(target, code?.datei ?? '', v);
            force((x) => x + 1);
          }}
        >
          {LANGS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
        <button className="btn" onClick={loadFirmware} title="Kompilierte Firmware (.hex für AVR, .uf2 für Pico) laden">
          Firmware laden …
        </button>
        {nativeAvailable() && !firmware && lang !== 'micropython' && (
          <button className="btn" title="Mit arduino-cli zu echtem Maschinencode kompilieren und im Emulator ausführen" onClick={() => target && void compileNative(target)}>
            Echt kompilieren
          </button>
        )}
      </div>
      {firmware ? (
        <div className="empty" style={{ paddingTop: 50 }}>
          <Icon.chip size={28} />
          <p>
            <b>Firmware geladen</b> ({lang === 'hex' ? 'Intel-HEX' : 'UF2'}, {Math.round((code?.datei.length ?? 0) / (lang === 'uf2' ? 1.37 : 2.8) / 1024)} KB).
            <br />
            Sie läuft im Präzisionsmodus mit echter Befehlsausführung. Haltepunkte und Register siehst du unter „Debugger“.
          </p>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <CodeEditor
          value={code?.datei ?? ''}
          lang={lang}
          onChange={(v) => {
            if (!target) return;
            setCode(target, v);
            force((x) => x + 1);
          }}
          errorLine={err?.line ?? null}
          breakpoints={lang === 'arduino' ? bps : undefined}
          onToggleBreakpoint={lang === 'arduino' && target ? (l) => toggleBreakpoint(target, l) : undefined}
          currentLine={curLine}
        />
        </div>
      )}
      {err && (
        <div className="err-banner">
          <Icon.error size={16} style={{ color: 'var(--red)', flex: 'none' }} />
          <span>{err.text}</span>
        </div>
      )}
    </div>
  );
}

function SerialTab() {
  const target = useStore((s) => s.codeTarget);
  useStore((s) => s.tick);
  const sim = useStore((s) => s.sim);
  const ref = useRef<HTMLPreElement>(null);
  const [input, setInput] = useState('');
  const [auto, setAuto] = useState(true);
  const [ending, setEnding] = useState('\n');
  const text = target ? state.serial[target] ?? '' : '';
  const v = serialVersion;
  useEffect(() => {
    if (auto && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [v, auto, text.length]);
  const send = () => {
    if (!target) return;
    engine.mcus.get(target)?.runtime.serialFeed(input + ending);
    state.serial[target] = (state.serial[target] ?? '') + `› ${input}\n`;
    setInput('');
  };
  return (
    <div className="serial">
      <pre ref={ref}>{text || (sim === 'stopped' ? 'Starte die Simulation (▶), um die Ausgabe von Serial.print() zu sehen.' : '')}</pre>
      <div className="serial-input">
        <input className="field" placeholder="Nachricht an den Mikrocontroller senden …" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} disabled={sim === 'stopped'} />
        <select className="field" style={{ width: 130 }} value={ending} onChange={(e) => setEnding(e.target.value)}>
          <option value="">Kein Zeilenende</option>
          <option value={'\n'}>Neue Zeile</option>
          <option value={'\r\n'}>NL + CR</option>
        </select>
        <button className="btn" onClick={send} disabled={sim === 'stopped'}>
          <Icon.send size={13} /> Senden
        </button>
        <button className={`icon-btn ${auto ? 'on' : ''}`} title="Automatisch scrollen" onClick={() => setAuto(!auto)}>
          <Icon.chevronDown size={14} />
        </button>
        <button className="icon-btn" title="Leeren" onClick={() => target && (state.serial[target] = '')}>
          <Icon.trash size={14} />
        </button>
      </div>
    </div>
  );
}

function Spark({ data, color = 'var(--accent)', h = 40 }: { data: number[]; color?: string; h?: number }) {
  if (data.length < 2) return <div style={{ height: h }} />;
  const max = Math.max(...data.map(Math.abs), 1e-9);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${h - (Math.abs(v) / max) * (h - 4) - 2}`).join(' ');
  return (
    <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: h, display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const history = new Map<string, number[]>();

function MetersTab() {
  useStore((s) => s.tick);
  const project = useStore((s) => s.project);
  const sim = useStore((s) => s.sim);
  if (sim === 'stopped')
    return (
      <div className="empty" style={{ paddingTop: 40 }}>
        <Icon.gauge size={28} />
        <p>Messwerte erscheinen, sobald die Simulation läuft.<br />Tipp: Fahre mit der Maus über einen Pin, um seine Spannung zu sehen.</p>
      </div>
    );
  const cards: JSX.Element[] = [];
  // Stromversorgung & Akkulaufzeit
  for (const p of project.parts) {
    const st = engine.states.get(p.id);
    if (!st) continue;
    if (st.capacityAh !== undefined) {
      const h = history.get(p.id) ?? [];
      h.push(Math.abs(st.i ?? 0));
      while (h.length > 160) h.shift();
      history.set(p.id, h);
      const avg = h.reduce((a, b) => a + b, 0) / Math.max(h.length, 1);
      const life = (st.capacityAh * st.soc) / Math.max(avg, 1e-9);
      cards.push(
        <div className="card meter-card" key={p.id}>
          <h4>
            <Icon.bolt size={14} /> {p.id} · {getPart(p.type)?.name}
          </h4>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span className="big-number">{formatValue(Math.abs(st.i ?? 0), 'A')}</span>
            <span className="info-text">{(st.v ?? 0).toFixed(2)} V · {(st.soc * 100).toFixed(1)} %</span>
          </div>
          <Spark data={h} color="var(--green)" />
          <div className="info-text" style={{ marginTop: 6 }}>
            Geschätzte Laufzeit:{' '}
            <b style={{ color: 'var(--text)' }}>{life > 24 * 365 ? `${(life / 24 / 365).toFixed(1)} Jahre` : life > 48 ? `${(life / 24).toFixed(1)} Tage` : `${life.toFixed(1)} Stunden`}</b>
          </div>
        </div>,
      );
    }
    const def = getPart(p.type);
    if (!def) continue;
    if (p.type === 'multimeter')
      cards.push(
        <div className="card meter-card" key={p.id}>
          <h4>
            <Icon.gauge size={14} /> {p.id} · Multimeter
          </h4>
          <span className="big-number">
            {st.reading ?? '—'} <small style={{ fontSize: 14, color: 'var(--muted)' }}>{st.unit}</small>
          </span>
        </div>,
      );
    if (p.type === 'strommesser')
      cards.push(
        <div className="card meter-card" key={p.id}>
          <h4>
            <Icon.bolt size={14} /> {p.id} · Strom über Zeit
          </h4>
          <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
            <span className="big-number">{formatValue(Math.abs(st.i ?? 0), 'A')}</span>
            <span className="info-text">⌀ {formatValue(st.avg ?? 0, 'A')} · Spitze {formatValue(st.peak ?? 0, 'A')}</span>
          </div>
          <Spark data={st.hist ?? []} color="var(--green)" h={56} />
          <div className="info-text" style={{ marginTop: 6 }}>{st.life}</div>
        </div>,
      );
    if (p.type === 'oszilloskop' || p.type === 'logikanalysator') {
      const samples: number[][] = st.samples ?? [];
      const chans = p.type === 'oszilloskop' ? 4 : 8;
      const colors = ['#ffd60a', '#32d7ff', '#ff6bd6', '#30d158', '#ff9f0a', '#bf5af2', '#64d2ff', '#ff453a'];
      cards.push(
        <div className="card meter-card" key={p.id} style={{ gridColumn: 'span 2' }}>
          <h4>
            <Icon.gauge size={14} /> {p.id} · {def.name}
          </h4>
          <div style={{ background: '#0a0f0a', borderRadius: 8, padding: 6 }}>
            {Array.from({ length: chans }, (_, c) => (
              <Spark key={c} data={samples.map((s) => s[c] ?? 0)} color={colors[c]} h={p.type === 'oszilloskop' ? 50 : 22} />
            ))}
          </div>
        </div>,
      );
    }
  }
  // Mikrocontroller
  for (const [id, slot] of engine.mcus) {
    const st = engine.states.get(id) ?? {};
    cards.push(
      <div className="card meter-card" key={'mcu' + id}>
        <h4>
          <Icon.chip size={14} /> {id} · {slot.board.name}
        </h4>
        <dl className="kv">
          <dt>Versorgung</dt>
          <dd>{slot.powered ? `${slot.vcc.toFixed(2)} V` : 'aus'}</dd>
          <dt>Zustand</dt>
          <dd>{slot.runtime.error ? 'Fehler' : slot.runtime.sleep === 'deep' ? 'Deep-Sleep 💤' : slot.powered ? 'läuft' : '—'}</dd>
          <dt>Stromaufnahme</dt>
          <dd>{formatValue(Math.abs(st.i ?? 0), 'A')}</dd>
          <dt>Laufzeit</dt>
          <dd>{(slot.runtime.timeUs / 1e6).toFixed(1)} s</dd>
          <dt>WLAN / BLE</dt>
          <dd>{slot.runtime.wifi.status === 3 ? 'verbunden' : slot.board.wifi ? '—' : 'nicht vorhanden'} / {slot.board.ble ? (slot.bleName ? 'sendet' : 'bereit') : '—'}</dd>
        </dl>
      </div>,
    );
  }
  // Netzspannungen
  const nets = project.nets.slice(0, 24);
  cards.push(
    <div className="card meter-card" key="nets">
      <h4>Netzspannungen</h4>
      <dl className="kv">
        {nets.map((n) => {
          const [pid, pn] = n.pins[0].split('.');
          const inst = project.parts.find((p) => p.id === pid);
          const def = inst && getPart(inst.type);
          const pin = def?.pins(inst!.props).find((x) => x.id === pn || (x.aliases ?? []).includes(pn) || x.label === pn);
          const v = engine.pinVoltage(pid, pin?.id ?? pn);
          return (
            <div key={n.name} style={{ display: 'contents' }}>
              <dt>{n.name}</dt>
              <dd>{v === null ? '—' : `${v.toFixed(3)} V`}</dd>
            </div>
          );
        })}
      </dl>
    </div>,
  );
  return <div className="meters">{cards}</div>;
}

function MessagesTab() {
  const issues = useStore((s) => s.issues);
  const msgs = useStore((s) => s.messages);
  const all = [...msgs.map((m) => ({ ...m, src: 'sim' as const })).reverse(), ...issues.map((i) => ({ level: i.level, text: i.text, time: -1, part: i.part, src: 'check' as const }))];
  if (!all.length)
    return (
      <div className="empty" style={{ paddingTop: 40 }}>
        <Icon.check size={28} style={{ color: 'var(--green)' }} />
        <p>Keine Meldungen – alles sieht gut aus.</p>
      </div>
    );
  return (
    <div className="messages">
      {all.map((m, i) => (
        <div key={i} className={`msg ${m.level}`} onClick={() => m.part && set({ selection: [m.part], selectedNet: null })} style={{ cursor: m.part ? 'pointer' : 'default' }}>
          <span className="ic">{m.level === 'error' ? <Icon.error size={16} /> : m.level === 'warn' ? <Icon.warn size={16} /> : <Icon.info size={16} />}</span>
          <span>{m.text}</span>
          <small>{m.time >= 0 ? `${m.time.toFixed(2)} s` : 'Prüfung'}</small>
        </div>
      ))}
    </div>
  );
}

function TestsTab() {
  const project = useStore((s) => s.project);
  const [results, setResults] = useState<TestResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  if (!project.tests.length)
    return (
      <div className="empty" style={{ paddingTop: 40 }}>
        <Icon.checklist size={28} />
        <p>Dieses Projekt hat keine Testschritte.<br />In der .ohm-Datei kannst du unter „test:“ beschreiben, was passieren soll.</p>
      </div>
    );
  return (
    <div className="messages">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setTimeout(() => {
              try {
                setResults(runTests(project));
              } finally {
                setBusy(false);
              }
            }, 30);
          }}
        >
          <Icon.play size={12} /> {busy ? 'Teste …' : 'Alle Tests automatisch ausführen'}
        </button>
        {results && (
          <span className="info-text">
            {results.filter((r) => r.ok).length} von {results.length} bestanden
          </span>
        )}
      </div>
      {project.tests.map((t, i) => {
        const r = results?.[i];
        return (
          <div key={i} className="test-row">
            <button className={`check ${checked[i] || r?.ok ? 'on' : ''}`} onClick={() => setChecked({ ...checked, [i]: !checked[i] })}>
              {(checked[i] || r?.ok) && <Icon.check size={12} />}
            </button>
            <div style={{ flex: 1 }}>
              <div>
                <b>{i + 1}.</b> {t.schritt}
              </div>
              <div className="info-text">Erwartet: {t.erwartet}</div>
              {r && (
                <div style={{ marginTop: 4 }}>
                  <span className={`badge ${r.ok === true ? 'ok' : r.ok === false ? 'err' : 'warn'}`}>{r.ok === true ? 'bestanden' : r.ok === false ? 'fehlgeschlagen' : 'manuell prüfen'}</span> <span className="info-text">{r.detail}</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const TABS: { id: BottomTab; label: string; icon: (p: { size?: number }) => JSX.Element }[] = [
  { id: 'code', label: 'Code', icon: Icon.code },
  { id: 'serial', label: 'Serieller Monitor', icon: Icon.terminal },
  { id: 'meters', label: 'Messgeräte', icon: Icon.gauge },
  { id: 'messages', label: 'Meldungen', icon: Icon.bell },
  { id: 'tests', label: 'Tests', icon: Icon.checklist },
  { id: 'debug', label: 'Debugger', icon: Icon.bolt },
];

export function BottomPanel() {
  const open = useStore((s) => s.bottomOpen);
  const tab = useStore((s) => s.bottomTab);
  const target = useStore((s) => s.codeTarget);
  const project = useStore((s) => s.project);
  const issues = useStore((s) => s.issues);
  const msgs = useStore((s) => s.messages);
  const [h, setH] = useState(() => Number(localStorage.getItem('ohm.bottomH')) || 300);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const boards = project.parts.filter((p) => getPart(p.type)?.board && !getPart(p.type)?.board?.linux);
  const nErr = issues.filter((i) => i.level === 'error').length + msgs.filter((m) => m.level === 'error').length;
  return (
    <div className="bottom" style={{ height: open ? h : 38 }}>
      {open && (
        <div
          className="resize-h"
          onPointerDown={(e) => {
            drag.current = { y: e.clientY, h };
            (e.target as Element).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const nh = Math.min(window.innerHeight - 200, Math.max(140, drag.current.h - (e.clientY - drag.current.y)));
            setH(nh);
          }}
          onPointerUp={() => {
            drag.current = null;
            localStorage.setItem('ohm.bottomH', String(h));
          }}
        />
      )}
      <div className="bottom-tabs">
        <div className="seg">
          {TABS.map((t) => (
            <button key={t.id} className={open && tab === t.id ? 'on' : ''} onClick={() => set({ bottomTab: t.id, bottomOpen: open && tab === t.id ? false : true })}>
              <t.icon size={14} />
              <span className="hide-narrow">{tr(t.label)}</span>
              {t.id === 'messages' && nErr > 0 && <span className="tab-count">{nErr}</span>}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {(tab === 'code' || tab === 'serial') && boards.length > 0 && (
          <select className="speed" value={target ?? ''} onChange={(e) => set({ codeTarget: e.target.value })}>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.id} · {getPart(b.type)?.name}
              </option>
            ))}
          </select>
        )}
        <button className="icon-btn" title={open ? 'Einklappen' : 'Ausklappen'} onClick={() => set({ bottomOpen: !open })}>
          <Icon.chevronDown size={14} style={{ transform: open ? '' : 'rotate(180deg)', transition: 'transform .2s' }} />
        </button>
      </div>
      {open && (
        <div className="bottom-body">
          {tab === 'code' && <CodeTab />}
          {tab === 'serial' && <SerialTab />}
          {tab === 'meters' && <MetersTab />}
          {tab === 'messages' && <MessagesTab />}
          {tab === 'tests' && <TestsTab />}
          {tab === 'debug' && <DebugPanel />}
        </div>
      )}
    </div>
  );
}
