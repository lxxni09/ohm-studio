/**
 * Kurs „Elektronik in 30 Lektionen“ – jede Lektion mit kurzer Theorie, Aufgabe und automatischer Prüfung.
 */
import type { Kriterium } from './grading';

export interface Lektion {
  nr: number;
  titel: string;
  kapitel: string;
  theorie: string;
  aufgabe: string;
  tipp: string;
  kriterien: Kriterium[];
  /** Startprojekt: Beispiel-Schlüssel oder leer */
  start?: string;
}

const L = (nr: number, kapitel: string, titel: string, theorie: string, aufgabe: string, tipp: string, kriterien: Kriterium[], start?: string): Lektion => ({ nr, kapitel, titel, theorie, aufgabe, tipp, kriterien, start });

export const KURS: Lektion[] = [
  L(1, 'Grundlagen', 'Der erste Stromkreis', 'Strom fließt nur in einem **geschlossenen Kreis**: von Plus durch den Verbraucher zurück zu Minus. Eine LED leuchtet, wenn Strom von der Anode (A, langes Bein) zur Kathode (K) fließt.', 'Baue einen Kreis aus Batteriehalter, Widerstand und LED, sodass die LED leuchtet.', 'Batterie + → Widerstand → LED A, LED K → Batterie −.', [{ art: 'teil', typ: 'batteriehalter' }, { art: 'teil', typ: 'led' }, { art: 'teil', typ: 'widerstand' }, { art: 'led_an' }]),
  L(2, 'Grundlagen', 'Das ohmsche Gesetz', '**U = R · I.** Am Vorwiderstand liegt die Differenz aus Versorgung und LED-Flussspannung (rot ≈ 2 V). Bei 5 V und 220 Ω fließen (5 − 2) / 220 ≈ 14 mA.', 'Wähle den Vorwiderstand so, dass die LED mit 5–20 mA betrieben wird.', 'Rechne R = (U − 2 V) / I. Ein Klick auf den Widerstand zeigt seinen Wert im Inspektor.', [{ art: 'led_strom', min_mA: 5, max_mA: 20 }, { art: 'keine_fehler' }]),
  L(3, 'Grundlagen', 'Reihenschaltung', 'In Reihe fließt durch alle Bauteile **derselbe Strom**, die Spannungen addieren sich.', 'Schalte zwei LEDs mit einem gemeinsamen Vorwiderstand in Reihe an 9 V – beide sollen leuchten.', 'Zwei rote LEDs brauchen zusammen ≈ 4 V. Nimm z. B. 330 Ω.', [{ art: 'teil', typ: 'led', anzahl: 2 }, { art: 'led_an', anzahl: 2 }]),
  L(4, 'Grundlagen', 'Parallelschaltung', 'Parallel liegt an allen Zweigen **dieselbe Spannung**, die Ströme addieren sich. Jede LED braucht ihren eigenen Vorwiderstand.', 'Baue drei parallele Zweige aus je Widerstand + LED.', 'Alle Widerstände an +, alle Kathoden an −.', [{ art: 'teil', typ: 'led', anzahl: 3 }, { art: 'teil', typ: 'widerstand', anzahl: 3 }, { art: 'led_an', anzahl: 3 }]),
  L(5, 'Grundlagen', 'Der Spannungsteiler', 'Zwei Widerstände teilen eine Spannung im Verhältnis ihrer Werte: **U₂ = U · R₂ / (R₁ + R₂)**.', 'Erzeuge aus 5 V eine Spannung zwischen 2,3 und 2,7 V.', 'Zwei gleich große Widerstände halbieren die Spannung.', [{ art: 'teil', typ: 'widerstand', anzahl: 2 }, { art: 'spannung', min: 2.3, max: 2.7 }]),
  L(6, 'Bauteile', 'Taster und Schalter', 'Ein Taster schließt den Kreis nur, solange er gedrückt ist. In der Simulation kannst du ihn anklicken.', 'Baue eine Schaltung, in der eine LED nur bei gedrücktem Taster leuchtet.', 'Taster in Reihe zu Widerstand und LED. Ungedrückt muss die LED aus sein.', [{ art: 'teil', typ: 'taster' }, { art: 'led_aus' }, { art: 'teil', typ: 'led' }]),
  L(7, 'Bauteile', 'Der Kondensator', 'Ein Kondensator speichert Ladung. Elkos sind gepolt (+ an die höhere Spannung!). Parallel zur Versorgung glättet er Spannungseinbrüche.', 'Setze einen Elko polungsrichtig parallel zur Versorgung einer LED-Schaltung.', 'Elko + an Batterie +, − an −.', [{ art: 'teil', typ: 'elko' }, { art: 'led_an' }, { art: 'keine_fehler' }]),
  L(8, 'Bauteile', 'RC-Glied und Zeitkonstante', 'Widerstand und Kondensator bilden ein Zeitglied: **τ = R · C**. Nach 5 τ ist der Kondensator praktisch voll.', 'Baue ein RC-Glied aus Widerstand und Kondensator an einer Spannungsquelle.', '10 kΩ und 100 µF ergeben τ = 1 s.', [{ art: 'teil', typ: 'widerstand' }, { art: 'kategorie', kategorie: 'Passiv', anzahl: 2 }, { art: 'keine_fehler' }]),
  L(9, 'Bauteile', 'Die Diode', 'Eine Diode lässt Strom nur in eine Richtung. Als **Verpolschutz** in Reihe zur Batterie schützt sie die Schaltung.', 'Füge einer LED-Schaltung eine 1N4007 als Verpolschutz hinzu – die LED soll weiter leuchten.', 'Diode in Durchlassrichtung: Anode zur Batterie +.', [{ art: 'teil', typ: '1n4007' }, { art: 'led_an' }]),
  L(10, 'Bauteile', 'Der Transistor als Schalter', 'Ein kleiner Basisstrom steuert einen großen Kollektorstrom (NPN, z. B. BC547). Basiswiderstand nicht vergessen!', 'Schalte eine LED über einen BC547. Die Basis bekommt Strom über einen Widerstand.', 'Last zwischen + und Kollektor, Emitter an −, Basis über 10 kΩ an +.', [{ art: 'teil', typ: 'BC547' }, { art: 'led_an' }, { art: 'keine_fehler' }]),
  L(11, 'Bauteile', 'Der MOSFET', 'MOSFETs werden über die **Gate-Spannung** gesteuert und schalten große Ströme fast verlustfrei. Logic-Level-Typen (IRLZ44N) schalten schon mit 5 V.', 'Schalte eine LED mit einem IRLZ44N. Gate über einen Widerstand an +5 V.', 'Pull-down am Gate (100 kΩ) verhindert undefinierte Zustände.', [{ art: 'teil', typ: 'IRLZ44N' }, { art: 'led_an' }]),
  L(12, 'Bauteile', 'Relais und Freilaufdiode', 'Spulen erzeugen beim Abschalten hohe Spannungsspitzen. Eine **Freilaufdiode** antiparallel zur Spule fängt sie ab.', 'Baue eine Relaisschaltung mit einem Relais-Modul und schalte damit eine LED.', 'Relais-Module haben die Diode schon eingebaut.', [{ art: 'teil', typ: 'relais' }, { art: 'teil', typ: 'led' }]),
  L(13, 'Sensoren', 'Licht messen mit dem LDR', 'Ein Fotowiderstand (LDR) wird bei Licht niederohmig. Im Spannungsteiler wird daraus eine Spannung.', 'Baue einen Spannungsteiler aus LDR und Festwiderstand.', '10 kΩ als Gegenwiderstand passt gut.', [{ art: 'teil', typ: 'ldr' }, { art: 'teil', typ: 'widerstand' }, { art: 'spannung', min: 0.3, max: 4.7 }]),
  L(14, 'Sensoren', 'Temperatur mit dem NTC', 'Ein NTC wird bei Wärme niederohmiger. Mit einem Spannungsteiler und einem Mikrocontroller misst du so Temperatur.', 'Baue einen Spannungsteiler mit NTC.', 'NTC 10 k + Widerstand 10 k an 5 V.', [{ art: 'teil', typ: 'ntc' }, { art: 'spannung', min: 1, max: 4 }]),
  L(15, 'Sensoren', 'Das Potentiometer', 'Ein Poti ist ein einstellbarer Spannungsteiler: der Schleifer (Pin 2) greift eine Teilspannung ab.', 'Schließe ein Poti an 5 V an und nutze den Schleifer.', 'Pin 1 an +, Pin 3 an −, Pin 2 ist der Ausgang.', [{ art: 'teil', typ: 'potentiometer' }, { art: 'spannung', min: 0.5, max: 4.5 }]),
  L(16, 'Mikrocontroller', 'Blink – das Hallo Welt', '`pinMode` stellt einen Pin als Ausgang ein, `digitalWrite` schaltet ihn, `delay` wartet Millisekunden.', 'Lass eine LED am Arduino blinken.', 'LED mit 220 Ω an D13, Kathode an GND.', [{ art: 'teil', typ: 'arduino-uno' }, { art: 'code', muster: 'digitalWrite' }, { art: 'code', muster: 'delay' }, { art: 'led_an' }], 'blink'),
  L(17, 'Mikrocontroller', 'Helligkeit mit PWM', '`analogWrite(pin, 0…255)` schaltet sehr schnell an und aus – das Auge sieht mittlere Helligkeit. Nur Pins mit ~ können PWM.', 'Dimme eine LED mit analogWrite.', 'Pin 9, 10 oder 11 am Uno.', [{ art: 'code', muster: 'analogWrite' }, { art: 'led_an' }]),
  L(18, 'Mikrocontroller', 'Analoge Werte lesen', '`analogRead(A0)` liefert 0…1023 für 0…5 V.', 'Lies ein Poti mit analogRead ein.', 'Schleifer an A0.', [{ art: 'teil', typ: 'potentiometer' }, { art: 'code', muster: 'analogRead' }]),
  L(19, 'Mikrocontroller', 'Der serielle Monitor', 'Mit `Serial.begin(9600)` und `Serial.println()` schickt der Arduino Text an den Computer – ideal zur Fehlersuche.', 'Gib Messwerte über die serielle Schnittstelle aus.', 'Die Ausgabe erscheint unten im Tab „Seriell“.', [{ art: 'code', muster: 'Serial\\.begin' }, { art: 'code', muster: 'Serial\\.print' }]),
  L(20, 'Mikrocontroller', 'Taster einlesen', '`pinMode(pin, INPUT_PULLUP)` aktiviert den internen Pull-up: ungedrückt HIGH, gedrückt LOW.', 'Lies einen Taster mit digitalRead ein und schalte damit eine LED.', 'Taster zwischen Pin und GND.', [{ art: 'teil', typ: 'taster' }, { art: 'code', muster: 'digitalRead' }, { art: 'code', muster: 'INPUT_PULLUP' }]),
  L(21, 'Mikrocontroller', 'Lauflicht', 'Mit Schleifen und Arrays steuerst du viele Ausgänge elegant: `for (int i = 0; i < 4; i++)`.', 'Baue ein Lauflicht mit mindestens 4 LEDs.', 'Ein Array mit den Pin-Nummern spart Tipparbeit.', [{ art: 'teil', typ: 'led', anzahl: 4 }, { art: 'code', muster: 'for\\s*\\(' }, { art: 'led_an' }]),
  L(22, 'Mikrocontroller', 'Schieberegister 74HC595', 'Ein Schieberegister macht aus 3 Pins 8 Ausgänge: Daten seriell hineinschieben, dann übernehmen (Latch).', 'Steuere LEDs über einen 74HC595.', '`shiftOut(DATA, CLOCK, MSBFIRST, wert)`.', [{ art: 'teil', typ: '74hc595' }, { art: 'code', muster: 'shiftOut|digitalWrite' }, { art: 'led_an' }], 'lauflicht-595'),
  L(23, 'Mikrocontroller', 'Töne mit dem Summer', '`tone(pin, frequenz)` erzeugt eine Rechteckschwingung, `noTone(pin)` stoppt sie.', 'Spiele einen Ton auf einem Summer.', 'Summer + an einen Pin, − an GND.', [{ art: 'teil', typ: 'summer' }, { art: 'code', muster: 'tone\\(' }]),
  L(24, 'Mikrocontroller', 'Servomotoren', 'Servos stellen einen Winkel 0…180° ein. Die Bibliothek `Servo.h` erzeugt das Steuersignal.', 'Steuere einen Servo mit einem Poti.', '`myservo.write(map(analogRead(A0), 0, 1023, 0, 180))`.', [{ art: 'teil', typ: 'servo' }, { art: 'code', muster: 'Servo' }], 'servo-poti'),
  L(25, 'Mikrocontroller', 'Entfernung messen', 'Der HC-SR04 sendet Ultraschall; die Laufzeit des Echos (`pulseIn`) ergibt die Entfernung: cm = µs / 58.', 'Miss eine Entfernung mit dem HC-SR04.', 'TRIG 10 µs HIGH, dann pulseIn(ECHO, HIGH).', [{ art: 'teil', typ: 'hc-sr04' }, { art: 'code', muster: 'pulseIn' }], 'abstandswarner'),
  L(26, 'Mikrocontroller', 'Ein OLED-Display', 'Das SSD1306 hängt am I²C-Bus (SDA/SCL). Mit `display.print()` schreibst du Text.', 'Zeige Text auf einem SSD1306 an.', 'SDA an A4, SCL an A5 beim Uno.', [{ art: 'teil', typ: 'ssd1306' }, { art: 'code', muster: 'display' }]),
  L(27, 'Analogtechnik', 'Der Timer NE555', 'Der 555 erzeugt ohne Mikrocontroller Takte. Astabil: f ≈ 1,44 / ((R1 + 2·R2) · C).', 'Baue einen 555-Blinker.', 'Starte mit dem Beispiel „Timer 555“ und ändere die Frequenz.', [{ art: 'teil', typ: 'ne555' }, { art: 'teil', typ: 'elko' }, { art: 'keine_fehler' }], 'timer555'),
  L(28, 'Analogtechnik', 'Der Operationsverstärker', 'Ein OPV verstärkt die Differenz seiner Eingänge enorm. Als **Komparator** schaltet er, sobald IN+ > IN−.', 'Baue einen Komparator mit dem LM358, der eine LED schaltet.', 'IN+ an einen Spannungsteiler, IN− an eine feste Referenz.', [{ art: 'teil', typ: 'lm358' }, { art: 'teil', typ: 'led' }]),
  L(29, 'Profi', 'Fehlersuche mit den Analysen', 'Gute Entwickler prüfen vor dem Bau: Wärme, Toleranzen, Fehlerfälle. Öffne „Analysen“ im Menü.', 'Bringe ein Projekt in einen Zustand ohne Fehler in Prüfung und Simulation.', 'Das Review unter „KI-Werkzeuge“ hilft beim Finden.', [{ art: 'keine_fehler' }, { art: 'kategorie', kategorie: 'Mikrocontroller', anzahl: 1 }]),
  L(30, 'Profi', 'Die eigene Platine', 'Aus dem Schaltplan wird eine Platine: Bauteile platzieren, Leiterbahnen routen, Fertigungsregeln (DRC) prüfen, Gerber exportieren.', 'Erstelle ein Projekt, dessen Platine die DRC-Prüfung ohne Fehler besteht.', 'Ansicht „Platine“ öffnen – rote Markierungen zeigen Verstöße.', [{ art: 'drc_sauber' }, { art: 'teil', typ: 'widerstand' }]),
];

export interface Fortschritt {
  erledigt: Record<number, string>;
}

export function loadProgress(): Fortschritt {
  try {
    return JSON.parse(localStorage.getItem('ohm.kurs') ?? '{"erledigt":{}}') as Fortschritt;
  } catch {
    return { erledigt: {} };
  }
}

export function saveProgress(f: Fortschritt) {
  try {
    localStorage.setItem('ohm.kurs', JSON.stringify(f));
  } catch {
    /* egal */
  }
}
