/**
 * Nachbildungen gängiger Arduino-Bibliotheken.
 * Jede Klasse spricht über den LibHost mit dem simulierten Bauteil, das wirklich
 * an den passenden Pins hängt – fehlt die Verkabelung, merkt man das wie in echt.
 */
import { Block } from './runtime';
import type { McuRuntime } from './runtime';

export interface PartState {
  [k: string]: any;
}

export interface BleSeen {
  mac: string;
  name: string;
  rssi: number;
}

export interface LibHost {
  /** Bauteil eines Typs finden, das am I²C-Bus des Boards hängt */
  findI2C(kinds: string[], addr?: number): PartState | null;
  /** Bauteil finden, dessen Pin `pinName` mit dem MCU-Pin verbunden ist */
  findOnPin(pin: number, kinds: string[], pinName?: string): PartState | null;
  /** alle Bauteile eines Typs, die über SPI/Steuerpins mit dem Board verbunden sind */
  findAny(kinds: string[]): PartState | null;
  bleScan(): BleSeen[];
  bleAdvertise(name: string | null): void;
  wifiAvailable(): boolean;
  rgbWrite?(pin: number, r: number, g: number, b: number): void;
  serialWrite(text: string, port?: number): void;
  warn(msg: string): void;
}

const FONT_W = 6;
const FONT_H = 8;

function obj<T extends object>(cls: string, o: T): T & { __cls: string } {
  return Object.assign(o, { __cls: cls });
}

export const LIB_CLASSES = [
  'HardwareSerial', 'TwoWire', 'SPIClass', 'WiFiClass', 'BLEDevice', 'BLEScan', 'BLEScanResults', 'BLEAdvertisedDevice', 'BLEAddress', 'BLEAdvertising', 'BLEServer',
  'LiquidCrystal_I2C', 'LiquidCrystal', 'Adafruit_SSD1306', 'Adafruit_SH1106G', 'Servo', 'ESP32Servo', 'DHT', 'DHT_Unified', 'OneWire', 'DallasTemperature',
  'Adafruit_NeoPixel', 'Adafruit_BME280', 'Adafruit_BMP280', 'Adafruit_MPU6050', 'sensors_event_t', 'MFRC522', 'Keypad', 'LedControl', 'HTTPClient', 'WiFiClient',
  'NewPing', 'Stepper', 'AccelStepper', 'EspClass', 'EEPROMClass', 'Keyboard_', 'FS', 'TM1637Display', 'Adafruit_ST7789', 'Adafruit_ILI9341', 'Encoder', 'Bounce',
  'NimBLEDevice', 'NimBLEScan', 'BLEUUID', 'IPAddress', 'Preferences',
];

export function createLibObject(cls: string, args: unknown[], rt: McuRuntime): Record<string, unknown> | null {
  const h = rt.host;
  switch (cls) {
    case 'HardwareSerial': {
      let buf = '';
      return obj(cls, {
        begin: (baud: number) => {
          rt.serialBaud = baud;
        },
        end: () => {},
        print: (s: string) => {
          if (!rt.serialBaud) {
            if (!buf) h.warn('Serial.print() ohne Serial.begin() – auf echter Hardware kommt so nichts an.');
            buf = 'x';
          }
          h.serialWrite(s);
          return s.length;
        },
        println: (s: string) => {
          h.serialWrite(s + '\r\n');
          return s.length + 2;
        },
        write: (c: unknown) => {
          h.serialWrite(typeof c === 'number' ? String.fromCharCode(c) : String(c));
          return 1;
        },
        available: () => rt.serialIn.length,
        read: () => (rt.serialIn.length ? rt.serialIn.shift()! : -1),
        peek: () => (rt.serialIn.length ? rt.serialIn[0] : -1),
        readString: () => {
          const s = String.fromCharCode(...rt.serialIn);
          rt.serialIn.length = 0;
          return s;
        },
        readStringUntil: (term: number) => {
          const idx = rt.serialIn.indexOf(term);
          const take = idx >= 0 ? rt.serialIn.splice(0, idx + 1).slice(0, -1) : rt.serialIn.splice(0);
          return String.fromCharCode(...take);
        },
        parseInt: () => {
          const s = String.fromCharCode(...rt.serialIn);
          const m = /-?\d+/.exec(s);
          if (!m) return 0;
          rt.serialIn.splice(0, m.index + m[0].length);
          return parseInt(m[0], 10);
        },
        parseFloat: () => {
          const s = String.fromCharCode(...rt.serialIn);
          const m = /-?\d+(\.\d+)?/.exec(s);
          if (!m) return 0;
          rt.serialIn.splice(0, m.index + m[0].length);
          return parseFloat(m[0]);
        },
        setTimeout: () => {},
        flush: () => {},
        setDebugOutput: () => {},
        valueOf: () => 1,
      });
    }
    case 'TwoWire':
      return obj(cls, { begin: () => {}, setClock: () => {}, beginTransmission: () => {}, endTransmission: () => 0, write: () => 1, requestFrom: () => 0, read: () => 0, available: () => 0 });
    case 'SPIClass':
      return obj(cls, { begin: () => {}, transfer: () => 0, beginTransaction: () => {}, endTransaction: () => {} });
    case 'IPAddress':
      return obj(cls, { toString: () => args.join('.') });
    case 'WiFiClass':
      return obj(cls, {
        mode: () => {},
        begin: (ssid: string) => {
          rt.wifi = { status: 6, ssid: String(ssid ?? ''), since: rt.timeUs };
        },
        status: () => {
          if (rt.wifi.since && rt.timeUs - rt.wifi.since > 1_800_000) rt.wifi.status = h.wifiAvailable() ? 3 : 1;
          return rt.wifi.status;
        },
        isConnected: () => (rt.wifi.status === 3 ? 1 : 0),
        disconnect: () => {
          rt.wifi.status = 6;
        },
        localIP: () => (rt.wifi.status === 3 ? '192.168.4.' + (20 + (rt.board.id.length % 200)) : '0.0.0.0'),
        macAddress: () => '24:0A:C4:12:34:56',
        RSSI: () => (rt.wifi.status === 3 ? -54 : 0),
        SSID: () => rt.wifi.ssid,
        setSleep: () => {},
        softAP: () => 1,
        softAPIP: () => '192.168.4.1',
        scanNetworks: () => new Block(2_000_000, 3),
        setHostname: () => {},
      });
    case 'WiFiClient':
      return obj(cls, { connect: () => (rt.wifi.status === 3 ? 1 : 0), print: () => 1, println: () => 1, available: () => 0, stop: () => {}, connected: () => 0 });
    case 'HTTPClient': {
      let url = '';
      let body = '';
      return obj(cls, {
        begin: (...a: unknown[]) => {
          url = String(a[a.length - 1]);
          return 1;
        },
        addHeader: () => {},
        GET: () => {
          if (rt.wifi.status !== 3) return -1;
          if (typeof fetch === 'undefined') return new Block(300_000, 200);
          const p = fetch(url)
            .then(async (r) => {
              body = await r.text();
              return r.status;
            })
            .catch(() => {
              body = '';
              h.warn(`HTTP-Anfrage an ${url} ist fehlgeschlagen (Internet/CORS).`);
              return -1;
            });
          return new Block(150_000, 0, p);
        },
        POST: (data: string) => {
          if (rt.wifi.status !== 3) return -1;
          const p = fetch(url, { method: 'POST', body: data })
            .then(async (r) => {
              body = await r.text();
              return r.status;
            })
            .catch(() => -1);
          return new Block(150_000, 0, p);
        },
        getString: () => body,
        end: () => {},
      });
    }
    case 'BLEDevice': {
      let scan: Record<string, unknown> | null = null;
      return obj(cls, {
        init: (name: string) => {
          rt.ble.name = String(name ?? '');
        },
        getScan: () => (scan ??= createLibObject('BLEScan', [], rt)),
        getAdvertising: () => createLibObject('BLEAdvertising', [], rt),
        startAdvertising: () => {
          rt.ble.advertising = true;
          h.bleAdvertise(rt.ble.name || 'ESP32');
        },
        createServer: () => createLibObject('BLEServer', [], rt),
        deinit: () => {},
        setPower: () => {},
      });
    }
    case 'BLEServer':
      return obj(cls, { setCallbacks: () => {}, createService: () => obj('BLEService', { createCharacteristic: () => obj('BLECharacteristic', { setValue: () => {}, notify: () => {}, setCallbacks: () => {}, addDescriptor: () => {} }), start: () => {} }), getAdvertising: () => createLibObject('BLEAdvertising', [], rt), startAdvertising: () => { rt.ble.advertising = true; h.bleAdvertise(rt.ble.name || 'ESP32'); } });
    case 'BLEAdvertising':
      return obj(cls, {
        start: () => {
          rt.ble.advertising = true;
          h.bleAdvertise(rt.ble.name || 'ESP32');
        },
        stop: () => {
          rt.ble.advertising = false;
          h.bleAdvertise(null);
        },
        addServiceUUID: () => {},
        setScanResponse: () => {},
        setMinPreferred: () => {},
      });
    case 'BLEScan': {
      let results: BleSeen[] = [];
      const self = obj(cls, {
        setActiveScan: () => {},
        setInterval: () => {},
        setWindow: () => {},
        setAdvertisedDeviceCallbacks: () => {},
        clearResults: () => {
          results = [];
        },
        start: (seconds: number) => {
          results = h.bleScan();
          const res = createLibObject('BLEScanResults', [results], rt);
          return new Block(Math.max(0.1, Number(seconds) || 1) * 1_000_000, res);
        },
        getResults: () => createLibObject('BLEScanResults', [results], rt),
      });
      return self;
    }
    case 'BLEScanResults': {
      const list = (args[0] as BleSeen[]) ?? [];
      return obj(cls, {
        getCount: () => list.length,
        getDevice: (i: number) => createLibObject('BLEAdvertisedDevice', [list[i]], rt),
      });
    }
    case 'BLEAdvertisedDevice': {
      const d = (args[0] as BleSeen) ?? { mac: '00:00:00:00:00:00', name: '', rssi: -100 };
      return obj(cls, {
        getAddress: () => obj('BLEAddress', { toString: () => d.mac }),
        getRSSI: () => d.rssi,
        getName: () => d.name,
        haveName: () => (d.name ? 1 : 0),
        toString: () => `Name: ${d.name}, Address: ${d.mac}, rssi: ${d.rssi}`,
      });
    }
    case 'EspClass':
      return obj(cls, {
        restart: () => {
          setTimeout(() => rt.reset(0), 0);
          return new Block(1e9);
        },
        getFreeHeap: () => 280_000,
        getChipModel: () => rt.board.chip,
        getCpuFreqMHz: () => rt.board.mhz,
        deepSleep: (us: number) => {
          rt.fn.esp_deep_sleep(us);
          return new Block(0);
        },
        getEfuseMac: () => 0x563412c40a24,
      });
    case 'EEPROMClass': {
      const mem = rt.eeprom;
      return obj(cls, { begin: () => 1, read: (a: number) => mem[a] ?? 255, write: (a: number, v: number) => (mem[a] = v), update: (a: number, v: number) => (mem[a] = v), commit: () => 1, length: () => 1024 });
    }
    case 'Preferences': {
      const store = rt.nvs;
      return obj(cls, {
        begin: () => 1, end: () => {}, clear: () => store.clear(),
        putInt: (k: string, v: number) => store.set(k, v), getInt: (k: string, d = 0) => (store.get(k) as number) ?? d,
        putUInt: (k: string, v: number) => store.set(k, v), getUInt: (k: string, d = 0) => (store.get(k) as number) ?? d,
        putString: (k: string, v: string) => store.set(k, v), getString: (k: string, d = '') => (store.get(k) as string) ?? d,
        putBool: (k: string, v: number) => store.set(k, v), getBool: (k: string, d = 0) => (store.get(k) as number) ?? d,
        putFloat: (k: string, v: number) => store.set(k, v), getFloat: (k: string, d = 0) => (store.get(k) as number) ?? d,
      });
    }
    case 'FS':
      return obj(cls, { begin: () => 1 });
    case 'Keyboard_':
      return obj(cls, { begin: () => {}, press: () => {}, release: () => {}, releaseAll: () => {}, print: () => {}, write: () => {}, move: () => {}, click: () => {} });

    /* ------------------------- Displays ------------------------- */
    case 'LiquidCrystal_I2C':
    case 'LiquidCrystal': {
      const cols = cls === 'LiquidCrystal_I2C' ? Number(args[1] ?? 16) : 16;
      const rows = cls === 'LiquidCrystal_I2C' ? Number(args[2] ?? 2) : 2;
      let cx = 0;
      let cy = 0;
      const dev = () => (cls === 'LiquidCrystal_I2C' ? h.findI2C(['lcd1602', 'lcd2004'], Number(args[0])) : h.findOnPin(Number(args[0]), ['lcd1602', 'lcd2004'], 'RS'));
      let warned = false;
      const d = () => {
        const x = dev();
        if (!x && !warned) {
          warned = true;
          h.warn(`${cls}: Kein LCD am ${cls === 'LiquidCrystal_I2C' ? 'I²C-Bus (SDA/SCL)' : 'RS-Pin'} gefunden. Prüfe die Verkabelung.`);
        }
        if (x && !x.lines) {
          x.lines = Array.from({ length: x.rows ?? rows }, () => ' '.repeat(x.cols ?? cols));
        }
        return x;
      };
      const write = (s: string) => {
        const x = d();
        if (!x) return;
        for (let ch of s) {
          // HD44780-Zeichensatz: 223 = °, 228 = µ, 244 = Ω
          ch = ({ 'ß': '°', 'ä': 'µ', 'ô': 'Ω' } as Record<string, string>)[ch] ?? ch;
          if (cy >= x.lines.length) break;
          const line: string = x.lines[cy];
          if (cx < line.length) x.lines[cy] = line.slice(0, cx) + ch + line.slice(cx + 1);
          cx++;
        }
        x.version = (x.version ?? 0) + 1;
      };
      return obj(cls, {
        init: () => d(),
        begin: () => d(),
        backlight: () => {
          const x = d();
          if (x) x.backlight = true;
        },
        noBacklight: () => {
          const x = d();
          if (x) x.backlight = false;
        },
        clear: () => {
          const x = d();
          if (x) x.lines = x.lines.map((l: string) => ' '.repeat(l.length));
          cx = cy = 0;
        },
        home: () => {
          cx = cy = 0;
        },
        setCursor: (c: number, r: number) => {
          cx = c;
          cy = r;
        },
        print: (s: string) => {
          write(s);
          return s.length;
        },
        println: (s: string) => {
          write(s);
          return s.length;
        },
        write: (c: number) => write(String.fromCharCode(c)),
        createChar: () => {},
        cursor: () => {},
        noCursor: () => {},
        blink: () => {},
        noBlink: () => {},
        display: () => {},
        noDisplay: () => {},
        scrollDisplayLeft: () => {},
        scrollDisplayRight: () => {},
      });
    }
    case 'Adafruit_SSD1306':
    case 'Adafruit_SH1106G': {
      const W = Number(args[0] ?? 128);
      const Hh = Number(args[1] ?? 64);
      const buf = new Uint8Array(W * Hh);
      let tx = 0;
      let ty = 0;
      let size = 1;
      let color = 1;
      let dev: PartState | null = null;
      const px = (x: number, y: number, c = color) => {
        x = Math.round(x);
        y = Math.round(y);
        if (x < 0 || y < 0 || x >= W || y >= Hh) return;
        const i = y * W + x;
        buf[i] = c === 2 ? 1 - buf[i] : c ? 1 : 0;
      };
      const line = (x0: number, y0: number, x1: number, y1: number, c = color) => {
        const dx = Math.abs(x1 - x0);
        const dy = -Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1;
        const sy = y0 < y1 ? 1 : -1;
        let err = dx + dy;
        for (let n = 0; n < 2000; n++) {
          px(x0, y0, c);
          if (x0 === x1 && y0 === y1) break;
          const e2 = 2 * err;
          if (e2 >= dy) {
            err += dy;
            x0 += sx;
          }
          if (e2 <= dx) {
            err += dx;
            y0 += sy;
          }
        }
      };
      const drawChar = (ch: string) => {
        if (ch === '\n') {
          tx = 0;
          ty += FONT_H * size;
          return;
        }
        if (ch === '\r') return;
        const g = glyph(ch);
        for (let cx = 0; cx < 5; cx++)
          for (let cy = 0; cy < 8; cy++)
            if ((g[cx] >> cy) & 1) {
              for (let a = 0; a < size; a++) for (let b = 0; b < size; b++) px(tx + cx * size + a, ty + cy * size + b);
            }
        tx += FONT_W * size;
        if (tx + FONT_W * size > W) {
          tx = 0;
          ty += FONT_H * size;
        }
      };
      const circle = (x0: number, y0: number, r: number, fill: boolean, c = color) => {
        for (let y = -r; y <= r; y++)
          for (let x = -r; x <= r; x++) {
            const d = x * x + y * y;
            if (fill ? d <= r * r + r : Math.abs(Math.sqrt(d) - r) < 0.5) px(x0 + x, y0 + y, c);
          }
      };
      return obj(cls, {
        begin: () => {
          dev = h.findI2C(['ssd1306', 'sh1106'], undefined);
          if (!dev) {
            h.warn('OLED: Kein Display am I²C-Bus gefunden – display.begin() schlägt fehl (prüfe SDA/SCL und Versorgung).');
            return 0;
          }
          return 1;
        },
        clearDisplay: () => buf.fill(0),
        display: () => {
          if (dev) {
            dev.fb = buf.slice();
            dev.w = W;
            dev.h = Hh;
            dev.version = (dev.version ?? 0) + 1;
          }
        },
        setTextSize: (s: number) => {
          size = Math.max(1, Math.round(s));
        },
        setTextColor: (c: number) => {
          color = c;
        },
        setCursor: (x: number, y: number) => {
          tx = x;
          ty = y;
        },
        setTextWrap: () => {},
        cp437: () => {},
        setRotation: () => {},
        print: (s: string) => {
          for (const ch of s) drawChar(ch);
          return s.length;
        },
        println: (s: string) => {
          for (const ch of s + '\n') drawChar(ch);
          return s.length;
        },
        write: (c: number) => drawChar(String.fromCharCode(c)),
        drawPixel: (x: number, y: number, c: number) => px(x, y, c),
        drawLine: (a: number, b: number, c: number, d: number, col: number) => line(a, b, c, d, col),
        drawFastHLine: (x: number, y: number, w: number, c: number) => line(x, y, x + w - 1, y, c),
        drawFastVLine: (x: number, y: number, hh: number, c: number) => line(x, y, x, y + hh - 1, c),
        drawRect: (x: number, y: number, w: number, hh: number, c: number) => {
          line(x, y, x + w - 1, y, c);
          line(x, y + hh - 1, x + w - 1, y + hh - 1, c);
          line(x, y, x, y + hh - 1, c);
          line(x + w - 1, y, x + w - 1, y + hh - 1, c);
        },
        drawRoundRect: (x: number, y: number, w: number, hh: number, _r: number, c: number) => {
          line(x + 1, y, x + w - 2, y, c);
          line(x + 1, y + hh - 1, x + w - 2, y + hh - 1, c);
          line(x, y + 1, x, y + hh - 2, c);
          line(x + w - 1, y + 1, x + w - 1, y + hh - 2, c);
        },
        fillRect: (x: number, y: number, w: number, hh: number, c: number) => {
          for (let i = 0; i < w; i++) for (let j = 0; j < hh; j++) px(x + i, y + j, c);
        },
        fillRoundRect: (x: number, y: number, w: number, hh: number, _r: number, c: number) => {
          for (let i = 0; i < w; i++) for (let j = 0; j < hh; j++) px(x + i, y + j, c);
        },
        fillScreen: (c: number) => buf.fill(c ? 1 : 0),
        drawCircle: (x: number, y: number, r: number, c: number) => circle(x, y, r, false, c),
        fillCircle: (x: number, y: number, r: number, c: number) => circle(x, y, r, true, c),
        drawTriangle: (a: number, b: number, c: number, d: number, e: number, f: number, col: number) => {
          line(a, b, c, d, col);
          line(c, d, e, f, col);
          line(e, f, a, b, col);
        },
        invertDisplay: () => {},
        dim: () => {},
        width: () => W,
        height: () => Hh,
        startscrollright: () => {},
        stopscroll: () => {},
        getTextBounds: () => {},
        drawBitmap: () => {},
      });
    }
    case 'Adafruit_ST7789':
    case 'Adafruit_ILI9341': {
      let dev: PartState | null = null;
      const W = cls === 'Adafruit_ILI9341' ? 240 : 240;
      const Hh = cls === 'Adafruit_ILI9341' ? 320 : 240;
      const ops: unknown[][] = [];
      let tx = 0;
      let ty = 0;
      let size = 1;
      let color = 0xffff;
      const flush = () => {
        if (!dev) dev = h.findAny(['ili9341', 'st7789']);
        if (dev) {
          dev.ops = ops.slice(-600);
          dev.version = (dev.version ?? 0) + 1;
        }
      };
      return obj(cls, {
        begin: () => {
          dev = h.findAny(['ili9341', 'st7789']);
        },
        init: () => {
          dev = h.findAny(['ili9341', 'st7789']);
        },
        setRotation: () => {},
        fillScreen: (c: number) => {
          ops.length = 0;
          ops.push(['fill', c]);
          flush();
        },
        fillRect: (x: number, y: number, w: number, hh: number, c: number) => {
          ops.push(['rect', x, y, w, hh, c, 1]);
          flush();
        },
        drawRect: (x: number, y: number, w: number, hh: number, c: number) => {
          ops.push(['rect', x, y, w, hh, c, 0]);
          flush();
        },
        fillCircle: (x: number, y: number, r: number, c: number) => {
          ops.push(['circle', x, y, r, c, 1]);
          flush();
        },
        drawCircle: (x: number, y: number, r: number, c: number) => {
          ops.push(['circle', x, y, r, c, 0]);
          flush();
        },
        drawLine: (a: number, b: number, c: number, d: number, col: number) => {
          ops.push(['line', a, b, c, d, col]);
          flush();
        },
        drawPixel: (x: number, y: number, c: number) => {
          ops.push(['rect', x, y, 1, 1, c, 1]);
          flush();
        },
        setTextColor: (c: number) => {
          color = c;
        },
        setTextSize: (s: number) => {
          size = s;
        },
        setCursor: (x: number, y: number) => {
          tx = x;
          ty = y;
        },
        print: (s: string) => {
          ops.push(['text', tx, ty, s, color, size]);
          tx += s.length * 6 * size;
          flush();
          return s.length;
        },
        println: (s: string) => {
          ops.push(['text', tx, ty, s, color, size]);
          tx = 0;
          ty += 8 * size;
          flush();
          return s.length;
        },
        color565: (r: number, g: number, b: number) => ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3),
        width: () => W,
        height: () => Hh,
      });
    }
    case 'LedControl': {
      const dev = () => h.findOnPin(Number(args[0]), ['max7219'], 'DIN');
      const ensure = () => {
        const x = dev();
        if (x && !x.rows) x.rows = new Array(8).fill(0);
        return x;
      };
      return obj(cls, {
        shutdown: () => {},
        setIntensity: (_a: number, i: number) => {
          const x = ensure();
          if (x) x.intensity = i;
        },
        clearDisplay: () => {
          const x = ensure();
          if (x) {
            x.rows = new Array(8).fill(0);
            x.version = (x.version ?? 0) + 1;
          }
        },
        setRow: (_a: number, r: number, v: number) => {
          const x = ensure();
          if (x) {
            x.rows[r] = v;
            x.version = (x.version ?? 0) + 1;
          }
        },
        setColumn: (_a: number, c: number, v: number) => {
          const x = ensure();
          if (x) {
            for (let r = 0; r < 8; r++) x.rows[r] = ((v >> (7 - r)) & 1 ? x.rows[r] | (1 << (7 - c)) : x.rows[r] & ~(1 << (7 - c)));
            x.version = (x.version ?? 0) + 1;
          }
        },
        setLed: (_a: number, r: number, c: number, on: number) => {
          const x = ensure();
          if (x) {
            x.rows[r] = on ? x.rows[r] | (1 << (7 - c)) : x.rows[r] & ~(1 << (7 - c));
            x.version = (x.version ?? 0) + 1;
          }
        },
        setDigit: () => {},
        setChar: () => {},
      });
    }
    case 'TM1637Display': {
      const dev = () => h.findOnPin(Number(args[0]), ['tm1637'], 'CLK');
      return obj(cls, {
        setBrightness: () => {},
        clear: () => {
          const x = dev();
          if (x) x.text = '    ';
        },
        showNumberDec: (n: number, lz?: number) => {
          const x = dev();
          if (x) x.text = lz ? String(n).padStart(4, '0') : String(n).padStart(4, ' ');
        },
        showNumberDecEx: (n: number, _dots: number, lz?: number) => {
          const x = dev();
          if (x) x.text = lz ? String(n).padStart(4, '0') : String(n).padStart(4, ' ');
        },
        setSegments: () => {},
      });
    }

    /* ------------------------- Aktoren ------------------------- */
    case 'Servo':
    case 'ESP32Servo': {
      let pin = -1;
      let angle = 90;
      const apply = () => {
        const s = pin >= 0 ? h.findOnPin(pin, ['servo', 'servo-mg996r'], 'SIG') : null;
        if (s) s.target = angle;
        else if (pin >= 0) h.warn(`Servo an Pin ${pin}: Kein Servo mit dem Signal-Pin verbunden.`);
      };
      return obj(cls, {
        attach: (p: number) => {
          pin = Number(p);
          return 1;
        },
        detach: () => {
          pin = -1;
        },
        write: (a: number) => {
          angle = Math.max(0, Math.min(180, a));
          apply();
        },
        writeMicroseconds: (us: number) => {
          angle = Math.max(0, Math.min(180, ((us - 544) / (2400 - 544)) * 180));
          apply();
        },
        read: () => Math.round(angle),
        attached: () => (pin >= 0 ? 1 : 0),
        setPeriodHertz: () => {},
      });
    }
    case 'Stepper':
    case 'AccelStepper': {
      const pins = args.slice(1).map(Number);
      let pos = 0;
      let target = 0;
      let speed = 10;
      const steps = cls === 'Stepper' ? Number(args[0]) || 200 : 200;
      const dev = () => h.findOnPin(pins[0], ['stepper', 'a4988', 'uln2003'], undefined);
      const upd = () => {
        const d = dev();
        if (d) {
          d.position = pos;
          d.stepsPerRev = steps;
        }
      };
      return obj(cls, {
        setSpeed: (s: number) => {
          speed = s;
        },
        step: (n: number) => {
          pos += n;
          upd();
          const us = Math.abs(n) * (60_000_000 / Math.max(1, speed * steps));
          return new Block(us);
        },
        setMaxSpeed: (s: number) => {
          speed = s;
        },
        setAcceleration: () => {},
        moveTo: (t: number) => {
          target = t;
        },
        move: (t: number) => {
          target = pos + t;
        },
        run: () => {
          if (pos !== target) {
            pos += pos < target ? 1 : -1;
            upd();
          }
          return pos !== target ? 1 : 0;
        },
        runSpeed: () => {
          pos += Math.sign(speed);
          upd();
          return 1;
        },
        distanceToGo: () => target - pos,
        currentPosition: () => pos,
        setCurrentPosition: (p: number) => {
          pos = target = p;
        },
        runToPosition: () => {
          const n = Math.abs(target - pos);
          pos = target;
          upd();
          return new Block((n * 1_000_000) / Math.max(1, speed));
        },
      });
    }
    case 'Adafruit_NeoPixel': {
      const n = Number(args[0] ?? 1);
      let pin = Number(args[1] ?? -1);
      const px = new Array(n).fill(0);
      let bright = 255;
      return obj(cls, {
        begin: () => {},
        setPin: (p: number) => {
          pin = p;
        },
        show: () => {
          const d = h.findOnPin(pin, ['ws2812', 'ws2812-ring', 'ws2812-strip'], 'DIN');
          if (!d) {
            return;
          }
          d.pixels = px.map((c: number) => {
            const r = ((c >> 16) & 255) * (bright / 255);
            const g = ((c >> 8) & 255) * (bright / 255);
            const b = (c & 255) * (bright / 255);
            return [r, g, b];
          });
          d.version = (d.version ?? 0) + 1;
        },
        setPixelColor: (i: number, r: number, g?: number, b?: number) => {
          if (i < 0 || i >= n) return;
          px[i] = g === undefined ? r : ((r & 255) << 16) | ((g & 255) << 8) | (b! & 255);
        },
        getPixelColor: (i: number) => px[i] ?? 0,
        Color: (r: number, g: number, b: number) => ((r & 255) << 16) | ((g & 255) << 8) | (b & 255),
        ColorHSV: (hue: number, s = 255, v = 255) => {
          const hh = ((hue % 65536) / 65536) * 6;
          const c = (v / 255) * (s / 255);
          const x = c * (1 - Math.abs((hh % 2) - 1));
          const m = v / 255 - c;
          const [r, g, b] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
          return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255);
        },
        gamma32: (c: number) => c,
        setBrightness: (b: number) => {
          bright = b;
        },
        clear: () => px.fill(0),
        fill: (c: number, first = 0, count = n) => {
          for (let i = first; i < Math.min(n, first + count); i++) px[i] = c;
        },
        numPixels: () => n,
      });
    }

    /* ------------------------- Sensoren ------------------------- */
    case 'DHT': {
      const pin = Number(args[0]);
      const dev = () => h.findOnPin(pin, ['dht22', 'dht11'], 'DATA');
      let warned = false;
      const get = (k: 'temperatur' | 'feuchte') => {
        const d = dev();
        if (!d) {
          if (!warned) h.warn(`DHT an Pin ${pin}: kein Sensor gefunden → Messwert „nan“. Prüfe die Datenleitung.`);
          warned = true;
          return NaN;
        }
        if (!d.powered) return NaN;
        return Number(d[k]);
      };
      return obj(cls, {
        begin: () => {},
        readTemperature: (f?: number) => {
          const t = get('temperatur');
          return f ? (t * 9) / 5 + 32 : t;
        },
        readHumidity: () => get('feuchte'),
        computeHeatIndex: (t: number) => t,
      });
    }
    case 'OneWire':
      return obj(cls, { pin: Number(args[0]), reset: () => 1, write: () => {}, read: () => 0, search: () => 0, reset_search: () => {} });
    case 'DallasTemperature': {
      const ow = args[0] as { pin: number } | undefined;
      const dev = () => (ow ? h.findOnPin(ow.pin, ['ds18b20'], 'DQ') : null);
      return obj(cls, {
        begin: () => {},
        requestTemperatures: () => new Block(750_000 / 8),
        getTempCByIndex: () => {
          const d = dev();
          return d && d.powered ? Number(d.temperatur) : -127;
        },
        getTempFByIndex: () => {
          const d = dev();
          return d && d.powered ? (Number(d.temperatur) * 9) / 5 + 32 : -196.6;
        },
        getDeviceCount: () => (dev() ? 1 : 0),
        setResolution: () => {},
      });
    }
    case 'Adafruit_BME280':
    case 'Adafruit_BMP280': {
      let dev: PartState | null = null;
      return obj(cls, {
        begin: (addr?: number) => {
          dev = h.findI2C(['bme280', 'bmp280'], addr);
          return dev ? 1 : 0;
        },
        readTemperature: () => (dev ? Number(dev.temperatur) : NaN),
        readHumidity: () => (dev ? Number(dev.feuchte) : NaN),
        readPressure: () => (dev ? Number(dev.druck) * 100 : NaN),
        readAltitude: (sea = 1013.25) => (dev ? 44330 * (1 - Math.pow(Number(dev.druck) / sea, 0.1903)) : NaN),
        setSampling: () => {},
      });
    }
    case 'sensors_event_t':
      return obj(cls, { acceleration: { x: 0, y: 0, z: 0 }, gyro: { x: 0, y: 0, z: 0 }, temperature: 0 });
    case 'Adafruit_MPU6050': {
      let dev: PartState | null = null;
      return obj(cls, {
        begin: () => {
          dev = h.findI2C(['mpu6050'], undefined);
          return dev ? 1 : 0;
        },
        setAccelerometerRange: () => {},
        setGyroRange: () => {},
        setFilterBandwidth: () => {},
        getEvent: (a: any, g: any, t: any) => {
          const d = dev ?? { ax: 0, ay: 0, az: 9.81, gx: 0, gy: 0, gz: 0, temperatur: 25 };
          if (a) a.acceleration = { x: +d.ax, y: +d.ay, z: +d.az };
          if (g) g.gyro = { x: +d.gx, y: +d.gy, z: +d.gz };
          if (t) t.temperature = +d.temperatur;
          return 1;
        },
      });
    }
    case 'NewPing': {
      const trig = Number(args[0]);
      const echo = Number(args[1]);
      return obj(cls, {
        ping_cm: () => {
          const us = h.findOnPin(echo, ['hc-sr04'], 'ECHO') ? rt.host.pulseIn(echo, 1, 30000) : 0;
          void trig;
          return new Block(us + 100, Math.round(us / 58));
        },
        ping: () => new Block(1000, rt.host.pulseIn(echo, 1, 30000)),
      });
    }
    case 'MFRC522': {
      let shown = '';
      const uid = { size: 4, uidByte: [0, 0, 0, 0] };
      return obj(cls, {
        PCD_Init: () => {},
        PCD_DumpVersionToSerial: () => h.serialWrite('Firmware Version: 0x92 = v2.0\r\n'),
        PICC_IsNewCardPresent: () => {
          const d = h.findAny(['rfid-rc522']);
          if (!d || !d.karte) {
            shown = '';
            return 0;
          }
          if (shown === d.karte) return 0;
          return 1;
        },
        PICC_ReadCardSerial: () => {
          const d = h.findAny(['rfid-rc522']);
          if (!d || !d.karte) return 0;
          shown = String(d.karte);
          const bytes = shown.split(/[ :]/).map((x) => parseInt(x, 16) || 0);
          uid.uidByte = bytes;
          uid.size = bytes.length;
          return 1;
        },
        PICC_HaltA: () => {},
        PCD_StopCrypto1: () => {},
        uid,
      });
    }
    case 'Keypad': {
      const keys = args[0] as number[][] | number[];
      let last = 0;
      return obj(cls, {
        getKey: () => {
          const d = h.findAny(['keypad-4x4', 'keypad-4x3']);
          const k = d?.pressed as string | undefined;
          if (!k) {
            last = 0;
            return 0;
          }
          const code = k.charCodeAt(0);
          if (code === last) return 0;
          last = code;
          void keys;
          return code;
        },
        waitForKey: () => new Block(100_000, 0),
        setDebounceTime: () => {},
      });
    }
    case 'Encoder':
      return obj(cls, { read: () => 0, write: () => {} });
    case 'Bounce':
      return obj(cls, { attach: () => {}, interval: () => {}, update: () => 0, read: () => 0, fell: () => 0, rose: () => 0 });
  }
  return null;
}

/* 5×7-Pixelschrift (klassische Adafruit-GFX-Glyphen für ASCII 32–126) */
const FONT: Record<string, number[]> = {};
const F5 =
  '0000000000005f00000007000700147f147f14242a7f2a12231308646236495522500005030000001c2241000041221c00082a1c2a0808083e080800503000000808080808006060000020100804023e5149453e00427f400042615149462141454b311814127f1027454545393c4a49493001710905033649494936064949291e0036360000005636000008142241001414141414412214080002015109063259795141' +
  '7e1111117e7f494949363e414141227f4141221c7f494949417f090901013e4149497a7f0808087f00417f41002040413f017f081422417f404040407f0204027f7f0408107f3e4141413e7f090909063e4151215e7f09192946464949493101017f01013f4040403f1f2040201f7f2018207f63140814630304780403615149454300007f4141020408102041417f0000040201020440404040400001020400' +
  '2054545478' + '7f48444438' + '3844444420' + '384444487f' + '3854545418' + '087e090102' + '0c5252523e' + '7f08040478' + '00447d4000' + '2040443d00' + '7f10284400' + '00417f4000' + '7c04180478' + '7c08040478' + '3844444438' + '7c14141408' + '081414187c' + '7c08040408' + '4854545420' + '043f444020' + '3c4040207c' + '1c2040201c' + '3c4030403c' + '4428102844' + '0c5050503c' + '4464544c44' + '0008364100' + '00007f0000' + '0041360800' + '0201020402';
(() => {
  for (let i = 0; i < 95; i++) {
    const hex = F5.slice(i * 10, i * 10 + 10);
    if (hex.length < 10) break;
    FONT[String.fromCharCode(32 + i)] = [0, 1, 2, 3, 4].map((k) => parseInt(hex.slice(k * 2, k * 2 + 2), 16));
  }
})();

export function glyph(ch: string): number[] {
  return FONT[ch] ?? FONT['?'] ?? [0, 0, 0, 0, 0];
}

