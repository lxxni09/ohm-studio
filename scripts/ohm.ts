/**
 * Kommandozeile für das .ohm-Format.
 *   npm run ohm -- types              alle Bauteiltypen
 *   npm run ohm -- check datei.ohm    Datei prüfen
 *   npm run ohm -- test datei.ohm     Testschritte simulieren
 *   npm run ohm -- export datei.ohm gerber|bom|kicad|wokwi|spice
 *   npm run ohm -- schema             JSON-Schema ausgeben
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { drc } from '../src/eda/drc';
import { fabPackage, pickPlaceCsv, stepModel } from '../src/export/fab';
import { runProject } from '../src/analysis/runner';
import { emcCheck, lifetime, powerIntegrity, signalIntegrity, thermalAnalysis } from '../src/analysis/analyses';
import { parseOhm, typeList } from '../src/ohm/format';
import { runTests } from '../src/sim/testrunner';
import { bomCsv } from '../src/export/bom';
import { gerberFiles, kicadNetlist, spiceNetlist, wokwiDiagram, zip } from '../src/export/exporters';

const [cmd, file, arg] = process.argv.slice(2);

function load(f: string) {
  const r = parseOhm(readFileSync(f, 'utf8'));
  for (const i of r.issues) console.error(`${i.level === 'error' ? '✗' : i.level === 'warn' ? '!' : 'i'} ${i.text}`);
  return r;
}

function schema() {
  const types = typeList().map((t) => t.typ);
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://ohm.studio/ohm.schema.json',
    title: 'Ohm-Studio-Projekt (.ohm)',
    description: 'Ein komplettes Elektronikprojekt in einer YAML-Datei: Bauteile, Verkabelung, Platine, Code, Tests.',
    type: 'object',
    required: ['ohm', 'teile'],
    properties: {
      ohm: { const: 1, description: 'Formatversion' },
      projekt: { type: 'object', properties: { name: { type: 'string' }, autor: { type: 'string' }, beschreibung: { type: 'string' } } },
      teile: {
        type: 'object',
        description: 'Bauteile: Bezeichner → Eigenschaften',
        propertyNames: { pattern: '^[A-Za-z][A-Za-z0-9_]*$' },
        additionalProperties: {
          type: 'object',
          required: ['typ'],
          properties: {
            typ: { enum: types },
            pos: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: 'Position in mm' },
            dreh: { enum: [0, 90, 180, 270] },
            nahe_an: { type: 'string', description: 'neben ein anderes Teil legen' },
          },
          additionalProperties: true,
        },
      },
      netze: {
        type: 'object',
        additionalProperties: { type: 'array', minItems: 2, items: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]*\\.[^\\s]+$' } },
      },
      ansichten: {
        type: 'object',
        properties: {
          steckbrett: {},
          platine: { type: 'object', properties: { groesse: { type: 'string', pattern: '^(auto|\\d+(\\.\\d+)?x\\d+(\\.\\d+)?mm)$' }, lagen: { enum: [1, 2] }, farbe: { enum: ['gruen', 'schwarz', 'blau', 'rot', 'weiss', 'lila', 'gelb'] }, oberflaeche: { enum: ['gold', 'silber', 'hasl'] } } },
          schaltplan: { type: 'object', properties: { symbole: { enum: ['IEC', 'ANSI'] } } },
        },
      },
      einstellungen: { type: 'object', properties: { geschwindigkeit: { type: 'number' }, realismus: { type: 'boolean' }, zeitschritt: { type: 'number' } } },
      code: {
        oneOf: [{ $ref: '#/$defs/code' }, { type: 'array', items: { $ref: '#/$defs/code' } }],
      },
      test: { type: 'array', items: { type: 'object', required: ['schritt', 'erwartet'], properties: { schritt: { type: 'string' }, erwartet: { type: 'string' } } } },
    },
    $defs: {
      code: { type: 'object', required: ['datei'], properties: { ziel: { type: 'string' }, sprache: { enum: ['arduino', 'cpp', 'micropython'] }, datei: { type: 'string' } } },
    },
  };
}

switch (cmd) {
  case 'types':
    for (const t of typeList()) console.log(`${t.typ.padEnd(24)} ${t.name.padEnd(36)} ${t.kategorie.padEnd(16)} Pins: ${t.pins.slice(0, 16).join(' ')}${t.pins.length > 16 ? ' …' : ''}`);
    break;
  case 'check': {
    const r = load(file);
    console.log(r.issues.some((i) => i.level === 'error') ? 'Fehler gefunden.' : `OK – „${r.project.name}“ (${r.project.parts.length} Teile, ${r.project.nets.length} Netze)`);
    process.exit(r.issues.some((i) => i.level === 'error') ? 1 : 0);
    break;
  }
  case 'test': {
    const r = load(file);
    const res = runTests(r.project);
    res.forEach((x, i) => console.log(`${x.ok === true ? '✓' : x.ok === false ? '✗' : '?'} ${r.project.tests[i].schritt} → ${x.detail}`));
    process.exit(res.some((x) => x.ok === false) ? 1 : 0);
    break;
  }
  case 'export': {
    const p = load(file).project;
    const base = file.replace(/\.ohm$/, '');
    if (arg === 'bom') writeFileSync(`${base}-stueckliste.csv`, bomCsv(p));
    else if (arg === 'kicad') writeFileSync(`${base}.net`, kicadNetlist(p));
    else if (arg === 'spice') writeFileSync(`${base}.cir`, spiceNetlist(p));
    else if (arg === 'wokwi') writeFileSync(`${base}-diagram.json`, wokwiDiagram(p).json);
    else if (arg === 'fertigung') fabPackage(p).arrayBuffer().then((b) => writeFileSync(`${base}-fertigung.zip`, Buffer.from(b)));
    else if (arg === 'step') writeFileSync(`${base}.step`, stepModel(p));
    else if (arg === 'pnp') writeFileSync(`${base}-pnp.csv`, pickPlaceCsv(p));
    else if (arg === 'gerber') zip(gerberFiles(p)).arrayBuffer().then((b) => writeFileSync(`${base}-gerber.zip`, Buffer.from(b)));
    else console.error('Format: gerber | fertigung | step | pnp | bom | kicad | wokwi | spice');
    break;
  }
  case 'drc': {
    const p = load(file).project;
    const v = drc(p, arg || 'jlcpcb');
    for (const x of v) console.log(`${x.level === 'error' ? '✗' : '!'} [${x.rule}] ${x.text}`);
    console.log(v.length ? `${v.filter((x) => x.level === 'error').length} Fehler, ${v.filter((x) => x.level !== 'error').length} Warnungen` : `DRC sauber (${arg || 'jlcpcb'})`);
    process.exit(v.some((x) => x.level === 'error') ? 1 : 0);
    break;
  }
  case 'analyse': {
    const p = load(file).project;
    const m = runProject(p);
    const out = { waerme: thermalAnalysis(p, m), emv: emcCheck(p), lebensdauer: lifetime(p, m), pi: powerIntegrity(p, m), si: signalIntegrity(p) };
    if (arg === 'json') console.log(JSON.stringify(out, null, 2));
    else {
      for (const t of out.waerme) console.log(`${t.level === 'ok' ? '✓' : t.level === 'warn' ? '!' : '✗'} Wärme ${t.id}: ${(t.p * 1000).toFixed(0)} mW, ${t.t.toFixed(0)} °C`);
      for (const e of out.emv) console.log(`${e.level === 'ok' ? '✓' : e.level === 'warn' ? '!' : '✗'} EMV ${e.rule}: ${e.text}`);
      console.log(`MTBF ≈ ${Math.round(out.lebensdauer.mtbf)} h`);
    }
    process.exit([...out.waerme, ...out.emv].some((x) => x.level === 'error') ? 1 : 0);
    break;
  }
  case 'schema':
    console.log(JSON.stringify(schema(), null, 2));
    break;
  default:
    console.log('ohm types | check <datei> | test <datei> | drc <datei> [profil] | analyse <datei> [json] | export <datei> <format> | schema');
}
