import { describe, expect, it } from 'vitest';
import { parseOhm, serializeOhm } from '../src/ohm/format';
import { EXAMPLES } from '../src/examples';
import { diffProjects, diffSummary, lineDiff } from '../src/team/diff';
import { commitVersion, listVersions } from '../src/team/history';

const text = Object.values(EXAMPLES)[0];

describe('Teamarbeit', () => {
  it('Diff erkennt neue, entfernte, geänderte und verschobene Teile', () => {
    const a = parseOhm(text).project;
    const b = parseOhm(text).project;
    b.parts[0].x += 50;
    const r = b.parts.find((p) => p.props.wert !== undefined);
    if (r) r.props.wert = '4,7k';
    const removed = b.parts.pop()!;
    b.parts.push({ ...b.parts[0], id: 'NEU1', x: 0, y: 0 });
    const d = diffProjects(a, b);
    expect(d.parts.find((p) => p.id === removed.id)?.kind).toBe('entfernt');
    expect(d.parts.find((p) => p.id === 'NEU1')?.kind).toBe('neu');
    if (r && r.id !== removed.id) expect(d.parts.find((p) => p.id === r.id)?.kind).toBe('geaendert');
    expect(diffSummary(d)).toContain('neu');
    expect(diffProjects(a, parseOhm(text).project).empty).toBe(true);
  });
  it('Zeilen-Diff', () => {
    const d = lineDiff('a\nb\nc', 'a\nx\nc');
    expect(d.map((l) => l.op + l.text)).toEqual([' a', '-b', '+x', ' c']);
  });
  it('Review und Team überleben Speichern/Laden', () => {
    const p = parseOhm(text).project;
    p.team = [{ name: 'Ada', rolle: 'admin' }, { name: 'Bo', rolle: 'pruefer' }];
    p.review = { status: 'in-pruefung', kommentare: [{ id: 'k1', autor: 'Bo', text: 'R1 zu klein?', wann: '2026-01-01 10:00', teil: p.parts[0].id, antworten: [{ autor: 'Ada', text: 'passt', wann: '2026-01-01 11:00' }] }], entscheidungen: [{ wer: 'Ada', rolle: 'admin', wann: '2026-01-01 09:00', ergebnis: 'angefordert' }] };
    const q = parseOhm(serializeOhm(p)).project;
    expect(q.team).toEqual(p.team);
    expect(q.review).toEqual(p.review);
  });
  it('Versionsverlauf verkettet Versionen', async () => {
    const v1 = await commitVersion('T', 'a', 'eins', 'Ada');
    const v2 = await commitVersion('T', 'b', 'zwei', 'Ada');
    expect(await commitVersion('T', 'b', 'gleich', 'Ada')).toBeNull();
    expect(v2!.parent).toBe(v1!.id);
    expect((await listVersions('T')).length).toBe(2);
  });
});
