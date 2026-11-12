// Lädt die ESP32-Werkzeuge genau so wie Einstellungen → Emulatoren (für den Windows-Test in GitHub Actions).
// Aufruf: electron e2e/esp32-werkzeuge.cjs   (Zielordner über OHM_ESP32_TOOLS)
const { app } = require('electron');
const esp32 = require('../electron/esp32.cjs');
app.whenReady().then(async () => {
  let last = '';
  try {
    const st = await esp32.install((p) => {
      const line = `${p.text} ${Math.round(p.frac * 100)} %`;
      if (line.slice(0, 30) !== last.slice(0, 30) || p.frac === 1) console.log(line);
      last = line;
    });
    console.log('Status:', JSON.stringify(st));
    app.exit(st.cli && st.core && st.riscv32 && st.xtensa ? 0 : 1);
  } catch (e) {
    console.error('Installation fehlgeschlagen:', e.message);
    app.exit(1);
  }
});
