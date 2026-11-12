# Ohm Studio

**Elektronik bauen und simulieren, bevor man ein einziges Teil kauft.**

Ohm Studio ist ein Elektronik-Simulator mit realistisch aussehenden Bauteilen, echtem Arduino-Code und elektrisch korrekter Schaltungsberechnung – und mit `.ohm`, einem Dateiformat, in dem eine KI ein komplettes Projekt (Bauteile, Verkabelung, Platine, Code, Tests) als **eine** Textdatei ausgeben kann.

## Installieren (Windows)

**`OhmStudio-…-portable.exe`** herunterladen und doppelklicken – keine Installation nötig. Alternativ der Installer **`OhmStudio-…-Setup.exe`** (mit Startmenü-Eintrag und Verknüpfung für `.ohm`-Dateien).

Beide Dateien baut der GitHub-Workflow „Ohm Studio – Windows-Programm bauen“ bei jedem Push (Reiter *Actions* → letzter Lauf → *Artifacts*). Hinweis: Die .exe ist nicht digital signiert; Windows SmartScreen fragt daher beim ersten Start nach („Weitere Informationen“ → „Trotzdem ausführen“).

## Selbst bauen

```bash
npm install
npm run app          # Desktop-App starten (Electron)
npm run dist:win     # Windows: release/OhmStudio-…-portable.exe
npm run dist:win:all # Windows: zusätzlich Installer (braucht Windows oder Wine)
npm run dist:mac     # macOS: .dmg (auf einem Mac)
npm run dist:linux   # Linux: AppImage
npm test             # Simulations-, Format- und Beispieltests
npm run dev          # Entwicklungsmodus im Browser
```

## Was es kann

- **Drei Ansichten derselben Schaltung:** Steckbrett (realistisch, Kabel hängen weich durch), Schaltplan (IEC/ANSI umschaltbar), Platine (2D mit Gold/Silber-Pads und wählbarem Lötstopplack, plus 3D-Ansicht).
- **157 Bauteile:** 39 Boards (Arduino Uno/R4/Nano/Mega/Leonardo/Pro Mini/Micro, ATtiny85, ESP32 · S2 · S3 · C3 · C3 SuperMini · C5 · C6 · H2 · P4, ESP8266, Pico/Pico W/Pico 2/2 W, STM32, nRF52840, XIAO-Serie, Teensy 4.x, Raspberry Pi Zero 2 W/3/4/5), Passive, Halbleiter, ICs (555, LM358, 74HC595, Logikgatter, CD4017, Motortreiber, Pegelwandler), Displays (LCD, OLED, TFT, 7-Segment, MAX7219, TM1637), Sensoren (DHT, BME280, DS18B20, HC-SR04, PIR, MPU6050, Hall, Mikrofon, Bodenfeuchte, Gas, RFID …), WS2812-NeoPixel (einzeln, Ring, Streifen), Funk (BLE-Beacon, WLAN-Router, nRF24, LoRa, IR), Stromversorgung mit **Entladekurven** (AA, AAA, 18650, LiPo, CR2032, 9 V, USB, Labornetzteil, Solar, Buck/Boost) und Messgeräte (Multimeter, Oszilloskop, Logikanalysator, Funktionsgenerator, Strommessung mit **Akkulaufzeit-Schätzung**).
- **Elektrisch korrekt:** Schaltungslöser nach Modified Nodal Analysis mit Newton-Raphson (Dioden/LEDs, BJTs, MOSFETs, Regler, OpAmps, Kondensatoren, Spulen). LEDs leuchten abhängig vom echten Strom und **brennen durch** (mit Rauchwölkchen), Elkos platzen bei Verpolung, Widerstände überhitzen.
- **Echter Code:** Arduino-C++ wird übersetzt und läuft zeitgenau mit der Schaltung (delay, millis, Interrupts, PWM, tone, pulseIn, shiftOut, Deep-Sleep, BLE-Scan, WLAN, HTTP …), inklusive Nachbildungen gängiger Bibliotheken. Fehler werden auf Deutsch erklärt („Zeile 12: Hier fehlt ein Semikolon“).
- **Man hört es:** Summer, Lautsprecher, Relais-Klicks, Motoren.
- **Lernmodus:** Strom fließt als animierte Punkte, Spannungen als Farbverlauf.
- **KI-Assistent:** „Bau mir einen Feuchtigkeitssensor für Pflanzen“ → `.ohm` wird erzeugt, geöffnet und simuliert (Claude API mit eigenem Schlüssel, offline mit Vorlagen).
- **Tests aus der Datei:** Sätze wie „SW2 drücken“ / „D1 blinkt 5x“ werden automatisch ausgeführt und geprüft.
- **Export:** Gerber (ZIP mit Bohrdatei, direkt bei JLCPCB/PCBWay/Aisler hochladbar), Stückliste als CSV mit Preisen und Bestelllinks, KiCad-Netzliste, Wokwi `diagram.json`, SPICE-Netzliste, Teilen als Link.

## Das .ohm-Format

Siehe [`OHM_FOR_AI.md`](OHM_FOR_AI.md) (Anleitung, die man einem Chatbot mitgibt), [`ohm.schema.json`](ohm.schema.json) und [`examples/`](examples/). Kommandozeile:

```bash
npm run ohm -- types                         # alle Bauteiltypen
npm run ohm -- check examples/blink.ohm      # Datei prüfen
npm run ohm -- test  examples/schluessel-tuerwaechter.ohm
npm run ohm -- export examples/blink.ohm gerber
```

## Aufbau

| Ordner | Inhalt |
|---|---|
| `src/sim` | Schaltungslöser (`mna.ts`), Engine mit MCU-Kopplung, Testläufer |
| `src/mcu` | Arduino-Übersetzer, Laufzeit, Bibliotheks-Nachbildungen |
| `src/parts` | Boards und Bauteilbibliothek (Grafik, Pins, Verhalten, Datenblatt, Preis) |
| `src/ohm` | Datenmodell, Laden/Prüfen/Platzieren/Speichern |
| `src/views` | Steckbrett, Schaltplan, Platine (2D/3D) |
| `src/export` | Gerber, KiCad, Wokwi, SPICE, Stückliste |
| `src/ui` | Toolbar, Bibliothek, Inspektor, Code-Editor, Panels, KI-Assistent |

Getroffene Entscheidungen (z. B. Web-App statt Tauri, eigener Löser statt ngspice) stehen in [`ENTSCHEIDUNGEN.md`](ENTSCHEIDUNGEN.md), der Stand in [`FORTSCHRITT.md`](FORTSCHRITT.md).
