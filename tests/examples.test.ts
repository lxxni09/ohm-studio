import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { parseOhm } from '../src/ohm/format';
import { runTests } from '../src/sim/testrunner';

const dir = new URL('../examples/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.ohm'));

describe('Beispielprojekte', () => {
  for (const f of files) {
    it(f, () => {
      const { project, issues } = parseOhm(readFileSync(new URL(f, dir), 'utf8'));
      expect(issues.filter((i) => i.level === 'error').map((i) => i.text)).toEqual([]);
      if (project.tests.length) {
        const res = runTests(project);
        const failed = res.map((r, i) => ({ r, t: project.tests[i] })).filter((x) => x.r.ok === false);
        expect(failed.map((x) => `${x.t.schritt} → ${x.r.detail}`)).toEqual([]);
      }
    });
  }
});
