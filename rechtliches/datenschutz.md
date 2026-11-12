# Datenschutzerklärung – Ohm Studio by Nodaris

> ⚠️ **ENTWURF – NICHT VERÖFFENTLICHEN, BEVOR EINE FACHKUNDIGE PERSON (RECHTSANWALT/-ANWÄLTIN) IHN GEPRÜFT HAT.**
> Dieser Text wurde automatisch erstellt, ersetzt keine Rechtsberatung und kann Fehler, Lücken oder veraltete Rechtslagen enthalten. Platzhalter stehen in [ECKIGEN KLAMMERN].

## 1. Verantwortlicher
[Name/Firma, Anschrift, E-Mail] – siehe Impressum. Datenschutzbeauftragte(r): [falls bestellt].

## 2. Grundsatz
Ohm Studio arbeitet **lokal auf deinem Gerät**. Projekte, Code und Simulationen verlassen deinen Rechner nur, wenn du eine der unten genannten Funktionen ausdrücklich nutzt. Es gibt **keine Werbung, keine Tracker und keine versteckte Telemetrie**.

## 3. Verarbeitungen im Programm

| Funktion | Welche Daten | Empfänger | Rechtsgrundlage | Wann |
|---|---|---|---|---|
| Testphase (Windows-Programm) | Startdatum, anonyme Geräte-Kennung (Einweg-Hash der Windows-MachineGuid), gespeichert nur lokal (Registry HKCU und Benutzerprofil) | – (verlässt den Rechner nicht) | Art. 6 Abs. 1 lit. f DSGVO (Schutz vor Mehrfach-Testphasen) | bleibt nach Deinstallation, löschbar über Registry-Schlüssel `HKCU\Software\Nodaris\OhmStudio` und `%LOCALAPPDATA%\Nodaris` |
| Lizenzprüfung | Lizenz-ID | Nodaris | Art. 6 Abs. 1 lit. b DSGVO (Vertrag) | nur mit aktivierter Lizenz, max. täglich |
| Update-Suche | Programmversion, Kanal, IP-Adresse (technisch) | Nodaris | Art. 6 Abs. 1 lit. f (Sicherheit) | beim Start, abschaltbar |
| KI-Funktionen | Projektinhalt, Code, ggf. PDF-Datenblätter | Anthropic PBC (USA) bzw. der von deiner Organisation eingetragene Anbieter | Art. 6 Abs. 1 lit. a (Einwilligung durch Eingabe des eigenen Schlüssels und Aufruf) | nur auf Aufruf |
| Live-Preise | Herstellerteilenummern | gewählter Distributor (Nexar/Octopart, Mouser) | Art. 6 Abs. 1 lit. a | nur nach Zustimmung |
| Nodaris Cloud / Firmenserver | Konto (Name, E-Mail, Passwort-Hash), Projekte (verschlüsselt), Audit-Log (Aktion, Zeit, IP) | Nodaris bzw. Betreiber des Firmenservers | Art. 6 Abs. 1 lit. b bzw. AVV | bei Nutzung |
| Live-Zusammenarbeit | Projektstand, Name, Auswahl | eingetragener Server, andere Teilnehmer | Art. 6 Abs. 1 lit. b | während der Sitzung |
| Klassenräume | Name, Abgaben, Punkte | Server der Schule bzw. Nodaris | Art. 6 Abs. 1 lit. b / e | bei Nutzung |
| Teilen-Link | gesamtes Projekt in der URL | wer den Link erhält | – | nur auf Aufruf |

## 4. Website
Server-Logfiles (IP-Adresse, Zeit, Seite, Browser) für max. [7] Tage zur Sicherheit (Art. 6 Abs. 1 lit. f). Keine Cookies außer technisch notwendigen. Keine Analyse-Werkzeuge. [ANPASSEN, falls doch eingesetzt]

## 5. Zahlungen
Zahlungen wickelt [Paddle.com Market Ltd. / Lemon Squeezy LLC / Stripe Payments Europe Ltd.] als [Händler (Merchant of Record) / Zahlungsdienstleister] ab. Es gilt dessen Datenschutzerklärung. Wir erhalten Name, E-Mail, Land, Plan und Rechnungsstatus, **keine** vollständigen Zahlungsdaten.

## 6. Übermittlung in Drittländer
Bei Nutzung der KI-Funktionen mit Anthropic erfolgt eine Übermittlung in die USA. [Grundlage: EU-US Data Privacy Framework / Standardvertragsklauseln – PRÜFEN]

## 7. Speicherdauer
Konten bis zur Löschung, Projekte bis zur Löschung durch dich, Audit-Logs [12 Monate / nach Vorgabe der Organisation], Rechnungsdaten 10 Jahre (§ 147 AO).

## 8. Deine Rechte
Auskunft (Art. 15), Berichtigung (16), Löschung (17), Einschränkung (18), Datenübertragbarkeit (20), Widerspruch (21), Widerruf von Einwilligungen (7 Abs. 3), Beschwerde bei einer Aufsichtsbehörde (77), z. B. [zuständige Landesdatenschutzbehörde].

## 9. Sicherheit
TLS bei jeder Übertragung, AES-256-GCM für gespeicherte Projekte, Passwörter mit scrypt, optionale Zwei-Faktor-Anmeldung.

Stand: [Datum]
