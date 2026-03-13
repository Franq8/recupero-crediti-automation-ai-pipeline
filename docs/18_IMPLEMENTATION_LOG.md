# 18 — Implementation Log

## 2026-03-13 — ExecPlan 43 (Discord v1 template+table auto-continue)
### Audit e principio di riuso confermati
- Verificati i mattoni standard già vivi e riusabili nel backend:
  - `POST /practices/:id/workflow/prepare`
  - `POST /practices/:id/workflow/enrich`
  - `POST /practices/:id/generate-docx-from-row`
  - `GET /practices/:id/table-rows`
- Confermato che il motore corretto da riusare per Discord v1 è il workflow web/table-first già presente, senza reintrodurre il layer Discord legacy.
- Confermato che i mini-report necessari al report postumo cumulativo sono già serviti da `prepare` e `enrich`; mancava solo l’orchestrazione auto-continue e il packaging finale.

### Implementazione backend Discord v1
- Introdotto un layer nuovo, minimo e pulito per Discord v1:
  - helper dedicato `apps/api/src/discord-v1.ts`
  - endpoint `POST /discord/v1/template-table-autocontinue`
- Contratto input implementato:
  - accetta **esattamente 1 `.docx`**
  - accetta **esattamente 1 `.xlsx` o `.csv`**
  - rifiuta input mancanti/multipli come errore tecnico chiaro.
- Orchestrazione implementata usando il backend standard già esistente:
  1. crea pratica
  2. forza `DETERMINISTIC_TABLE_FIRST`
  3. registra template e tabella
  4. esegue `workflow/prepare`
  5. se il template contiene placeholder speciali, esegue `workflow/enrich` in auto-continue
  6. genera tutti i DOCX via `generate-docx-from-row`
- Nessuna sosta intermedia lato Discord: il comportamento equivale a un auto-click su “continua” del flusso web.

### Packaging ZIP finale
- Implementato ZIP finale con:
  - cartella `generated-docx/`
  - `report.md` postumo cumulativo
  - `summary.csv` riga-per-riga
- Il report postumo somma davvero:
  - esito prima fase / prima tabella
  - esito seconda fase / seconda tabella, se esiste
  - esito finale della generazione per ogni riga
- Gli warning vengono riportati nel report ma non bloccano la generazione; gli errori tecnici restano tracciati per la sola riga affetta.

### UX Discord minima
- L’endpoint restituisce direttamente lo ZIP finale.
- Espone anche header sintetici per il chiamante Discord:
  - messaggio iniziale consigliato
  - messaggio finale consigliato
  - summary JSON con documenti generati / warning / errori
  - `practiceId` tecnico di riferimento

### Verifiche eseguite
- `npm run -w @rca/api build` ✅
- `npm run build` ✅
- `npm run -w @rca/api smoke` ✅ (`SMOKE_OK`)
- `npm run -w @rca/api smoke:table` ✅ (`TABLE_SMOKE_OK`)
- `npm run -w @rca/api smoke:discord-v1` ✅ (`DISCORD_V1_OK`)
  - caso template con placeholder semplici
  - caso template con placeholder speciali e seconda fase auto-eseguita

### Limiti residui reali
- Discord v1 copre volutamente solo il contratto `1 template + 1 tabella`; niente editing tabellare o step-by-step da chat.
- Se il template contiene placeholder speciali, la seconda fase viene eseguita ma senza un motore di derivazione esterno embedded nel repo: il layer Discord non inventa contenuti extra, mantiene il comportamento warn-and-proceed.
- L’integrazione Discord lato bot/client resta minimale: questo step chiude il backend orchestrator + contratto file/output, non una UI conversazionale ricca.

## 2026-03-13 — ExecPlan 42 (warn-and-proceed matrix)
### Audit implementativo e correzione piano
- Riesaminati backend e frontend rispetto alla matrice finale di `docs/42_EXECPLAN_WARN_AND_PROCEED_MATRIX.md`.
- Divergenze reali emerse rispetto allo stato precedente:
  - frontend ancora percepibile come 3 iter principali, mentre la matrice definitiva richiede **2 iter principali** + funzione separata `solo template`;
  - caso `Template + tabella` ancora con blocco UX improprio su mismatch mancanti, in contrasto con la logica warn-and-proceed;
  - assenza esplicita della coppia `prima tabella` / `seconda tabella` come fasi distinte servite dal backend;
  - generazione corretta già da riga tabellare, ma mancava la formalizzazione intermedia dei mini-report.
- ExecPlan 42 mantenuto come fonte canonica; implementazione riallineata al piano invece di estendere scope.

### Allineamento backend
- Aggiunto helper di shape workflow template per distinguere:
  - chiavi tabellari complessive;
  - presenza reale di placeholder speciali `[[ ]]` / `[[[ ]]]`.
- Introdotto `POST /practices/:id/workflow/prepare`:
  - costruisce/serve sempre la **prima tabella di lavorazione**;
  - supporta sia `STANDARD_DOCUMENT_SET` sia `DETERMINISTIC_TABLE_FIRST`;
  - restituisce primo mini-report con input summary, warning e confronto `match` / `non-match` nel caso tabellare;
  - tratta incongruenze come warning superabili, non come blocchi duri.
- Introdotto `POST /practices/:id/workflow/enrich`:
  - produce la **seconda tabella/final table** solo se il template contiene placeholder speciali;
  - merge esplicito dei valori derive/generate sulla riga workspace corrente;
  - audit dedicato `WORKFLOW_FINAL_TABLE_ENRICHED`.
- Confermata la regola di generazione finale da `POST /practices/:id/generate-docx-from-row` sulla riga workspace corrente.

### Allineamento frontend
- Rifatto `apps/web/src/App.tsx` attorno alla matrice finale:
  - **2 soli iter principali** visibili;
  - `solo template` spostato a utility separata;
  - upload separato area documentazione / area tabella;
  - pulsante esplicito `Prepara prima tabella`;
  - primo mini-report visibile con warning superabili;
  - workspace tabellare centrale ed editabile;
  - secondo mini-report mostrato solo se `hasSpecialPlaceholders=true`;
  - generazione sempre dal workspace finale.
- Rimosso il blocco UX precedente su mismatch tabellare come comportamento standard: il mismatch resta visibile e correggibile, ma non altera la struttura del flusso salvo blocchi tecnici minimi.

### Verifiche eseguite
- `npm run -w @rca/api build` ✅
- `npm run -w @rca/web build` ✅
- `npm run build` ✅
- `npm run -w @rca/api smoke` ✅ (`SMOKE_OK`)
- `npm run -w @rca/api smoke:table` ✅ (`TABLE_SMOKE_OK`)
- test mirato `node tmp_matrix_verify.mjs` ✅ (`MATRIX_VERIFY_OK`)
  - iter documentale senza speciali;
  - iter documentale con speciali;
  - iter tabellare con mismatch + speciali;
  - generazione finale da riga workspace confermata.

### Limiti residui reali
- Nel percorso documentale la precompilazione reale dei valori semplici dipende ancora dall’iniezione esterna di risultati OpenClaw / valori espliciti: il repo non contiene un motore LLM embedded né dataset reali finali.
- L’editor tabellare web è riga-singola/textarea-based: funziona, ma non è ancora un grid editor avanzato.
- La validazione resta forte su casi sintetici/anonimizzati e non sostituisce il collaudo finale su materiali reali dello studio.


## 2026-03-13 — ExecPlan 41 (final validation / go-live)
### Verifica tecnica completa
- `npm install` rieseguito sul workspace.
- `npm audit fix` eseguito con successo.
- Audit dipendenze ricontrollato:
  - `npm audit` ✅ `0 vulnerabilities`
  - `npm audit --omit=dev` ✅ `0 vulnerabilities`
- `npm run build` workspace completo ✅
- `npm run -w @rca/api smoke` ✅ (`SMOKE_OK`)
- `npm run -w @rca/api smoke:table` ✅ (`TABLE_SMOKE_OK`)

### Difetti reali emersi e corretti
- Corretto falso positivo nei report tecnici `GET /project/readiness` e `GET /project/go-live-report`:
  - rimosse capability/checklist Discord residue non più vere dopo il purge legacy;
  - aggiunti indicatori coerenti con lo stato reale (`legacyDiscordPurged`, `smokeTable`, `noLegacyDiscordRuntime`).
- Corretto comportamento del runner strict OpenClaw su template senza placeholder istruzionali:
  - prima il run risultava impropriamente `completed` con tutti i flow `skipped`;
  - ora `POST /practices/:id/pipeline/run-openclaw` restituisce `409` anche quando il template non espone alcun flow EXTRACT/DERIVE/GENERATE, mantenendo coerenza con la policy strict.

### Validazione finale dei 3 iter di prodotto
- Iter A — solo template ✅
  - verificato export struttura tabellare dal template in CSV / JSON / XLSX;
  - header coerenti: `row_id` + sole chiavi del template.
- Iter B — template + documentazione ✅
  - verificato blocco strict `409` senza output flow espliciti;
  - verificato blocco strict `409` anche con template privo di placeholder istruzionali;
  - verificato run completato con `flowOverrides` espliciti su set documentale anonimizzato minimo;
  - verificata generazione DOCX da riga workspace risultante.
- Iter C — template + tabella ✅
  - verificato caso matching OK;
  - verificato mismatch con colonna template mancante (blocco UX coerente lato prodotto);
  - verificato caso warning con colonna extra e generazione DOCX consentita usando solo le colonne riconosciute dal template.

### Limite residuo esplicito
- Nel repo non è presente un pacchetto finale di materiali reali / anonimizzati completi dello studio.
- La validazione finale copre quindi bene il go-live tecnico e i percorsi prodotto finali su casi sintetici/anonimizzati minimi, ma non costituisce copertura totale su casi reali finali.

## 2026-03-10 — ExecPlan 38 D2 (content extraction only)
### Audit finale D2
- Riesaminati `apps/api/src/extractor.ts`, `apps/api/src/extraction-rules.ts` e gli usi reali nel repo.
- Confermato come perimetro vivo il solo `extractTextByMime(...)` usato da `GET /practices/:id/extract-openclaw-payload`.
- Confermato come perimetro morto l'intero ramo legacy di field extraction euristica precetto-specifica:
  - `extractPrecettoFieldsDetailed(...)`
  - helper `excerptAround(...)`, `capture(...)`
  - utility di normalizzazione in `extraction-rules.ts`

### Redesign backend D2
- Rinominato/rifondato il modulo documentale in `apps/api/src/document-content.ts`.
- Aggiornato `apps/api/src/server.ts` per importare `extractTextByMime` dal nuovo modulo.
- Eliminati `apps/api/src/extractor.ts` e `apps/api/src/extraction-rules.ts`.
- Backend documentale riallineato a policy confermata:
  - solo file -> contenuto testuale leggibile
  - nessuna estrazione regex/heuristic di campi di dominio
  - nessuna normalizzazione implicita post-LLM
- `apps/api/src/llm-extractor.ts` classificato come residuo morto in D2; rimozione rinviata al passo D3 dedicato.

### Verifiche eseguite
- grep su `apps/api/src` dei simboli rimossi ✅
  - nessuna occorrenza residua di `extractPrecettoFieldsDetailed(...)`
  - nessun import runtime residuo verso `extraction-rules.ts`
- `npm run -w @rca/api build` ✅
- verifica diretta del modulo `extractTextByMime(...)` su:
  - TXT ✅
  - DOCX ✅
  - PDF ✅
- smoke API locale su `GET /practices/:id/extract-openclaw-payload` con upload reale di TXT/DOCX/PDF ✅
  - payload restituito con `documents[]` popolato solo via content extraction
- `npm run build` workspace completo ✅

## 2026-03-10 — ExecPlan 37 D1 (template table structure)
### Audit minimale D1
- Confermati i soli punti legacy da toccare per D1:
  - modulo statico di export template in `apps/api/src/`
  - route backend legacy di export template globale
  - link UI in `apps/web/src/App.tsx`
  - docs operative `18/19/20/24`
- Confermata come fonte canonica della struttura template l'introspezione del DOCX reale:
  - placeholder campi da `extractTemplateFields(...)`
  - placeholder istruzionali `[ ]`, `[[ ]]`, `[[[ ]]]` da `extractTemplateInstructions(...)`
  - unica colonna tecnica ammessa: `row_id`

### Redesign backend D1
- Rinominato/rifondato il modulo statico legacy in `apps/api/src/template-table-structure.ts`.
- Eliminato il vecchio endpoint globale di export template statico.
- Introdotto il nuovo endpoint contestuale `GET /templates/:id/table-structure/:format`.
- Nuovo export CSV/XLSX/JSON generato direttamente dal template selezionato:
  - solo `row_id` + chiavi derivate dal template
  - nessun campo hardcoded legacy
  - JSON serializzato come array tabellare a una riga seed

### Frontend D1
- `apps/web/src/App.tsx` aggiornato:
  - rimossi i link globali legacy di export template
  - introdotti i link contestuali `templates/:id/table-structure/...`
  - download disponibile solo con template selezionato
  - copy UI riallineata a “struttura tabellare dal template”

### Verifiche eseguite
- `npm run -w @rca/api build` ✅
- `npm run -w @rca/web build` ✅
- smoke funzionale dedicato con API live ✅
  - template semplice `{{...}}` -> export CSV/JSON/XLSX con header esatti `row_id + chiavi template`
  - template misto `[ ]`, `[[ ]]`, `[[[ ]]]`, `{{...}}` -> export JSON con tutte e sole le chiavi del template, nessuna colonna extra

## 2026-03-09 — ExecPlan 36 (audit + purge Discord legacy)
### Audit e classificazione consolidata
- Eseguito audit file-per-file su backend, web e docs.
- Confermata classificazione `DELETE` per l'intero layer Discord legacy applicativo.
- Confermata classificazione `FREEZE-D` per il vecchio export template statico, `extractor.ts`/`extraction-rules.ts`, `llm-extractor.ts`: non toccati in questa fase.
- Corretti nel piano i riferimenti ai nomi reali dei documenti operativi del repo (`19_RUNBOOK.md`, `20_API_QUICKREF.md`, `21_HANDOFF_CHECKLIST.md`, `24_OPEN_POINTS_PLAN.md`).

### Purge eseguito
- Rimossi da `apps/api/src/server.ts` gli endpoint legacy del layer Discord.
- Eliminato `apps/api/src/discord-parser.ts`.
- Eliminato smoke script `apps/api/scripts/e2e-discord.mjs` e relativo script npm `smoke:discord`.
- Ripuliti runbook/quickref/handoff dai riferimenti operativi al layer Discord legacy.
- Marcato `docs/15_DISCORD_CHANNEL_WORKFLOW_SPEC.md` come documento storico deprecato.

### Verifiche eseguite
- `npm run -w @rca/api build` ✅
- grep backend Discord legacy su `apps/api/src apps/api/scripts apps/api/package.json` ✅ (nessuna occorrenza residua)
- grep docs operative ripulite ✅

## 2026-03-06 — JOB-CORE-CLOSURE-01 (core closure)
### Completato
- Backend: creato modulo `apps/api/src/openclaw-runner.ts` con orchestrazione sequenziale EXTRACT/DERIVE/GENERATE, timeout/retry per flow, merge canonico bucket (`extract < derive < generate`).
- Backend: aggiunto endpoint `POST /practices/:id/pipeline/run-openclaw`.
  - usa `extract-openclaw-payload`
  - esegue i 3 flow separati
  - applica merge via `/extract-openclaw-merge-flows`
  - aggiorna riga attiva in `TableRow` (`rowIndex=1`, `source=pipeline-openclaw`)
  - produce stato run + stato flow-level in risposta.
- Backend: aggiunto endpoint `GET /practices/:id/table-rows/:rowIndex`.
- Audit flow-level completato:
  - `PIPELINE_RUN_START`
  - `FLOW_RUN_START` / `FLOW_RUN_OK` / `FLOW_RUN_FAIL`
  - `PIPELINE_RUN_COMPLETED` / `PIPELINE_RUN_FAILED`
- UI (`apps/web/src/App.tsx`) riallineata al flusso core:
  - bottone unico **Run AI Pipeline**
  - stato step EXTRACT/DERIVE/GENERATE
  - gestione errori per singolo flow
  - tabella finale row-level completa con colonne dinamiche
  - selezione riga attiva
  - generazione DOCX da riga selezionata.
- UI styles: estensioni tabella (`active-row`, `missing`, overflow).

### Verifiche eseguite
- `npm run build` ✅
- `npm run -w @rca/api smoke` ✅ (`SMOKE_OK`)
- `npm run -w @rca/api smoke:table` ✅ (`TABLE_SMOKE_OK`)

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

## 2026-03-06
### Blocco completato — ExecPlan 33 (multi-set batch + note documento)
- Creati i piani mancanti:
  - `docs/33_EXECPLAN_MULTISET_BATCH_AND_DOC_NOTES.md`
  - `docs/34_EXECPLAN_DETERMINISTIC_TABLE_CSV_XLSX_FIRST.md`
  - `docs/35_EXECPLAN_REAL_TESTS_AND_FINAL_HANDOFF.md`
- Esteso data model:
  - `StoredFile.noteText` (nota documento)
  - nuovo modello `TableRow` per righe tabella multi-set
- Implementato import multi-riga su `POST /practices/:id/import`:
  - parsing CSV/XLSX/JSON a più righe
  - persistenza tabellare `TableRow` con `rowIndex`
  - applicazione riga 1 come riga attiva sui `FieldValue`
- Implementato endpoint nota documento:
  - `POST /practices/:id/files/:fileId/note`
- Aggiornato payload OpenClaw extraction includendo `noteText` per documento.
- Build workspace eseguita con esito OK.

### Blocco completato — ExecPlan 34 (tabella deterministica CSV/XLSX-first)
- Reso deterministic-first il parser import (`parseImportFileRows`) senza inferenze fuzzy.
- Aggiunti endpoint tabella:
  - `GET /practices/:id/table-rows`
  - `POST /practices/:id/table-rows`
  - `GET /practices/:id/table-rows/export.csv`
- Aggiunto output DOCX per riga:
  - `POST /practices/:id/generate-docx-from-row`
- Eseguito allineamento docs open points (`docs/24_OPEN_POINTS_PLAN.md`).
- Build workspace rieseguita con esito OK.

### Blocco completato — ExecPlan 35 (test reali + handoff finale)
- Aggiunto smoke test reale tabellare:
  - `apps/api/scripts/e2e-table.mjs`
  - script npm: `npm run -w @rca/api smoke:table`
- Eseguiti test reali con API avviata:
  - `npm run -w @rca/api smoke` -> `SMOKE_OK`
  - `npm run -w @rca/api smoke:table` -> `TABLE_SMOKE_OK`
  - `npm run -w @rca/api smoke:discord` -> `DISCORD_SMOKE_OK`
- Aggiornate docs operative:
  - `docs/19_RUNBOOK.md`
  - `docs/20_API_QUICKREF.md`
  - `docs/21_HANDOFF_CHECKLIST.md`
- Build finale workspace confermata nuovamente OK.

## 2026-03-09 — ExecPlan 36 (redesign runner + document set + deterministic mode + table workspace + note + UX)
### Completato
- Runner `openclaw-runner.ts` rifatto in modalità `strict-openclaw`: nessuna euristica nascosta, nessuna simulazione implicita; senza output flow espliciti il run viene bloccato.
- Endpoint pipeline aggiornato:
  - supporto `documentSetId` su `POST /practices/:id/pipeline/run-openclaw`
  - audit `PIPELINE_RUN_BLOCKED` quando mancano output esterni
  - row output persistita con metadati di lifecycle (`originMode`, `sourceSetId`, `status`, `reviewState`, `qualityScore`).
- Formalizzato il dominio documentale:
  - `Practice.workingMode`
  - nuovo modello `DocumentSet`
  - `StoredFile.documentSetId`
  - `TableRow.originMode/sourceSetId/status/reviewState/qualityScore`.
- Aggiunti endpoint minimi document-set / mode:
  - `POST /practices/:id/mode`
  - `GET /practices/:id/document-sets`
  - `POST /practices/:id/document-sets`
  - `POST /practices/:id/document-sets/:setId/files/:fileId/attach`
- Upload file allineato ai set documentali (`documentSetId` nei multipart).
- UI ridisegnata con:
  - scelta esplicita modalità (`standard-document-set` / `deterministic-table-first`)
  - gestione document set
  - editor note per file
  - tabella finale con segnali `mode/status/review/quality`.

### Verifiche eseguite
- `npx prisma db push --schema apps/api/prisma/schema.prisma` ✅
- `npm run build` ✅
- smoke custom runner strict/document-set ✅ (`RUNNER_STRICT_SMOKE_OK`)
- `npm run -w @rca/api smoke` ✅ (`SMOKE_OK`)
- `npm run -w @rca/api smoke:table` ✅ (`TABLE_SMOKE_OK`)
- smoke custom mode/note/set ✅ (`MODE_NOTE_SET_SMOKE_OK`)

## 2026-03-13 — ExecPlan 40 (UI/UX hardening + real validation)
### Audit UX iniziale e correzione piano
- Riesaminati `apps/web/src/App.tsx` e `apps/web/src/styles.css` come entrypoint reale del prodotto.
- Problemi UX classificati:
  - **Alta priorità**: 3 iter reali non percepibili subito; nomenclatura troppo tecnica; assenza di matching esplicito template↔tabella; tabella finale non abbastanza centrale come workspace.
  - **Media priorità**: distinzione insufficiente tra percorso documentale e table-first; ruolo del template come generatore struttura poco chiaro; flow status leggibile ma non contestualizzato.
  - **Bassa priorità**: microcopy troppo backend-centrico; assenza di metriche sintetiche sul workspace.
- Corretto `docs/40_EXECPLAN_UI_UX_HARDENING_AND_REAL_VALIDATION.md` per chiarire che:
  - le modalità backend canoniche restano **2** (`STANDARD_DOCUMENT_SET`, `DETERMINISTIC_TABLE_FIRST`);
  - gli **iter UX** da mostrare all’utente restano **3** (`Solo template`, `Template + documentazione`, `Template + tabella`);
  - `Solo template` è un percorso **export-only**, non una nuova macro-funzionalità.
- Corretti nel piano anche i riferimenti ai nomi reali delle docs operative del repo.

### Hardening UI/UX eseguito
- `apps/web/src/App.tsx` rifatto attorno a un entrypoint guidato dei 3 iter reali.
- Ridotto il gergo tecnico in UI:
  - copy orientato a iter/azioni utente;
  - label comprensibili per pratica, template, input guidato, pipeline, matching, workspace.
- Reso esplicito il ruolo del template come generatore della struttura tabellare con CTA dedicate per export `XLSX/CSV/JSON`.
- Chiarita la differenza tra:
  - percorso documentale (`Template + documentazione`),
  - percorso deterministic-table-first (`Template + tabella`),
  - percorso preparatorio (`Solo template`).
- Introdotta verifica UX concreta per il caso deterministic-table-first:
  - confronto placeholder semplici del template ↔ colonne della tabella importata;
  - coverage %;
  - elenco colonne riconosciute / mancanti / extra;
  - severità `ok` / `warning` / `blocking`;
  - blocco UI della generazione DOCX in caso di mismatch bloccante;
  - conferma esplicita in caso di sole colonne extra.
- Rafforzata la tabella finale come workspace centrale:
  - metriche sintetiche (righe, pronte, da verificare, output generati, qualità media);
  - riepilogo riga attiva;
  - naming più operativo di origine/percorso/stato/review/qualità.
- Migliorata leggibilità stato flow-level EXTRACT/DERIVE/GENERATE con card dedicate.
- `apps/web/src/styles.css` aggiornato per supportare entry cards, workflow strip, matching panels, metriche workspace, pill stato e layout più leggibile.

### Verifiche eseguite dopo le macro-aree
- Build frontend: `npm run -w @rca/web build` ✅
- Build backend: `npm run -w @rca/api build` ✅
- Build workspace: `npm run build` ✅
- Smoke core: `npm run -w @rca/api smoke` ✅ (`SMOKE_OK`)
- Smoke deterministic-table-first: `npm run -w @rca/api smoke:table` ✅ (`TABLE_SMOKE_OK`)

### Validazione reale/anonymized eseguita
Eseguita validazione concreta con dataset anonimizzati costruiti ad hoc ma realistici per il dominio:
1. **Solo template**
   - template DOCX reale minimale con placeholder dominio;
   - verifica export struttura CSV da template;
   - esito: header coerenti con i placeholder del template.
2. **Template + documentazione**
   - template DOCX anonimizzato;
   - 2 documenti TXT anonimizzati caricati nel document set;
   - pipeline strict eseguita con `flowOverrides` espliciti per simulare output reali OpenClaw;
   - verifica creazione riga workspace + generazione DOCX da riga;
   - verifica contenuto DOCX generato su valori chiave (`Milano`, `Alfa SRL`, `Beta SPA`).
3. **Template + tabella — matching OK**
   - import CSV con tutte le colonne richieste;
   - verifica assenza mismatch;
   - generazione DOCX da riga completata.
4. **Template + tabella — mismatch**
   - import CSV con colonne mancanti ed extra;
   - mismatch rilevato concretamente (`capitale_ingiunto`, `di_numero` mancanti; `extra_colonna` extra);
   - esito usato per confermare la bontà del redesign UX matching/mismatch.

### Problemi emersi e correzioni
- Emersa in validazione una finezza non bloccante: l’export CSV della struttura usa quoting standard (`"row_id",...`).
  - Non è un bug prodotto.
  - È stato corretto il criterio di verifica reale per aderire all’output canonico dell’endpoint.
- Nessun blocker backend emerso nei percorsi testati.
- Nessuna nuova macro-funzionalità introdotta; solo hardening UX/UI e validazione reale.

## 2026-03-10 — ExecPlan 39 (D3: remove dead llm-extractor residue)
### Completato
- Eliminato `apps/api/src/llm-extractor.ts` come residuo morto.
- Verificato che il runtime vivo resti centrato solo su `extract-openclaw-payload`, `extract-openclaw-merge-flows`, `extract-openclaw`, `pipeline/run-openclaw`, `openclaw-runner.ts`.
- Nessun riferimento runtime attivo residuo al vecchio modulo; lasciati intatti solo riferimenti storici/docs dove utili come audit trail.

### Verifiche eseguite
- grep mirato su sorgenti/docs non-dist per distinguere riferimenti attivi vs storici ✅
- `npm run -w @rca/api build` ✅
- `npm run build` ✅
- grep finale runtime attivo su endpoint/moduli OpenClaw vivi ✅

