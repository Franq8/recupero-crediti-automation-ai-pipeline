# 38 — ExecPlan D2: content extraction only

## Obiettivo
Ripulire definitivamente l’area `extractor.ts` / `extraction-rules.ts` allineandola al nuovo progetto:
- backend documentale = **solo estrazione contenuto/testo dai file**;
- nessuna estrazione euristica di campi di dominio;
- nessuna normalizzazione implicita dei valori finali restituiti dal flow AI;
- nessun residuo regex/heuristic precetto-specifico nel cuore del caso documentale.

## Decisioni già fissate
1. `extractPrecettoFieldsDetailed(...)` va eliminata.
2. Il backend non deve fare post-normalizzazione implicita dei valori LLM se prompt/output contract sono corretti.
3. Il modulo vivo da mantenere è solo quello che converte file -> contenuto leggibile.
4. `extraction-rules.ts`, se non più necessario dopo la rimozione del vecchio codice, va eliminato.
5. L’area documentale deve restare: file caricati -> contenuto -> flow AI.

## Output attesi
### Backend
- modulo coerente per content extraction only
- rimozione codice regex/heuristic di field extraction
- rimozione di `extraction-rules.ts` se ormai morto

### Docs
- aggiornamento log/quickref/open points dove opportuno

---

## Fase 1 — Audit D2 finale
### Step 1.1
- rileggere `extractor.ts`
- rileggere `extraction-rules.ts`
- grep usi reali nel repo

### Step 1.2
- confermare il perimetro vivo:
  - `extractTextByMime(...)` o equivalente
- confermare il perimetro morto:
  - `extractPrecettoFieldsDetailed(...)`
  - helpers usati solo da quella funzione

### Verifica
- lista completa dei simboli da tenere/rimuovere

---

## Fase 2 — Redesign backend
### Step 2.1
- trasformare `extractor.ts` in modulo coerente di content extraction only
- se opportuno, rinominarlo in modo più esplicito (`document-content.ts`, `file-content-extractor.ts`, ecc.)

### Step 2.2
- rimuovere `extractPrecettoFieldsDetailed(...)`
- rimuovere ogni helper morto collegato

### Step 2.3
- rimuovere `extraction-rules.ts` se non più necessario
- aggiornare tutti gli import residui

### Verifica
- build backend OK
- nessun import spezzato
- grep assenza simboli rimossi

---

## Fase 3 — Verifica funzionale
### Step 3.1
- verificare che il caso documentale continui a estrarre contenuto da:
  - PDF
  - DOCX
  - plain text / altri file testuali

### Step 3.2
- verificare che `extract-openclaw-payload` continui a funzionare correttamente usando solo content extraction

### Verifica
- build workspace OK
- smoke principali OK

---

## Fase 4 — Documentazione
Aggiornare:
- `docs/18_IMPLEMENTATION_LOG.md`
- `docs/24_OPEN_POINTS_PLAN.md`
- eventuali riferimenti tecnici se toccati

Segnare D2 come chiuso.

---

## Definition of Done
D2 è chiuso quando:
1. backend documentale fa solo content extraction;
2. `extractPrecettoFieldsDetailed(...)` non esiste più;
3. `extraction-rules.ts` non esiste più se non più necessaria;
4. nessun residuo regex/heuristic precetto-specifico resta nel core documentale;
5. build e smoke restano verdi.
