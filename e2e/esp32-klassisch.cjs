// Test klassischer ESP32 (Xtensa, zwei Kerne) im echten Modus: Pins, ADC, Deep-Sleep mit EXT0-Wecker und
// RTC-Variable über mehrere Aufwach-Zyklen. Aufruf: electron e2e/esp32-klassisch.cjs  (OHM_ESP32_TOOLS)
const { app, ipcMain } = require('electron');
const esp32 = require('../electron/esp32.cjs');
const code = `RTC_DATA_ATTR int zaehler = 0;
void setup() {
  Serial.begin(115200);
  pinMode(2, OUTPUT);
  digitalWrite(2, HIGH);
  zaehler++;
  Serial.printf("wach grund=%d zaehler=%d adc=%d\\n", (int)esp_sleep_get_wakeup_cause(), zaehler, analogRead(34));
  esp_sleep_enable_ext0_wakeup(GPIO_NUM_33, 0);
  delay(300);
  esp_deep_sleep_start();
}
void loop() {}
`;
const t0 = Date.now();
const T = () => ((Date.now() - t0) / 1000).toFixed(1);
let serial = '';
const bridge = [];
const inp = (l) => ipcMain.emit('ohm:esp32:bridge', {}, 't', l);
const wc = {
  isDestroyed: () => false,
  send: (_ch, ev) => {
    if (ev.type === 'serial') {
      serial += ev.text;
      for (const l of ev.text.split('\n')) if (/wach|Guru/.test(l)) console.log(T(), 'seriell |', l.trim());
    } else if (ev.type === 'bridge') {
      bridge.push(ev.line);
      if (ev.line[0] === 'H') (inp('I ffffffffff'), inp('A 34 2048'));
      if (ev.line[0] === 'Z')
        setTimeout(() => {
          inp('I fdffffffff'); // GPIO 33 auf LOW → wecken
          setTimeout(() => inp('I ffffffffff'), 800);
        }, 1500);
    } else console.log(T(), ev.type, (ev.text || '').slice(0, 200));
  },
};
app.whenReady().then(async () => {
  esp32.register();
  await esp32.start('t', 'ESP32', code, wc);
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline && !/zaehler=3/.test(serial)) await new Promise((r) => setTimeout(r, 250));
  esp32.stop('t');
  const ok = [
    ['Programm läuft (erster Start)', /wach grund=0 zaehler=1 adc=2048/.test(serial)],
    ['digitalWrite über die Brücke', bridge.includes('O 2 1')],
    ['Deep-Sleep mit EXT0-Wecker gemeldet', bridge.some((l) => /^Z 200000000 0 0$/.test(l))],
    ['Aufgewacht durch EXT0, RTC-Variable erhalten', /wach grund=2 zaehler=2/.test(serial)],
    ['Zweites Aufwachen', /wach grund=2 zaehler=3/.test(serial)],
  ];
  for (const [n, v] of ok) console.log(v ? '✓' : '✗', n);
  const pass = ok.every(([, v]) => v);
  console.log(pass ? '\nKlassischer ESP32 im echten Modus: bestanden' : '\nKlassischer ESP32 im echten Modus: NICHT bestanden');
  app.exit(pass ? 0 : 1);
});
