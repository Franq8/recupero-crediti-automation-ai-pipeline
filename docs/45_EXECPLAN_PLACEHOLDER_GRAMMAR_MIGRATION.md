# 45 — ExecPlan: migrazione sintassi placeholder canonica

## Obiettivo
Riallineare definitivamente il progetto a una grammatica unica e coerente di placeholder, separando bene:
- chiave finale di merge
- tipo di lavorazione (extract / derive / generate)

## Sintassi canonica fissata
- **extract** → `{campo}`
- **derive** → `[{campo} istruzione]`
- **generate** → `[[{campo} istruzione]]`

## Significato
### `{campo}`
- identifica la chiave finale della tabella/workspace
- il valore finale della colonna `campo` verrà usato per popolare il template

### `[{campo} istruzione]`
- il valore finale della colonna `campo` deve essere **derivato**
- l’istruzione testuale guida la derivazione

### `[[{campo} istruzione]]`
- il valore finale della colonna `campo` deve essere **generato**
- l’istruzione testuale guida la generazione

## Principio architetturale
- Le **graffe singole** definiscono sempre e solo la chiave finale di merge.
- Le **quadre esterne** definiscono il tipo di flusso.
- La tabella finale contiene solo colonne pulite (`campo`), non la sintassi completa dei placeholder.
- Il renderer finale deve popolare il template usando la stessa grammatica canonica (`{campo}`) o una conversione centralizzata equivalente.

---

## Fase 1 — Audit impatto codice
### Step 1.1
- individuare tutti i punti che oggi leggono:
  - `[campo]`
  - `[[campo]]`
  - `[[[campo]]]`
  - `{{campo}}`
  - `MERGEFIELD` / `«campo»`

### Step 1.2
- classificare i punti da aggiornare:
  1. parser template / istruzioni
  2. costruzione struttura tabellare
  3. workflow prepare/enrich
  4. renderer DOCX finale
  5. fixture/test/smoke
  6. docs

### Verifica
- mappa completa dell’impatto

---

## Fase 2 — Parser template e istruzioni
### Obiettivo
Far leggere al sistema la nuova grammatica canonica.

### Step 2.1 — Extract keys semplici
- `{campo}` deve essere riconosciuto come campo base/extract

### Step 2.2 — Derive
- `[{campo} istruzione]` deve produrre:
  - `key = campo`
  - `kind = derive`
  - `instruction = ...`

### Step 2.3 — Generate
- `[[{campo} istruzione]]` deve produrre:
  - `key = campo`
  - `kind = generate`
  - `instruction = ...`

### Step 2.4
- evitare collisioni/ambiguità col parser semplice delle graffe

### Verifica
- test parser su esempi minimi e misti

---

## Fase 3 — Struttura tabellare e workflow
### Obiettivo
Garantire che la tabella finale continui ad avere solo chiavi pulite.

### Step 3.1
- l’export struttura tabellare dal template deve produrre intestazioni:
  - `row_id`
  - `campo`
  - non la sintassi completa dei placeholder

### Step 3.2
- `workflow/prepare` deve popolare le colonne extract `{campo}`

### Step 3.3
- `workflow/enrich` deve usare i metadati ricavati da:
  - `[{campo} ...]`
  - `[[{campo} ...]]`

### Verifica
- prima tabella e seconda tabella coerenti con chiavi pulite

---

## Fase 4 — Renderer DOCX finale
### Obiettivo
Far sì che il template finale venga popolato correttamente con la nuova grammatica.

### Step 4.1
- introdurre supporto canonico a `{campo}` nel renderer

### Step 4.2
- decidere il ruolo residuo di `{{campo}}`, `«campo»`, `MERGEFIELD`:
  - compatibilità temporanea o rimozione/secondarietà

### Step 4.3
- garantire che un template con:
  - `{campo}`
  - `[{campo} istruzione]`
  - `[[{campo} istruzione]]`
  alla fine venga popolato col valore finale della colonna `campo`

### Verifica
- DOCX realmente popolati con la nuova sintassi

---

## Fase 5 — Aggiornamento fixture/test
### Step 5.1
- rifare template di prova e fixture Discord/web con nuova sintassi

### Step 5.2
- aggiornare smoke rilevanti / test mirati

### Step 5.3
- verificare almeno:
  - template con soli extract
  - template con derive
  - template con generate
  - template misto

---

## Fase 6 — Docs
Aggiornare:
- `docs/18_IMPLEMENTATION_LOG.md`
- `docs/19_RUNBOOK.md`
- `docs/20_API_QUICKREF.md`
- `docs/21_HANDOFF_CHECKLIST.md`
- `docs/24_OPEN_POINTS_PLAN.md`

Esplicitare la nuova grammatica come canonica.

---

## Fase 7 — Verifica finale
### Step 7.1
- build completa
### Step 7.2
- smoke principali
### Step 7.3
- test end-to-end su `doc-generator` con template nuovo
### Step 7.4
- verifica che i documenti finali siano davvero popolati con nuova sintassi

---

## Definition of Done
Il blocco è chiuso quando:
1. la nuova sintassi è l’unica grammatica canonica del progetto;
2. parser, workflow, tabella e renderer sono allineati;
3. i template di prova con `{campo}` / `[{campo} ...]` / `[[{campo} ...]]` funzionano davvero;
4. web e Discord producono documenti finali correttamente popolati.
