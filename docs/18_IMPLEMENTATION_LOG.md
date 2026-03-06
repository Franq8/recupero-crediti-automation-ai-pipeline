# 18 — Implementation Log

## 2026-02-12
### Avanzamento effettuato
- Creato `docs/17_EXECPLAN.md` (piano di esecuzione dettagliato).
- Bootstrap monorepo reale completato:
  - `apps/api` (Fastify + Prisma + SQLite)
  - `apps/web` (React + Vite)
  - `packages/shared`
- Definito schema DB iniziale con tabelle core:
  - `Practice`, `StoredFile`, `Template`, `FieldValue`, `AuditEvent`
- Implementate API reali backend:
  - `POST /practices`
  - `GET /practices/:id`
  - `POST /practices/:id/files`
  - `POST /practices/:id/fields`
  - `POST /templates`
  - `GET /templates`
  - `GET /practices/:id/summary`
- Implementata persistenza file in DB (byte content + hash + metadati).
- Applicata migrazione DB iniziale Prisma.
- Build workspace riuscita (`npm run build` OK).

### Stato rispetto ExecPlan
- **Fase 1**: avviata e in buona parte completata (backbone tecnico operativo).
- **Fase 2**: avviata solo base web (UI minima), da estendere a workspace dati completo.

### Incremento successivo (stessa sessione)
- Estensione API:
  - `GET /practices`
  - `POST /practices/:id/select-template`
  - `POST /practices/:id/extract`
  - `POST /practices/:id/generate`
  - `POST /practices/:id/generate-docx`
  - `GET /templates/:id/fields`
  - `GET /templates/:id/download`
  - `GET /practices/:id/files/:fileId/download`
  - `GET /practices/:id/export/merge-data.csv`
- Implementato parser documentale base (PDF/DOCX) con estrazione iniziale campi precetto.
- Implementata introspezione campi template DOCX (MERGEFIELD + placeholder comuni).
- Implementata generazione DOCX iniziale con sostituzione valori su placeholder (`{{field}}`, `«field»`, fallback su nodi testuali).
- UI web estesa:
  - lista pratiche,
  - upload documenti pratica,
  - upload e selezione template libreria,
  - esecuzione estrazione,
  - editing/salvataggio campi,
  - generazione DOCX con download.
- Build completa confermata nuovamente OK.

### Blocco completato successivo
- Implementato controllo coerenza esecutorietà manuale vs auto:
  - estrazione salva `conflitto_esecutorieta`
  - nuovo endpoint `GET /practices/:id/consistency`
  - UI con alert coerenza/conflitto dedicato
- Build workspace confermata nuovamente OK.

### Blocco completato successivo
- Raffinato motore render DOCX per copertura placeholder avanzata:
  - `{{field}}`
  - `«field»`
  - MERGEFIELD Word in `w:fldSimple`
  - MERGEFIELD Word complessi (begin/instrText/separate/end) con patch del result run
- Build workspace confermata nuovamente OK.

### Blocco completato successivo
- Migliorata qualità estrazione con metadati per campo:
  - estrazione dettagliata con `value`, `confidence`, `sourceRef`
  - scelta del valore migliore per campo su più documenti (max confidence)
  - persistenza di confidenza e riferimento fonte in `FieldValue`
- UI workspace arricchita:
  - visualizzazione confidenza (%) per campo
  - visualizzazione snippet fonte (`sourceRef`) sotto ogni campo
- Build workspace confermata nuovamente OK.

### Blocco completato successivo
- Avviato adapter Discord lato backend con endpoint `/discord/command`:
  - gestione canale operativo autorizzato via `DISCORD_OPERATIVE_CHANNEL_ID`
  - supporto comandi `new`, `status`, `extract`, `set`, `generate`, `generate-fast`
  - generazione DOCX da comando Discord con file persistito e `downloadPath` restituito
- Build workspace confermata nuovamente OK.

### Blocco completato successivo
- Collegamento adapter Discord avanzato:
  - nuovo endpoint `/discord/router` per parse comandi testuali `/precetto ...`
  - dispatch interno su `/discord/command`
  - supporto esteso comandi backend (`attach`, `interessi`, `export` oltre ai precedenti)
- Build workspace confermata nuovamente OK.

### Blocco completato successivo
- Implementato **Template Coverage Report**:
  - endpoint `GET /practices/:id/template-report`
  - calcolo campi template compilati/mancanti + percentuale copertura
  - integrazione in generazione DOCX (missing fields conteggiati e tracciati in audit)
- UI aggiornata con sezione report template e warning campi mancanti.
- Estensione risposta Discord `generate/generate-fast` con conteggio campi template mancanti.
- Build workspace confermata nuovamente OK.

### Blocco completato successivo
- Implementata sincronizzazione automatica campi da template selezionato:
  - nuovo endpoint `POST /practices/:id/sync-template-fields`
  - creazione automatica in pratica dei campi template mancanti (stato `MISSING`)
  - audit dedicato `SYNC_TEMPLATE_FIELDS`
- UI aggiornata:
  - sync automatico dopo selezione template
  - pulsante manuale “Allinea campi da template”
- Build workspace confermata nuovamente OK.

### Blocco completato successivo
- Implementato import strutturato reale su pratica:
  - nuovo endpoint `POST /practices/:id/import` (xlsx/csv/json)
  - parsing primo record e upsert campi con `sourceType=import`
  - persistenza file import in `StoredFile` (`PRACTICE_IMPORT`)
  - audit evento `IMPORT_FILE_APPLIED`
- UI aggiornata con upload import file nella sezione documenti pratica.
- Build workspace confermata nuovamente OK.

### Blocco completato successivo
- Hardening dipendenze completato:
  - rimosso parser XLSX vulnerabile (`xlsx`)
  - migrato import Excel su `exceljs`
  - `npm audit` ora pulito (0 vulnerabilità)
- Build workspace confermata nuovamente OK.

### Blocco completato successivo
- Implementato blocco interessi v1 operativo:
  - endpoint `POST /practices/:id/recompute-interest`
  - supporto `interessi_modalita` (`none`, `simple`, `complex_placeholder`)
  - supporto selettore tasso `legale|mora` (default legale lato UI)
  - calcolo `simple` (base, tasso, dal, al) con salvataggio `interessi_giorni` + `interessi_importo`
  - per `none`, valorizzazione clausola standard in campo dedicato
- UI aggiornata con sezione Interessi e pulsante “Ricalcola interessi”.
- Build workspace confermata nuovamente OK.

### Blocco completato successivo
- Preparazione operativa/deploy avanzata:
  - aggiunti Dockerfile per `apps/api` e `apps/web`
  - aggiunto `docker-compose.yml` con persistenza volume DB
- Rafforzata documentazione operativa:
  - `docs/19_RUNBOOK.md`
  - `docs/20_API_QUICKREF.md`
  - README aggiornato con run locali/docker
- Build workspace confermata nuovamente OK.

### Blocco completato successivo
- Aggiunto endpoint integrazione messaging `POST /discord/hook`:
  - ingestione testo + allegati in un payload unico
  - auto-creazione pratica in presenza di allegati senza `practiceId`
  - attach file a pratica
  - esecuzione opzionale comando `/precetto ...` nella stessa richiesta
- Build workspace confermata nuovamente OK.

### Blocco completato successivo
- Implementato Quality Gate bozza (non bloccante):
  - endpoint `GET /practices/:id/quality-gate`
  - score qualità, livello, campi forti mancanti, conflitto esecutorietà
  - finalità: orientare revisione senza bloccare generazione
- UI aggiornata con pannello quality gate e azione dedicata.
- Build workspace confermata nuovamente OK.

### Blocco completato successivo
- Aggiunto bridge `POST /discord/openclaw-event` per integrazione pratica con eventi OpenClaw:
  - accetta attachment paths locali
  - legge file da path, inferisce mime, converte base64
  - inoltra su `/discord/hook` mantenendo lo stesso flusso operativo
- Build workspace confermata nuovamente OK.

### Blocco completato successivo
- Raffinamento estrazione campi precetto (fallback rules potenziate):
  - nuove regole su parti/difensore/PEC
  - normalizzazione date italiane in formato ISO
  - normalizzazione importi monetari
  - separazione utility in `extraction-rules.ts`
- Build workspace confermata nuovamente OK.

### Blocco completato successivo
- Introdotto smoke test end-to-end automatizzato (`apps/api/scripts/e2e-smoke.mjs`):
  - crea pratica
  - crea/upload template docx minimo
  - seleziona/sync template
  - set campi
  - genera DOCX
  - assert base (`SMOKE_OK`)
- Aggiunto script npm `npm run -w @rca/api smoke`.
- Runbook aggiornato con smoke test automatizzato.
- Build workspace confermata nuovamente OK.

### Blocco corretto (policy)
- Rimossa integrazione diretta API-key dal backend (errore di allineamento policy).
- Confermata policy tecnica: estrazione LLM solo tramite flussi OpenClaw client, mai con chiavi API locali nell'app.
- Backend extraction mode marcato come `openclaw-client-only` in audit.
- Build workspace confermata nuovamente OK dopo correzione.

### Prossimi passi immediati
1. Test end-to-end completo su canale operativo `#precetto-operativo`.
2. Integrare entrypoint LLM delegato a OpenClaw client (policy globale: qualunque uso LLM passa da default model OpenClaw).

### Blocco completato successivo
- Implementato entrypoint LLM policy-compliant:
  - nuovo endpoint `POST /practices/:id/extract-openclaw`
  - riceve risultati estrazione prodotti dal client OpenClaw (default model OpenClaw)
  - merge su campi pratica con rispetto precedenza campi manuali
  - audit evento `OPENCLAW_CLIENT_EXTRACT_APPLIED`
- Documentazione tecnica aggiornata (`12`, `19`, `20`) per distinguere:
  - extraction fallback rules
  - extraction delegata OpenClaw client
- Build workspace confermata nuovamente OK.

### Prossimi passi immediati
1. Test end-to-end completo su canale operativo `#precetto-operativo`.
2. Rifinire prompt/schema estrazione usata dal lato OpenClaw client su dataset reale.

### Blocco completato successivo
- Implementato endpoint ponte per orchestrazione LLM lato OpenClaw client:
  - `GET /practices/:id/extract-openclaw-payload`
  - restituisce prompt, schema atteso, e testi documentali estratti (chunk)
  - obiettivo: standardizzare la chiamata al modello default OpenClaw fuori dall'app
- Build workspace confermata nuovamente OK.

### Prossimi passi immediati
1. Test end-to-end completo su canale operativo `#precetto-operativo`.
2. Collegare il chiamante OpenClaw effettivo: payload -> LLM default -> apply su `/extract-openclaw`.

### Blocco completato successivo
- Miglioramento UX revisione + auditabilità:
  - endpoint `GET /practices/:id/audit` con timeline eventi
  - UI con pannello Audit timeline
  - filtro campi nel workspace (`all`, `missing`, `manual`, `conflict`)
- Build workspace confermata nuovamente OK.

### Prossimi passi immediati
1. Test end-to-end completo su canale operativo `#precetto-operativo`.
2. Validazione su template e documenti reali per rifinitura finale mapping/estrazione.

### Blocco completato successivo
- Aggiunto smoke test Discord adapter (`apps/api/scripts/e2e-discord.mjs`):
  - crea pratica via `/discord/command`
  - aggiorna campi via `/discord/command` e `/discord/router`
  - verifica status finale
  - output atteso `DISCORD_SMOKE_OK`
- Script npm aggiunto: `npm run -w @rca/api smoke:discord`.
- Runbook aggiornato con sezione smoke Discord.
- Build workspace confermata nuovamente OK.

### Prossimi passi immediati
1. Test end-to-end completo su canale operativo `#precetto-operativo` con allegati reali.
2. Validazione finale su template/documenti reali e rifinitura residuale.

### Blocco completato successivo
- Rifinitura core template mapping (no nuove feature Discord):
  - endpoint `GET /templates/:id/mapping-preview`
  - calcolo coverage mapping + elenco campi template sconosciuti
- UI template section aggiornata con alert coverage e unknown fields.
- Build workspace confermata nuovamente OK.

### Prossimi passi immediati
1. Validazione su template/documenti reali e correzione finale unknown fields.
2. Chiusura checklist finale progetto + handoff operativo.

### Blocco completato successivo
- Aggiunto endpoint stato progetto `GET /project/readiness`:
  - readiness percent
  - checklist capability principali
  - metriche base (pratiche/template/audit)
- Aggiunto documento handoff finale: `docs/21_HANDOFF_CHECKLIST.md`.

### Blocco completato successivo
- Aggiunto report finale pratica:
  - endpoint `GET /practices/:id/final-report`
  - include qualità, coerenza, conteggi e lista campi mancanti
  - natura informativa (non blocca output)
- UI aggiornata con azione `Final report` e pannello riepilogo pratica.
- Build workspace confermata nuovamente OK.

### Prossimi passi immediati
1. Validazione finale con documenti/template reali nel canale operativo.
2. Chiusura progetto con check handoff e conferma go-live.

### Blocco completato successivo
- Eseguiti smoke test automatizzati con API live:
  - `npm run -w @rca/api smoke` -> `SMOKE_OK`
  - `npm run -w @rca/api smoke:discord` -> `DISCORD_SMOKE_OK`
- Verificata tenuta end-to-end dei due percorsi principali (core + adapter Discord v1).

### Blocco completato successivo
- Aggiunto backup/handoff stato pratica:
  - `GET /practices/:id/export-state.json`
  - `POST /practices/import-state`
- Obiettivo: portabilità stato pratica tra ambienti e recovery rapido.
- Build workspace confermata nuovamente OK.

### Prossimi passi immediati
1. Validazione finale con template/documenti reali.
2. Chiusura progetto con check handoff e decisione go-live.

### Blocco completato successivo
- Formalizzato piano di freeze v1 (`docs/22_V1_FREEZE.md`):
  - stop scope creep
  - consentiti solo stabilizzazione/bugfix/test reali
  - criteri chiari di uscita verso go-live

### Blocco completato successivo
- Stabilizzazione messaggi errore API (più azionabili) su:
  - generate-docx senza template selezionato
  - template mancante/non disponibile
  - extract senza documenti caricati
  - import senza file
- Validazione regressione:
  - build OK
  - smoke core OK
  - smoke discord OK

### Blocco completato successivo
- Implementato supporto placeholder composti `[[...]]` nel renderer DOCX.
- Aggiunta logica campi composti per identificazione soggetti:
  - `debitore_identificativo_completo`
  - `creditore_identificativo_completo`
- Compatibilità aggiunta con placeholder testuale template corrente:
  - `[[denominazione debitore + c.f e/o p.iva]]`
  - `[[denominazione creditore + c.f e/o p.iva]]`
- Build workspace confermata nuovamente OK.
