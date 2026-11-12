# Vertrag zur Auftragsverarbeitung (AVV) gemäß Art. 28 DSGVO

> ⚠️ **ENTWURF – NICHT VERÖFFENTLICHEN, BEVOR EINE FACHKUNDIGE PERSON (RECHTSANWALT/-ANWÄLTIN) IHN GEPRÜFT HAT.**
> Dieser Text wurde automatisch erstellt, ersetzt keine Rechtsberatung und kann Fehler, Lücken oder veraltete Rechtslagen enthalten. Platzhalter stehen in [ECKIGEN KLAMMERN].

zwischen **[KUNDE]** („Verantwortlicher“) und **[FIRMA / Nodaris]** („Auftragsverarbeiter“)

## 1. Gegenstand und Dauer
Betrieb der Nodaris Cloud (Projektspeicher, Live-Zusammenarbeit, Klassenräume, Audit-Log, Anmeldung inkl. SSO/SCIM) für die Laufzeit des Hauptvertrags.

## 2. Art der Daten und betroffene Personen
Beschäftigte, Schülerinnen/Schüler bzw. Nutzer des Verantwortlichen: Name, E-Mail, Rolle, Anmeldezeitpunkte, IP-Adressen (Audit-Log), Projektinhalte.

## 3. Weisungen
Verarbeitung nur auf dokumentierte Weisung. Hält der Auftragsverarbeiter eine Weisung für rechtswidrig, informiert er unverzüglich.

## 4. Technische und organisatorische Maßnahmen (Anlage 1)
- Verschlüsselung: TLS 1.3 bei Übertragung, AES-256-GCM für gespeicherte Projekte
- Zugriff: Rollenmodell, Zwei-Faktor-Anmeldung, SSO, SCIM-Deprovisionierung
- Protokollierung: Audit-Log aller schreibenden Aktionen
- Hosting in der EU ([Rechenzentrum, Frankfurt]); Backups verschlüsselt, [täglich], Aufbewahrung [30 Tage]
- Mandantentrennung; Self-Hosted-Option für vollständige Kontrolle
- [ERGÄNZEN: physische Sicherheit, Notfallplan, Tests]

## 5. Unterauftragsverarbeiter (Anlage 2)
| Unternehmen | Zweck | Ort |
|---|---|---|
| [Hosting-Anbieter] | Rechenzentrum | EU |
| [E-Mail-Versand] | Systemnachrichten | EU |
Änderungen werden [30 Tage] vorher angekündigt; Widerspruchsrecht.

## 6. Pflichten
Vertraulichkeit der Mitarbeitenden, Unterstützung bei Betroffenenrechten, Meldung von Datenschutzverletzungen binnen [24] Stunden, Unterstützung bei DSFA.

## 7. Löschung und Rückgabe
Nach Vertragsende Rückgabe (Export aller Projekte als .ohm) und Löschung binnen [30] Tagen, sofern keine Aufbewahrungspflicht besteht.

## 8. Kontrollrechte
Nachweise durch Zertifikate/Berichte [ISO 27001 / SOC 2 – sobald vorhanden] oder Vor-Ort-Prüfung nach Absprache.

Ort, Datum, Unterschriften: ______
