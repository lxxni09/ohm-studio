# Ohm Studio by Nodaris – aktueller Stand

**Version 2.0.0** · Stand 11.11.2026 · Windows-Programm `OhmStudio-2.0.0-portable.exe` (ca. 100 MB, Doppelklick, keine Installation)

Ohm Studio ist ein Programm, um Elektronik zu entwerfen, mit echtem Code zu simulieren und fertig zur Fertigung zu exportieren. Es läuft komplett offline, ohne Werbung und ohne Tracker.

---

## 1. Überblick in Zahlen

| | |
|---|---|
| Bauteiltypen (simulierbar) | 199 |
| Bestellvarianten im Katalog | 10 081 (mit Teilenummern) |
| Beispielprojekte | 10 |
| Lektionen im Kurs | 30 |
| Sprachen | 10 |
| Automatische Tests | 65, alle grün |
| Testabdeckung Simulationskern | 81,9 % |
| Rechenzeit großes Projekt | 10 000 Bauteile ≈ 34 ms pro Schritt |
| Plattformen | Windows (fertig gebaut), macOS, Linux, Web-App (auch iPad/iPhone/Android) |

---

## 2. Arbeiten im Programm

**Oberfläche:** Bibliothek links, Arbeitsfläche in der Mitte, Inspektor rechts, unten Code/Serieller Monitor/Messgeräte/Meldungen/Tests/Debugger. Hell- und Dunkelmodus, Apple-Stil, Akzentfarbe #0A84FF.

**Drei Ansichten derselben Schaltung:**
- **Steckbrett** – realistische Bauteile, Kabel gerade (90°, 45°, direkt oder weich), automatische Wegsuche um Bauteile herum, Knickpunkte per Doppelklick, Brückenbögen an Kreuzungen, Stil je Netz
- **Schaltplan** – IEC- oder ANSI-Symbole, Raster, Netzlabels, GND- und Versorgungssymbole
- **Platine** – 2D und **fotorealistisches 3D** (Lötstopplack in 8 Farben inkl. matt, ENIG/HASL/OSP/Silber/Zinn, Massefläche mit Thermals, Vias, FR4-Kante, Bauteile mit Lötstellen). Modi Werkbank, Röntgen, Explosion; Foto in 4K und 360°-Video

**Bibliothek:** Suche versteht „widerstand 4,7k 0805“, „elko 470u 25v“, „led rot“ und zeigt passende Bestellvarianten.

---

## 3. Simulation

- Analoger Schaltungslöser (Knotenpotenzialverfahren, Newton-Raphson) mit Dioden, LEDs, Transistoren, MOSFETs, Kondensatoren, Spulen, Reglern, OpAmps, 555, Logik-ICs
- **Dünnbesetzter Löser** ab 48 Knoten – auch Projekte mit 10 000 Bauteilen rechnen flüssig
- Einschalten wie in echt: Kondensatoren starten leer
- Lernmodus: Stromfluss und Spannungen sichtbar
- Überlast, Rauch, Hitze, verständliche Fehlermeldungen
- Referenztests gegen analytische/SPICE-Werte (RC-Kurve, Spannungsteiler, LED-Strom)

### Code auf Mikrocontrollern
| Modus | Was läuft |
|---|---|
| Schnellmodus | Arduino-C direkt ausgeführt (ideal zum Lernen) |
| AVR echt | Echte Maschinenbefehle (.hex) auf Uno, Nano, Pro Mini, ATtiny85 (avr8js) |
| RP2040 echt | Raspberry Pi Pico mit Firmware (.uf2) und **echtem MicroPython 1.24** (rp2040js) |
| Desktop | „Echt kompilieren“ mit installiertem arduino-cli |

**Debugger:** Haltepunkte im Zeilenrand, Einzelschritt, Register, Variablen, Peripherie, Speicher-Hexdump.

---

## 4. Profi-Schaltplan und -Platine

- **ERC** (elektrische Prüfung): fehlende Versorgung, offene Eingänge, Kurzschluss zwischen Quellen, 5 V an 3,3-V-Pins, GPIO gegen GPIO, Netze mit nur einem Pin
- **DRC** (Fertigungsregeln) mit Profilen von **JLCPCB, PCBWay, Aisler, Eurocircuits, Würth**
- **Autorouter** mit Vias auf 2 Lagen, Massefläche
- **Lagenaufbau** 1–32 Lagen, Material (FR4, High-Tg, Rogers, Aluminium, Polyimid), Dicke, **Impedanzrechner** (IPC-2141)
- **Bestückungsvarianten** (Teile „nicht bestückt“)
- **Automatisch platzieren** – nur übernommen, wenn Leitungen kürzer werden und keine neuen Fehler entstehen

---

## 5. Fertigung und Einkauf

**Komplettes Fertigungspaket (ZIP):**
Gerber X2 + Excellon-Bohrdaten · Pick & Place · Bestückungszeichnung (PDF) · Stückliste · Testpunkte · IPC-2581 · ODB++ (Grundumfang) · STEP (3D) · Fertigungsnutzen 2×2

**Einkauf:**
- Hersteller-Teilenummern (genaue Katalogvariante), LCSC-Nummern
- Lebenszyklus (aktiv/NRND/abgekündigt), RoHS/REACH, Alternativen
- Staffelpreise für 1 / 100 / 1 000 / 10 000 Stück
- Richtpreise von 5 Platinenherstellern
- Live-Preise (Octopart/Nexar, Mouser) **nur nach Zustimmung** und mit eigenem Schlüssel – gesendet werden nur Teilenummern

Weitere Exporte: KiCad-Netzliste, SPICE, Wokwi, Teilen-Link.

---

## 6. Analysen

| Analyse | Inhalt |
|---|---|
| Wärme | Verlustleistung aus der Simulation, Temperatur je Bauteil, **Wärmebild** auf der Platine, Kühlkörper-Empfehlung |
| Monte Carlo + Worst-Case | Bauteiltoleranzen, Histogramm, Grenzwerte, reproduzierbar |
| FMEA | Jeder Fehler (Unterbrechung, Kurzschluss, Drift) wird **wirklich simuliert**; Risikoprioritätszahl, CSV-Export |
| Lebensdauer | Elkos (Arrhenius), LEDs, Mechanik; MTBF nach SN 29500 |
| Power Integrity | Spannungsabfall auf Leiterbahnen, Strombelastbarkeit (IPC-2221) |
| Signalintegrität | Impedanz, Laufzeit, kritische Länge, I²C-Buskapazität |
| EMV | Abblockkondensatoren, Freilaufdioden, Massefläche, Antennen-Leitungen, Schlitze, Quarzabstand |

---

## 7. KI-Funktionen

- **KI-Assistent** baut ganze Projekte aus einer Beschreibung
- **Schaltungs-Review** – mit KI erklärt, ohne Schlüssel regelbasiert
- **Bauteil-Vorschläge** („günstiger, gleiches Gehäuse“)
- **Datenblatt-Leser** – PDF rein, Pins + Kennwerte + Symbol raus, als eigenes Bauteil ins Projekt
- **Code-Assistent** – Erklären, Fehler finden, Kommentieren, eigene Fragen, Code übernehmen
- Nur mit **eigenem Claude-API-Schlüssel**; Firmen können die KI abschalten oder einen eigenen Anbieter eintragen

---

## 8. Gehäuse (Mechanik)

Passendes Gehäuse um die Platine: Unterschale, Deckel mit Zentrierrand, Schraubdome, automatische Ausschnitte (USB, LEDs, Taster, Drehknöpfe, Displays, Sensoren), Knopf-Verlängerungen, 3D-Vorschau, **Kollisionsprüfung**, Export **STL** (3D-Druck) und **STEP** (CAD).

---

## 9. Teamarbeit

- **Versionen** wie Git (Prüfsummen, Meilensteine, Wiederherstellen)
- **Visueller Vergleich**: Teile farbig (neu/entfernt/geändert/verschoben), Netze, Code-Unterschiede
- **Review**: Kommentare an Bauteilen, Antworten, „erledigt“, Freigabe-Workflow (Entwurf → In Prüfung → Freigegeben/Abgelehnt)
- **Rollen**: Betrachter, Bearbeiter, Prüfer, Admin
- **Live-Zusammenarbeit**: mehrere Fenster oder über einen Server, farbige Rahmen zeigen, wer was bearbeitet

---

## 10. Konto, Pläne, Lizenzen

| | Free | Plus | Pro | Team | Enterprise |
|---|---|---|---|---|---|
| Preis | 0 € | 6 €/Monat | 19 €/Monat | 49 €/Nutzer/Monat | auf Anfrage |
| Jährlich | – | 60 € | 190 € | 490 €/Nutzer | Rahmenvertrag |

- Signierte Lizenzschlüssel, **14 Tage Offline-Kulanz**, Offline-Lizenzen für Enterprise
- **14 Tage Pro testen** ohne Zahlungsdaten
- Betreiber-Werkzeug zum Erzeugen von Lizenzen (`npm run license`)
- **In dieser Vorschau ist alles freigeschaltet** (Sperren erst mit echtem Verkaufsstart)

---

## 11. Firmenfunktionen (eigener Server)

Nodaris-Server ohne Fremd-Abhängigkeiten, per **Docker** oder **Kubernetes**:
- Anmeldung mit Passwort + **Zwei-Faktor (TOTP)**
- **Single Sign-On** (OpenID Connect: Microsoft Entra ID, Google, Okta, Keycloak)
- **SCIM 2.0** (automatische Benutzerverwaltung)
- **Verschlüsselter Projektspeicher** (AES-256-GCM)
- **Audit-Log**
- Klassenräume, Live-Zusammenarbeit, Lizenzprüfung
- Update-Kanäle Stabil / Beta / Firmen-LTS, Richtlinien (KI aus, Exportkontroll-Hinweis)

---

## 12. Lernen

- Kurs **„Elektronik in 30 Lektionen“** (Grundlagen → Bauteile → Sensoren → Mikrocontroller → Analogtechnik → eigene Platine), jede Lektion mit **automatischer Prüfung**
- **Klassenräume**: Lehrkraft legt Klasse an, verteilt Aufgaben mit Vorlage, sieht Punkte; Schüler treten per Code bei und geben ab

---

## 13. Sprachen, Barrierefreiheit, Plattformen

- **10 Sprachen:** Deutsch, Englisch, Französisch, Spanisch, Italienisch, Polnisch, Chinesisch, Japanisch, Koreanisch, Portugiesisch (Menüs, Werkzeugleiste, Bibliothek, Panels, Dialogtitel)
- **Barrierefreiheit:** Farbenblind-Modus (Widerstandswerte als Text), Größe der Oberfläche, hoher Kontrast, reduzierte Bewegung, Tastatur und Bildschirmleser-Beschriftungen
- **Web-App** installierbar, offline nutzbar, Zwei-Finger-Zoom auf Tablets

---

## 14. Für Entwickler und CI

```bash
npm run ohm -- check   projekt.ohm          # Format + ERC prüfen
npm run ohm -- test    projekt.ohm          # Tests simulieren
npm run ohm -- drc     projekt.ohm aisler   # Fertigungsregeln
npm run ohm -- analyse projekt.ohm          # Wärme, EMV, MTBF
npm run ohm -- export  projekt.ohm fertigung
```
Das `.ohm`-Format ist eine lesbare Textdatei mit allem: Teile, Netze, Code, Tests, Varianten, Platzierung, eigene Bauteile, Team und Review.

---

## 15. Dateien im Projekt

| Ordner/Datei | Inhalt |
|---|---|
| `release/OhmStudio-2.0.0-portable.exe` | Windows-Programm |
| `website/` | Produktseite (Funktionen, Preise, Download, FAQ) |
| `docs/` | Handbuch, API/CLI/CI, Self-Hosting, Neuigkeiten |
| `rechtliches/` | **Entwürfe**: Impressum, Datenschutz, AGB, Widerruf, AVV, EULA, Lizenzen, Betreiber-Checkliste |
| `server/`, `Dockerfile`, `deploy/k8s/` | Nodaris-Server |
| `FORTSCHRITT.md`, `ENTSCHEIDUNGEN.md` | Baufortschritt und Begründungen |

---

## 16. Noch offen

- ESP32, STM32 und Raspberry Pi mit Linux als **echte** Emulatoren (bisher nur Erkennung installierter QEMU/Renode)
- Vollständige Übersetzung aller Dialoge und Lektionen
- Nativer SAML-Endpunkt (OpenID Connect funktioniert)
- Live-Zusammenarbeit führt ganze Projekte zusammen, noch nicht je Bauteil
- 3D-Modelle der Hersteller; sehr große Projekte rechnen schnell, zeichnen aber noch langsam
- Native iPad-App (Web-App läuft auf dem iPad)

## 17. Vor dem Verkauf nötig (nicht durch Software lösbar)

- Rechtstexte von einer Anwältin / einem Anwalt prüfen lassen
- Marke „Nodaris“ bei DPMA/EUIPO prüfen und anmelden, Domain sichern
- Gewerbe, Steuern, echter Zahlungsanbieter, Lizenzserver, Code-Signatur-Zertifikat

Details: `rechtliches/BETREIBER-CHECKLISTE.md`
