# .ohm – Anleitung für KIs

Gib diese Datei einem Chatbot mit. Dann kann er komplette Elektronikprojekte für **Ohm Studio** schreiben, die man nur öffnen muss: Bauteile, Verkabelung, Platinenlayout, Code und Tests in **einer** YAML-Datei.

## Aufbau

```yaml
ohm: 1                       # Formatversion, immer 1
projekt:
  name: Kurzer Name
  autor: Wer
  beschreibung: Ein Satz, was das Gerät tut.

teile:                       # ID: { typ: …, Eigenschaften … }
  U1: { typ: esp32-c3-supermini }
  R1: { typ: widerstand, wert: 220 }
  D1: { typ: led, farbe: rot }

netze:                       # NAME: [TEIL.PIN, TEIL.PIN, …]
  LED:  [U1.IO6, R1.1]
  LEDA: [R1.2, D1.A]
  GND:  [D1.K, U1.GND]

ansichten:                   # optional
  steckbrett: auto
  platine: { groesse: 50x30mm, lagen: 2, farbe: gruen }

code:                        # Arduino-C++ für ein Board
  ziel: U1
  sprache: arduino
  datei: |
    void setup() { pinMode(6, OUTPUT); }
    void loop() { digitalWrite(6, HIGH); delay(500); digitalWrite(6, LOW); delay(500); }

test:                        # was man sehen/hören soll
  - schritt: Simulation starten
    erwartet: D1 blinkt mindestens 3x innerhalb von 4s
```

## Regeln

1. **Nur Bauteiltypen aus der Bibliothek** (Liste: `npm run ohm -- types`). Unbekannte Typen sind ein Fehler.
2. **Pins immer als `TEIL.PIN`.** Pinnamen stehen in der Typliste (z. B. `U1.IO3`, `U1.D13`, `U1.GP15`, `R1.1`, `D1.A`, `D1.K`, `Q1.B`, `BAT1.+`).
3. **Jedes Netz hat mindestens zwei Pins.** Das Masse-Netz heißt `GND`.
4. **Code vollständig** in `code.datei` – kein „…“, keine Platzhalter.
5. **Tests** beschreiben in einfachen Sätzen, was passieren soll.
6. Positionen sind optional; fehlen sie, platziert Ohm Studio automatisch (`pos: [x, y]` in mm, `dreh: 90`).

## Elektrische Regeln, die Ohm Studio prüft

- Jede LED braucht einen **Vorwiderstand** (5 V: ~220 Ω, 3,3 V: ~100 Ω).
- GPIO-Pins liefern max. ~20 mA. Summer, Relais, Motoren über **Transistor** (z. B. `S8050`, Basiswiderstand 1 kΩ) oder Treiber (`l298n`, `drv8833`).
- ESP32 und Pico sind **nicht 5-V-tolerant** – Pegelwandler (`pegelwandler`) oder Spannungsteiler.
- Taster: `pinMode(pin, INPUT_PULLUP)` und gegen `GND` schalten → gedrückt = `LOW`.
- Boards werden automatisch per USB versorgt. Hängt eine Batterie/ein Netzteil an `5V`/`VIN`, ist USB aus.
- Elkos sind gepolt (`C1.+`, `C1.-`).

## Testsätze, die automatisch geprüft werden

| Schritt | Erwartung |
|---|---|
| `SW1 drücken` | `D1 blinkt 5x` · `D1 blinkt mindestens 3x innerhalb von 4s` |
| `TEIL.eigenschaft = wert` (z. B. `TAG1.entfernung = 20m`) | `BZ1 piept innerhalb von 3s` |
| `MAG1 wegziehen` / `MAG1 heranziehen` | `D1 leuchtet` · `D1 ist aus` |
| `SW1 einschalten` / `ausschalten` | `LCD zeigt "Hallo"` |
| `warte 2s` | `Serial zeigt "Bereit"` |

## Unterstützte Arduino-Bibliotheken (Simulation)

Serial, Wire, SPI, WiFi, HTTPClient, BLEDevice (Scan, Werbung), Preferences, EEPROM, LiquidCrystal_I2C, Adafruit_SSD1306 / SH1106G, Adafruit_ILI9341 / ST7789, LedControl, TM1637Display, Servo / ESP32Servo, Stepper / AccelStepper, Adafruit_NeoPixel, DHT, OneWire + DallasTemperature, Adafruit_BME280 / BMP280, Adafruit_MPU6050, NewPing, MFRC522, Keypad, sowie ESP32-Deep-Sleep (`esp_deep_sleep_start`, Timer- und GPIO-Wecker), `ledc*`, `tone`, `attachInterrupt`, `pulseIn`, `shiftOut`, `millis`, `sprintf`.

Nicht unterstützt: eigene `struct`/`class`-Definitionen, Zeiger-Arithmetik, Referenzparameter (`int &x`) – nutze globale Variablen.
