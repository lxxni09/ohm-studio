# Ohm Studio by Nodaris – Handbuch

## 1. Erste Schritte
1. **Bauteil platzieren:** links in der Bibliothek suchen („widerstand 1k“, „esp32“) und auf die Arbeitsfläche ziehen.
2. **Verbinden:** auf einen Pin klicken, dann auf den Ziel-Pin. Kabel verlaufen rechtwinklig (90°); oben links lässt sich 45°, direkt oder weich wählen. Doppelklick auf ein Kabel fügt einen Knickpunkt ein.
3. **Code schreiben:** unten im Tab „Code“ (Arduino-C, MicroPython oder fertige Firmware .hex/.uf2).
4. **Starten:** Leertaste oder ▶. Taster, Schalter und Regler sind während der Simulation bedienbar.

Ansichten: **1** Steckbrett, **2** Schaltplan, **3** Platine (2D oder fotorealistisch in 3D).

## 2. Simulation
- Analoger Schaltungslöser (MNA mit Newton-Raphson): Spannungen, Ströme, Leistungen live – Lernmodus (🎓) zeigt Stromfluss.
- **Schnellmodus:** Arduino-C wird direkt ausgeführt – ideal zum Lernen.
- **Präzisionsmodus:** echte Maschinenbefehle – AVR (avr8js, .hex), RP2040 (rp2040js, .uf2, echtes MicroPython 1.24).
- **Debugger:** Haltepunkte per Klick in den Zeilenrand, Einzelschritt, Register, Variablen, Peripherie, Speicher.
- Desktop-Programm: „Echt kompilieren“ nutzt ein installiertes `arduino-cli`.

## 3. Schaltplan & Platine
- **ERC** (elektrische Regeln) läuft ständig mit – Meldungen unten unter „Meldungen“.
- **Platine:** Lagenaufbau 1–32 Lagen, Material, Dicke, Impedanzrechner (Menü „Lagenaufbau“). Autorouter mit Vias, Massefläche mit Thermals.
- **DRC** gegen Herstellerprofile (JLCPCB, PCBWay, Aisler, Eurocircuits, Würth) – Verstöße rot markiert.
- **Varianten:** Inspektor → „Varianten“: Teile je Variante „nicht bestückt“.
- **Automatisch platzieren:** Menü → KI-Werkzeuge → Platzieren.

## 4. Fertigung & Einkauf
Menü → Exportieren & bestellen:
- **Komplettes Fertigungspaket:** Gerber X2 + Excellon, Pick & Place, Bestückungszeichnung (PDF), Stückliste, Testpunkte, IPC-2581, ODB++, STEP.
- **Einkauf:** Hersteller-Teilenummern, Lebenszyklus, RoHS/REACH, Staffelpreise 1/100/1 000/10 000, Alternativen. Live-Preise nur nach Zustimmung mit eigenem Schlüssel.
- **Richtpreise** von fünf Fertigern.

## 5. Analysen (Pro)
Wärme mit Wärmebild · Monte Carlo + Worst-Case · FMEA mit echter Fehlersimulation · Lebensdauer/MTBF · Power Integrity (IR-Drop, IPC-2221) · Signalintegrität (Z₀, kritische Länge, I²C) · EMV-Prüfung.

## 6. KI-Werkzeuge
Schaltungs-Review, Bauteil-Vorschläge, Datenblatt-Leser (PDF → eigenes Bauteil), Code-Assistent, KI-Assistent für ganze Projekte. Online nur mit eigenem Claude-API-Schlüssel; ohne Schlüssel arbeiten Review und Vorschläge regelbasiert. Firmen können die KI abschalten oder einen eigenen Anbieter eintragen.

## 7. Gehäuse
Menü → Gehäuse: Wandstärke, Spiel, Domhöhe einstellen; Ausschnitte für USB, LEDs, Taster entstehen automatisch. Export als STL (3D-Druck) und STEP (CAD). Kollisionsprüfung zeigt zu hohe Bauteile.

## 8. Team
Menü → Versionen, Review & Team: Versionen speichern und visuell vergleichen, Kommentare an Bauteile heften, Prüfung anfordern und freigeben, Rollen vergeben, live zusammenarbeiten (Sitzungscode).

## 9. Lernen
„Elektronik in 30 Lektionen“ mit automatischer Prüfung; Klassenräume mit Aufgaben und Fortschrittsübersicht (über einen Nodaris-Server).

## 10. Konto, Pläne, Firmen
Menü → Konto & Pläne (Testphase, Lizenzschlüssel). Menü → Einstellungen & Firmenserver (SSO, 2FA, Cloud-Projekte, Audit-Log, Richtlinien, Update-Kanal, Datenschutz-Übersicht). Betrieb eines eigenen Servers: `SELF-HOSTING.md`.

## 11. Tastenkürzel
Leertaste Start/Pause · R drehen · Entf löschen · ⌘D duplizieren · ⌘Z/⇧⌘Z · ⌘S/⌘O · F alles zeigen · 1/2/3 Ansichten · Esc abbrechen · Alt beim Ziehen ohne Raster.

## 12. Das .ohm-Format
Eine lesbare YAML-Datei mit allem: Teile, Netze, Code, Tests, Ansichten, Varianten, Platzierung, eigene Bauteile, Team und Review. Referenz: `OHM_FOR_AI.md`, Schema: `ohm.schema.json`.
