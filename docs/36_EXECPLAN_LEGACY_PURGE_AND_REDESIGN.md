# 36 — ExecPlan: Legacy purge + redesign coerente del nuovo core

## Obiettivo
Smarcare in modo ordinato tutto ciò che è stato individuato come:
1. legacy obsoleto già sostituito o esplicitamente fuori focus,
2. funzione reale da ridisegnare ex novo in modo coerente con il nuovo progetto.

## Vincoli operativi
- Procedere **step by step**, una macro-area alla volta.
- Dopo ogni step/macro-area: **verifica di correttezza** prima del passaggio successivo.
- I punti classificati in area **D (ambigui/da ridiscutere)** restano congelati fino a nuova decisione utente.
- Nessuna retrocompatibilità non richiesta.
- Hard delete dei layer certamente obsoleti.
- Durante il lavoro, rivalutare la classificazione iniziale alla luce della lettura concreta del codice: se emerge una realtà diversa, correggere il piano e documentarlo.

## Perimetro incluso
### DELETE / PURGE
- layer Discord legacy:
  - `POST /discord/openclaw-event`
  - `POST /discord/hook`
  - `POST /discord/router`
  - `POST /discord/command`
  - `apps/api/src/discord-parser.ts`
- eventuali richiami docs/UI/test a quel layer
- eventuali residui di percorsi ormai chiaramente superati

### REDESIGN
- runner OpenClaw lato app in forma definitiva/coerente
- modellazione forte dei document set
- modalità deterministic-first da file tabellare unico
- tabella finale come centro operativo vero
- note documento come feature completa
- UX/workflow di scelta modalità

## Perimetro escluso per ora (freeze area D)
- `import-template/:format`
- distinzione fine interna su `extractor.ts` / `extraction-rules.ts`
- decisioni finali su eventuale permanenza/rimozione completa di `llm-extractor.ts`

## Strategia generale
Il lavoro va svolto in 3 fasi grandi:
1. **Audit tecnico dettagliato e conferma classificazione**
2. **Purge del legacy morto**
3. **Redesign/implementazione coerente delle funzioni vive**

---

## FASE 1 — Audit tecnico approfondito
### Obiettivo
Passare dalla ricognizione ad alto livello a una mappa precisa file-per-file / endpoint-per-endpoint / dipendenza-per-dipendenza.

### Step 1.1 — Mappa dipendenze reali
- censire tutte le occorrenze di:
  - endpoint Discord legacy
  - parser Discord
  - hook/test/docs collegati
  - runner OpenClaw
  - document uploads / import rows / table rows / generate-docx-from-row
- mappare chi chiama cosa, in backend e frontend

### Step 1.2 — Verifica classificazione iniziale
Per ogni elemento classificato:
- confermare se è davvero `DELETE`, `REDESIGN`, `FREEZE-D`
- correggere la classificazione se il codice reale mostra sfumature diverse

### Deliverable
- aggiornamento di questo execplan se necessario
- nota sintetica in `docs/18_IMPLEMENTATION_LOG.md`

### Audit outcome consolidato (2026-03-09)
- Confermato `DELETE`: intero layer Discord legacy (`/discord/openclaw-event`, `/discord/hook`, `/discord/router`, `/discord/command`, `apps/api/src/discord-parser.ts`, smoke/script/docs operative collegate).
- Confermato `REDESIGN`: runner OpenClaw, formalizzazione document set, deterministic-table-first come mode esplicito, tabella finale come workspace operativo, note documento, UX scelta modalità.
- Confermato `FREEZE-D`: `import-template/:format`, distinzione interna `extractor.ts` / `extraction-rules.ts`, decisione finale su `llm-extractor.ts`.
- Correzione emersa dall'audit: i file docs reali da aggiornare in Fase 4 sono `19_RUNBOOK.md`, `20_API_QUICKREF.md`, `21_HANDOFF_CHECKLIST.md`, `24_OPEN_POINTS_PLAN.md` (non i nomi alternativi riportati nel mandato esterno).

### Verifica obbligatoria
- grep strutturale concluso
- classificazione consolidata documentata
- nessun intervento distruttivo ancora eseguito

---

## FASE 2 — Purge del legacy certamente morto
### Obiettivo
Rimuovere tutto ciò che appartiene a un paradigma già superato, senza toccare ancora i punti D.

### Macro-area 2A — Backend Discord legacy
#### Step 2A.1
- eliminare da `apps/api/src/server.ts`:
  - `/discord/openclaw-event`
  - `/discord/hook`
  - `/discord/router`
  - `/discord/command`

#### Step 2A.2
- eliminare `apps/api/src/discord-parser.ts`
- rimuovere import e riferimenti correlati

#### Step 2A.3
- eliminare eventuali test/smoke/docs riferiti a quel layer

#### Verifica
- build backend OK
- grep conferma assenza path Discord legacy
- nessun import spezzato

### Macro-area 2B — Pulizia documentazione e riferimenti residui
#### Step 2B.1
- pulire runbook/api quickref/checklist/implementation log da riferimenti Discord legacy come percorso core o operativo attuale

#### Step 2B.2
- verificare eventuali riferimenti in UI o script dev

#### Verifica
- ricerca testuale pulita
- documentazione coerente col nuovo perimetro

---

## FASE 3 — Redesign delle funzioni vive

### Macro-area 3A — Runner OpenClaw definitivo
#### Obiettivo
Trasformare il runner da wiring/placeholder tecnico a orchestratore coerente col modello OpenClaw/OAuth.

#### Step 3A.1 — Audit runner attuale
- leggere `openclaw-runner.ts` in dettaglio
- isolare cosa è solo scaffolding / heuristics / fake execution

#### Step 3A.2 — Contratto runner definitivo
- definire input/output/stati/errori
- definire comportamento in modalità strict OpenClaw
- eliminare fallback impliciti non voluti

#### Step 3A.3 — Implementazione
- rifare runner perché:
  - esegua i flow nel modo consentito dall’architettura OpenClaw scelta
  - renda esplicito lo stato dei flow
  - non simuli il lavoro AI in modo nascosto

#### Step 3A.4 — Verifica
- build
- smoke del nuovo percorso pipeline
- audit events coerenti

---

### Macro-area 3B — Modellazione forte dei document set
#### Obiettivo
Far emergere nel dominio il concetto di set documentale, oggi richiesto funzionalmente ma ancora non pienamente formalizzato.

#### Step 3B.1 — Audit del dominio corrente
- capire se `Practice + StoredFile + TableRow` basta o se serve nuova entità

#### Step 3B.2 — Scelta modellazione
Valutare e implementare, se necessario:
- `DocumentSet`
- `DocumentSetFile`
- associazione set -> pipeline run -> row output

#### Step 3B.3 — Implementazione backend
- endpoint CRUD minimi / associazione file->set / run per set

#### Step 3B.4 — Verifica
- ogni set genera una riga propria
- una riga produce un DOCX proprio
- nessuna contaminazione tra set

---

### Macro-area 3C — Modalità deterministic-first tabellare
#### Obiettivo
Trasformare l’attuale import multi-row in una vera seconda modalità di prodotto.

#### Step 3C.1 — Definizione formale modalità
- `mode = standard-document-set`
- `mode = deterministic-table-first`

#### Step 3C.2 — Regole di branch
- se template ha solo `[ ]` -> popolamento totalmente deterministico
- se template ha anche `[[ ]]` / `[[[ ]]]` -> eseguire solo i flow necessari per i placeholder speciali

#### Step 3C.3 — Implementazione applicativa
- orchestrazione coerente dei due rami
- tabella iniziale popolata direttamente dal file tabellare

#### Step 3C.4 — Verifica
- batch massivo con template solo `[ ]`
- caso misto con placeholder speciali

---

### Macro-area 3D — Tabella finale come centro operativo
#### Obiettivo
Rendere la tabella non una semplice preview ma il vero artefatto di lavorazione.

#### Step 3D.1 — Audit tabella attuale
- capire limiti di `TableRow` attuale
- definire lifecycle riga: creazione, aggiornamento, pronto, review, output

#### Step 3D.2 — Estensione modello/stato
- eventuali campi meta: `status`, `originMode`, `sourceSetId`, `reviewState`, `qualityScore`

#### Step 3D.3 — Implementazione UI/backend
- tabella come area lavoro
- selezione riga attiva
- segnali di qualità/stato riga

#### Step 3D.4 — Verifica
- una lavorazione incrementale popola e aggiorna correttamente la tabella

---

### Macro-area 3E — Note documento come feature completa
#### Obiettivo
Far diventare la nota per file una feature coerente e utilizzabile, non solo un campo tecnico.

#### Step 3E.1 — Audit note attuali
- verificare persistenza, uso nel payload, assenza/presenza UI

#### Step 3E.2 — Design funzionale
- nota per file dentro set
- visibilità in UI
- inserimento nel prompt con contesto corretto

#### Step 3E.3 — Implementazione
- UI note file
- wiring prompt
- verifica associazione nota -> documento corretto

#### Step 3E.4 — Verifica
- test con note differenti su file diversi

---

### Macro-area 3F — UX/workflow di scelta modalità
#### Obiettivo
Evitare l’ambiguità attuale tra upload documenti e import tabellare conviventi senza regia.

#### Step 3F.1 — Definizione UX
- scelta esplicita modalità per pratica o per lavorazione:
  - standard-document-set
  - deterministic-table-first

#### Step 3F.2 — Implementazione UI
- entrypoint chiaro
- pannelli e azioni coerenti per modalità

#### Step 3F.3 — Verifica
- utente capisce subito quale percorso sta usando
- nessuna azione “ibrida accidentale”

---

## FASE 4 — Verifica finale complessiva
### Step 4.1
- build completa workspace
- smoke tecnici principali
- eventuali smoke aggiuntivi per i nuovi rami

### Step 4.2
- audit finale grep-based per assicurare rimozione layer Discord legacy e altri residui purgati

### Step 4.3
- aggiornamento finale documentazione:
  - `18_IMPLEMENTATION_LOG.md`
  - `19_RUNBOOK.md`
  - `20_API_QUICKREF.md`
  - `21_HANDOFF_CHECKLIST.md`
  - `24_OPEN_POINTS_PLAN.md`

### Step 4.4
- report finale di completamento lavoro, esplicitando che si può poi passare ai punti dell’area D

---

## Ordine di esecuzione imposto al work job
1. Fase 1 audit approfondito
2. Fase 2 purge Discord legacy
3. Verifica
4. Fase 3A runner definitivo
5. Verifica
6. Fase 3B document set
7. Verifica
8. Fase 3C deterministic-first
9. Verifica
10. Fase 3D tabella centro operativo
11. Verifica
12. Fase 3E note documento
13. Verifica
14. Fase 3F UX modalità
15. Verifica finale complessiva
16. Report conclusivo all’utente

## Criterio di stop del work job
Il job deve fermarsi solo se:
- emerge una vera ambiguità funzionale non risolvibile dal piano,
- c’è rischio elevato di introdurre incoerenze strutturali o perdita di dati,
- per procedere sarebbe necessario intervenire sui punti congelati dell’area D.

## Definition of Done
Il lavoro è completato quando:
- il legacy Discord è purgato,
- le macro-funzioni vive sono state ridisegnate/implementate in forma coerente col nuovo progetto,
- ogni macro-area è stata verificata prima della successiva,
- esiste report finale che dichiara chiuso il lavoro e pronto il passaggio ai punti D.
