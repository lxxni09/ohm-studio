import type { BoardDef } from '../parts/boards';

export function DEFAULT_SKETCH(b: BoardDef): string {
  const led = b.ledBuiltin !== undefined ? 'LED_BUILTIN' : '2';
  const baud = b.family === 'avr' ? 9600 : 115200;
  return `// ${b.name} – los geht's!
// Tipp: Unten auf ▶ drücken, um die Simulation zu starten.

void setup() {
  Serial.begin(${baud});
  pinMode(${led}, OUTPUT);
  Serial.println("Hallo von ${b.name}!");
}

void loop() {
  digitalWrite(${led}, HIGH);   // LED an
  delay(500);
  digitalWrite(${led}, LOW);    // LED aus
  delay(500);
}
`;
}
