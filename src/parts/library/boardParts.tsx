/**
 * Boards als Bauteile: Grafik, Versorgung (USB, Regler), GPIO-Kopplung zum Mikrocontroller.
 */
import type { ReactNode } from 'react';
import { Diode, diodeFromVf, Regulator, Resistor, Source, Switch } from '../../sim/mna';
import { BOARDS, type BoardDef } from '../boards';
import { Chip, Glow, HeaderPins, Label, Pcb, SmdLed, UsbPort, Resistor0603 } from '../svg';
import type { BuildCtx, PartDef, PinDef } from '../types';

function boardRender(b: BoardDef, state: Record<string, any>): ReactNode {
  const leds = (b.leds ?? []).map((l) => ({ ...l, x: Math.min(l.x, b.w - 8), y: Math.min(l.y, b.h - 8) }));
  const visiblePins = b.pins.filter((p) => p.x >= 0);
  const ledOn = (l: { gpio?: number; power?: boolean }) => (l.power ? (state.powered ? 0.9 : 0) : l.gpio !== undefined ? state[`led${l.gpio}`] ?? 0 : 0);
  if (b.layout === 'uno' || b.layout === 'mega') {
    const isR4 = b.id.includes('r4');
    const nucleo = b.id.includes('nucleo');
    const outline = b.layout === 'mega' ? `M0 6 a6 6 0 0 1 6 -6 H${b.w - 10} l10 10 V${b.h - 6} a6 6 0 0 1 -6 6 H6 a6 6 0 0 1 -6 -6z` : `M0 6 a6 6 0 0 1 6 -6 H254 l6 6 V40 l10 10 V176 l-10 10 V204 a6 6 0 0 1 -6 6 H6 a6 6 0 0 1 -6 -6z`;
    const headers = (y: number, xs: PinDef[]) => {
      if (!xs.length) return null;
      const minX = Math.min(...xs.map((p) => p.x)) - 5;
      const maxX = Math.max(...xs.map((p) => p.x)) + 5;
      return (
        <g>
          <rect x={minX} y={y - 6} width={maxX - minX} height={12} rx={1} fill="#1b1b1c" />
          {xs.map((p) => (
            <rect key={p.id} x={p.x - 2.6} y={p.y - 2.6} width={5.2} height={5.2} fill="#050505" stroke="#2c2c2e" strokeWidth={0.4} />
          ))}
        </g>
      );
    };
    const topPins = visiblePins.filter((p) => p.y < 30);
    const botPins = visiblePins.filter((p) => p.y > 180);
    const sidePins = visiblePins.filter((p) => p.y >= 30 && p.y <= 180);
    return (
      <g>
        <g filter="url(#f-shadow)">
          <path d={outline} fill={b.color} />
          <path d={outline} fill="url(#p-fr4)" />
        </g>
        <g opacity={0.25} stroke="#fff" fill="none" strokeWidth={0.5}>
          <path d="M70 60 h80 v40 h40" />
          <path d="M70 70 h70 v40 h60" />
          <path d="M120 150 v-30 h50" />
        </g>
        {[[14, 14], [b.w - 20, 16], [14, b.h - 30], [b.w - 20, b.h - 20]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={5} fill="var(--canvas)" stroke="#d9b45a" strokeWidth={1.5} />
        ))}
        {headers(12, topPins)}
        {headers(198, botPins)}
        {sidePins.length > 0 && (
          <g>
            <rect x={340} y={14} width={30} height={sidePins.length * 5 + 12} rx={1} fill="#1b1b1c" />
            {sidePins.map((p) => (
              <rect key={p.id} x={p.x - 2.6} y={p.y - 2.6} width={5.2} height={5.2} fill="#050505" />
            ))}
          </g>
        )}
        {/* USB und Hohlstecker */}
        {isR4 ? <UsbPort x={-4} y={64} kind="usbc" rot={90} /> : <rect x={-12} y={36} width={58} height={46} rx={2} fill="url(#g-metal)" stroke="#7d8389" strokeWidth={0.6} />}
        {!isR4 && !nucleo && <rect x={-4} y={42} width={36} height={34} fill="#cfd3d6" opacity={0.6} />}
        {!nucleo && (
          <g>
            <rect x={-8} y={150} width={56} height={36} rx={3} fill="#151515" />
            <circle cx={10} cy={168} r={8} fill="#000" />
            <circle cx={10} cy={168} r={2.5} fill="url(#g-metal)" />
          </g>
        )}
        {/* Mikrocontroller */}
        {b.family === 'avr' && b.layout === 'uno' && b.id === 'arduino-uno' ? (
          <g>
            <rect x={120} y={140} width={136} height={38} rx={2} fill="#1d1d1f" />
            {Array.from({ length: 14 }, (_, i) => (
              <g key={i}>
                <rect x={124 + i * 9.6} y={136} width={3} height={4} fill="#c9cdd1" />
                <rect x={124 + i * 9.6} y={178} width={3} height={4} fill="#c9cdd1" />
              </g>
            ))}
            <rect x={120} y={140} width={136} height={14} rx={2} fill="url(#g-gloss)" />
            <circle cx={127} cy={159} r={3} fill="#111" />
            <Label x={188} y={156} size={6} color="#cfcfcf" weight={500}>
              ATMEGA328P-PU
            </Label>
            <Label x={188} y={166} size={4} color="#9a9a9a" weight={400}>
              Microchip
            </Label>
          </g>
        ) : (
          <Chip x={150} y={110} w={44} h={44} label={b.chip.split(' ')[0]} legs={11} legSide="four" />
        )}
        <Chip x={60} y={44} w={18} h={18} label={isR4 ? 'ESP' : '16U2'} legs={6} legSide="four" />
        <rect x={98} y={92} width={22} height={9} rx={4.5} fill="url(#g-metal)" />
        <Label x={109} y={96.5} size={3} color="#555">
          16.000
        </Label>
        {b.buttons?.map((btn) => (
          <g key={btn.id}>
            <rect x={btn.x - 9} y={btn.y - 9} width={18} height={18} rx={2} fill="url(#g-metal)" />
            <circle cx={btn.x} cy={btn.y} r={5.5} fill={state[`pressed_${btn.id}`] ? '#8a1c14' : '#c62828'} />
          </g>
        ))}
        {leds.map((l, i) => (
          <SmdLed key={i} x={l.x} y={l.y} color={l.color} on={ledOn(l)} />
        ))}
        {/* Beschriftung */}
        <g opacity={0.95}>
          <Label x={210} y={74} size={b.layout === 'mega' ? 16 : 18} color="#fff" weight={800}>
            {b.layout === 'mega' ? 'MEGA' : nucleo ? 'NUCLEO' : isR4 ? 'UNO R4' : b.id.includes('leonardo') ? 'LEONARDO' : 'UNO'}
          </Label>
          <Label x={210} y={92} size={5} color="#e2f3f5" weight={500}>
            {nucleo ? 'STM32F401RE' : 'ARDUINO'}
          </Label>
        </g>
        {visiblePins.map((p) => (
          <Label key={'l' + p.id} x={p.x} y={p.y < 30 ? p.y + 11 : p.y > 180 ? p.y - 11 : p.y} size={3.2} color="#fff" weight={600} rotate={p.y < 30 || p.y > 180 ? -90 : 0}>
            {p.label?.replace(/^D(\d)/, '$1')}
          </Label>
        ))}
        <Label x={160} y={30} size={4} color="#fff" weight={600}>
          DIGITAL (PWM ~)
        </Label>
        <Label x={190} y={184} size={4} color="#fff" weight={600}>
          ANALOG IN
        </Label>
      </g>
    );
  }
  if (b.layout === 'pi' || b.layout === 'pizero') {
    const zero = b.layout === 'pizero';
    return (
      <g>
        <g filter="url(#f-shadow)">
          <rect x={0} y={0} width={b.w} height={b.h} rx={zero ? 12 : 12} fill={b.color} />
          <rect x={0} y={0} width={b.w} height={b.h} rx={12} fill="url(#p-fr4)" />
        </g>
        {[[14, 14], [b.w - (zero ? 14 : 100), 14], [14, b.h - 14], [b.w - (zero ? 14 : 100), b.h - 14]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={6} fill="var(--canvas)" stroke="#d9b45a" strokeWidth={2} />
        ))}
        <rect x={visiblePins[0].x - 6} y={0} width={20 * 10 + 2} height={22} rx={1} fill="#1d1d1f" />
        <HeaderPins pins={visiblePins} />
        <Chip x={zero ? 90 : 110} y={zero ? 40 : 70} w={zero ? 44 : 60} h={zero ? 44 : 60} label="BROADCOM" sub={b.chip} legs={0} />
        {!zero && <Chip x={190} y={80} w={40} h={30} label="RAM" legs={0} />}
        {!zero && (
          <g>
            {[0, 1].map((i) => (
              <rect key={i} x={b.w - 70} y={10 + i * 56} width={72} height={52} rx={2} fill="url(#g-metal)" stroke="#7d8389" />
            ))}
            <rect x={b.w - 74} y={124} width={76} height={62} rx={2} fill="url(#g-metal)" stroke="#7d8389" />
            <rect x={b.w - 66} y={140} width={56} height={30} fill="#2b2b2b" />
          </g>
        )}
        <rect x={zero ? 30 : 70} y={b.h - 18} width={zero ? 32 : 30} height={20} rx={2} fill="url(#g-metal)" />
        {!zero && <rect x={130} y={b.h - 18} width={30} height={20} rx={2} fill="url(#g-metal)" />}
        <UsbPort x={zero ? b.w - 70 : 30} y={b.h - 4} kind={zero ? 'micro' : 'usbc'} />
        <Label x={zero ? 200 : 120} y={zero ? 70 : 150} size={zero ? 9 : 11} color="#fff" weight={700}>
          Raspberry Pi {b.name.replace('Raspberry Pi ', '')}
        </Label>
        <SmdLed x={zero ? 240 : 20} y={zero ? 100 : 190} color="#2ee66b" on={state.powered ? 0.6 + 0.4 * Math.sin((state.blink ?? 0) * 3) ** 2 : 0} />
        <SmdLed x={zero ? 250 : 20} y={zero ? 100 : 200} color="#ff3b30" on={state.powered ? 0.9 : 0} />
        {visiblePins
          .filter((p) => /^GPIO/.test(p.id))
          .map((p) => (
            <Label key={'l' + p.id} x={p.x} y={p.y + (p.y > 10 ? 10 : -8)} size={2.8} color="#fff" opacity={0.7}>
              {p.gpio}
            </Label>
          ))}
      </g>
    );
  }
  // Dual-Reihen-Boards (Nano, ESP32, Pico, XIAO …)
  const isEsp = b.family === 'esp32' || b.family === 'esp8266';
  const shield = isEsp && b.w >= 100 && b.layout === 'dual' && !b.id.includes('nano');
  const cx = b.w / 2;
  const tiny = b.layout === 'tiny';
  return (
    <g>
      <g filter="url(#f-shadow)">
        <rect x={0} y={0} width={b.w} height={b.h} rx={tiny ? 3 : 5} fill={b.color} />
        <rect x={0} y={0} width={b.w} height={b.h} rx={5} fill="url(#p-fr4)" />
      </g>
      {/* Lötpads mit Stiftleisten */}
      <HeaderPins pins={visiblePins} />
      {shield ? (
        <g>
          <rect x={cx - 34} y={b.h - 110} width={68} height={86} rx={2} fill="url(#g-metal)" stroke="#6b7076" strokeWidth={0.6} />
          <Label x={cx} y={b.h - 80} size={5} color="#4a4f55" weight={700}>
            {b.family === 'esp8266' ? 'ESP-12F' : b.chip.includes('S3') ? 'ESP32-S3' : 'ESP32-WROOM'}
          </Label>
          <Label x={cx} y={b.h - 72} size={3.4} color="#5d636a">
            {b.chip}
          </Label>
          <rect x={cx - 34} y={b.h - 24} width={68} height={22} fill="#20202a" />
          <path d={`M${cx - 30} ${b.h - 6} v-14 h8 v12 h8 v-12 h8 v12 h8 v-12 h8 v12 h8 v-14`} stroke="#d9b45a" strokeWidth={1.4} fill="none" />
        </g>
      ) : (
        <Chip x={cx - Math.min(18, b.w * 0.28)} y={b.h * 0.42} w={Math.min(36, b.w * 0.56)} h={Math.min(36, b.w * 0.56)} label={b.chip.split(/[ +]/)[0].replace('ESP32-', '')} legs={tiny ? 0 : 8} legSide="four" />
      )}
      {b.id.includes('supermini') && (
        <g>
          <rect x={cx - 14} y={b.h - 26} width={28} height={8} rx={1} fill="#e0d8c8" />
          <Label x={cx} y={b.h - 22} size={3} color="#555">
            ANT
          </Label>
        </g>
      )}
      {tiny ? (
        <g>
          <rect x={-18} y={4} width={22} height={b.h - 8} rx={2} fill="#1d1d1f" />
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={-16} y={8 + i * ((b.h - 16) / 4)} width={14} height={4} fill="url(#g-gold)" />
          ))}
        </g>
      ) : (
        <UsbPort x={cx} y={b.layout === 'dual' && b.id.startsWith('esp32-s3') ? b.h - 6 : 6} kind={b.usb} />
      )}
      {(b.leds ?? []).map((l, i) => (
        <SmdLed key={i} x={Math.min(Math.max(l.x, 18), b.w - 18)} y={Math.min(Math.max(l.y, 18), b.h - 14)} color={l.color} on={ledOn(l)} />
      ))}
      {b.ledBuiltin !== undefined && !(b.leds ?? []).some((l) => l.gpio === b.ledBuiltin) && <SmdLed x={b.w - 18} y={22} color="#2ee66b" on={state[`led${b.ledBuiltin}`] ?? 0} />}
      {(b.buttons ?? []).map((btn) => {
        const x = Math.min(Math.max(btn.x, 16), b.w - 16);
        const y = Math.min(Math.max(btn.y, 12), b.h - 12);
        return (
          <g key={btn.id}>
            <rect x={x - 7} y={y - 5} width={14} height={10} rx={1.5} fill="url(#g-metal)" />
            <rect x={x - 4} y={y - 3} width={8} height={6} rx={1} fill={state[`pressed_${btn.id}`] ? '#111' : '#2b2d30'} />
            <Label x={x} y={y + 9} size={2.8} color="#ddd">
              {btn.label}
            </Label>
          </g>
        );
      })}
      <Resistor0603 x={cx - 10} y={b.h * 0.3} />
      <Resistor0603 x={cx + 10} y={b.h * 0.3} />
      {visiblePins.map((p) => (
        <Label key={'l' + p.id} x={p.x < cx ? p.x + 8 : p.x - 8} y={p.y} size={b.w < 80 ? 3 : 3.4} color="#fff" anchor={p.x < cx ? 'start' : 'end'} weight={600} opacity={0.85}>
          {p.label}
        </Label>
      ))}
      <Label x={cx} y={tiny ? b.h - 4 : b.h * 0.86} size={b.w < 80 ? 3.4 : 4.4} color="#fff" weight={700} rotate={b.w < 80 && b.h > 100 ? -90 : 0}>
        {b.name.replace('Raspberry Pi ', '').replace('Arduino ', '').replace('Seeed ', '')}
      </Label>
      {state.sleep === 'deep' && (
        <Label x={cx} y={b.h * 0.25} size={5} color="#9ecbff" weight={700}>
          zzz
        </Label>
      )}
    </g>
  );
}

/** Standard-I²C-Pins je Board */
export function i2cPins(b: BoardDef): { sda: number; scl: number } {
  if (b.constants?.SDA !== undefined && b.constants?.SCL !== undefined) return { sda: b.constants.SDA, scl: b.constants.SCL };
  if (b.family === 'esp32') {
    if (b.chip.includes('C3') && b.id.includes('xiao')) return { sda: 6, scl: 7 };
    if (b.chip.includes('C3')) return { sda: 8, scl: 9 };
    if (b.chip.includes('S3')) return { sda: 8, scl: 9 };
    if (b.chip.includes('C6') || b.chip.includes('C5') || b.chip.includes('H2')) return { sda: 6, scl: 7 };
    if (b.chip.includes('S2')) return { sda: 8, scl: 9 };
    return { sda: 21, scl: 22 };
  }
  if (b.family === 'rp2040') return { sda: 4, scl: 5 };
  if (b.family === 'rpi') return { sda: 2, scl: 3 };
  if (b.family === 'stm32') return { sda: 23, scl: 22 };
  if (b.family === 'nrf52') return { sda: 17, scl: 20 };
  return { sda: 18, scl: 19 };
}

function boardBuild(b: BoardDef) {
  return (ctx: BuildCtx) => {
    const pins = b.pins;
    const first = (pw: string) => pins.find((p) => p.power === pw)?.id;
    const gndId = first('gnd');
    const gnd = gndId ? ctx.node(gndId) : -1;
    const n5 = first('5v') ? ctx.node(first('5v')!) : ctx.internal('5v');
    const n3 = first('3v3') ? ctx.node(first('3v3')!) : b.vcc === 3.3 ? ctx.internal('3v3') : n5;
    const vinId = first('vin');
    // USB: an, aus oder automatisch (aus, wenn eine externe Quelle an einem Versorgungspin hängt)
    const ext = pins.some((p) => p.power && p.power !== 'gnd' && ctx.engine.hasExternalSource(ctx.id, p.id));
    const usbProp = ctx.props.usb;
    const usb = b.usb !== 'none' && (usbProp === true || usbProp === 'ja' || ((usbProp === undefined || usbProp === 'auto') && !ext));
    ctx.state.usb = usb;
    if (usb) ctx.add(new Source(n5, gnd, 5.0, 0.25));
    if (vinId) {
      const nvin = ctx.node(vinId);
      if (b.family === 'avr' || b.family === 'renesas') ctx.add(new Regulator(nvin, gnd, n5, 5, 1.0, 0.004));
      else if (b.family === 'rp2040') {
        ctx.add(new Diode(n5, nvin, diodeFromVf(0.3, 0.5, 1.3)));
      } else ctx.add(new Diode(nvin, n5, diodeFromVf(0.3, 0.5, 1.3)));
    }
    const vbat = first('vbat');
    if (vbat && b.family === 'nrf52') ctx.add(new Diode(ctx.node(vbat), n5, diodeFromVf(0.2, 0.5, 1.3)));
    if (b.vcc === 3.3 && n3 !== n5) {
      const src = b.family === 'rp2040' && vinId ? ctx.node(vinId) : n5;
      ctx.add(new Regulator(src, gnd, n3, 3.3, b.regulator?.dropout ?? 1.1, 0.0001));
    }
    const rail = b.vcc === 5 ? n5 : n3;
    const load = ctx.add(new Resistor(rail, gnd, b.vcc / b.current.active));
    // Power-LED (verbraucht realistisch ~1 mA)
    const hasPowerLed = (b.leds ?? []).some((l) => l.power);
    if (hasPowerLed) {
      const nl = ctx.internal('pled');
      ctx.add(new Resistor(rail, nl, 1500));
      ctx.add(new Diode(nl, gnd, diodeFromVf(2.0, 0.002, 2)));
    }
    // GPIO-Treiber
    const gpioSrc = new Map<number, Source>();
    const pinNode = new Map<number, number>();
    for (const p of pins) {
      if (p.gpio === undefined || p.power) continue;
      if (gpioSrc.has(p.gpio)) continue;
      const nd = p.x < -100 ? ctx.internal('gpio' + p.gpio) : ctx.node(p.id);
      pinNode.set(p.gpio, nd);
      gpioSrc.set(p.gpio, ctx.add(new Source(nd, gnd, 0, 1e9)));
    }
    // Onboard-LED an einem GPIO ohne Stiftleiste (z. B. Pico GP25)
    if (b.ledBuiltin !== undefined && !pinNode.has(b.ledBuiltin)) {
      const nd = ctx.internal('gpio' + b.ledBuiltin);
      pinNode.set(b.ledBuiltin, nd);
      gpioSrc.set(b.ledBuiltin, ctx.add(new Source(nd, gnd, 0, 1e9)));
    }
    // Onboard-LED
    const ledDiodes: { gpio: number; d: Diode }[] = [];
    if (b.ledBuiltin !== undefined && pinNode.has(b.ledBuiltin)) {
      const nd = pinNode.get(b.ledBuiltin)!;
      const nl = ctx.internal('led');
      if (b.ledActiveLow) {
        ctx.add(new Resistor(rail, nl, 1000));
        ledDiodes.push({ gpio: b.ledBuiltin, d: ctx.add(new Diode(nl, nd, diodeFromVf(2.6, 0.003, 2))) });
      } else {
        ctx.add(new Resistor(nd, nl, 1000));
        ledDiodes.push({ gpio: b.ledBuiltin, d: ctx.add(new Diode(nl, gnd, diodeFromVf(2.0, 0.003, 2))) });
      }
    }
    // BOOT-Taster
    const bootSw: Switch[] = [];
    for (const btn of b.buttons ?? []) {
      if (btn.gpio !== undefined && pinNode.has(btn.gpio)) {
        const s = ctx.add(new Switch(pinNode.get(btn.gpio)!, gnd, false, 50));
        (s as any).key = `pressed_${btn.id}`;
        bootSw.push(s);
        // externe Pull-ups für Strapping-Pins
        ctx.add(new Resistor(pinNode.get(btn.gpio)!, rail, 10000));
      }
    }
    const slot = ctx.engine.registerMcu(ctx.id, b, { gpioSrc, pinNode, rail, gnd });
    const brownout = b.vcc === 5 ? 2.7 : 2.5;
    return {
      pre(c: BuildCtx) {
        const v = c.v(b.vcc === 5 ? (first('5v') ?? '') : (first('3v3') ?? '')) - (gndId ? c.v(gndId) : 0);
        const vr = Number.isFinite(v) && v !== 0 ? v : c.circuit.voltage(rail) - c.circuit.voltage(gnd);
        const powered = vr > brownout;
        if (powered !== !!c.state.powered) {
          c.state.powered = powered;
          slot.setPowered(powered);
        }
        slot.vcc = Math.max(0, Math.min(vr, b.vcc + 0.3));
        // Stromaufnahme je nach Zustand
        const rt = slot.runtime;
        let I = b.current.active;
        if (rt?.sleep === 'deep') I = b.current.sleep;
        else if (rt && (rt.wifi.status === 3 || rt.wifi.status === 6 || rt.ble.advertising)) I = b.current.radio ?? b.current.active;
        if (!powered) I = b.current.sleep;
        const r = b.vcc / I;
        if (Math.abs(load.r - r) > 1e-6 * r) {
          load.r = r;
          c.engine.markDirty();
        }
        c.state.sleep = rt?.sleep;
        c.state.blink = c.time;
        for (const s of bootSw) {
          const pressed = !!c.state[(s as any).key];
          if (pressed !== s.closed) {
            s.closed = pressed;
            c.engine.markDirty();
          }
        }
        if (c.state.pressed_reset && !c.state._resetHeld) {
          c.state._resetHeld = true;
          slot.reset();
        } else if (!c.state.pressed_reset) c.state._resetHeld = false;
      },
      post(c: BuildCtx) {
        for (const l of ledDiodes) c.state[`led${l.gpio}`] = Math.min(1, Math.max(0, Math.pow(Math.max(l.d.i, 0) / 0.002, 0.6)));
        c.state.i = (rail >= 0 ? (c.circuit.voltage(rail) - c.circuit.voltage(gnd)) / load.r : 0) + 0;
      },
    };
  };
}

export const BOARD_PARTS: PartDef[] = BOARDS.map((b) => ({
  type: b.id,
  aliases: [],
  name: b.name,
  category: b.linux ? 'Computer' : 'Mikrocontroller',
  keywords: `${b.chip} ${b.family} ${b.wifi ? 'wlan wifi' : ''} ${b.ble ? 'bluetooth ble' : ''} mikrocontroller board ${b.id.replace(/-/g, ' ')}`,
  prefix: 'U',
  defaults: { usb: 'auto' },
  props: [{ key: 'usb', label: 'USB-Versorgung', type: 'select', options: [{ value: 'auto', label: 'Automatisch' }, { value: true as unknown as string, label: 'An (USB-Kabel steckt)' }, { value: false as unknown as string, label: 'Aus (Batterie/Netzteil)' }], hint: 'Automatisch: USB aus, sobald etwas an 5V/3V3/VIN hängt' }],
  size: () => ({ w: b.w, h: b.h }),
  pins: () => b.pins,
  render: ({ state }) => boardRender(b, state),
  symbol: 'box',
  build: boardBuild(b),
  bridges: () => {
    const groups: string[][] = [];
    for (const pw of ['gnd', '5v', '3v3'] as const) {
      const ids = b.pins.filter((p) => p.power === pw).map((p) => p.id);
      if (ids.length > 1) groups.push(ids);
    }
    // Uno-Layout: SDA/SCL-Stifte sind intern A4/A5
    const ids = new Set(b.pins.map((p) => p.id));
    if (b.layout === 'uno' && ids.has('SDA') && ids.has('A4')) groups.push(['SDA', 'A4'], ['SCL', 'A5']);
    return groups;
  },
  areas: () =>
    (b.buttons ?? []).map((btn) => {
      const x = b.layout === 'dual' ? Math.min(Math.max(btn.x, 16), b.w - 16) : btn.x;
      const y = b.layout === 'dual' ? Math.min(Math.max(btn.y, 12), b.h - 12) : btn.y;
      return { kind: 'press' as const, key: `pressed_${btn.id}`, area: { x: x - 9, y: y - 8, w: 18, h: 16 }, label: btn.label };
    }),
  info: b.info,
  specs: {
    Chip: b.chip,
    Takt: `${b.mhz} MHz`,
    Logikpegel: `${b.vcc} V`,
    ADC: b.adcBits ? `${b.adcBits} Bit` : '—',
    Funk: [b.wifi && 'WLAN', b.ble && 'Bluetooth LE'].filter(Boolean).join(', ') || '—',
    'Deep-Sleep': b.current.sleep < 0.001 ? `${Math.round(b.current.sleep * 1e6)} µA` : `${Math.round(b.current.sleep * 1000)} mA`,
  },
  price: b.price,
  board: b,
  height3d: 12,
}));

void Glow;
void Pcb;
