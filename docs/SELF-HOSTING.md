# Nodaris-Server – Self-Hosted & Firmenbetrieb

Der Nodaris-Server ist eine einzelne Node-Datei ohne Abhängigkeiten (`server/nodaris-server.mjs` + `server/enterprise.mjs`). Er liefert die Web-Version von Ohm Studio aus und stellt die Firmenfunktionen bereit.

| Funktion | Endpunkt |
|---|---|
| Web-Version | `/` |
| Echtzeit-Zusammenarbeit | WebSocket `/collab/<raum>` |
| Anmeldung (Passwort, scrypt) | `POST /auth/login`, `POST /auth/register` (erstes Konto = Admin) |
| Zwei-Faktor (TOTP, RFC 6238) | `POST /auth/2fa/setup`, `POST /auth/2fa/enable` |
| Single Sign-On (OpenID Connect + PKCE) | `/auth/sso` → `/auth/callback` |
| SCIM 2.0 | `/scim/v2/Users`, `/scim/v2/Groups`, `/scim/v2/ServiceProviderConfig` |
| Projektspeicher (AES-256-GCM) | `GET/PUT /v1/projects/<id>` |
| Audit-Log | `POST /v1/audit`, `GET /v1/audit` (Admins) |
| Lizenzprüfung | `GET /v1/license/<id>` |
| Health-Check | `/healthz` |

## Schnellstart mit Docker

```bash
export SESSION_SECRET=$(openssl rand -hex 32) DATA_KEY=$(openssl rand -hex 32) SCIM_TOKEN=$(openssl rand -hex 24)
docker compose up -d
# → http://localhost:8787 – in Ohm Studio unter Einstellungen → Firmenserver eintragen
```

**`DATA_KEY` sicher aufbewahren** – ohne ihn sind gespeicherte Projekte nicht mehr lesbar.

## Kubernetes

`deploy/k8s/nodaris.yaml` enthält PVC, Deployment, Service und Ingress (TLS 1.3). Live-Sitzungen liegen im Arbeitsspeicher; bei mehreren Repliken Sticky Sessions aktivieren.

## Single Sign-On

| Anbieter | `OIDC_ISSUER` |
|---|---|
| Microsoft Entra ID | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
| Google Workspace | `https://accounts.google.com` |
| Okta | `https://<firma>.okta.com` |
| Keycloak | `https://<host>/realms/<realm>` |

Redirect-URI beim Anbieter: `<PUBLIC_URL>/auth/callback`. Benutzer werden beim ersten Login angelegt (Rolle „Bearbeiter“); Rollen vergibt der Admin.

**SAML:** Der Server spricht OIDC. Für reine SAML-Umgebungen einen OIDC-Bridge-Dienst vorschalten (Entra ID, Okta, Keycloak können SAML-IdPs als OIDC anbieten). Ein nativer SAML-Endpunkt ist geplant.

## SCIM (automatische Benutzerverwaltung)

In Entra ID / Okta als „SCIM 2.0“-App anlegen: Basis-URL `<PUBLIC_URL>/scim/v2`, Token = `SCIM_TOKEN`. Deaktivierte Benutzer (`active: false`) können sich sofort nicht mehr anmelden.

## Sicherheit

- TLS übernimmt der Reverse-Proxy/Ingress (TLS 1.3 empfohlen). Der Server setzt HSTS und `X-Frame-Options`.
- Passwörter: scrypt mit zufälligem Salt. Sitzungstoken: HMAC-SHA256, 12 h gültig.
- Projektdaten: AES-256-GCM mit Authentifizierung (Manipulation wird erkannt).
- `ALLOWED_ORIGINS` auf die eigene Domain und `app://ohm` (Desktop-App) beschränken.

## Offline-Lizenzen (abgeschottete Netze)

```bash
node scripts/license-tool.mjs sign enterprise "Firma GmbH" 365 50 --offline
```

Offline-Lizenzen brauchen nie eine Online-Prüfung. Für eigene Update-Server: Umgebungsvariable `NODARIS_UPDATE_URL` auf den Arbeitsplätzen setzen.

## Code-Signatur der Programme

- **Windows (Authenticode):** `CSC_LINK` (PFX, base64) und `CSC_KEY_PASSWORD` als Secrets im CI hinterlegen, dann `npm run dist:win:all`. EV-Zertifikate vermeiden den SmartScreen-Hinweis sofort.
- **macOS (Notarisierung):** `CSC_LINK`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` setzen und in `package.json` `build.mac.notarize` auf `true` stellen.
