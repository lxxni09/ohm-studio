# Entscheidungen

Getroffen während des Baus, wo der Projektauftrag Spielraum ließ oder in dieser Umgebung nicht umsetzbar war.

## Plattform
- **Desktop-Programm mit Electron** (Windows-.exe portabel + Installer, macOS, Linux). Electron statt Tauri, weil sich Windows-Programme damit auch ohne Windows-Rechner bauen lassen und die Darstellung auf allen Systemen identisch ist (eingebautes Chromium). Die Oberfläche wird über ein eigenes `app://`-Protokoll geladen; Schriften sind eingebettet, die App läuft komplett offline (nur KI-Assistent und HTTP aus Sketches brauchen Internet).
- **Ursprünglich Web-App (React + TypeScript + Vite) statt Tauri-Hülle.** In der Bau-Umgebung fehlen die System-Bibliotheken (WebKitGTK) für Tauri. Die App ist so aufgebaut, dass sie ohne Änderungen in eine Tauri-Hülle passt (`src-tauri/` kann später ergänzt werden). Sie läuft heute in jedem Browser und startet in deutlich unter 2 Sekunden.
- **Kein Tailwind / Framer Motion.** Eigene CSS-Variablen (Design-Tokens) + CSS-Übergänge (150–250 ms, ease-out) halten das Paket klein und das Design exakt kontrollierbar.
- **Kein Monaco.** Ein leichtgewichtiger eigener Code-Editor mit Syntaxhervorhebung, Zeilennummern und Fehlermarkierung (Monaco wäre 5+ MB und verschlechtert den Start).

## Simulation
- **Eigener Schaltungslöser (Modified Nodal Analysis, Newton-Raphson) in TypeScript statt ngspice.** ngspice ist als nativer Prozess im Browser nicht verfügbar. Der Löser deckt Widerstände, Kondensatoren, Spulen, Dioden/LEDs (Shockley), BJTs (Ebers-Moll), MOSFETs (quadratisches Modell), Regler, OpAmps, Schalter ab. Die Schnittstelle (`Device`) ist so gebaut, dass später ein ngspice-Backend (shared library / Prozess) eingehängt werden kann.
- **Mikrocontroller: Arduino-Sketch-Übersetzer statt Befehlssatz-Emulation (simavr/QEMU/rp2040js).** Echter Maschinencode bräuchte eine Toolchain (avr-gcc, xtensa-gcc …), die im Browser fehlt. Stattdessen übersetzt Ohm Studio eine große Teilmenge von Arduino-C/C++ in JavaScript-Generatoren, die zeitgenau mit der Schaltung laufen (delay, millis, Interrupts, PWM, Deep-Sleep …). Board-spezifisches Verhalten ist nachgebildet: 16-Bit-`int` auf AVR, 10/12-Bit-ADC, Pull-up-Widerstände, Ausgangswiderstände, 3,3-V-Toleranz, Stromgrenzen der Pins.
  - Später: GPL-Engines (simavr, QEMU-ESP32) als **separate Prozesse** über die Tauri-Hülle anbinden – dafür ist `McuRuntime`/`Host` als Schnittstelle gedacht.
- **Bibliotheken** (LiquidCrystal_I2C, Adafruit_SSD1306, Servo, DHT, NeoPixel, BLE, WiFi, HTTPClient …) sind als Nachbildungen implementiert, die mit dem tatsächlich verdrahteten Bauteil sprechen. Fehlt die Verdrahtung, merkt man das wie in echt.
- **Bluetooth LE:** Beacons (`ble-beacon`) und werbende ESP32 sind über eine einfache Funkausbreitung (RSSI ~ −59 dBm − 22·log10(d)) gekoppelt.
- **WLAN:** Virtuelles Netz, Verbindung nach ~1,8 s; HTTP-Anfragen gehen über `fetch` ins echte Internet (CORS-Regeln des Browsers gelten).
- **Zeitschritt** standardmäßig 1 ms. Reine Gleichstromschaltungen werden nur bei Änderungen neu gelöst (schnell), Schaltungen mit Kondensatoren/Spulen jeden Schritt.
- **Raspberry Pi (Linux):** Ein echter Linux-Boot braucht QEMU (nativ). Im Browser gibt es eine **virtuelle Pi-OS-Oberfläche** mit Terminal und GPIO-Steuerung; die Schnittstelle für einen echten QEMU-Prozess ist vorgesehen.

## Format
- `.ohm` ist YAML. Deutsche Schlüssel wie im Auftrag (`teile`, `netze`, `typ`, `wert` …). Englische Synonyme (`parts`, `nets`, `type`) werden beim Laden ebenfalls akzeptiert („verzeiht Ungenauigkeit“).
- Bauteile können optional `pos: [x, y]` (in mm) und `dreh: 90` haben; fehlt das, platziert Ohm Studio automatisch.

## Bibliothek
- Bauteile sind als selbstständige `PartDef`-Objekte organisiert (Grafik, Pins, Verhalten, Datenblatt, Preis, 3D-Höhe), gruppiert in Dateien je Kategorie. Ein Community-Bauteil ist ein einzelnes `PartDef`-Objekt – das entspricht dem geforderten „ein Ordner pro Bauteil“ und lässt sich später 1:1 in Einzelordner aufteilen.

## Version 2.0 – Nodaris
- **Marke:** Firma *Nodaris*, Programm *Ohm Studio by Nodaris*, App-ID `com.nodaris.ohmstudio`, npm-Paket `@nodaris/ohm-studio`, Domain-Platzhalter `nodaris.example`. Zentrale Konstanten in `src/brand/brand.ts`, Logo (Knoten-Bildzeichen + Wortmarke) in `src/brand/Logo.tsx`.
- **Hinweis für den Betreiber:** Vor Veröffentlichung Markenrecherche bei DPMA/EUIPO für „Nodaris“ durchführen und Domain sichern.
- **Windows-Metadaten (Herausgeber):** Lokal unter Linux ohne Wine lassen sich Herausgeber/Icon nicht in die .exe schreiben (`signAndEditExecutable: false`). Der Windows-Build im GitHub-Workflow (`dist:win:all`) schreibt sie hinein.
- **Fotorealismus:** 3D-Platine mit Three.js (lädt erst bei Bedarf, ~140 kB gzip): physikbasierte Materialien, Klarlack-Lötstopp mit durchscheinenden, erhabenen Bahnen (Bump-Map), Oberflächen ENIG/HASL/OSP/Silber/Zinn, FR4-Kante, Lötkegel, Vias, Masseflächen mit Wärmefallen, LEDs mit Transmission und echtem Lichtschein. Modi Werkbank (Lötmatte, Lötkolben, Multimeter), Röntgen, Lagen (Explosion). Export als 4K-PNG und 360°-WebM. Echte STEP/GLB-Herstellermodelle sind noch nicht angebunden; die Körper werden prozedural erzeugt.
- **Gerber X2** mit Dateiattributen, Massefläche als Region mit Freistellungen, Fertigungsnutzen (n×m, Fräskanal, Rand mit Fiducials/Werkzeuglöchern).
- **Präzisionsmodus:** avr8js (MIT) und rp2040js (MIT) laufen direkt in der App (keine GPL-Komponenten im Hauptprogramm). Der RP2040-Bootrom (BSD-3, Raspberry Pi) und die MicroPython-Firmware 1.24.1 (MIT) liegen bei. Firmware wird als `.hex` (AVR) oder `.uf2` (Pico) geladen; in `.ohm` steht sie als `sprache: hex` (Intel-HEX-Text) bzw. `sprache: uf2` (Base64). MicroPython-Skripte (`sprache: micropython`) werden über den Raw-REPL per USB-CDC in den echten Interpreter übertragen.
- **GPL-Engines (QEMU-ESP32, Renode, QEMU-Pi, simavr, ngspice)** werden nur als separate Prozesse angesprochen, wenn sie auf dem Rechner installiert sind (Electron-Hauptprozess, `which` mit Positivliste). Die eigentliche Kopplung für ESP32/STM32/Pi-Linux ist noch nicht gebaut.
- **arduino-cli** (Desktop): Sketch wird lokal zu echtem Maschinencode kompiliert und im Emulator ausgeführt. Ohne arduino-cli bleibt der Schnellmodus.

## Fertigung & Einkauf (2.0, Schritt 5)
- **Eigener PDF-Schreiber** statt Bibliothek (jsPDF ~300 kB): Bestückungszeichnungen brauchen nur Linien, Kreise und Helvetica-Text – ~60 Zeilen Code.
- **STEP AP214 mit Quadern** für Platine und Bauteilkörper: reicht für Gehäusekonstruktion (Kollision, Bohrungen). Echte Herstellermodelle folgen mit der 3D-Bibliothek.
- **ODB++ nur im Grundumfang** (matrix, profile, Feature-Layer, Bohrungen, Netze). Das vollständige Format ist proprietär dokumentiert; Gerber X2 + IPC-2581 sind die empfohlenen Wege.
- **Live-Preise opt-in (Abschnitt 13):** Abfrage nur mit Häkchen-Zustimmung und eigenem API-Schlüssel (Nexar/Octopart, Mouser). Es gehen ausschließlich MPNs raus, nie Schaltung oder Projektname. Ohne Zustimmung: Offline-Richtpreise mit typischen Mengenrabatten (1 / 0,55 / 0,32 / 0,21).
- **Direktbestellung** wird nicht automatisch ausgelöst: Hersteller-APIs (JLCPCB, PCBWay) erfordern Partnerverträge. Bis dahin Richtpreise + Link zum Upload-Formular.

## Konto, Pläne & Lizenzen (2.0, Schritt 6)
- **Signierte Lizenzschlüssel statt Server-Pflicht:** `NODARIS-<payload>.<ECDSA-P-256-Signatur>`. Das Programm prüft offline mit dem eingebauten öffentlichen Schlüssel; der private Schlüssel liegt nur beim Betreiber (`.keys/`, gitignored). Neuer Schlüssel: `node scripts/license-tool.mjs keygen`, dann `LICENSE_PUBLIC_KEY` ersetzen.
- **14 Tage Offline-Kulanz:** gezählt ab der letzten erfolgreichen Online-Prüfung. Danach fällt das Programm auf Free zurück – Projekte bleiben vollständig nutzbar. Enterprise-Offline-Lizenzen brauchen nie eine Prüfung.
- **Online-Prüfung sendet nur die Lizenz-ID** an den eigenen Lizenzserver, und nur wenn eine Lizenz aktiviert ist (Abschnitt 13).
- **Durchsetzung abschaltbar (`VITE_LICENSE_ENFORCE`)** und in der Vorschau aus: Solange es keine echte Bezahlung gibt, wäre es unfair, Funktionen zu sperren. Feature-Flags sind trotzdem überall verdrahtet und getestet.
- **Kein Upgrade-Pop-up**, keine Werbung: Planhinweise erscheinen nur dezent (z. B. „(Pro)“ an gesperrten Lagenzahlen) und im Dialog „Konto & Pläne“.
- **Zahlung:** Kauf-Links zeigen auf `nodaris.example/kaufen?…&modus=test` (Platzhalter für Paddle/Lemon Squeezy-Checkout). Der Merchant of Record stellt nach Zahlung per Webhook einen signierten Schlüssel aus.

## Teamarbeit (2.0, Schritt 7)
- **Versionen in IndexedDB statt echtem Git:** Git im Browser (isomorphic-git) wäre ~300 kB und bräuchte ein Dateisystem. Das Datenmodell ist trotzdem Git-artig (Inhalts-Hash, Vorgänger, Tags), ein späterer Export in ein Git-Repository ist 1:1 möglich.
- **Review-Daten in der .ohm-Datei** (`team:`, `review:`): Kommentare und Freigaben reisen mit dem Projekt, auch ohne Server.
- **Live-Abgleich auf Dokumentebene** (ganzer .ohm-Text + Lamport-Zähler, 120 ms entprellt). Für Projekte bis einige hundert Teile völlig ausreichend; ein CRDT auf Teil-Ebene ist der nächste Ausbau.
- **Eigener Server ohne npm-Abhängigkeiten** (`server/nodaris-server.mjs`, WebSocket nach RFC 6455 von Hand): läuft überall, wo Node läuft, und ist die Basis für Self-Hosted (Schritt 8). Daten gehen nur an den Server, den der Nutzer einträgt.

## Firmenfunktionen (2.0, Schritt 8)
- **Server ohne npm-Abhängigkeiten:** OIDC (JWKS + JWT-Prüfung über `crypto.createPublicKey({format:'jwk'})`), TOTP, scrypt, AES-GCM und WebSocket mit Node-Bordmitteln. Weniger Angriffsfläche in der Lieferkette – wichtig für Firmenkunden.
- **OIDC statt SAML zuerst:** Alle großen Anbieter (Entra ID, Google, Okta, Keycloak) sprechen OIDC; SAML-XML-Signaturen sicher ohne Bibliothek zu prüfen, wäre riskant. SAML-Kunden nutzen eine OIDC-Bridge.
- **Erstes Konto wird Admin**, danach legen nur Admins oder SCIM Konten an.
- **Update-Suche** sendet nur Version + Kanal, ist abschaltbar; Firmen setzen `NODARIS_UPDATE_URL` für eigene Server.
- **Richtlinien lokal gespeichert** (KI aus, eigener Anbieter, Exportkontrolle). Zentrale Verteilung per Server-Richtlinie ist der nächste Ausbau.

## Analysen (2.0, Schritt 9)
- **Analysen auf dem echten Simulator:** Jede Analyse startet eigene Engine-Instanzen (≈ 10–30 ms pro Lauf), dadurch fließen Firmware-Verhalten, Nichtlinearitäten und Lastzustände ein – statt nur Formeln auf Nennwerte anzuwenden.
- **FMEA durch Fehlerinjektion:** Unterbrechung = Teil aus allen Netzen lösen, Kurzschluss = Netze der beiden Pins verbinden, Drift = Wert ändern. Auswirkungen werden gegen den Normalbetrieb verglichen (Versorgung, Überlast, Ausgaben, Signale).
- **Reproduzierbarer Zufall (Mulberry32, fester Seed):** Gleiche Eingabe → gleiches Monte-Carlo-Ergebnis, wichtig für Reviews und CI.
- **Normen als Abschätzung:** IPC-2221 (Strombelastbarkeit), IPC-2141 (Impedanz), SN 29500 (Ausfallraten), Arrhenius-10-K-Regel (Elkos). Die Oberfläche sagt deutlich, dass das Messungen am Prototyp nicht ersetzt.

## KI, Mechanik, Lernen (2.0, Schritt 10)
- **Jede KI-Funktion hat einen Offline-Weg** (Review regelbasiert, Vorschläge aus der Bibliothek, Platzieren rein algorithmisch). Nur Datenblatt-Leser und Code-Assistent brauchen zwingend ein Modell.
- **Strukturierte Ausgabe per JSON-Schema** (`output_config.format`) statt Text-Parsing; Modell `claude-opus-5-5` mit adaptivem Denken und serverseitigem Fallback bei Ablehnungen.
- **Eigene Bauteile als generisches DIP-IC** mit Ruhestrommodell: genug für Schaltplan, Platine, Stückliste; das Verhalten simulieren nur die eingebauten Modelle.
- **Gehäuse als Voxel-Platten (0,5 mm)**: wasserdicht genug für Slicer, ohne CSG-Bibliothek; STEP als Quader-Zerlegung.
- **Bewertung deklarativ** (Kriterien-Liste), dieselbe Engine für Kurs und Lehrer-Aufgaben; bewertet wird lokal, der Server speichert nur Punkte und Projekt.

## Bibliothek, Sprachen, Plattformen (2.0, Schritt 12)
- **10 000 Bauteile als Katalog statt 10 000 Modelle:** Bestellvarianten (Wert, Bauform, Toleranz, Spannung, Teilenummer) sind Voreinstellungen der simulierbaren Grundtypen. So simuliert jede Variante korrekt, und die Bibliothek bleibt wartbar.
- **Übersetzung mit dem deutschen Text als Schlüssel** (`t('Steckbrett')`): neue Texte fallen automatisch auf Deutsch zurück, nichts bricht. Zuerst die sichtbarsten Bereiche übersetzt; Dialoge folgen schrittweise.
- **Web-Version als PWA** statt nativer iPad-App für den Anfang: läuft auf iPad/iPhone/Android, offline nutzbar, mit Zwei-Finger-Zoom. Der Service Worker speichert nur eigene Dateien, nie Antworten fremder Server.

## Feinschliff nach 2.0
- **Einschalten wie in echt:** Beim Start der Simulation beginnen Kondensatoren leer und Spulen stromlos (entspricht SPICE `.tran … UIC` mit Anfangswerten 0). Vorher wurde der Gleichstrom-Arbeitspunkt übernommen – RC-Glieder waren dann schon „geladen“. Referenztest: RC-Ladekurve 63,2 % nach τ.
- **Testabdeckung Simulationskern:** 81,9 % Anweisungen (`npm run coverage`), Ziel ≥ 80 % erreicht.
- **Dünnbesetzter Löser ab 48 Knoten:** Matrix wird als Zeilen-Maps aufgebaut, Gauß-Elimination mit Minimum-Degree-Reihenfolge (Heap). Sammelknoten (GND, VCC) werden zuletzt eliminiert, dadurch fast keine Auffüllung. Messung (Widerstand+LED-Paare an einer Quelle): 2 001 Teile 570 → 7 ms pro Schritt, 10 001 Teile 34 ms pro Schritt (vorher wegen n²-Speicher gar nicht möglich). Bei numerischen Problemen fällt der Löser auf die dichte Variante mit Pivotsuche zurück.

---

# Ohm Studio 3.0

## Natives Windows-Programm: bei Electron bleiben (Schritt 1)
- **Geprüft:** Umstieg auf ein natives Framework (WinUI 3 / WPF / Qt) gegenüber Electron mit eigener Titelleiste.
- **Entscheidung: Electron bleibt.** Ein Umstieg hieße, die gesamte Oberfläche (≈ 40 000 Zeilen React/SVG, Three.js-3D, Simulator) neu zu schreiben – Monate Arbeit, ohne Nutzen für die Simulation. Stattdessen sind alle Stellen, an denen man einen Browser bemerkt, abgestellt:
  - eigene Titelleiste mit echten Windows-11-Fensterknöpfen (`titleBarOverlay`, inkl. Snap-Layouts beim Überfahren von „Maximieren“), Mica-Hintergrund, Andocken an Bildschirmränder
  - native Menüs (Datei/Bearbeiten/Ansicht/Simulation/Hilfe als echte Windows-Popup-Menüs), native Kontextmenüs, native Öffnen-/Speichern-Dialoge, native Rückfrage „Änderungen speichern?“
  - kein F5/Strg+R, keine Entwicklerwerkzeuge in der Release-Version, kein Browser-Zoom (Strg+Mausrad/±/0), kein Drucken-Dialog, kein Markieren der Oberfläche, keine Navigation weg von der App, Links nur auf ausdrücklichen Klick im Standardbrowser
  - Splash-Fenster mit Logo, Fenstergröße/-position wird gemerkt, nur eine Instanz, `.ohm`-Doppelklick öffnet im laufenden Fenster
- **Gemessen:** Start bis bedienbares Fenster 1,4–1,5 s (Linux, Software-Grafik, Entwicklungsmodus) – Ziel < 2 s erreicht.

## Setup-Assistent mit NSIS (über electron-builder)
- NSIS statt WiX/Inno Setup: von electron-builder direkt unterstützt (Updates, Web-Installer, Deinstallation), gut anpassbar. MSI zusätzlich für Firmen-IT.
- Komponenten- und Optionsseite als eigene NSIS-Seiten (nsDialogs). Verknüpfungen, `.ohm`-Zuordnung und Beispielprojekte macht das Setup selbst, damit sie abwählbar sind.
- „Sprachpakete“ sind immer enthalten (zusammen < 100 KB) – die Zeile ist zur Information grau angehakt statt eine Scheinauswahl zu sein.
- ESP32-Emulator: wird nicht im Setup heruntergeladen, sondern beim ersten Gebrauch (Setup bleibt klein und offline-fähig). Die Auswahl im Setup wird in `install.json` gespeichert.
- **Getestet unter Wine** (Linux): alle Seiten per Bildschirmfoto geprüft, Installation für mich und für alle, stille Installation `/S /allusers /NODESKTOP`, Apps-Eintrag (Name, Herausgeber, Version, Größe, Symbol), Deinstallation mit Rückfrage, Aufräumen. Die Standardprüfung „Programm läuft noch“ funktioniert unter Wine nicht (PowerShell/tasklist) – für den Test gibt es `build/installer-wine-test.nsh`, im echten Setup bleibt die Standardprüfung.
- MSI lässt sich nur unter Windows bauen (WiX braucht .NET) → GitHub Actions auf `windows-latest`.

## Veröffentlichen über GitHub Releases
- Jeder Push baut auf einem echten Windows-Rechner und aktualisiert das Release `v<Version>` (gleicher Link, immer der neueste Stand).
- **Wichtig:** Das Repository ist privat. Release-Dateien kann dann nur herunterladen, wer bei GitHub angemeldet ist und Zugriff hat; Web-Installer und automatische Updates funktionieren für fremde Nutzer erst, wenn die Releases öffentlich sind (Repository öffentlich machen oder ein eigenes öffentliches Repository nur für Downloads) – steht in der Betreiber-Checkliste.

## Qualität: ehrliche, äußere Prüfungen (Schritt 2)
- **End-to-End-Tests** (`e2e/run.mjs`) bedienen Oberfläche und echtes Desktop-Programm mit Maus und Tastatur: öffnen, Kabel ziehen, simulieren, exportieren, Absturz-Wiederherstellung, Desktop-Fenster. Laufen in GitHub Actions.
- **Gerber-Gegenprüfung mit gerbonara** (externe Python-Bibliothek, nicht unser Code): alle 10 Beispiele, Lagen, Umrissgröße, Bohrungsanzahl, alles innerhalb des Umrisses.
- **Dabei gefundene echte Fehler:** Bohrdatei-Kopf (`G90` hinter dem Kopfende), Befestigungslöcher der Platine (2,54 mm) passten nicht zu den Schraubdomen des Gehäuses (3,5 mm), Bauteile/Leiterbahnen lagen in vier Beispielen im Bereich der Befestigungslöcher, ZIP-Dateien hatten das Datum 1980, ein frisch geöffnetes Projekt wurde erst nach der ersten Änderung automatisch gesichert.
- **Tempo großer Projekte** (gemessen im Browser ohne Grafikkarte): Öffnen von 2 001 Teilen 278 s → 3,4 s (quadratische/kubische Stellen in Platzierung, Zeilennummern, Kabelbaum, Kreuzungserkennung, ERC entfernt). Simulation mit 2 001 Teilen 3× schneller. Ehrliche Grenze: ab etwa 3 000 Teilen wird das Zeichnen als SVG zäh (5 001 Teile: 5 Bilder/s im Test ohne Grafikkarte) – dafür bräuchte es eine WebGL-Zeichenfläche (offen).

## Echter ESP32 über Espressif-QEMU (Schritt 3)
- **Desktop-Prozess statt WebAssembly:** Espressif-QEMU als WASM gibt es nicht fertig; es selbst nach WASM zu bauen wäre wochenlange Arbeit mit ungewissem Ausgang (Threads, Größe). Im Windows-Programm läuft QEMU als eigener Prozess; im Web bleibt der Schnellmodus (mit Hinweis).
- **Werkzeuge werden nachgeladen, nicht ins Setup gepackt:** arduino-cli + ESP32-Kern + QEMU sind ca. 1,5 GB (8 GB entpackt). Das Setup bleibt so bei ca. 110 MB; die Setup-Komponente „ESP32-Emulator“ löst beim ersten Start eine Rückfrage zum Download aus.
- **QEMU 9.2.2 statt 8.2:** 8.2 stürzt beim Empfang auf UART1 ab (int-WDT) – die Brücke wäre unbrauchbar.
- **Flash im DIO-Modus:** QIO bootet im Emulator nicht.
- **Brücke über UART1 statt nachgebauter Peripherie im Emulator:** QEMU verbindet GPIO/ADC nicht mit der Außenwelt. Die Brücke ersetzt nur die Arduino-Peripherie-Funktionen (pinMode, digitalWrite/Read, analogRead, ledc, Deep-Sleep, BLE-Scan) per Linker-`--wrap`; der eigentliche Programmcode bleibt unverändert echter Maschinencode. Die UART1-Pins (RX1/TX1) werden vor Umkonfigurieren geschützt, sonst trennt `pinMode()` auf diesen Pins die Brücke.
- **Klassischer ESP32 – ehrlich gemessene Emulator-Schwäche:** Ohne Befehlszählung löst Espressif-QEMU beim Zweikern-ESP32 zufällig einen falschen „Cache error“ aus (4 von 10 Starts, auch bei einem leeren Arduino-Sketch ohne Brücke, auch mit QEMU 8.2). Mit `-icount shift=auto` 0 von 10, dafür läuft die Zeit im Emulator etwa 0,65× so schnell. Der Soft-Reset nach dem Aufwachen ist auch mit `-icount` unzuverlässig; deshalb schickt die Firmware vor dem Aufwachen ihren RTC-Speicher an Ohm Studio, das den Emulator kalt neu startet und Weckgrund + RTC-Speicher zurückspielt (RTC_DATA_ATTR-Variablen bleiben wie auf echter Hardware erhalten). Als Sicherheitsnetz startet Ohm Studio den Emulator bis zu 8-mal still neu, falls er vor dem Anwenderprogramm abstürzt. Der ESP32-C3 (ein Kern) braucht nichts davon.

## „Idee rein, Platine raus“ (Schritt 4)
- **Selbstprüfung ohne KI, Reparatur mit KI:** Ob ein Projekt funktioniert, entscheidet nicht die KI, sondern Ohm Studio selbst (Datei-Prüfung, elektrische Regeln, ERC, kurzer Simulationslauf, die Testschritte aus der Datei). Nur die Reparatur nutzt die KI (höchstens 3 Versuche); was danach noch offen ist, steht ehrlich in der Liste.
- **Warnungen, die „kaputt“ bedeuten, zählen als Fehler:** z. B. LED ohne Vorwiderstand. Sonst würde die Selbstprüfung ein Projekt durchwinken, das in echt sofort ein Bauteil zerstört.
- **Bestellen als Anleitung statt API:** Bestell-APIs von Platinenherstellern brauchen Partnerverträge (und Geld) – das entscheidet der Inhaber (mit Zustimmung der Eltern). Bis dahin: Gerber-ZIP speichern + Direktlink zum Hersteller + LCSC-BOM-Tool, mit Hinweis auf die Eltern beim Bezahlen.
- **Test mit nachgebauter Claude-API:** Echte KI-Antworten ändern sich und kosten Geld; der Nachbau (`e2e/mock-claude.mjs`) spricht dasselbe Streaming-Format und liefert absichtlich erst ein fehlerhaftes Projekt, damit die Reparaturschleife wirklich geprüft wird.
- **Dabei gefundene Fehler:** (1) Überlast-Prüfung der Pins rechnete mit der Lösung vor einem Pinwechsel → Fehlalarm „82 mA“ im Beispiel Abstandswarner (echt ~35 mA). (2) Ein Pull-down-Widerstand auf GND galt als LED-Vorwiderstand → LED ohne Vorwiderstand wurde übersehen. (3) Platinenpreis: JLCPCB-Aktionspreis wurde auch bei 100 Stück angesetzt.

## Onboarding und Website (Schritt 5)
- **Tour statt Video im Programm:** Eine Tour zeigt die echten Knöpfe an ihrer echten Stelle; nach 6 × 10 s läuft das Blink-Projekt – man hat also in 60 Sekunden etwas zum Laufen gebracht. Sie startet erst 1,2 s nach dem Programmstart und nur bei leerem Projekt, damit sie nicht über einer per Doppelklick geöffneten Datei liegt.
- **Video mit dem echten Programm aufgenommen** (Playwright), kein nachgestelltes Marketingvideo – es zeigt genau, was das Programm kann. Neu aufnehmen nach Änderungen: `node scripts/record-demo.mjs`.
- **Website ehrlich auf Windows ausgerichtet:** macOS/Linux-Downloads wurden nicht gebaut, also nicht mehr angeboten.

## Community-Galerie (Schritt 6)
- **Eigene, datensparsame Konten statt Firmenkonten:** Die Konten des Firmenservers legt ein Admin an; die Community braucht freie Registrierung. Nur Spitzname + Passwort, keine E-Mail – weniger Daten, weniger Pflichten, passend für junge Nutzer. Nachteil: kein „Passwort vergessen“ (dafür bräuchte es eine E-Mail).
- **Moderation zuerst durch Menschen, automatisch nur Verbergen:** Ab 3 Meldungen verschiedener Personen wird ein Eintrag verborgen, bis ein Moderator entscheidet. Offizielle Beispiele werden nie automatisch verborgen (sonst könnte man sie per Massenmeldung wegklicken).
- **Kein Server vorkonfiguriert:** Es gibt noch keinen echten Nodaris-Server; die Galerie sagt das offen und zeigt die Beispiele, statt eine leere oder falsche Adresse zu nutzen.
- **Gefundene Fehler:** (1) Im Windows-Programm waren Datei → Öffnen, Speichern, Speichern unter, Idee, Galerie, Teilen ohne Wirkung (Menüpunkte ohne Aktion; Strg+S ging, der Menüklick nicht). Jetzt verdrahtet, und ein Test prüft jeden Menüpunkt. (2) Vorschaubilder waren schwarz (Farben kamen aus dem Stylesheet) – jetzt werden die Stile eingebettet.

## Social Media (Schritt 7)
- **Ringpuffer im Hauptprozess statt Bildschirmaufnahme:** Electron fotografiert nur die Arbeitsfläche (`capturePage`, 10 Bilder/s, JPEG) und nur während die Simulation läuft. Kein Zugriff auf den restlichen Bildschirm, keine Datenübertragung.
- **Video mit WebCodecs + mediabunny** (Nachfolger des veralteten mp4-muxer): MP4/H.264, weil TikTok/Instagram das am besten annehmen; WebM/VP9 als Rückfall.
- **Zuschnitt auf die Schaltung:** Die Arbeitsfläche ist quer, Clips sind hochkant – ohne Zuschnitt war die Schaltung winzig.
- **Gefundene Fehler:** (1) Der Moment-Erkenner schaute jede Sekunde nach – genau im Blink-Takt, er sah also immer denselben Zustand. Jetzt alle 300 ms. (2) Vorschaubilder waren schwarz (siehe Schritt 6).

## KiCad- und Altium-Import (Schritt 8)
- **Unabhängige Prüfung mit KiCad selbst:** KiCad 7 (kicad-cli) erzeugt aus denselben Dateien seine Netzliste; der Test verlangt identische Netze. Das hat zwei echte Fehler gefunden: PWR_FLAG-Symbole schlossen alle Versorgungsschienen kurz, und unsichtbare Versorgungspins (älterer KiCad-Stil) wurden nicht global verbunden.
- **Altium binär selbst lesen:** Altium speichert .SchDoc als OLE-Verbunddatei; ein eigener kleiner Leser (statt einer großen Bibliothek) holt den Datenstrom, geprüft byte-gleich gegen Pythons olefile. Gegen Altium selbst konnte nicht geprüft werden (kostenpflichtig) – deshalb Plausibilitätsprüfungen (Pins auf Leitungsenden, GND-Pins im GND-Netz).
- **Ehrlicher Bericht statt stillem Weglassen:** Bauteile ohne Simulationsmodell werden aufgelistet; fehlende Spannungsquellen (nur Versorgungssymbole im Schaltplan) als Labornetzteil ergänzt und gemeldet; Quellen über 200 Hz werden gemeldet.

## Einnahmequellen (Schritt 9)
- **Schalter beim Bauen statt Einstellung im Programm:** Nutzer sollen nichts versehentlich einschalten; der Inhaber entscheidet beim Bauen (GitHub-Variablen), ob und was aktiv ist. Für Tests gibt es eine Vorschau über localStorage, die keine Preise ändert.
- **Provision nur mit echter Kennung:** Ohne hinterlegte Partner-Kennung sind die Shop-Links normale Suchlinks und werden ausdrücklich als „ohne Provision“ bezeichnet – es wird nie ein Provisionshinweis gezeigt, wenn keine Provision fließt, und nie eine Provision ohne Hinweis.
- **Zahlungen nur im Testmodus:** Ein echter Anbieter braucht Verträge, Gewerbe und die Zustimmung der Eltern. Der Live-Modus verweigert deshalb absichtlich jede Zahlung, statt halb zu funktionieren.
- **Remixe nicht verkaufbar:** Wer ein fremdes Projekt remixt, soll damit kein Geld verdienen können – das schützt die Urheber und die Community.

## Sehr große Projekte (> 3 000 Teile) – gemessen, bewusst noch offen
- Messung (12.11.2026, Chromium, 1440×900): 3 001 Teile öffnen in 3,8 s, Zoomen Median 17 ms pro Bild, aber einzelne Bilder bis 0,5 s; 5 001 Teile: 3,4 s / 33 ms / bis 0,8 s; Simulation 0,16–0,22 × Echtzeit.
- Der Großteil der Zeit ist das Zeichnen von tausenden SVG-Elementen im Browser, nicht unser Code. Abhilfe wäre eine eigene Canvas/WebGL-Zeichenfläche für große Projekte – viel Arbeit bei geringem Nutzen für typische Projekte (wenige Dutzend Teile). Deshalb vorerst nicht gebaut.

## Echter ESP32 auf echtem Windows (GitHub Actions)
- Werkzeug-Download (inkl. Entpacken der .tar.xz mit dem Windows-eigenen tar.exe) und der Test für den klassischen ESP32 (Pins, ADC, 2× Deep-Sleep mit RTC-Variable) laufen auf einem echten Windows-Rechner durch.
- Der ESP32-C3 stürzte unter Windows nach einem Soft-Reset ab („Stack protection fault“ nach RTC_SW_CPU_RST) – unter Linux nicht. Deshalb wacht jetzt auch der C3 per Kaltstart auf (wie der klassische ESP32). Ergebnis nach weiteren Läufen: Unter Windows lagen drei Ursachen vor – (1) Absturz nach Soft-Reset (→ Kaltstart), (2) ein echter Stacküberlauf in der Empfangs-Task der Brücke (3 KB, sscanf → 8 KB ohne sscanf; das hätte auch auf echter Hardware passieren können), (3) falsche Interrupts der Stack-Überwachung im Emulator (→ in Emulator-Builds abgeschaltet). Danach **bestand der Türwächter-Abnahmetest auf echtem Windows** (5× Blinken in 1,01 s, Alarm nach 2,27 s). -icount war für den C3 keine Lösung: gemessen 7× zu langsam. Der klassische ESP32 bleibt unter Windows wackelig beim Hochfahren (bis 8 Fehlversuche in Folge); Ohm Studio versucht es jetzt bis zu 15-mal automatisch.
- Das erste Übersetzen für den C3 dauerte unter Windows 3 Minuten (unter Linux ~1 Minute); danach geht es aus dem Zwischenspeicher schneller.

## Menüleiste im CAD-Stil statt „…“-Menü (12.11.2026)

- **Anlass:** Man kam nicht in die Einstellungen – das „…“-Menü wurde von der Werkzeugleiste abgeschnitten (`overflow: hidden`). Wunsch: Stil wie Solid Edge, weniger Apple, Einstellungen als Leiste oben.
- **Lösung:** Reiter-Menüleiste (Datei, Start, Simulation, Platine & Fertigung, Analyse & KI, Team, Einstellungen, Hilfe) mit großen und kleinen Knöpfen in beschrifteten Gruppen; Segoe UI, kleine Radien, grau/blau, keine Glas-Effekte. Keine aufklappenden Menüs mehr, die abgeschnitten werden können.
- **Entfernt auf Wunsch:** Clip-Funktion (inkl. mediabunny und Ringpuffer im Hauptprozess).
- **Tastenkürzel:** zuerst missverstanden und die Liste entfernt; gewünscht war sie *in der Leiste*. Jetzt: Knopf „Tastenkürzel“ in den Reitern Einstellungen und Hilfe, Kürzel im Hinweistext der Knöpfe (`aria-keyshortcuts` für Screenreader), Windows-Schreibweise (Strg statt ⌘), F11 für Vollbild ergänzt.
- **„Leeres Projekt“** als eigener Knopf im Reiter Start und „Leer starten“ im Ideen-Assistenten – vorher war das leere Projekt nur versteckt erreichbar.
