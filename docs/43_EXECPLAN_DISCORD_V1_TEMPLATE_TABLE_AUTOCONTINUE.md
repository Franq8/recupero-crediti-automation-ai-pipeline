# 43 — ExecPlan: Discord v1 template + tabella in auto-continue

## Obiettivo
Implementare il primo flusso Discord operativo a partire dal caso più semplice ma già pienamente utile:
- input: **1 template DOCX + 1 tabella XLSX/CSV**
- motore: **stesso backend/flusso standard del web**
- UX Discord: nessuna sosta intermedia; il sistema auto-continua le fasi che sul web richiederebbero conferma utente
- output: **ZIP finale** con documenti generati + **report postumo cumulativo**

## Principio architetturale fissato
Discord **non introduce un motore diverso**.
Usa lo stesso comportamento del backend standard:
1. costruzione prima tabella di lavorazione
2. eventuale costruzione seconda tabella arricchita se ci sono placeholder speciali
3. generazione finale documenti

La sola differenza è UX:
- nel web: l’utente può fermarsi, vedere i report, modificare, premere continua
- in Discord: il sistema si comporta come se l’utente avesse già premuto continua nelle due eventuali soste

## Decisioni già fissate
1. Nessuna fase interattiva intermedia in Discord.
2. Nessun controllo bloccante di matching lato UX Discord.
3. I documenti vengono comunque generati, salvo errori tecnici reali.
4. Il report Discord è **postumo** e corrisponde alla somma dei due report del web:
   - report della prima tabella
   - report della seconda tabella, se esiste
5. L’output finale è un pacchetto ZIP con:
   - documenti generati
   - report postumo (`README.txt` o `report.md`)
   - eventuale riepilogo CSV per riga

---

## Scope (incluso)
1. Ingest Discord di 1 template + 1 tabella.
2. Trigger lavorazione Discord v1.
3. Auto-continue del flusso standard backend.
4. Packaging ZIP finale.
5. Report postumo cumulativo.
6. Messaggio Discord finale sintetico con esito e file allegato.

## Scope (escluso)
- flusso Discord con documentazione generica
- controllo manuale passo-passo in Discord
- editing tabella da Discord
- gestione avanzata thread/stati multipli oltre il minimo necessario per v1

---

## Fase 1 — Audit del flusso standard riusabile
### Step 1.1
- rileggere endpoint/workflow standard attuali:
  - `workflow/prepare`
  - `workflow/enrich`
  - `generate-docx-from-row`
  - export/report correlati

### Step 1.2
- identificare quali dati dei due mini-report servono per costruire il report postumo cumulativo

### Verifica
- mappa chiara dei punti riusabili senza introdurre logica parallela

---

## Fase 2 — Contratto Discord v1
### Step 2.1
Definire input accettati:
- 1 `.docx`
- 1 `.xlsx` o `.csv`

### Step 2.2
Definire comportamento se input non validi:
- template mancante -> errore tecnico
- tabella mancante -> errore tecnico
- più template / più tabelle -> errore tecnico chiaro

### Step 2.3
Definire output Discord:
- messaggio iniziale: lavorazione avviata
- messaggio finale: esito sintetico + ZIP allegato

---

## Fase 3 — Backend orchestration Discord v1
### Step 3.1
- introdurre endpoint/handler Discord v1 dedicato (senza riesumare il vecchio layer legacy improprio)
- ingest allegati + creazione pratica/lavorazione temporanea o dedicata

### Step 3.2
- eseguire in sequenza il flusso standard:
  1. upload template
  2. upload tabella
  3. `workflow/prepare`
  4. se presenti placeholder speciali -> `workflow/enrich`
  5. generazione documenti da tabella finale

### Step 3.3
- raccogliere dati dei report intermedi
- costruire report postumo cumulativo

### Verifica
- il backend Discord usa davvero lo stesso motore del web
- nessuna logica business duplicata in modo incoerente

---

## Fase 4 — Packaging output finale
### Step 4.1
- creare ZIP finale con:
  - DOCX generati
  - `README.txt` o `report.md`
  - eventuale CSV esiti/riepilogo per riga

### Step 4.2
- strutturare il report con 3 blocchi:
  1. esito prima fase / prima tabella
  2. esito seconda fase / seconda tabella (se presente)
  3. esito finale generazione

### Step 4.3
- includere warning/incongruenze rilevate, senza impedire la generazione già avvenuta

### Verifica
- ZIP leggibile e completo
- report coerente con le fasi effettivamente eseguite

---

## Fase 5 — Integrazione Discord lato UX minima
### Step 5.1
- messaggio iniziale sintetico: avvio lavorazione
### Step 5.2
- messaggio finale sintetico con:
  - numero documenti generati
  - righe con warning/errori
  - ZIP allegato

### Verifica
- esperienza Discord minimale e non invasiva
- nessuna “rottura di coglioni” intermedia

---

## Fase 6 — Verifica finale
### Step 6.1
- build completa
- smoke standard invariati
- test dedicato Discord v1 con template + tabella

### Step 6.2
- validare due casi:
  - template solo con placeholder semplici
  - template con placeholder speciali

### Step 6.3
- verificare che il report postumo includa davvero la somma delle due fasi quando la seconda esiste

---

## Fase 7 — Docs
Aggiornare:
- `docs/18_IMPLEMENTATION_LOG.md`
- `docs/19_RUNBOOK.md`
- `docs/20_API_QUICKREF.md`
- `docs/21_HANDOFF_CHECKLIST.md`
- `docs/24_OPEN_POINTS_PLAN.md`

---

## Definition of Done
Discord v1 è chiuso quando:
1. caricando template + tabella parte davvero lo stesso motore del web;
2. le soste intermedie sono bypassate automaticamente;
3. i documenti vengono generati comunque salvo errori tecnici reali;
4. viene restituito uno ZIP con documenti + report postumo cumulativo;
5. il report riassume davvero prima fase, eventuale seconda fase, ed esito finale.
