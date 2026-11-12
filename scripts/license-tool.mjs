#!/usr/bin/env node
/**
 * Lizenz-Werkzeug für den Betreiber (Nodaris).
 *   node scripts/license-tool.mjs keygen                 → .keys/license-private.pem + öffentlicher Schlüssel (in src/license/license.ts eintragen)
 *   node scripts/license-tool.mjs sign <plan> <name> [tage=365] [plätze=1] [--offline] [--test]
 * Der private Schlüssel gehört NIE ins Repository oder ins Programm.
 */
import { generateKeyPairSync, createPrivateKey, sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const [cmd, ...args] = process.argv.slice(2);
const b64u = (b) => Buffer.from(b).toString('base64url');

if (cmd === 'keygen') {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  mkdirSync('.keys', { recursive: true });
  writeFileSync('.keys/license-private.pem', privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.log('Öffentlicher Schlüssel (LICENSE_PUBLIC_KEY):\n' + publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
} else if (cmd === 'sign') {
  const flags = args.filter((a) => a.startsWith('--'));
  const [plan, name, tage = '365', seats = '1'] = args.filter((a) => !a.startsWith('--'));
  if (!['free', 'plus', 'pro', 'team', 'enterprise'].includes(plan) || !name) {
    console.error('Aufruf: sign <plus|pro|team|enterprise> <name> [tage] [plätze] [--offline] [--test]');
    process.exit(1);
  }
  const now = Date.now();
  const payload = { id: randomUUID(), plan, name, seats: +seats, issued: now, expires: now + +tage * 86400000, ...(flags.includes('--offline') && { offline: true }), ...(flags.includes('--test') && { test: true }) };
  const data = Buffer.from(JSON.stringify(payload));
  const key = createPrivateKey(readFileSync('.keys/license-private.pem'));
  const sig = sign('sha256', data, { key, dsaEncoding: 'ieee-p1363' });
  console.log(`NODARIS-${b64u(data)}.${b64u(sig)}`);
} else {
  console.log('Befehle: keygen | sign');
}
