# 19 — Runbook operativo (locale + docker)

## Prerequisiti
- Node 22+
- npm 10+

## Avvio locale (sviluppo)
1. `npm install`
2. `npm run db:generate`
3. `cp apps/api/.env.example apps/api/.env`
4. `npm run db:push`
5. Terminale A: `npm run dev:api`
6. Terminale B: `npm run dev:web`

UI: `http://localhost:5173` (vite)
API: `http://localhost:8787`

## Avvio docker (staging-like)
1. `docker compose build`
2. `docker compose up -d`
3. API su `http://localhost:8787`
4. Web su `http://localhost:8080`

## Smoke test rapido
Workflow matrix aggiornato:
- upload template + input separati
- selezione iter principale (`Template + documentazione` oppure `Template + tabella`)
- preparazione prima tabella (`POST /practices/:id/workflow/prepare`)
- revisione/edit della tabella workspace (`POST /practices/:id/table-rows`)
- solo se il template contiene `[{campo} istruzione]` o `[[{campo} istruzione]]`: arricchimento seconda tabella (`POST /practices/:id/workflow/enrich`)
- generazione finale da riga workspace (`POST /practices/:id/generate-docx-from-row`)

Manuale:
- `GET /health`
- crea pratica (`POST /practices`)
- upload template (`POST /templates`)
- seleziona template pratica (`POST /practices/:id/select-template`)
- esporta struttura tabellare dal template (`GET /templates/:id/table-structure/xlsx|csv|json`)
- sync campi template (`POST /practices/:id/sync-template-fields`)
- upload pdf (`POST /practices/:id/files`)
- extract fallback (`POST /practices/:id/extract`)
- ottieni payload per estrazione OpenClaw (`GET /practices/:id/extract-openclaw-payload`)
- apply risultati estrazione OpenClaw (`POST /practices/:id/extract-openclaw`)
- import multi-riga CSV/XLSX/JSON (`POST /practices/:id/import`)
- (opz.) nota documento (`POST /practices/:id/files/:fileId/note`)
- generate docx (`POST /practices/:id/generate-docx`)
- generate docx da riga tabella (`POST /practices/:id/generate-docx-from-row`)

Automatizzato:
- con API avviata su localhost:8787
- eseguire `npm run -w @rca/api smoke`
- output atteso: `SMOKE_OK`


Smoke tabella deterministic-first:
- con API avviata su localhost:8787
- eseguire `npm run -w @rca/api smoke:table`
- output atteso: `TABLE_SMOKE_OK`

## Discord v1 — template + tabella in auto-continue
- endpoint: `POST /discord/v1/template-table-autocontinue`
- async mode: same endpoint with multipart field `async=true` returns `202` + `jobId` + status URL `GET /discord/v1/template-table-autocontinue/jobs/:jobId`
- canonical Discord processor now enqueues background work, then polls short status requests until completion instead of holding one long HTTP request open
- input multipart richiesto:
  - `actor` opzionale
  - **1 file `.docx`**
  - **1 file `.xlsx` oppure `.csv`**
- comportamento:
  - crea una pratica tecnica dedicata
  - usa `DETERMINISTIC_TABLE_FIRST`
  - esegue `workflow/prepare`
  - se servono placeholder speciali, esegue anche `workflow/enrich`
  - genera tutti i DOCX finali senza fermate intermedie
  - restituisce JSON con metadati finali + link download firmato
- download ZIP:
  - endpoint dedicato ritornato in `data.download.url`
  - contiene `generated-docx/*.docx`, `report.md`, `summary.csv`
- header utili restituiti:
  - `x-rca-discord-practice-id`
  - `x-rca-discord-summary`
  - `x-rca-discord-download-url`
  - `x-rca-discord-initial-message`
  - `x-rca-discord-final-message`

## Legacy purge completato
- il layer Discord legacy è stato rimosso dal backend applicativo.
- Discord v1 usa un endpoint nuovo e minimo, ma riusa il motore standard del web.
- l’app espone solo percorsi web/API coerenti con la policy OpenClaw-only.

## doc-generator — canale batch nativo
- canale Discord canonico batch-only: `1482018084020551883` (`doc-generator`)
- routing corretto richiesto:
  - **OpenClaw gateway** deve escludere `doc-generator` dal wildcard conversazionale del main agent
  - il canale viene gestito dal listener batch nativo del progetto
- listener locale progetto:
  - script: `npm run -w @rca/api docgen:listen`
  - token bot: letto da `~/.openclaw/openclaw.json` se `DISCORD_BOT_TOKEN` non è impostato
  - API target di default: `http://127.0.0.1:8787/discord/v1/template-table-autocontinue`
- comportamento atteso:
  - accetta **solo** 1 `.docx` + 1 `.xlsx|.csv` nello stesso messaggio
  - nessuna risposta conversazionale/intermedia
  - risposta finale con link download + messaggio sintetico
- test reale rapido con fixture già presenti:
  - `npm run -w @rca/api docgen:send-fixtures`

## Backup minimo consigliato
- backup volume DB (docker volume `rca_data`)
- export periodico template library via endpoint dedicati
- retention log audit

## Mode operative / iter UX
### Iter principale A) Template + documentazione
- backend mode: `STANDARD_DOCUMENT_SET`
- creare almeno un document set;
- caricare i documenti nel set;
- opzionalmente salvare note documento;
- preparare la **prima tabella** con `POST /practices/:id/workflow/prepare`;
- correggere/completare la tabella workspace;
- solo se esistono placeholder speciali `[[ ]]` / `[[[ ]]]`, creare la **seconda tabella** con `POST /practices/:id/workflow/enrich`;
- generare sempre dal workspace finale.

### Iter principale B) Template + tabella
- backend mode: `DETERMINISTIC_TABLE_FIRST`
- facoltativamente esportare prima la struttura tabellare dal template (`GET /templates/:id/table-structure/...`);
- importare una sola tabella CSV/XLSX/JSON;
- preparare la **prima tabella** con `POST /practices/:id/workflow/prepare`;
- leggere il mini-report match / non-match e correggere se opportuno;
- solo se esistono placeholder speciali, creare la **seconda tabella** con `POST /practices/:id/workflow/enrich`;
- generare sempre dal workspace finale.

### Utility laterale: solo template
- selezionare il template;
- esportare la struttura tabellare (`GET /templates/:id/table-structure/xlsx|csv|json`);
- compilare il file fuori piattaforma;
- reimportarlo quando pronto.
- Nota: non è un iter principale.

## Note UX operative aggiornate
- gli iter principali visibili sono **2**;
- `solo template` resta funzione separata;
- la prima tabella è sempre presente;
- warning e incongruenze sono superabili dall’utente;
- i blocchi veri restano solo tecnici/minimi (template/input assenti o impossibilità di costruire la tabella minima).

## Document set e note
- creare set via `POST /practices/:id/document-sets`
- associare/creare file con `documentSetId`
- salvare note file con `POST /practices/:id/files/:fileId/note`

## Runner strict OpenClaw
- `POST /practices/:id/pipeline/run-openclaw` non inventa output: senza `flowOverrides`/output esterni restituisce blocco operativo (`409`).
- Se il template selezionato non contiene placeholder istruzionali `[ ]` / `[[ ]]` / `[[[ ]]]`, il runner strict viene comunque bloccato (`409`): non esistono flow EXTRACT/DERIVE/GENERATE da eseguire.
- Baseline dipendenze verificata in chiusura go-live: `npm audit fix` eseguito, audit runtime/prod attuale pulito (`0 vulnerabilities`).
