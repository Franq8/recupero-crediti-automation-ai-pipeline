# 37 — ExecPlan D1: struttura tabellare derivata dal template

## Obiettivo
Eliminare il vecchio concetto di `import-template` statico e sostituirlo con una funzione coerente col nuovo progetto:
- il **template Word** definisce sempre la **struttura della tabella**;
- il sistema deve poter esportare tale struttura in `CSV`, `XLSX`, `JSON`;
- nessun campo hardcoded legacy;
- nessuna distinzione artificiale tra formati documentali nel caso documentale.

## Decisioni già fissate
1. Il vecchio endpoint `GET /import-template/:format` va eliminato.
2. Il vecchio generatore statico (`template-download.ts` nella forma attuale) va rimosso o rifondato.
3. La nuova funzione serve a:
   - **Caso A**: solo template -> generazione struttura vuota/tabellare
   - **Caso C**: template + una sola tabella -> contratto deterministic-first
4. Per il caso `template + documentazione`, questa funzione NON è il motore di popolamento; lì i file sono documentazione e il popolamento avviene via flow AI.
5. La struttura esportata deve contenere:
   - `row_id`
   - tutte e sole le chiavi derivate dal template
6. Nessuna colonna extra di dominio/legacy nel file esportato.
7. La classificazione interna dei placeholder (`extract` / `derive` / `generate`) resta interna al sistema e non deve sporcare CSV/XLSX visibile all’utente.

## Output attesi
### Backend
- nuovo endpoint contestuale, guidato dal template, per esportare la struttura tabellare
- eventuale endpoint/schema JSON ausiliario se utile internamente
- eliminazione del vecchio `GET /import-template/:format`

### Frontend
- sostituzione link/download vecchi con download struttura derivata dal template selezionato
- testo UI coerente col nuovo modello

### Docs
- aggiornamento quickref/runbook/implementation log/open points

---

## Fase 1 — Audit D1 minimale
### Step 1.1
- leggere `template-download.ts`, `server.ts`, `App.tsx` e docs che referenziano `import-template/:format`
- confermare tutti i punti di aggancio del vecchio flusso

### Step 1.2
- confermare la fonte canonica della struttura:
  - introspezione placeholder dal template reale
  - inclusione di `row_id` come unica colonna tecnica

### Verifica
- lista completa punti da toccare, senza ambiguità residue

---

## Fase 2 — Redesign backend
### Step 2.1 — Nuovo contratto
Introdurre un nuovo concetto backend, ad esempio:
- `GET /templates/:id/table-structure/:format`
oppure equivalente coerente col codice esistente.

Il contenuto deve essere derivato da:
- placeholder del template
- ordine stabile delle chiavi
- prefisso tecnico minimo: `row_id`

### Step 2.2 — Implementazione generatore
- rifare `template-download.ts` oppure sostituirlo con modulo nuovo
- generare `CSV`, `XLSX`, `JSON` solo dalla struttura del template
- nessun riferimento a campi statici legacy

### Step 2.3 — Wiring server
- aggiungere nuovo endpoint
- rimuovere vecchio `GET /import-template/:format`
- aggiornare eventuali percorsi correlati

### Verifica
- build backend OK
- prova download su template reale/minimo
- output contiene solo `row_id` + chiavi template

---

## Fase 3 — Allineamento frontend
### Step 3.1
- aggiornare i link download in `App.tsx`
- rendere esplicito che si tratta di “struttura tabellare dal template”

### Step 3.2
- verificare che il download richieda template selezionato / contesto corretto
- evitare UX ambigua del vecchio import-template globale

### Verifica
- build frontend OK
- link coerenti e non rotti

---

## Fase 4 — Verifica funzionale D1
### Step 4.1
- smoke minimo: template con placeholder semplici + export CSV/XLSX/JSON
- verificare che intestazioni = `row_id` + chiavi template

### Step 4.2
- smoke con template misto (`[ ]`, `[[ ]]`, `[[[ ]]]`)
- verificare che la struttura tabellare includa tutte le chiavi del template, senza colonne extra

### Step 4.3
- grep finale assenza vecchio `import-template/:format` in backend/web/docs operative

---

## Fase 5 — Documentazione
Aggiornare:
- `docs/18_IMPLEMENTATION_LOG.md`
- `docs/19_RUNBOOK.md`
- `docs/20_API_QUICKREF.md`
- `docs/24_OPEN_POINTS_PLAN.md`

Segnare D1 come chiuso.

---

## Definition of Done
D1 è chiuso quando:
1. il vecchio `import-template/:format` non esiste più;
2. esiste un nuovo export struttura tabellare derivata dal template;
3. CSV/XLSX/JSON contengono solo `row_id` + chiavi del template;
4. UI e docs riflettono il nuovo modello;
5. verifica tecnica finale OK.
