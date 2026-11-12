/**
 * Bibliothekserweiterung 2.0 (Abschnitt 11): Schnittstellen, Laden/Akku, Audio, Kamera, Steckverbinder,
 * Schutzbauteile, Leistungselektronik, Industrie, Mechanik.
 * Module mit Ruhestrom-Modell; Steckverbinder und Mechanik ohne Simulation (für Platine und Stückliste).
 */
import { Chip } from '../svg';
import { Diode, diodeFromVf, Resistor } from '../../sim/mna';
import type { Category, PartDef } from '../types';
import { modulePart } from './modules';

interface Spec {
  type: string;
  name: string;
  cat: Category;
  kw: string;
  pins: string[];
  chip: string;
  w?: number;
  h?: number;
  iq?: number;
  price: number;
  info: string;
  color?: string;
  noSim?: boolean;
}

const S = (type: string, name: string, cat: Category, kw: string, pins: string[], chip: string, price: number, info: string, more: Partial<Spec> = {}): Spec => ({ type, name, cat, kw, pins, chip, price, info, ...more });

const SPECS: Spec[] = [
  // Schnittstellen
  S('mcp2515', 'CAN-Controller MCP2515 + TJA1050', 'Funk', 'can bus auto kfz spi', ['VCC', 'GND', 'CS', 'SO', 'SI', 'SCK', 'INT'], 'MCP2515', 2.5, 'CAN-Bus-Modul (SPI) mit Transceiver TJA1050, 8-MHz-Quarz.', { iq: 0.005 }),
  S('tja1050', 'CAN-Transceiver TJA1050', 'ICs', 'can transceiver', ['TXD', 'GND', 'VCC', 'RXD', 'CANH', 'CANL'], 'TJA1050', 0.8, 'High-Speed-CAN-Transceiver bis 1 Mbit/s.', { iq: 0.01 }),
  S('max485', 'RS-485-Modul MAX485', 'Funk', 'rs485 modbus industrie seriell', ['RO', 'RE', 'DE', 'DI', 'VCC', 'GND', 'A', 'B'], 'MAX485', 1.2, 'Halbduplex-RS-485-Transceiver für Modbus und lange Leitungen bis 1200 m.', { iq: 0.0003 }),
  S('ch340', 'USB-UART CH340G', 'ICs', 'usb seriell uart programmer', ['GND', 'TXD', 'RXD', 'VCC', '3V3', 'DTR'], 'CH340G', 1.5, 'USB-zu-Seriell-Wandler, Auto-Reset über DTR.', { iq: 0.012 }),
  S('cp2102', 'USB-UART CP2102', 'ICs', 'usb seriell uart', ['DTR', 'RXD', 'TXD', 'VCC', 'CTS', 'GND'], 'CP2102', 2, 'USB-zu-Seriell-Wandler von Silicon Labs.', { iq: 0.02 }),
  S('w5500', 'Ethernet W5500', 'Funk', 'ethernet lan netzwerk spi tcp', ['GND', 'VCC', 'MISO', 'MOSI', 'SCK', 'CS', 'RST', 'INT'], 'W5500', 4.5, 'Hardware-TCP/IP-Ethernet-Controller mit RJ45 (SPI).', { iq: 0.13, w: 140, h: 110 }),
  // Laden & Akku
  S('tp4056', 'Li-Ion-Lader TP4056', 'Stromversorgung', 'akku laden lipo 18650 usb', ['IN+', 'IN-', 'B+', 'B-', 'OUT+', 'OUT-'], 'TP4056', 0.6, 'Lademodul 1 A für 1-Zellen-Li-Ion mit Schutz (DW01).', { noSim: true }),
  S('bq24074', 'Lade-IC BQ24074', 'Stromversorgung', 'akku laden power path', ['IN', 'GND', 'BAT', 'OUT', 'CHG', 'PGOOD', 'EN1', 'EN2'], 'BQ24074', 3.2, 'Li-Ion-Lader mit Power-Path-Management.', { noSim: true }),
  S('dw01', 'Akkuschutz DW01 + FS8205', 'Stromversorgung', 'akkuschutz bms tiefentladung', ['B+', 'B-', 'P+', 'P-'], 'DW01', 0.3, 'Schutz gegen Überladung, Tiefentladung und Kurzschluss.', { noSim: true }),
  S('max17048', 'Fuel Gauge MAX17048', 'Sensoren', 'akku ladezustand soc i2c', ['VCC', 'GND', 'SDA', 'SCL', 'ALRT'], 'MAX17048', 3, 'Ladezustand-Messung (ModelGauge) für Li-Ion über I²C.', { iq: 0.000023 }),
  S('mt3608', 'Step-up-Wandler MT3608', 'Stromversorgung', 'boost aufwärtswandler dcdc', ['VIN+', 'VIN-', 'VOUT+', 'VOUT-'], 'MT3608', 0.7, 'Aufwärtswandler 2–24 V, bis 2 A.', { noSim: true }),
  S('lm2596', 'Step-down-Wandler LM2596', 'Stromversorgung', 'buck abwärtswandler dcdc', ['IN+', 'IN-', 'OUT+', 'OUT-'], 'LM2596', 1.5, 'Abwärtswandler 3–35 V, bis 3 A, einstellbar.', { noSim: true, w: 120, h: 70 }),
  // Audio
  S('pam8403', 'Audioverstärker PAM8403', 'Ein-/Ausgabe', 'audio verstaerker stereo klasse d', ['5V', 'GND', 'L', 'R', 'LOUT+', 'LOUT-', 'ROUT+', 'ROUT-'], 'PAM8403', 0.6, 'Stereo-Klasse-D-Verstärker 2 × 3 W an 5 V.', { iq: 0.01 }),
  S('max98357', 'I²S-Verstärker MAX98357A', 'Ein-/Ausgabe', 'i2s audio dac verstaerker', ['LRC', 'BCLK', 'DIN', 'GAIN', 'SD', 'GND', 'VIN'], 'MAX98357', 3, 'Digitaler I²S-Mono-Verstärker 3,2 W.', { iq: 0.0024 }),
  S('pcm5102', 'I²S-DAC PCM5102A', 'Ein-/Ausgabe', 'i2s dac audio hifi', ['VIN', 'GND', 'LCK', 'DIN', 'BCK', 'SCK'], 'PCM5102A', 4, '32-bit-Stereo-DAC mit 112 dB Dynamik.', { iq: 0.02 }),
  S('inmp441', 'I²S-Mikrofon INMP441', 'Sensoren', 'mikrofon i2s audio mems', ['VDD', 'GND', 'SD', 'WS', 'SCK', 'L/R'], 'INMP441', 2.5, 'Digitales MEMS-Mikrofon mit I²S-Ausgang.', { iq: 0.0014 }),
  // Kamera, Touch
  S('ov2640', 'Kamera OV2640', 'Sensoren', 'kamera camera bild esp32-cam', ['3V3', 'GND', 'SIOC', 'SIOD', 'VSYNC', 'HREF', 'PCLK', 'XCLK', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9'], 'OV2640', 5, '2-Megapixel-Kamera mit JPEG-Ausgabe (DVP).', { iq: 0.04, w: 160, h: 100 }),
  S('ft6206', 'Touch-Controller FT6206', 'Sensoren', 'touch kapazitiv i2c', ['VCC', 'GND', 'SDA', 'SCL', 'INT', 'RST'], 'FT6206', 2, 'Kapazitiver Touch-Controller (I²C).', { iq: 0.004 }),
  S('mpr121', 'Touch-Sensor MPR121', 'Sensoren', 'touch kapazitiv 12 kanäle', ['3V3', 'GND', 'SCL', 'SDA', 'IRQ', 'ADDR'], 'MPR121', 2.5, '12 kapazitive Touch-Eingänge über I²C.', { iq: 0.00003 }),
  // Steckverbinder (ohne Simulation)
  S('usb-c-buchse', 'USB-C-Buchse (Breakout)', 'Stromversorgung', 'usb c buchse stecker typ-c', ['VBUS', 'GND', 'CC1', 'CC2', 'D+', 'D-'], 'USB-C', 0.6, 'USB-Typ-C-Buchse mit 5,1-kΩ-CC-Widerständen.', { noSim: true }),
  S('jst-ph-2', 'JST-PH 2-polig', 'Aufbau', 'stecker jst ph akku 2mm', ['1', '2'], 'PH2', 0.1, 'JST-PH-Steckverbinder, Raster 2,0 mm (Akkus).', { noSim: true, w: 50, h: 40 }),
  S('jst-xh-4', 'JST-XH 4-polig', 'Aufbau', 'stecker jst xh 2.54', ['1', '2', '3', '4'], 'XH4', 0.12, 'JST-XH-Steckverbinder, Raster 2,5 mm.', { noSim: true, w: 70, h: 40 }),
  S('jst-sh-4', 'JST-SH 4-polig (Qwiic/STEMMA QT)', 'Aufbau', 'stecker jst sh qwiic stemma i2c', ['GND', 'VCC', 'SDA', 'SCL'], 'SH4', 0.15, 'JST-SH 1,0 mm – Qwiic/STEMMA-QT-I²C-Anschluss.', { noSim: true, w: 70, h: 40 }),
  S('molex-kk-3', 'Molex KK 3-polig', 'Aufbau', 'stecker molex kk', ['1', '2', '3'], 'KK3', 0.2, 'Molex KK 254, Raster 2,54 mm.', { noSim: true, w: 60, h: 40 }),
  S('schraubklemme-2', 'Schraubklemme 2-polig', 'Aufbau', 'schraubklemme terminal klemme', ['1', '2'], 'KF301', 0.15, 'Schraubklemme Raster 5,08 mm, 16 A.', { noSim: true, w: 50, h: 45, color: '#2f7d4a' }),
  S('schraubklemme-3', 'Schraubklemme 3-polig', 'Aufbau', 'schraubklemme terminal klemme', ['1', '2', '3'], 'KF301', 0.2, 'Schraubklemme Raster 5,08 mm, 16 A.', { noSim: true, w: 70, h: 45, color: '#2f7d4a' }),
  S('stiftleiste-6', 'Stiftleiste 1×6', 'Aufbau', 'stiftleiste header pin', ['1', '2', '3', '4', '5', '6'], '1x6', 0.05, 'Stiftleiste 2,54 mm.', { noSim: true, w: 80, h: 30 }),
  // Leistungselektronik
  S('ir2104', 'Gate-Treiber IR2104', 'ICs', 'gate treiber halbbruecke mosfet', ['VCC', 'IN', 'SD', 'COM', 'LO', 'VS', 'HO', 'VB'], 'IR2104', 1.8, 'Halbbrücken-Gate-Treiber 600 V.', { iq: 0.0015 }),
  S('igbt-irg4bc30', 'IGBT IRG4BC30', 'Halbleiter', 'igbt leistung', ['G', 'C', 'E'], 'IRG4BC30', 2.5, 'IGBT 600 V / 23 A (TO-220).', { noSim: true, w: 50, h: 60 }),
  S('gbu406', 'Brückengleichrichter GBU406', 'Halbleiter', 'gleichrichter brücke graetz', ['~1', '+', '-', '~2'], 'GBU406', 0.8, 'Brückengleichrichter 600 V / 4 A.', { noSim: true }),
  S('trafo-230-12', 'Trafo 230 V → 12 V', 'Stromversorgung', 'transformator trafo netz', ['P1', 'P2', 'S1', 'S2'], '12V 1VA', 6, 'Print-Transformator 230 V / 12 V, 1,5 VA. Netzspannung – Vorsicht!', { noSim: true, w: 110, h: 90, color: '#2a2a2a' }),
  // Schutz
  S('tvs-smbj5', 'TVS-Diode SMBJ5.0A', 'Halbleiter', 'tvs esd schutz ueberspannung', ['A', 'K'], 'SMBJ5', 0.2, 'Überspannungsschutz 5 V, 600 W Spitze.', { noSim: true, w: 40, h: 30 }),
  S('varistor-275', 'Varistor S10K275', 'Passiv', 'varistor vdr ueberspannung netz', ['1', '2'], 'S10K275', 0.3, 'Varistor 275 V AC für Netzschutz.', { noSim: true, w: 40, h: 40 }),
  S('ferrit', 'Ferritperle 600 Ω', 'Passiv', 'ferrit emv entstoerung', ['1', '2'], 'BLM18', 0.05, 'Ferritperle 600 Ω @ 100 MHz zur Entstörung.', { noSim: true, w: 40, h: 25 }),
  S('gleichtaktdrossel', 'Gleichtaktdrossel 2 × 10 mH', 'Passiv', 'drossel emv gleichtakt common mode', ['1', '2', '3', '4'], 'CMC', 0.9, 'Gleichtaktdrossel für Netz- und Datenleitungen.', { noSim: true }),
  // Industrie
  S('plc-input-24v', 'SPS-Eingang 24 V (Optokoppler)', 'Ein-/Ausgabe', 'sps plc 24v industrie eingang optokoppler', ['IN+', 'IN-', 'VCC', 'GND', 'OUT'], 'PC817×4', 3.5, '24-V-Eingangskarte mit galvanischer Trennung.', { iq: 0.002 }),
  S('loop-4-20ma', '4–20-mA-Empfänger', 'Sensoren', '4-20ma stromschleife industrie sensor', ['I+', 'I-', 'VCC', 'GND', 'OUT'], '4-20mA', 4, 'Wandelt 4–20 mA in 0–3,3 V für den ADC.', { iq: 0.003 }),
  S('relaiskarte-4', 'Relaiskarte 4-fach', 'Ein-/Ausgabe', 'relais karte 4 kanal', ['GND', 'IN1', 'IN2', 'IN3', 'IN4', 'VCC'], '4× SRD-05VDC', 4.5, 'Vier Relais 10 A / 250 V mit Optokopplern.', { iq: 0.002, w: 160, h: 100 }),
  S('hutschiene-netzteil', 'Hutschienen-Netzteil 24 V', 'Stromversorgung', 'hutschiene din rail netzteil 24v', ['L', 'N', 'PE', '+V', '-V'], 'HDR-15-24', 18, 'DIN-Rail-Netzteil 24 V / 0,63 A. Netzspannung – nur durch Fachkräfte!', { noSim: true, w: 100, h: 110, color: '#ddd' }),
  // Mechanik (nur Stückliste/Platine)
  S('abstandshalter-m3', 'Abstandshalter M3 × 10', 'Aufbau', 'abstandshalter distanz m3 schraube', ['M'], 'M3×10', 0.1, 'Messing-Abstandshalter M3, 10 mm.', { noSim: true, w: 30, h: 30, color: '#c9a227' }),
  S('kuehlkoerper-to220', 'Kühlkörper TO-220', 'Aufbau', 'kühlkörper kuehlkoerper heatsink', ['M'], '21 K/W', 0.5, 'Fingerkühlkörper 21 K/W für TO-220.', { noSim: true, w: 60, h: 50, color: '#888' }),
  S('luefter-5v', 'Lüfter 5 V 30 mm', 'Ein-/Ausgabe', 'luefter fan kuehlung', ['+', '-'], '3010', 2, 'Axiallüfter 30 × 30 × 10 mm, 5 V / 0,1 A.', { w: 80, h: 80, color: '#222' }),
];

function make(s: Spec): PartDef {
  const w = s.w ?? Math.max(80, s.pins.length * 12 + 30);
  const h = s.h ?? 60;
  const def = modulePart({
    type: s.type,
    name: s.name,
    category: s.cat,
    keywords: s.kw,
    pins: s.pins,
    w,
    h,
    color: s.color,
    iq: s.noSim ? undefined : s.iq,
    info: s.info,
    price: s.price,
    body: ({ w: bw, h: bh }) => (
      <g>
        <Chip x={bw / 2 - Math.min(40, bw * 0.3)} y={bh * 0.15} w={Math.min(80, bw * 0.6)} h={Math.min(28, bh * 0.4)} label={s.chip} />
      </g>
    ),
    extra:
      s.type === 'luefter-5v'
        ? (ctx) => {
            ctx.add(new Resistor(ctx.node('+'), ctx.node('-'), 50));
            return {
              post(c) {
                c.state.speed = Math.max(0, Math.min(1, (c.v('+') - c.v('-')) / 5));
              },
            };
          }
        : s.type === 'tvs-smbj5'
          ? (ctx) => {
              ctx.add(new Diode(ctx.node('A'), ctx.node('K'), diodeFromVf(0.7, 0.01, 1.8, 6.4)));
            }
          : undefined,
  });
  if (s.noSim) def.build = undefined;
  return def;
}

export const EXTRA_PARTS: PartDef[] = SPECS.map(make);
