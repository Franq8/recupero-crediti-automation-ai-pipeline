# 24 — Piano punti aperti (aggiornato)

## 1) Runner OpenClaw lato app
- Stato: chiuso.
- Evidenza: runner strict, blocco esplicito senza output esterni, audit `PIPELINE_RUN_BLOCKED`.

## 2) Document set
- Stato: chiuso per il perimetro di ExecPlan 36.
- Evidenza: modello `DocumentSet`, file associabili al set, row con `sourceSetId`.

## 3) Modalità deterministic-table-first
- Stato: chiuso e riallineato da ExecPlan 42.
- Evidenza base: `Practice.workingMode`, UI con scelta esplicita, import tabellare come percorso dedicato.
- Evidenza UX/prodotto aggiornata: confronto template ↔ tabella con esito `match` / `non-match`, warning su mancanti/extra, prosecuzione consentita, prima tabella sempre presente, seconda tabella solo se esistono placeholder speciali.

## 4) Tabella finale come workspace operativo
- Stato: chiuso e rafforzato da ExecPlan 40.
- Evidenza base: row lifecycle con `status`, `reviewState`, `qualityScore`, output DOCX da riga.
- Evidenza UX aggiuntiva: tabella resa workspace percepibile con metriche sintetiche, dettaglio riga attiva, naming operativo e CTA orientate alla generazione documento.

## 5) Note documento
- Stato: chiuso per il perimetro di ExecPlan 36.
- Evidenza: note persistite e UI editor per file.

## 6) Area D
- Stato: D1, D2, D3 chiusi.
- Evidenza D1: eliminato il vecchio export template statico; introdotto `GET /templates/:id/table-structure/:format` con export derivato dal template (solo `row_id` + chiavi template, nessun campo legacy hardcoded).
- Evidenza D2: backend documentale ridotto a solo content extraction; rimosse la legacy field extraction `extractPrecettoFieldsDetailed(...)` e `extraction-rules.ts`; modulo vivo riallineato a `apps/api/src/document-content.ts`; nessuna normalizzazione implicita post-LLM nel core documentale.
- Evidenza D3: eliminato `apps/api/src/llm-extractor.ts`; nessun riferimento runtime attivo residuo al modulo morto; policy OpenClaw-only mantenuta solo nel runtime vivo e nelle docs corrette.
- Punto residuo area D: nessuno.

## 7) Go-live finale / punti ancora aperti fuori codice
- Stato: parzialmente aperto solo sul piano di validazione materiali reali.
- Chiuso lato tecnico:
  - build workspace OK;
  - smoke core OK;
  - smoke deterministic-table-first OK;
  - audit dipendenze pulito (`0 vulnerabilities`);
  - corretto falso positivo nei report di readiness/go-live su capability Discord residue;
  - corretto blocco strict runner anche quando il template non espone flow `[ ]` / `[[ ]]` / `[[[ ]]]`.
- Residuo non risolvibile senza input esterni:
  - manca nel repo un set finale di template/documenti reali o anonimizzati completi per collaudo prodotto definitivo su casi reali.
