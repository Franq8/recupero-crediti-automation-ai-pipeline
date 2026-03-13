# 20 — API Quick Reference

## Core
- `GET /health`
- `GET /project/readiness`
- `GET /project/go-live-report`
- `POST /practices`
- `GET /practices`
- `GET /practices/:id`
- `POST /practices/:id/mode`
- `GET /practices/:id/export-state.json`
- `POST /practices/import-state`

## Files/Template
- `POST /practices/:id/files` (`documentSetId` opzionale)
- `POST /practices/:id/files/:fileId/note`
- `GET /practices/:id/files/:fileId/download`
- `GET /practices/:id/document-sets`
- `POST /practices/:id/document-sets`
- `POST /practices/:id/document-sets/:setId/files/:fileId/attach`
- `POST /templates`
- `GET /templates`
- `GET /templates/:id/fields`
- `GET /templates/:id/mapping-preview`
- `GET /templates/:id/download`
- `POST /practices/:id/select-template`
- `POST /practices/:id/sync-template-fields`

## Data extraction/import
- `GET /practices/:id/extract-openclaw-payload` (prompt flow separati + documenti)
- `POST /practices/:id/pipeline/run-openclaw` (runner strict OpenClaw legacy/core: blocca senza output flow espliciti e anche quando il template non espone alcun flow EXTRACT/DERIVE/GENERATE)
- `POST /practices/:id/extract-openclaw-merge-flows` (merge risultati EXTRACT/DERIVE/GENERATE)
- `POST /practices/:id/extract-openclaw` (apply dataset già fuso)
- `POST /practices/:id/import`
- `GET /templates/:id/table-structure/xlsx|csv|json` (export struttura tabellare derivata dal template: solo `row_id` + chiavi template)
- `POST /practices/:id/workflow/prepare` (prima tabella + primo mini-report; supporta iter documentale e iter tabellare)
- `POST /practices/:id/workflow/enrich` (seconda tabella/final table solo se il template contiene placeholder speciali `[[ ]]` / `[[[ ]]]`)

## Validation/report
- `GET /practices/:id/summary`
- `GET /practices/:id/consistency`
- `GET /practices/:id/template-report`
- `GET /practices/:id/quality-gate`
- `GET /practices/:id/final-report`
- `GET /practices/:id/audit?limit=...`

## Discord v1
- `POST /discord/v1/template-table-autocontinue` (multipart: esattamente 1 `.docx` + 1 `.xlsx|.csv`; auto-continue del workflow standard web; risposta `application/zip` con `report.md` + `summary.csv` + DOCX generati)

## Output
- `POST /practices/:id/generate`
- `POST /practices/:id/generate-docx`
- `GET /practices/:id/table-rows`
- `GET /practices/:id/table-rows/:rowIndex`
- `POST /practices/:id/table-rows`
- `POST /practices/:id/generate-docx-from-row`
- `GET /practices/:id/table-rows/export.csv`
- `GET /practices/:id/export/merge-data.csv`


## Note architetturali
- nessun endpoint Discord legacy è più esposto dall'app.
- orchestrazione AI consentita solo via percorsi OpenClaw-first del backend.
- ExecPlan 42 introduce esplicitamente due fasi di workflow applicative:
  - `workflow/prepare` = prima tabella sempre + mini-report warn-and-proceed;
  - `workflow/enrich` = seconda tabella solo se servono placeholder speciali.
