# 19 — Runbook operativo (locale + docker)

## Prerequisiti
- Node 22+
- npm 10+

## Avvio locale (sviluppo)
1. `npm install`
2. `cp apps/api/.env.example apps/api/.env`
3. `npm run db:migrate -- --name init_local`
4. Terminale A: `npm run dev:api`
5. Terminale B: `npm run dev:web`

UI: `http://localhost:5173` (vite)
API: `http://localhost:8787`

## Avvio docker (staging-like)
1. `docker compose build`
2. `docker compose up -d`
3. API su `http://localhost:8787`
4. Web su `http://localhost:8080`

## Smoke test rapido
Manuale:
- `GET /health`
- crea pratica (`POST /practices`)
- upload template (`POST /templates`)
- seleziona template pratica (`POST /practices/:id/select-template`)
- sync campi template (`POST /practices/:id/sync-template-fields`)
- upload pdf (`POST /practices/:id/files`)
- extract fallback (`POST /practices/:id/extract`)
- ottieni payload per estrazione OpenClaw (`GET /practices/:id/extract-openclaw-payload`)
- apply risultati estrazione OpenClaw (`POST /practices/:id/extract-openclaw`)
- generate docx (`POST /practices/:id/generate-docx`)

Automatizzato:
- con API avviata su localhost:8787
- eseguire `npm run -w @rca/api smoke`
- output atteso: `SMOKE_OK`

Smoke Discord adapter:
- con API avviata su localhost:8787
- opzionale: export `DISCORD_OPERATIVE_CHANNEL_ID` coerente con env API
- eseguire `npm run -w @rca/api smoke:discord`
- output atteso: `DISCORD_SMOKE_OK <practice_id>`

## Discord adapter
- endpoint bridge OpenClaw event: `POST /discord/openclaw-event`
  - input con `attachmentPaths` (path locali media inbound)
  - conversione automatica in allegati base64 e dispatch su hook
- endpoint parse+dispatch: `POST /discord/router`
- endpoint command-level: `POST /discord/command`
- protezione canale: `DISCORD_OPERATIVE_CHANNEL_ID`

## Backup minimo consigliato
- backup volume DB (docker volume `rca_data`)
- export periodico template library via endpoint dedicati
- retention log audit
