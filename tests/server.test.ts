import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
// @ts-expect-error – reines ESM-JS ohne Typen
import { createEnterprise } from '../server/enterprise.mjs';

describe('Nodaris-Server (Firmenfunktionen)', () => {
  const logs: unknown[] = [];
  process.env.DATA_KEY = '11'.repeat(32);
  const ent = createEnterprise({ dataDir: mkdtempSync(join(tmpdir(), 'nod-')), audit: (e: unknown) => logs.push(e) });
  it('AES-256-GCM: verschlüsselt und erkennt Manipulation', () => {
    const enc: Buffer = ent.encrypt('geheime Schaltung');
    expect(enc.subarray(0, 4).toString()).toBe('AES1');
    expect(enc.toString()).not.toContain('geheim');
    expect(ent.decrypt(enc)).toBe('geheime Schaltung');
    enc[enc.length - 1] ^= 1;
    expect(() => ent.decrypt(enc)).toThrow();
  });
  it('TOTP nach RFC 6238 (Testvektor)', () => {
    // RFC 6238 Anhang B: Schlüssel "12345678901234567890", T=59 s → 94287082 (8 Stellen) → 6 Stellen: 287082
    expect(ent.totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000)).toBe('287082');
  });
});
