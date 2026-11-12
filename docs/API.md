# Automatisierung: Kommandozeile, CI und Server-API

## Kommandozeile
```bash
npm run ohm -- types                         # alle Bauteiltypen
npm run ohm -- check  projekt.ohm            # Format + ERC prüfen (Exit-Code 1 bei Fehlern)
npm run ohm -- test   projekt.ohm            # test:-Schritte simulieren
npm run ohm -- drc    projekt.ohm aisler     # DRC gegen Herstellerprofil
npm run ohm -- analyse projekt.ohm [json]    # Wärme, EMV, MTBF, PI, SI
npm run ohm -- export projekt.ohm fertigung  # Fertigungspaket (auch: gerber, step, pnp, bom, kicad, wokwi, spice)
npm run ohm -- schema                        # JSON-Schema des .ohm-Formats
```

## Hardware-Regressionstests in GitHub Actions
```yaml
name: Hardware-Tests
on: [push, pull_request]
jobs:
  ohm:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: |
          for f in hardware/*.ohm; do
            npm run -s ohm -- check "$f"
            npm run -s ohm -- test "$f"
            npm run -s ohm -- drc "$f" jlcpcb
          done
```

## TypeScript-API
Alle Funktionen sind als Module nutzbar:
```ts
import { parseOhm, serializeOhm } from './src/ohm/format';
import { runTests } from './src/sim/testrunner';
import { drc } from './src/eda/drc';
import { fabPackage } from './src/export/fab';
import { monteCarlo, fmea } from './src/analysis/analyses';

const { project } = parseOhm(text);
const fehler = drc(project, 'eurocircuits');
const mc = await monteCarlo(project, 500);
```

## Server-API (Nodaris-Server)
Authentifizierung: `Authorization: Bearer <token>` (aus `POST /auth/login` oder SSO).

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/healthz` | Status |
| GET | `/auth/config` | SSO verfügbar? |
| POST | `/auth/register` | `{email, name, passwort}` – erstes Konto wird Admin |
| POST | `/auth/login` | `{email, passwort, code?}` → `{token, name, rolle}` |
| POST | `/auth/2fa/setup` · `/auth/2fa/enable` | TOTP einrichten |
| GET | `/auth/me` | aktuelle Sitzung |
| GET | `/auth/sso` → `/auth/callback` | OpenID Connect |
| GET/PUT | `/v1/projects[/<id>]` | verschlüsselter Projektspeicher `{text}` |
| POST/GET | `/v1/audit` | Audit-Ereignis melden / Log lesen (Admin) |
| GET | `/v1/license/<id>` | Lizenz gültig? |
| GET/POST | `/v1/classes`, `/v1/classes/join` | Klassenräume |
| GET/POST | `/v1/classes/<id>/assignments[/<aid>/submit]` | Aufgaben, Abgaben |
| GET | `/v1/classes/<id>/progress` | Fortschritt (Lehrkraft) |
| * | `/scim/v2/Users`, `/scim/v2/Groups` | SCIM 2.0 (Bearer = `SCIM_TOKEN`) |
| WS | `/collab/<raum>` | Live-Zusammenarbeit |
