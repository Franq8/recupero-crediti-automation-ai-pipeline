# 20 — API Quick Reference

## Core
- `GET /health`
- `GET /project/readiness`
- `GET /project/go-live-report`
- `POST /practices`
- `GET /practices`
- `GET /practices/:id`
- `GET /practices/:id/export-state.json`
- `POST /practices/import-state`

## Files/Template
- `POST /practices/:id/files`
- `GET /practices/:id/files/:fileId/download`
- `POST /templates`
- `GET /templates`
- `GET /templates/:id/fields`
- `GET /templates/:id/mapping-preview`
- `GET /templates/:id/download`
- `POST /practices/:id/select-template`
- `POST /practices/:id/sync-template-fields`

## Data extraction/import
- `POST /practices/:id/extract` (fallback rules)
- `GET /practices/:id/extract-openclaw-payload` (prompt+schema+testo documenti per chiamata LLM lato OpenClaw client)
- `POST /practices/:id/extract-openclaw` (apply risultati LLM dal client OpenClaw, policy-compliant)
- `POST /practices/:id/import`
- `GET /import-template/xlsx|csv|json`

## Validation/report
- `GET /practices/:id/summary`
- `GET /practices/:id/consistency`
- `GET /practices/:id/template-report`
- `GET /practices/:id/quality-gate`
- `GET /practices/:id/final-report`
- `GET /practices/:id/audit?limit=...`

## Output
- `POST /practices/:id/recompute-interest`
- `POST /practices/:id/generate`
- `POST /practices/:id/generate-docx`
- `GET /practices/:id/export/merge-data.csv`

## Discord adapter
- `POST /discord/openclaw-event` (bridge diretto da evento OpenClaw con attachment paths locali)
- `POST /discord/hook` (ingestion webhook-like: text + attachments + auto-practice)
- `POST /discord/router` (parse testo `/precetto ...` + dispatch)
- `POST /discord/command` (command-level)
