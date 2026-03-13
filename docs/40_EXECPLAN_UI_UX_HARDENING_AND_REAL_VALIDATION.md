# 40 — ExecPlan: UI/UX hardening + real validation

## Obiettivo
Portare il progetto dallo stato “architetturalmente coerente” allo stato “prodotto realmente usabile”, intervenendo su:
- chiarezza UX delle modalità operative,
- flusso guidato dell’utente,
- esperienza della tabella come centro operativo,
- caso deterministic-table-first,
- validazione concreta su casi reali/anonymizzati.

## Premessa
Il backend/core risulta ormai ripulito e coerente. Il rischio residuo non è tanto architetturale quanto di prodotto:
- UI troppo tecnica o poco guidata,
- confusione sulle modalità,
- caso tabellare non ancora sufficientemente accompagnato,
- mancanza di validazione reale sui template/documenti.

### Correzione emersa dall’audit UX iniziale
L’audit ha chiarito due precisazioni necessarie al piano:
1. nel prodotto esistono **2 modalità backend canoniche** (`STANDARD_DOCUMENT_SET`, `DETERMINISTIC_TABLE_FIRST`), mentre i **3 iter UX** da mostrare all’utente sono:
   - Solo template
   - Template + documentazione
   - Template + tabella
2. il percorso **Solo template** non richiede una terza mode backend: è un **entrypoint/export-only** che guida l’utente a scaricare la struttura tabellare dal template e preparare il file da reimportare.

Questa correzione non amplia lo scope: riallinea solo piano, naming e UX al dominio reale del repo.

## Scope (incluso)
1. Audit UX completo dell’interfaccia attuale.
2. Hardening UI per i 3 iter reali:
   - solo template,
   - template + documentazione,
   - template + una sola tabella.
3. Rifinitura UX del caso deterministic-table-first.
4. Validazione reale guidata su casi concreti.
5. Correzioni emerse dai test.
6. Go-live assessment finale.

## Scope (escluso)
- nuove macro-funzionalità non già discusse
- ritorno di layer legacy rimossi
- canali/modi operativi fuori perimetro core

## Principi di design
1. L’utente non deve ragionare per endpoint, ma per iter.
2. Le modalità devono essere evidenti e mutuamente comprensibili.
3. La tabella finale deve apparire come workspace centrale, non come effetto collaterale.
4. Il flusso deterministic-table-first deve essere rigido, chiaro, e non ambiguo.
5. I mismatch devono essere spiegati in modo operativo, non tecnico.

---

## FASE 1 — Audit UX attuale
### Step 1.1
- rileggere `apps/web/src/App.tsx` e `styles.css`
- mappare l’attuale esperienza utente end-to-end

### Step 1.2
- individuare punti di confusione, overload tecnico, ordine sbagliato dei pannelli, naming poco chiaro

### Deliverable
- nota sintetica problemi UX reali
- eventuale aggiornamento di questo piano se l’audit rivela criticità più precise

### Nota audit UX eseguito
**Priorità alta**
- entry UX iniziale poco guidato: i 3 iter reali erano mischiati nello stesso blocco input;
- naming tecnico (`STANDARD_DOCUMENT_SET`, `DETERMINISTIC_TABLE_FIRST`, `Run AI Pipeline`) più vicino al backend che al lavoro dell’utente;
- assenza di confronto esplicito template ↔ tabella nel caso deterministic-table-first;
- tabella finale presente ma non abbastanza leggibile come workspace principale.

**Priorità media**
- differenza tra percorso documentale e percorso tabellare non sufficientemente esplicitata;
- ruolo del template come generatore della struttura tabellare poco evidente;
- stato flow-level leggibile ma non abbastanza contestualizzato come avanzamento operativo.

**Priorità bassa**
- microcopy troppo “sistema-centrico”;
- mancava una sintesi numerica dello stato del workspace tabellare.

### Verifica
- classificazione dei problemi UX in priorità alta/media/bassa

---

## FASE 2 — Ridisegno entry UX delle modalità
### Obiettivo
Far capire subito all’utente quale iter sta scegliendo.

### Step 2.1
- introdurre un entrypoint chiaro per i 3 iter:
  - Solo template
  - Template + documentazione
  - Template + tabella

### Step 2.2
- ridurre ambiguità nella schermata iniziale della pratica
- rendere esplicito cosa succede dopo la scelta

### Step 2.3
- riallineare copy e microcopy UI

### Verifica
- build frontend OK
- flusso di scelta modalità leggibile senza spiegazione esterna

---

## FASE 3 — Hardening caso “solo template”
### Obiettivo
Fare di questo iter uno strumento semplice per generare la struttura tabellare corretta.

### Step 3.1
- rendere evidente il ruolo del template come generatore struttura
- guidare il download CSV/XLSX/JSON della struttura tabellare

### Step 3.2
- evitare che l’utente confonda questo iter con l’import documentale

### Verifica
- test manuale: upload template -> export struttura chiaro e immediato

---

## FASE 4 — Hardening caso “template + documentazione”
### Obiettivo
Rendere il flusso documentale lineare e leggibile.

### Step 4.1
- chiarire che tutti i file caricati sono trattati come documentazione
- spiegare che il contenuto viene analizzato dai flow AI

### Step 4.2
- rendere più trasparente l’avanzamento dei flow
- evidenziare esito, blocchi, stato riga/tabella risultante

### Verifica
- test manuale: template + documenti -> pipeline -> tabella -> docx comprensibile

---

## FASE 5 — Hardening caso “template + una sola tabella”
### Obiettivo
Chiudere il flusso deterministic-table-first come percorso prodotto vero.

### Step 5.1
- rendere evidente che questo iter è separato dal documentale
- guidare: template -> struttura tabellare -> compilazione/import

### Step 5.2
- introdurre UX di confronto tra placeholder semplici del template e intestazioni della tabella caricata
- mostrare percentuale di corrispondenza, mismatch, colonne mancanti/extra

### Step 5.3
- definire comportamento UX in caso di mismatch:
  - avviso
  - blocco o conferma esplicita secondo severità

### Step 5.4
- spiegare chiaramente che:
  - i placeholder semplici si popolano deterministicamente
  - i placeholder speciali, se presenti, vengono completati dai flow successivi

### Verifica
- test manuale con tabella matching
- test manuale con tabella mismatch

---

## FASE 6 — Tabella finale come workspace centrale
### Obiettivo
Rendere la tabella il cuore operativo percepibile del prodotto.

### Step 6.1
- migliorare leggibilità di colonne, stato, review, qualità, origine
- chiarire cosa è già pronto e cosa richiede attenzione

### Step 6.2
- rendere più evidente la relazione riga -> documento generabile

### Verifica
- tabella comprensibile anche senza conoscere i dettagli tecnici del backend

---

## FASE 7 — Validazione reale
### Obiettivo
Passare da “funziona in smoke” a “regge su casi veri”.

### Step 7.1
- raccogliere/uso di 2–3 template reali o anonimizzati
- usare 2–3 set di documenti reali/anonymizzati
- usare almeno 1 tabella reale/anonymizzata

### Step 7.2
- eseguire i tre iter reali
- annotare problemi funzionali, UX, output, mismatch

### Step 7.3
- correggere ciò che emerge come bug o incoerenza

### Verifica
- checklist esiti per ciascun iter

---

## FASE 8 — Go-live assessment finale
### Step 8.1
- build finale
- smoke tecnici
- verifica UI/UX finale
- verifica casi reali completati

### Step 8.2
- aggiornare docs reali del repo:
  - `18_IMPLEMENTATION_LOG.md`
  - `19_RUNBOOK.md`
  - `20_API_QUICKREF.md` (se emergono delta API reali)
  - `21_HANDOFF_CHECKLIST.md`
  - `24_OPEN_POINTS_PLAN.md`

### Step 8.3
- produrre giudizio finale esplicito:
  - pronto
  - pronto con limiti
  - non ancora pronto

---

## Definition of Done
Questa fase è chiusa quando:
1. i 3 iter sono chiari in UI;
2. il caso table-first ha una UX di matching/mismatch solida;
3. la tabella finale è chiaramente percepita come workspace centrale;
4. i test reali hanno prodotto evidenze sufficienti;
5. esiste una valutazione go-live onesta e motivata.
