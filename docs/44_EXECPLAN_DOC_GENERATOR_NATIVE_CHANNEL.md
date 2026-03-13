# 44 — ExecPlan: doc-generator native channel path

## Obiettivo
Chiudere definitivamente il canale Discord `doc-generator` come canale batch nativo, eliminando il routing conversazionale improprio e rendendo il path di esecuzione corretto direttamente operativo.

## Stato di partenza
- Il backend batch esiste già: `POST /discord/v1/template-table-autocontinue`
- Il canale Discord `doc-generator` esiste già: `1482018084020551883`
- Il problema reale trovato è nel routing: il guild config Discord di OpenClaw consente ancora `*`, quindi `doc-generator` viene trattato come canale normale dell’agente.

## Obiettivo finale desiderato
Nel canale `doc-generator` deve accadere solo questo:
1. l’utente carica 1 template DOCX + 1 tabella XLSX/CSV
2. parte il flusso batch corretto
3. nessuna risposta conversazionale/intermedia dell’agente
4. ritorno finale con ZIP + messaggio sintetico pertinente

## Vincoli
- Non introdurre workaround sporchi.
- Non riesumare il vecchio layer Discord legacy.
- Separare chiaramente il canale batch dal routing conversazionale generale.
- Rendere nativo il path di esecuzione effettivamente usato.

---

## Fase 1 — Audit del routing Discord reale
### Step 1.1
- rileggere config OpenClaw Discord attuale
- individuare esattamente il wildcard/allowlist che fa cadere `doc-generator` nel routing conversazionale

### Step 1.2
- verificare quali meccanismi di routing channel-specific esistono già nel runtime OpenClaw/config

### Verifica
- diagnosi precisa del punto di instradamento errato

---

## Fase 2 — Decisione architetturale finale
### Possibilità da valutare solo per chiuderne una
A. routing OpenClaw channel-specific con esclusione dal main agent
B. adapter/listener nativo batch-only sullo stesso bot/token

### Criterio
Scegliere quella che:
- elimina davvero la chat normale nel canale
- non richiede hack conversazionali
- usa il path più nativo e stabile

### Verifica
- decisione motivata e immediatamente implementabile

---

## Fase 3 — Implementazione del path nativo
### Se si sceglie A
- patch config/routing OpenClaw per isolare `doc-generator`
- aggancio del canale al path batch-only

### Se si sceglie B
- implementare listener nativo del progetto per il canale `doc-generator`
- usare direttamente il bot/token già configurato
- instradare il messaggio solo al flusso batch

### Verifica
- nessuna risposta conversazionale del main agent nel canale
- attivazione automatica del flusso corretto

---

## Fase 4 — Delivery finale nel canale
- messaggio iniziale opzionale minimo
- messaggio finale sintetico pertinente
- ZIP allegato
- nessun testo di reasoning/log non pertinente

### Verifica
- UX del canale conforme all’uso batch-only desiderato

---

## Fase 5 — Test end-to-end reale
- usare i due file di prova già creati
- caricarli davvero in `doc-generator`
- verificare l’intero giro fino al ritorno dello ZIP nel canale

### Verifica
- test reale completo riuscito

---

## Fase 6 — Consolidamento
- aggiornare docs operative minime
- commit + push finale se servono modifiche repo/config controllabili

## Definition of Done
Il blocco è chiuso quando:
1. `doc-generator` non si comporta più come chat agente normale;
2. il path nativo corretto è attivo;
3. caricando template + tabella il canale restituisce direttamente l’output batch atteso;
4. il test reale nel canale è riuscito davvero.
