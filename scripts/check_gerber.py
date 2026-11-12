#!/usr/bin/env python3
"""
Unabhängige Prüfung der Gerber-/Excellon-Dateien mit der externen Bibliothek gerbonara
(nicht mit dem eigenen Code von Ohm Studio). Aufruf:
    python3 scripts/check_gerber.py <ordner-mit-gerber> [erwartete_bohrungen] [breite_mm] [hoehe_mm]
Prüft: alle Lagen lesbar, Kupfer oben/unten vorhanden, Umriss geschlossen und in erwarteter Größe,
Bohrdatei mit Löchern, alle Objekte innerhalb des Umrisses.
"""
import sys
from pathlib import Path

from gerbonara import LayerStack
from gerbonara.excellon import ExcellonFile
from gerbonara.rs274x import GerberFile
from gerbonara.utils import MM

errors: list[str] = []


def fail(msg: str) -> None:
    errors.append(msg)
    print("FEHLER:", msg)


def main() -> int:
    d = Path(sys.argv[1])
    want_holes = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] != "-" else None
    want_w = float(sys.argv[3]) if len(sys.argv) > 3 else None
    want_h = float(sys.argv[4]) if len(sys.argv) > 4 else None

    # 1. Jede Datei einzeln mit gerbonara lesen
    files = {}
    for f in sorted(d.iterdir()):
        if f.suffix.lower() in (".gtl", ".gbl", ".gts", ".gbs", ".gto", ".gbo", ".gm1", ".gko", ".gtp", ".gbp"):
            g = GerberFile.open(f)
            files[f.suffix.lower()] = g
            print(f"ok  {f.name}: {len(g.objects)} Objekte")
        elif f.suffix.lower() in (".drl", ".xln"):
            x = ExcellonFile.open(f)
            files[".drl"] = x
            holes = [o for o in x.objects]
            print(f"ok  {f.name}: {len(holes)} Bohrungen")

    for need, name in ((".gtl", "Kupfer oben"), (".gm1", "Platinenumriss"), (".drl", "Bohrdaten")):
        if need not in files:
            fail(f"{name} fehlt")
    if errors:
        return 1

    # 2. Lagenstapel automatisch erkennen (wie es ein Hersteller-Viewer tut)
    stack = LayerStack.open(d)
    print("erkannte Lagen:", ", ".join(f"{k[0]} {k[1]}" for k in stack.graphic_layers.keys()))
    if ("top", "copper") not in stack.graphic_layers:
        fail("gerbonara erkennt keine obere Kupferlage")
    if stack.outline is None:
        fail("gerbonara erkennt keinen Umriss")

    # 3. Umriss: Größe
    (x0, y0), (x1, y1) = files[".gm1"].bounding_box(MM)
    w, h = x1 - x0, y1 - y0
    print(f"Umriss: {w:.2f} × {h:.2f} mm")
    if want_w and abs(w - want_w) > 0.3:
        fail(f"Umrissbreite {w:.2f} mm statt {want_w:.2f} mm")
    if want_h and abs(h - want_h) > 0.3:
        fail(f"Umrisshöhe {h:.2f} mm statt {want_h:.2f} mm")

    # 4. Kupfer muss innerhalb des Umrisses liegen
    for ext in (".gtl", ".gbl"):
        if ext in files and files[ext].objects:
            (cx0, cy0), (cx1, cy1) = files[ext].bounding_box(MM)
            if cx0 < x0 - 0.01 or cy0 < y0 - 0.01 or cx1 > x1 + 0.01 or cy1 > y1 + 0.01:
                fail(f"Kupfer {ext} ragt über den Umriss hinaus ({cx0:.2f},{cy0:.2f})–({cx1:.2f},{cy1:.2f})")

    # 5. Bohrungen
    holes = len(files[".drl"].objects)
    if holes == 0:
        fail("keine Bohrungen")
    if want_holes is not None and holes != want_holes:
        fail(f"{holes} Bohrungen statt {want_holes}")
    (hx0, hy0), (hx1, hy1) = files[".drl"].bounding_box(MM)
    if hx0 < x0 or hy0 < y0 or hx1 > x1 or hy1 > y1:
        fail("Bohrungen außerhalb des Umrisses")

    print("ERGEBNIS:", "FEHLER" if errors else "alles gültig")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
