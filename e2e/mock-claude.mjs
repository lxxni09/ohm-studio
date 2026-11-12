/**
 * Nachgebauter Claude-API-Server für die End-to-End-Tests des Idee-Assistenten (keine echten Kosten, immer
 * gleiche Antworten). Spricht das Streaming-Format von POST /v1/messages (Server-Sent Events).
 *  - Anfrage mit output_config.format (Rückfragen) → JSON mit einer Rückfrage
 *  - erster Bauauftrag → absichtlich fehlerhaftes Projekt (LED ohne Vorwiderstand)
 *  - Reparaturauftrag („automatisch geprüft“) → korrigiertes Projekt
 */
import http from 'node:http';

const projekt = (vor) => `ohm: 1
projekt:
  name: Dämmerungslicht
teile:
  U1: { typ: arduino-uno }
  L1: { typ: ldr }
  R2: { typ: widerstand, wert: 10k }
  D1: { typ: led, farbe: gelb }
${vor ? '  R1: { typ: widerstand, wert: 220 }\n' : ''}netze:
  5V: [U1.5V, L1.1]
  SENS: [L1.2, R2.1, U1.A0]
  GND: [U1.GND, R2.2, D1.K]
${vor ? '  LED: [U1.D9, R1.1]\n  LEDA: [R1.2, D1.A]' : '  LED: [U1.D9, D1.A]'}
code:
  ziel: U1
  datei: |
    void setup() { pinMode(9, OUTPUT); }
    void loop() { digitalWrite(9, analogRead(A0) < 400 ? HIGH : LOW); delay(20); }
`;

export const MOCK_ANSWERS = {
  fragen: { fragen: [{ frage: 'Wie bekommt es Strom?', optionen: ['USB', 'Batterie'] }] },
  kaputt: `Ich habe ein Dämmerungslicht gebaut: Ein Fotowiderstand misst die Helligkeit, bei Dunkelheit schaltet der Arduino die LED ein.\n\n\`\`\`yaml\n${projekt(false)}\`\`\``,
  repariert: `Die LED hatte keinen Vorwiderstand – ich habe 220 Ω ergänzt.\n\n\`\`\`yaml\n${projekt(true)}\`\`\``,
};

function sse(res, text) {
  const ev = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  ev('message_start', { type: 'message_start', message: { id: 'msg_mock', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
  ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  for (let i = 0; i < text.length; i += 80) ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 80) } });
  ev('content_block_stop', { type: 'content_block_stop', index: 0 });
  ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 50 } });
  ev('message_stop', { type: 'message_stop' });
  res.end();
}

export function startMockClaude(port = 0) {
  const log = [];
  const srv = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (!req.url.startsWith('/v1/messages')) return res.writeHead(404).end();
      const b = JSON.parse(body || '{}');
      const last = JSON.stringify(b.messages?.at(-1)?.content ?? '');
      const kind = b.output_config?.format ? 'fragen' : /automatisch gepr/.test(last) ? 'repariert' : 'kaputt';
      log.push({ kind, model: b.model, stream: b.stream, thinking: b.thinking?.type });
      const text = kind === 'fragen' ? JSON.stringify(MOCK_ANSWERS.fragen) : MOCK_ANSWERS[kind];
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      sse(res, text);
    });
  });
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${srv.address().port}`, log, close: () => srv.close() })));
}
