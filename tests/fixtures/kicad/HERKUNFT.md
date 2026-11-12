# Herkunft der KiCad-Testdateien

Originaldateien aus dem Ordner `demos/` des KiCad-Projekts (https://gitlab.com/kicad/code/kicad),
Versionen 7.0.0 (`v7/`), 8.0.0 (`v8/`) und master vom 11.11.2026 (`v9/`, Dateiformat 20260101).
Lizenz: wie das KiCad-Projekt (GPL-3.0-or-later). Nur als Testdaten verwendet, nicht im Programm enthalten.

`*.kicad7-netzliste.xml` wurde mit KiCad 7.0.11 erzeugt:
`kicad-cli sch export netlist --format kicadxml -o <datei>.xml <datei>.kicad_sch`
Sie dient als unabhängige Referenz: Ohm Studios Import muss dieselben Verbindungen finden wie KiCad selbst.
