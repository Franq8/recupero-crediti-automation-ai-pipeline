# 21 — Handoff checklist (chiusura progetto)

## Stato attuale
Il progetto è in stato **avanzato e operativo** su backbone completo (API + Web + DB + docx + import), con layer Discord legacy rimosso dal runtime applicativo.

## Cosa è pronto
- [x] Workspace unico dati
- [x] Upload documenti + import strutturato
- [x] Template library persistente
- [x] Mapping preview template
- [x] Runner backend OpenClaw strict (`POST /practices/:id/pipeline/run-openclaw`) con stato run + audit flow-level + blocco esplicito senza output esterni
- [x] Orchestrazione UI con bottone unico `Run AI Pipeline` e stato EXTRACT/DERIVE/GENERATE
- [x] Estrazione fallback rules + entrypoint OpenClaw client
- [x] Interessi v1 (none/simple)
- [x] Generazione DOCX standard/fast
- [x] Tabella finale row-level esplicita in UI + selezione riga attiva + lifecycle `status/review/quality` + generate DOCX da riga
- [x] Note documento su file pratica + contesto document set
- [x] Audit timeline + quality gate
- [x] Purge layer Discord legacy completato
- [x] Docker + runbook + smoke tests
- [x] Discord v1 backend auto-continue (`POST /discord/v1/template-table-autocontinue`) con ZIP finale + report postumo cumulativo

## Limiti residui reali
1. Mancano nel repo i materiali finali reali/anonymized dello studio per chiudere una copertura prodotto al 100% su casi reali.
2. La validazione finale eseguita in chiusura go-live copre build, smoke, iter prodotto sintetici e casi anonimizzati minimi; non sostituisce un collaudo su template/documenti finali reali.
3. Il report `/project/go-live-report` resta un indicatore tecnico utile, non una certificazione funzionale sui casi di studio reali.

## Ultime attività consigliate prima uso pieno
1. Validazione finale su template reali dello studio (non solo sintetici/anonimizzati minimi)
2. Verifica E2E operativa con i materiali finali effettivi
3. Fine-tuning eventuali campi unknown emersi da `mapping-preview` su template reali residui

## Stato post-ExecPlan 42
- UI riallineata a **2 soli iter principali**:
  - `Template + documentazione`
  - `Template + tabella`
- `Solo template` declassato correttamente a funzione laterale di export struttura.
- Prima tabella esplicita in entrambi gli iter via `POST /practices/:id/workflow/prepare`.
- Seconda tabella esplicita solo quando il template contiene placeholder speciali via `POST /practices/:id/workflow/enrich`.
- Warning/mismatch trattati in logica warn-and-proceed; niente blocchi UX impropri su incongruenze superabili.
- Tabella workspace editabile e generazione sempre da riga finale corrente.
- Validazione concreta completata su:
  - iter documentale senza speciali
  - iter documentale con speciali
  - iter tabellare con mismatch + speciali
  - smoke core e smoke table legacy/regressione

## Comandi rapidi
- Build: `npm run build`
- Smoke core: `npm run -w @rca/api smoke`
- Smoke table deterministic: `npm run -w @rca/api smoke:table`
- Smoke Discord v1: `npm run -w @rca/api smoke:discord-v1`

## Criterio chiusura definitiva
Il progetto si considera chiuso quando i 4 punti di validazione sopra sono completati senza errori bloccanti.

## Report rapido stato piattaforma
- endpoint: `GET /project/go-live-report`
- include:
  - readiness percent
  - capability checklist
  - hard checks
  - pending human validation

## Stato post-ExecPlan 36
- layer Discord legacy purgato
- workflow dual-mode esplicito in UI
- document set formalizzati nel dominio
- resta fuori scope solo il freeze area D
