# Ohm Studio by Nodaris – Was alles drin ist

Stand: **Version 2.0.0** · Windows-Programm `OhmStudio-2.0.0-portable.exe` (portabel, ca. 100 MB, ohne Installation per Doppelklick startbar)

---

## Neu in Version 2.0 (Kurzüberblick)

| Bereich | Was drin ist | Wo im Programm |
|---|---|---|
| **Marke** | Ohm Studio by Nodaris, neues Logo, App-ID `com.nodaris.ohmstudio` | Über-Dialog |
| **Kabel** | Gerade 90°/45°-Leitungen mit automatischer Wegsuche, Knickpunkte, Brückenbögen; alte Projekte werden umgestellt | Steckbrett, Schaltplan (Leiste oben links) |
| **3D-Platine** | Fotorealistisch: Lötstopplack, ENIG/HASL, Masseflächen, Vias, Werkbank, Röntgen, Explosion, Foto 4K, 360°-Video | Platine → 3D |
| **Echte Emulatoren** | AVR-Maschinencode (.hex), RP2040 (.uf2), **echtes MicroPython 1.24**, Debugger mit Haltepunkten, Registern, Speicher | Code-Tab: Sprache wählen; Tab „Debugger“ |
| **Profi-Platine** | ERC, DRC mit JLCPCB/PCBWay/Aisler/Eurocircuits/Würth, Autorouter mit Vias, 1–32 Lagen, Impedanzrechner, Varianten, automatisches Platzieren | Platine, Menü „Lagenaufbau“ |
| **Fertigung** | Fertigungspaket: Gerber X2, Bohrdaten, Pick & Place, Bestückungs-PDF, IPC-2581, ODB++, STEP, Testpunkte | Reiter Datei → Exportieren |
| **Einkauf** | Teilenummern, Lebenszyklus, RoHS/REACH, Staffelpreise 1/100/1000/10000, Alternativen, Richtpreise von 5 Fertigern; Live-Preise nur mit Zustimmung | Exportieren & bestellen |
| **Pläne & Lizenz** | Free/Plus/Pro/Team/Enterprise, signierte Lizenzschlüssel, 14 Tage Offline, 14 Tage Pro-Test. In dieser Vorschau ist **alles freigeschaltet** | Mehr → Konto & Pläne |
| **Team** | Versionen mit visuellem Vergleich, Kommentare an Bauteilen, Freigabe-Workflow, Rollen, Live-Zusammenarbeit | Mehr → Versionen, Review & Team |
| **Firmen** | Eigener Server (Docker/Kubernetes): SSO, Zwei-Faktor, SCIM, verschlüsselter Speicher, Audit-Log, Update-Kanäle, Richtlinien | Mehr → Einstellungen & Firmenserver; `docs/SELF-HOSTING.md` |
| **Analysen** | Wärmebild, Monte Carlo + Worst-Case, FMEA mit echter Fehlersimulation, Lebensdauer/MTBF, Power- & Signalintegrität, EMV | Mehr → Analysen |
| **KI** | Schaltungs-Review, Bauteil-Vorschläge, Datenblatt-Leser (PDF → Bauteil), Code-Assistent (mit eigenem Claude-Schlüssel; Review auch ohne) | Mehr → KI-Werkzeuge |
| **Gehäuse** | Passendes Gehäuse mit Ausschnitten, Schraubdomen, Knopf-Verlängerungen; STL + STEP; Kollisionsprüfung | Mehr → Gehäuse |
| **Lernen** | Kurs „Elektronik in 30 Lektionen“ mit automatischer Prüfung, Klassenräume | Mehr → Lernen & Klassenraum |
| **Bibliothek** | 199 Bauteiltypen, **10 081 Bestellvarianten** (z. B. „widerstand 4,7k 0805“) | Bibliothek links |
| **Sprachen & Zugang** | 10 Sprachen (Menüs), Farbenblind-Modus, Skalierung, hoher Kontrast | Einstellungen → Sprache & Barrierefreiheit |
| **Kommandozeile** | `check`, `test`, `drc`, `analyse`, `export fertigung` – für CI | `docs/API.md` |
| **Dokumente** | Website, Handbuch, Rechtstext-**Entwürfe** (vor Nutzung anwaltlich prüfen lassen!), Betreiber-Checkliste | `website/`, `docs/`, `rechtliches/` |

Noch offen (ehrlich): STM32/Raspberry-Pi-Linux als echte Emulatoren (nur Erkennung installierter QEMU/Renode); echter ESP32 gibt es seit 3.0 im Windows-Programm (ESP32 und ESP32-C3, ohne WLAN und I²C-/SPI-Geräte), nativer SAML-Endpunkt, vollständige Übersetzung aller Dialoge, Herstellermodelle in 3D, echte Bezahlung und Lizenzserver (braucht Gewerbe/Verträge).

Die folgenden Abschnitte beschreiben die Grundfunktionen aus Version 0.1, die alle weiter enthalten sind.

---

## 1. Das Programm

| | |
|---|---|
| **Art** | Desktop-Programm für Windows (`.exe`, portabel). Mac und Linux lassen sich aus demselben Code bauen. |
| **Start** | Doppelklick auf `Ohm Studio.exe`, keine Installation nötig |
| **Offline** | Läuft komplett ohne Internet. Nur der KI-Assistent und HTTP-Anfragen aus Sketches brauchen eine Verbindung. |
| **Erster Start** | Die `.exe` ist nicht digital signiert. Windows SmartScreen fragt deshalb einmal nach: **„Weitere Informationen“ → „Trotzdem ausführen“**. |
| **Speichern** | Projekte als `.ohm`-Datei; zusätzlich automatisches Zwischenspeichern |

---

## 2. Oberfläche („so wie Apple es machen würde“)

- **Links: Bauteil-Bibliothek** mit Suche. Die Suche versteht Eingaben wie „widerstand 1k“, „esp32 c3“ oder „led rot“ und füllt den Wert gleich vor. Bauteile zieht man auf die Fläche oder fügt sie per Doppelklick ein.
- **Mitte: Arbeitsfläche** mit drei umschaltbaren Ansichten derselben Schaltung:
  - **Steckbrett:** realistische Bauteile, weich durchhängende Kabel, Teile rasten im Steckbrett ein
  - **Schaltplan:** Symbole nach **IEC oder ANSI** umschaltbar, zeigt während der Simulation die Spannungen an
  - **Platine:** 2D mit Lötstopplack in 6 Farben, Gold- oder Silberpads und Bestückungsdruck, dazu eine **3D-Ansicht** zum Drehen
- **Rechts: Inspektor.** Er zeigt Werte, Live-Messwerte (Spannung, Strom, Leistung, Helligkeit), alle Pins mit Netz und Spannung, ein Datenblatt in Kurzform, den Preis und Bestelllinks.
- **Unten (einklappbar):** Code-Editor, Serieller Monitor, Messgeräte, Meldungen, Tests
- **Oben:** Menüleiste mit Reitern (Datei · Start · Simulation · Platine & Fertigung · Analyse & KI · Team · Einstellungen · Hilfe) im CAD-Stil; im Reiter Start: Leeres Projekt, Neues Projekt aus Idee, ▶ Start / ⟲ Reset / ■ Stopp, Geschwindigkeit (0,1× bis 10×)
- **Hell- und Dunkelmodus** (folgt dem System), Schrift Inter, eine Akzentfarbe (#0A84FF), Glas-Seitenleisten
- **Bedienung:**
  - Kabel ziehen: auf einen Pin klicken, dann auf einen zweiten
  - Fährt man mit der Maus über einen Pin, erscheint seine Spannung
  - Rückgängig und Wiederholen
  - Tastenkürzel (Leertaste, Strg+N/O/S, Strg+Umschalt+S, Strg+Z/Y/D, R, Entf, F, 1/2/3, F11, Esc) – Liste über Reiter Einstellungen/Hilfe → „Tastenkürzel“, Kürzel auch im Hinweistext jedes Knopfs

---

## 3. Bauteil-Bibliothek – 157 Teile

### Mikrocontroller (35)
- **Arduino:** Uno R3, Uno R4 Minima, Uno R4 WiFi, Leonardo, Mega 2560, Nano, Nano Every, Nano ESP32, Pro Mini 5V, Micro, ATtiny85 (Digispark)
- **Espressif:** ESP32 DevKit V1, ESP32-S2 Mini, ESP32-S3 DevKitC, **ESP32-C3 SuperMini**, ESP32-C3 DevKitM-1, ESP32-C5, ESP32-C6, ESP32-H2, ESP32-P4, ESP8266 NodeMCU
- **Raspberry Pi Mikrocontroller:** Pico, Pico W, Pico 2, Pico 2 W
- **Weitere:** STM32 Blue Pill, STM32 Nucleo-F401RE, nRF52840 (nice!nano), Teensy 4.0/4.1, Seeed XIAO ESP32C3 / ESP32S3 / RP2040 / nRF52840 / SAMD21

Alle Boards haben echte Pinbelegung, eine Onboard-LED, anklickbare RESET- und BOOT-Tasten, USB- oder Batterieversorgung über den eingebauten Spannungsregler und einen Stromverbrauch, der vom Zustand abhängt (aktiv, WLAN, Deep-Sleep).

### Computer (4)
Raspberry Pi Zero 2 W, Pi 3 B+, Pi 4 B, Pi 5. Sie haben einen 40-Pin-GPIO-Header und einen virtuellen HDMI-Monitor mit Boot-Log, Desktop und Terminal (siehe Abschnitt 6).

### Passive Bauteile (12)
Widerstand (Farbringe werden automatisch aus dem Wert berechnet, 4 oder 5 Ringe), Potentiometer, Trimmer, LDR, NTC, PTC, Keramik-, Folien- und Elektrolytkondensator, Spule, Quarz, Sicherung

### Halbleiter (27)
- **Dioden:** 1N4148, 1N4007, Schottky 1N5819, Z-Diode
- **LEDs:** 11 Farben, 3 und 5 mm, RGB-LED, NeoPixel einzeln, als Ring (12) und als Streifen (8)
- **Transistoren:** S8050, BC547, 2N2222, 2N3904, BC557, S8550, 2N3906, TIP120
- **MOSFETs:** IRLZ44N, IRF520, AO3400, 2N7000, IRF9540
- **Regler:** 7805, AMS1117-3.3/-5.0, HT7333
- **Optokoppler:** PC817

### ICs (14)
NE555, LM358, 74HC595, 74HC00/08/32/86/04, CD4017, EEPROM 24C256, L298N, DRV8833, A4988, Pegelwandler BSS138

### Ein-/Ausgabe (16)
Taster, Schiebeschalter, Reedkontakt mit verschiebbarem Magnet, Summer (aktiv und passiv, **hörbar**), Lautsprecher, Relaismodul (klickt hörbar), DC-Motor, Vibrationsmotor, Joystick, Drehencoder, Tastenfeld 4×4 und 4×3, Servo SG90 und MG996R, Schrittmotor 28BYJ-48

### Displays (10)
LCD 16×2 und 20×4 (I²C), OLED SSD1306 und SH1106, TFT ILI9341 und ST7789, E-Paper, 7-Segment, TM1637, LED-Matrix MAX7219

### Sensoren (14)
DHT22, DHT11, BME280, DS18B20, HC-SR04, PIR, MPU6050, Hall-Sensor, Mikrofon, Bodenfeuchte, Lichtsensor TEMT6000, Gas MQ-2, GPS NEO-6M, RFID RC522

Die Messwerte (Temperatur, Abstand, Bewegung, Feuchte …) stellt man während der Simulation mit Schiebereglern ein.

### Funk (5)
BLE-Beacon-Anhänger, nRF24L01+, LoRa SX1278, IR-Empfänger, WLAN-Router (virtuell)

### Stromversorgung (12)
Batteriehalter (1–4× AA/AAA/18650), AA, AAA, 18650, LiPo, CR2032, 9-V-Block. Alle Batterien haben eine **Entladekurve** und einen Innenwiderstand. Dazu USB-Netzteil, Labornetzteil (CV/CC), Solarzelle, Buck-Wandler LM2596, Boost-Wandler MT3608.

### Messgeräte (5)
Multimeter (V, A, Ω, Durchgangspiepser), Oszilloskop mit 4 Kanälen, Logikanalysator mit 8 Kanälen, Funktionsgenerator, **Strommessung über Zeit mit Schätzung der Akkulaufzeit**

### Aufbau (3)
Steckbrett mit 830 und mit 400 Kontakten, Drahtbrücke

---

## 4. Simulation

- **Elektrisch korrekt:** eigener Schaltungslöser (Modified Nodal Analysis mit Newton-Raphson) für Widerstände, Kondensatoren, Spulen, Dioden und LEDs, Transistoren, MOSFETs, Spannungsregler und Operationsverstärker
- **Realistische Effekte:**
  - Die Helligkeit einer LED hängt vom echten Strom ab, mit Glow-Effekt.
  - Zu viel Strom: Die LED **brennt durch**, mit Rauchwolke.
  - Ein falsch gepolter Elko löst eine Warnung aus und **platzt** im Extremfall.
  - Widerstände überhitzen, Sicherungen lösen aus.
  - Überlastete GPIO-Pins werden gemeldet, 5 V an einem ESP32-Pin ebenfalls.
- **Realismus-Modus:** Tasterprellen, Rauschen, Messungenauigkeiten
- **Lernmodus:** Strom fließt sichtbar als animierte Punkte durch die Kabel, Spannungen erscheinen als Farbverlauf.
- **Ton:** Summer, Lautsprecher, Relais-Klicks und Motorengeräusche sind wirklich zu hören.
- **Fehler in normaler Sprache**, z. B. „Die LED hat keinen Vorwiderstand – sie würde sofort kaputtgehen“

---

## 5. Mikrocontroller-Code

- **Arduino-C++** läuft zeitgenau zusammen mit der Schaltung.
- **Code-Editor** mit Syntaxhervorhebung, Zeilennummern, Auto-Einrückung und Fehlermarkierung in der betroffenen Zeile. Die Meldungen sind auf Deutsch, z. B. „Zeile 12: Hier fehlt ein Semikolon“.
- **Serieller Monitor** zum Lesen und Senden
- **Unterstützt:**
  - Standardfunktionen: `pinMode`, `digitalWrite/Read`, `analogRead/Write`, `delay`, `millis`
  - Interrupts, `tone`, `pulseIn`, `shiftOut`, `sprintf`, `String`
  - ESP32-spezifisch: `ledc*`, **Deep-Sleep** mit Timer- und GPIO-Wecker, Preferences/EEPROM (überleben einen Neustart)
- **Boardgenau:** 16-Bit-`int` auf Arduino (Überlauf wie in echt), 10- bzw. 12-Bit-ADC, interne Pull-ups
- **Nachgebildete Bibliotheken:** Serial, Wire, SPI, WiFi, HTTPClient (echte Internetanfragen), **BLEDevice** (Scan, Werbung, BLE zwischen simulierten Geräten), Preferences, EEPROM, LiquidCrystal(_I2C), Adafruit_SSD1306 / SH1106G / ILI9341 / ST7789, LedControl, TM1637Display, Servo / ESP32Servo, Stepper / AccelStepper, Adafruit_NeoPixel, DHT, OneWire + DallasTemperature, Adafruit_BME280 / BMP280, Adafruit_MPU6050, NewPing, MFRC522, Keypad

---

## 6. Raspberry Pi

- Virtueller HDMI-Monitor in einem eigenen Fenster: Boot-Log, Raspberry-Pi-OS-Desktop, Terminal
- Terminal-Befehle: `pinctrl set/get`, `gpio readall`, `uname`, `hostname -I`, `vcgencmd`
- Damit lassen sich die GPIOs der Schaltung direkt schalten und lesen.
- *Hinweis:* Das ist eine Nachbildung. Ein echter Linux-Boot (QEMU) ist noch nicht eingebaut.

---

## 7. Das `.ohm`-Format

Ein komplettes Projekt steht in **einer lesbaren Textdatei** (YAML): Bauteile, Verkabelung, Platinenlayout, Code und Tests.

- **Prüfung beim Öffnen** mit verständlichen Meldungen, z. B. „Meintest du ‚widerstand‘?“, „Hat keinen Pin X, vorhanden sind: …“
- **Verzeiht Ungenauigkeit:** Fehlende Positionen werden automatisch gesetzt, englische Schlüsselwörter werden ebenfalls verstanden.
- **Testschritte laufen automatisch:** Sätze wie „SW2 drücken“, „TAG1.entfernung = 20m“ oder „MAG1 wegziehen“ und Erwartungen wie „D1 blinkt 5x“ oder „BZ1 piept innerhalb von 3s“ werden simuliert und geprüft.
- **Mitgeliefert:**
  - `OHM_FOR_AI.md`: Anleitung, die man einem Chatbot mitgibt
  - `ohm.schema.json`: JSON-Schema
  - Kommandozeile: `npm run ohm -- types | check | test | export`
- **Öffnen:** Doppelklick auf eine `.ohm`-Datei (beim Installer), über das Menü oder per Drag & Drop ins Fenster

---

## 8. Export und Bestellen

| Export | Wofür |
|---|---|
| `.ohm` | Projekt teilen oder an eine KI geben |
| **Gerber (ZIP)** | Kupfer oben/unten, Lötstopp, Bestückungsdruck, Umriss, Bohrdatei. Direkt bei JLCPCB, PCBWay oder Aisler hochladbar. |
| **Stückliste (CSV)** | mit Preisen und Suchlinks zu Reichelt, Mouser und AliExpress |
| KiCad-Netzliste | Weiterarbeiten in KiCad |
| Wokwi `diagram.json` | für den Online-Simulator Wokwi |
| SPICE-Netzliste | für ngspice oder LTspice |
| **Als Link teilen** | Das ganze Projekt steckt in der URL. |

Links zu den Platinenherstellern stehen im Export-Dialog. Der Upload selbst geschieht manuell.

---

## 9. KI-Assistent

- Beschreibung eintippen, z. B. „Bau mir einen Feuchtigkeitssensor für Pflanzen“. Der Assistent erzeugt ein vollständiges `.ohm`-Projekt, öffnet es und **startet die Simulation**.
- Mit eigenem Claude-API-Schlüssel (Modell `claude-opus-5-5`) baut er individuell. Der Schlüssel bleibt auf dem eigenen Rechner.
- Ohne Schlüssel öffnet er eine passende Vorlage aus den Beispielen.

---

## 10. Beispielprojekte (10)

| Projekt | Inhalt |
|---|---|
| **Schlüssel-Türwächter** | ESP32-C3 SuperMini, Reedkontakt und Magnet, BLE-Anhänger, Summer über S8050, Lerntaste, Deep-Sleep |
| Blink | Arduino Uno + LED, das erste Programm |
| Pflanzenwächter | ESP32, Bodenfeuchtesensor, OLED mit Balkenanzeige, Warn-LED |
| Nachtlicht ohne Code | LDR + Transistor + LED |
| Fußgängerampel | Arduino Nano, 4 LEDs, Taster mit Interrupt, Summer |
| Raumthermometer | DHT22 + LCD 16×2 |
| Servo per Drehknopf | Raspberry Pi Pico, Potentiometer, SG90 |
| Lauflicht | Arduino + 74HC595 + LEDs |
| 555-Blinker | NE555 als Taktgeber, ganz ohne Mikrocontroller |
| Einpark-Abstandswarner | HC-SR04 + Summer, piept schneller, je näher das Hindernis ist |

Alle Beispiele bestehen ihre eingebauten Tests automatisch.

---

## 11. Qualität

- **26 automatische Tests:** Schaltungslöser, Arduino-Kopplung, `.ohm`-Format, NeoPixel, Steckbrett und alle 10 Beispiele. Alle bestanden.
- Schneller Start: Die Oberfläche ist rund 250 kB groß (komprimiert), der KI-Teil wird erst bei Bedarf geladen.

---

## 12. Was (noch) fehlt

- Echte Emulatoren (simavr, QEMU-ESP32, rp2040js). Der Code wird übersetzt, nicht als Maschinencode ausgeführt.
- Echter Linux-Boot für den Raspberry Pi (QEMU)
- MicroPython
- Fritzing-Export, direkter Upload zum Platinenhersteller
- Teile automatisch *auf* das Steckbrett setzen. Bisher werden sie daneben platziert und verkabelt.
- Digitale Signatur der `.exe`, damit SmartScreen nicht mehr nachfragt
- Installer-Version (`Setup.exe`). Sie wird nur auf Windows gebaut, über den GitHub-Workflow „Ohm Studio – Windows-Programm bauen“.

Details zu den Entscheidungen stehen in `ENTSCHEIDUNGEN.md`, der Arbeitsstand in `FORTSCHRITT.md`.

## Neu in 3.0
- **Neues Projekt aus Idee** (Assistent mit Selbstprüfung bis zur Bestellanleitung), **Einführungstour**, **Community-Galerie** mit Remix (braucht Server), **Teilen-Link mit Vorschau**, **KiCad-7/8/9- und Altium-Import**, **echter ESP32/ESP32-C3** im Windows-Programm.
