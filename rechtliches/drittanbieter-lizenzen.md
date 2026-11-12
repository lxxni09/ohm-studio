# Drittanbieter-Lizenzen

> ⚠️ **ENTWURF – NICHT VERÖFFENTLICHEN, BEVOR EINE FACHKUNDIGE PERSON (RECHTSANWALT/-ANWÄLTIN) IHN GEPRÜFT HAT.**
> Dieser Text wurde automatisch erstellt, ersetzt keine Rechtsberatung und kann Fehler, Lücken oder veraltete Rechtslagen enthalten. Platzhalter stehen in [ECKIGEN KLAMMERN].

| Komponente | Lizenz | Verwendung |
|---|---|---|
| React, React DOM | MIT | Oberfläche |
| Vite | MIT | Build |
| Electron | MIT | Desktop-Programm (enthält Chromium: BSD-3 u. a.) |
| three.js | MIT | 3D-Darstellung |
| avr8js | MIT | AVR-Emulator |
| rp2040js | MIT | RP2040-Emulator (inkl. Bootrom-Daten von Raspberry Pi: BSD-3-Clause) |
| MicroPython 1.24.1 (Firmware .uf2) | MIT | echtes MicroPython auf dem emulierten Pico |
| yaml | ISC | .ohm-Format |
| @anthropic-ai/sdk | MIT | KI-Funktionen |
| Inter, JetBrains Mono (@fontsource) | SIL Open Font License 1.1 | Schriften |

Vollständige Lizenztexte liegen den jeweiligen Paketen in `node_modules/*/LICENSE` bei und müssen im Installationspaket mitgeliefert werden. [PRÜFEN: automatischen Lizenzbericht im Build erzeugen, z. B. mit `license-checker`]

Nicht mitgeliefert, nur optional aufgerufen (GPL): ngspice, simavr, QEMU, Renode, arduino-cli (GPL-3.0), PlatformIO (Apache-2.0).
