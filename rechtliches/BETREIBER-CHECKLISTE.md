# Checkliste für den Betreiber vor dem Verkaufsstart

> ⚠️ **ENTWURF – NICHT VERÖFFENTLICHEN, BEVOR EINE FACHKUNDIGE PERSON (RECHTSANWALT/-ANWÄLTIN) IHN GEPRÜFT HAT.**
> Dieser Text wurde automatisch erstellt, ersetzt keine Rechtsberatung und kann Fehler, Lücken oder veraltete Rechtslagen enthalten. Platzhalter stehen in [ECKIGEN KLAMMERN].

Diese Punkte kann keine Software erledigen – sie müssen von dir bzw. Fachleuten umgesetzt werden:

> **Hinweis für Minderjährige:** Wenn du noch nicht 18 bist, darfst du Verträge, Konten mit Zahlungen, Gewerbe-Anmeldungen und Markenanmeldungen nur **mit Zustimmung deiner Eltern** (gesetzliche Vertreter) abschließen – meist müssen sie mit unterschreiben. Für ein eigenes Gewerbe unter 18 braucht es zusätzlich die Genehmigung des Familiengerichts (§ 112 BGB). Bitte jeden Punkt mit Geld oder Vertrag gemeinsam mit deinen Eltern erledigen.

## Downloads veröffentlichen (für das Windows-Setup)
Das Setup wird automatisch gebaut und unter „Releases“ auf GitHub abgelegt. Solange das Repository **privat** ist, können nur angemeldete Personen mit Zugriff herunterladen, und die automatischen Updates und der kleine Web-Installer funktionieren für andere nicht.
**Geprüft am 12.11.2026 – das Repository kann öffentlich werden:** Im ganzen Repository und in der kompletten Git-Historie (alle Commits) gibt es **keine** API-Schlüssel, Passwörter, Tokens, privaten Schlüssel oder fertigen Lizenzcodes. Alle Schlüssel werden nur über Umgebungsvariablen bzw. GitHub-Secrets gesetzt (die bleiben auch bei einem öffentlichen Repository geheim). Im Programm steckt nur der **öffentliche** Lizenz-Prüfschlüssel – der darf öffentlich sein, mit ihm kann man keine Lizenzen erzeugen. Commits laufen unter „Claude <noreply@anthropic.com>“, deine E-Mail-Adresse steht nirgends. Dein Vorname wurde aus den aktuellen Dateien entfernt; in alten Commits steht er noch (nur der Vorname, sonst nichts Persönliches). Achtung: Öffentlich werden **alle** Ordner im Repository, also auch `reels`, `animated-reels`, `story-reels`, `jet-rally` und `tiktok-catwalk`.

- [ ] **Variante A (einfach):** Auf github.com → Repository „Claude“ → **Settings** → ganz unten **„Change visibility“** → **Public**. Achtung: dann ist auch der Quellcode öffentlich sichtbar.
- [ ] **Variante B (Quellcode bleibt privat):** Neues öffentliches Repository anlegen, z. B. `ohm-studio-downloads`. Ein „Fine-grained Personal Access Token“ mit Schreibrecht nur für dieses Repository erstellen und im Repository „Claude“ unter **Settings → Secrets and variables → Actions** als `RELEASE_TOKEN` speichern. Danach Claude bitten, den Workflow auf das Download-Repository umzustellen (in `package.json` → `build.publish` das `repo` ändern).
- [ ] Code-Signatur-Zertifikat kaufen (siehe „Technik“), damit die Windows-Warnung „Der Computer wurde geschützt“ verschwindet.

## Community-Galerie einschalten (Schritt für Schritt)
Die Galerie ist fertig programmiert, aber **aus**, bis ein Server läuft. Eine öffentliche Plattform mit Nutzerinhalten bringt Pflichten mit – bitte **mit deinen Eltern** durchgehen (bei Minderjährigen müssen sie zustimmen bzw. als Betreiber eintreten):
- [ ] Server mieten (z. B. kleiner V-Server in Deutschland, ca. 5 €/Monat) – Vertrag und Kosten → Eltern.
- [ ] Domain, z. B. `galerie.nodaris.de`, mit HTTPS (Let's Encrypt).
- [ ] Server starten: `SESSION_SECRET=<zufällig> GALLERY_ADMINS=<dein Spitzname> node server/nodaris-server.mjs` (Anleitung: `docs/SELF-HOSTING.md`). `SESSION_SECRET` muss fest sein, sonst sind nach jedem Neustart alle abgemeldet.
- [ ] In Ohm Studio die Galerie-Adresse eintragen (Galerie → unten „Server … ändern“) oder beim Bauen `VITE_GALLERY_URL` setzen, damit sie für alle voreingestellt ist.
- [ ] **Impressum** für die Galerie (wer ist verantwortlich?) und **Datenschutzerklärung** ergänzen: gespeichert werden Spitzname, Passwort-Hash, Projekte, Kommentare, Likes, Meldungen; IP-Adressen nur kurz im Speicher für den Spamschutz (Meldungen ohne Konto: gekürzter Hash).
- [ ] **Nutzungsbedingungen / Community-Regeln** (freundlich bleiben, keine fremden Projekte als eigene, keine persönlichen Daten, keine gefährlichen Schaltungen am Stromnetz).
- [ ] **Melde- und Abhilfeverfahren** nach dem Digital Services Act (DSA): Meldeknopf ist eingebaut; du musst Meldungen **zeitnah** prüfen (Galerie → „Meldungen prüfen“) und eine Kontaktstelle (E-Mail) im Impressum nennen.
- [ ] Jugendschutz: Mindestalter 16 oder Einverständnis der Eltern ist beim Konto-Anlegen abgefragt (Art. 8 DSGVO); überlege, ob Kommentare anfangs nur für Freunde/Testgruppe frei sein sollen.
- [ ] Moderatoren bestimmen (`GALLERY_ADMINS`), Vertretung im Urlaub klären.
- [ ] Datensicherung von `data/galerie.json` einrichten.

## Einnahmen einschalten (Schritt für Schritt) – nur gemeinsam mit deinen Eltern
Alles ist vorbereitet und **aus**. Sobald Geld fließt, brauchst du als Minderjähriger die **Zustimmung deiner Eltern** – für ein dauerhaftes Geschäft sogar die Genehmigung des **Familiengerichts** (§ 112 BGB). Erst danach:
- [ ] **Gewerbe anmelden** (bzw. über die Eltern), Steuernummer, Kleinunternehmerregelung prüfen (§ 19 UStG) – Steuerberatung empfohlen.
- [ ] **Eigenen Lizenzschlüssel erzeugen** (auf deinem PC, einmalig): `node scripts/license-tool.mjs keygen`. Den ausgegebenen öffentlichen Schlüssel in `src/license/license.ts` bei `LICENSE_PUBLIC_KEY` eintragen lassen. Die Datei `.keys/license-private.pem` **niemals** hochladen oder weitergeben (ist per `.gitignore` ausgeschlossen) und sicher sichern (z. B. USB-Stick). Grund: Der private Schlüssel zum jetzigen öffentlichen Schlüssel lag nur in der Entwicklungsumgebung und ist nicht mehr verfügbar – ohne neuen Schlüssel kannst du keine Lizenzen ausstellen.
- [ ] **Pläne sperren** (Plus/Pro/Team): Build-Variable `VITE_LICENSE_ENFORCE=1`. Free bleibt vollwertig. Vorher AGB, Widerrufsbelehrung und Preisangaben (inkl. MwSt.) final prüfen lassen.
- [ ] **Partner-Links**: bei den Partnerprogrammen anmelden (z. B. reichelt, BerryBase, LCSC – Bedingungen lesen, manche verlangen Volljährigkeit), Kennungen als `VITE_PARTNER_REICHELT`, `VITE_PARTNER_BERRYBASE`, `VITE_PARTNER_LCSC` setzen, dann `VITE_PARTNER_LINKS=1`. Der Hinweis „Nodaris erhält eine Provision, für dich ändert sich der Preis nicht“ erscheint automatisch an jedem Partner-Link – nicht entfernen (Kennzeichnungspflicht für Werbung).
- [ ] **Bausätze**: Lieferanten, Lager/Versand, Gewährleistung, Verpackungsgesetz (LUCID-Registrierung), Elektrogesetz (bei Elektronik ggf. WEEE-Registrierung, stiftung ear), CE/Sicherheit klären. Dann `VITE_KITS=1`.
- [ ] **Marktplatz** (15 % für Nodaris): Zahlungsanbieter mit Marktplatz-Funktion (z. B. Stripe Connect, Mollie Connect) – der Anbieter übernimmt Identitätsprüfung und Auszahlung an Verkäufer. Plattform-AGB, Widerruf für digitale Inhalte, **DAC7-Meldepflicht** (Verkäufer-Daten ans Bundeszentralamt für Steuern), Umgang mit Rückbuchungen. Dann Server mit `MARKETPLACE=1` starten und `VITE_MARKETPLACE=1` bauen.
- [ ] **Echte Zahlungen**: `server/payments.mjs` hat absichtlich keinen Live-Modus – der muss mit dem gewählten Anbieter eingebaut und getestet werden (Testmodus des Anbieters zuerst).
- [ ] Einstellungen → **Transparenz** prüfen: dort muss stehen, was eingeschaltet ist.

## Unternehmen
- [ ] Gewerbe anmelden bzw. Gesellschaft gründen (z. B. UG/GmbH) – Rechtsform mit Steuerberatung klären
- [ ] Umsatzsteuer: Kleinunternehmerregelung ja/nein; bei Verkauf in die EU: OSS-Verfahren – oder Merchant of Record (Paddle/Lemon Squeezy) übernimmt die USt.
- [ ] Geschäftskonto, Buchhaltung, Aufbewahrungspflichten (GoBD)
- [ ] Betriebshaftpflicht / Vermögensschadenhaftpflicht (Software kann Schäden an Hardware verursachen)

## Marke & Domain
- [ ] **Markenrecherche „Nodaris“** beim DPMA (DPMAregister) und EUIPO (eSearch plus, TMview) in den Klassen 9 (Software) und 42 (SaaS)
- [ ] Markenanmeldung (DE und/oder EU) – erst nach positiver Recherche Logo und Namen öffentlich nutzen
- [ ] Domain sichern (z. B. nodaris.de / nodaris.com / nodaris.eu); `nodaris.example` im Code durch die echte Domain ersetzen (`src/brand/brand.ts`)
- [ ] Prüfen, ob „Ohm Studio“ als Produktname frei ist

## Rechtstexte
- [ ] Alle Entwürfe in diesem Ordner von einer Anwältin / einem Anwalt (IT-Recht) prüfen und anpassen lassen
- [ ] Impressum mit echten Angaben, Datenschutzerklärung mit echten Dienstleistern (Hosting, Zahlungsanbieter, E-Mail)
- [ ] AVV-Vorlage für Firmenkunden, Liste der Unterauftragsverarbeiter
- [ ] Verzeichnis von Verarbeitungstätigkeiten (Art. 30 DSGVO), ggf. Datenschutzbeauftragte(r)
- [ ] Barrierefreiheitsstärkungsgesetz (BFSG) prüfen – gilt seit 28.06.2025 für bestimmte Online-Dienste an Verbraucher

## Technik
- [ ] Code-Signatur-Zertifikat (Windows EV/OV, Apple Developer ID) beschaffen und in CI hinterlegen
- [ ] Lizenzschlüssel neu erzeugen (`npm run license keygen`), öffentlichen Schlüssel eintragen, privaten Schlüssel sicher verwahren (Passwort-Manager/HSM)
- [ ] Zahlungsanbieter-Konto (Testmodus → Livemodus), Webhook für Lizenzausstellung
- [ ] Server in der EU (z. B. Frankfurt) betreiben; Backups, Monitoring, Incident-Prozess
- [ ] Exportkontrolle: Programm enthält Verschlüsselung (AES/TLS) – Massenmarktausnahme prüfen
- [ ] Sicherheitstests (Penetrationstest) vor Firmenverkauf; ISO 27001/SOC 2 sind organisatorische Projekte

## Inhalte
- [ ] Rechte an Beispielprojekten, Bildern, Schriften prüfen (Inter, JetBrains Mono: SIL OFL – erlaubt)
- [ ] MicroPython-Firmware (MIT) und rp2040js/avr8js (MIT) – Lizenzhinweise sind in `drittanbieter-lizenzen.md`
