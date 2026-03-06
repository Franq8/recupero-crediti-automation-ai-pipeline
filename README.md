# Recupero Crediti Automation

Sistema per automatizzare la produzione atti (casistica iniziale: **atto di precetto su decreto ingiuntivo**) con:
- ingestion unificata (documenti + import + manuale),
- estrazione assistita (LLM-first + evidenze/confidenza),
- workspace unico di revisione,
- template library DOCX persistente,
- generazione DOCX standard/fast,
- adapter operativo Discord.

## Stato attuale
Backbone implementato e funzionante (API + Web + DB + build OK).

## Struttura
- `apps/api` backend Fastify + Prisma
- `apps/web` frontend React/Vite
- `packages/shared` costanti condivise
- `docs/` documentazione progetto

## Avvio locale
```bash
npm install
cp apps/api/.env.example apps/api/.env
npm run db:migrate -- --name init_local
npm run dev:api
# altro terminale
npm run dev:web
```

## Avvio docker
```bash
docker compose build
docker compose up -d
```
- API: `http://localhost:8787`
- Web: `http://localhost:8080`

## Documentazione chiave
- `docs/17_EXECPLAN.md` piano esecuzione
- `docs/18_IMPLEMENTATION_LOG.md` log incrementale build
- `docs/19_RUNBOOK.md` runbook operativo
- `docs/20_API_QUICKREF.md` quick reference endpoint
