# 42 — ExecPlan: warn-and-proceed matrix + doppio mini-report

## Obiettivo
Implementare in modo coerente il comportamento prodotto definitivo dei due iter principali:
- **Template + documentazione**
- **Template + tabella**

secondo la regola unificante:

> **prima tabella di lavorazione, poi eventuale seconda tabella arricchita, poi generazione documenti**

con modello **warn-and-proceed**:
- l’utente viene informato con chiarezza,
- può correggere,
- può caricare nuovi input,
- può comunque continuare,
- salvo solo i pochi blocchi tecnici reali.

---

## Decisioni già fissate

### 1. Iter principali visibili all’utente
L’utente vede solo due percorsi principali di lavorazione:
- **A) Template + documentazione**
- **B) Template + tabella**

La funzione **solo template** resta separata, non come iter principale, ma come funzione laterale per generare la struttura tabellare.

### 2. Upload separato, non promiscuo
In entrambi gli iter:
- il template si carica in un’area dedicata
- documenti o tabella si caricano in un’altra area dedicata
- l’utente avanza con un pulsante esplicito

### 3. Politica generale
Il sistema adotta una logica **warn-and-proceed**:
- mismatch, warning, incongruenze, copertura parziale **non sono blocchi duri**
- il sistema informa con un mini-report
- l’utente può correggere / integrare / continuare

### 4. Unici blocchi veri ammessi
Solo blocchi tecnici minimi:
- template assente o invalido
- input assente o invalido
- impossibilità tecnica di costruire la tabella minima di lavorazione

### 5. Regola unificante sui placeholder speciali
In ogni caso:
1. prima si costruisce una **prima tabella di lavorazione**
2. si mostra un **primo mini-report**
3. l’utente può modificare la tabella e/o aggiungere input
4. se non esistono placeholder speciali, si va direttamente alla generazione
5. se esistono placeholder speciali, si eseguono i flow AI
6. si mostra un **secondo mini-report** con tabella arricchita
7. l’utente può modificare ancora la tabella finale
8. poi si generano i documenti

---

## Modellazione finale del comportamento

# ITER A — Template + documentazione

## Fase A1 — Upload
L’utente carica:
- template
- uno o più documenti

## Fase A2 — Costruzione prima tabella
Il sistema:
- legge il template
- legge i documenti come documentazione
- popola i campi semplici `[ ]` tramite la fase di estrazione
- costruisce la **prima tabella di lavorazione**

## Fase A3 — Primo mini-report
Il mini-report A deve mostrare:
1. sintesi input:
   - template caricato
   - documenti caricati/letti
2. warning/incongruenze rilevate
3. **tabella di lavorazione editabile**

## Azioni utente disponibili
Sempre le stesse:
- modificare/completare la tabella
- caricare nuovi documenti
- continuare

## Fase A4 — Placeholder speciali
Se nel template non ci sono `[[ ]]` o `[[[ ]]]`:
- si passa direttamente alla generazione documenti

Se nel template ci sono placeholder speciali:
- si eseguono DERIVE / GENERATE
- si costruisce la **seconda tabella di lavorazione**

## Fase A5 — Secondo mini-report
Mostrare:
- esiti del modello
- warning eventuali
- **tabella finale di lavorazione** arricchita con i nuovi valori
- evidenza chiara dei campi derivati/generati

## Azioni utente disponibili
- modificare la tabella finale
- continuare

## Fase A6 — Generazione documenti
- un documento per riga della tabella finale

---

# ITER B — Template + tabella

## Fase B1 — Upload
L’utente carica:
- template
- una sola tabella

## Fase B2 — Costruzione prima tabella
Il sistema:
- legge il template
- legge la tabella
- confronta placeholder semplici del template con le intestazioni della tabella
- popola deterministicamente i campi semplici `[ ]`
- costruisce la **prima tabella di lavorazione**

## Esiti utili del confronto
Non esistono più sottocasi inutilmente ramificati.
Gli esiti sono solo due:
- **match**
- **non match**

In entrambi i casi il sistema prosegue fino al mini-report, salvo blocchi tecnici reali.

## Fase B3 — Primo mini-report
Il mini-report B deve mostrare:
1. sintesi input:
   - tabella caricata
   - righe rilevate
   - colonne rilevate
2. esito del confronto:
   - match / non match
   - warning utili
   - eventuali colonne mancanti / extra
3. **tabella di lavorazione editabile**

## Azioni utente disponibili
Sempre le stesse:
- correggere/modificare la tabella di lavorazione
- caricare una nuova tabella
- continuare

## Fase B4 — Placeholder speciali
Se nel template non ci sono `[[ ]]` o `[[[ ]]]`:
- si passa direttamente alla generazione documenti

Se nel template ci sono placeholder speciali:
- si eseguono DERIVE / GENERATE
- si costruisce la **seconda tabella di lavorazione** arricchita

## Fase B5 — Secondo mini-report
Mostrare:
- esiti del modello
- warning eventuali
- **tabella finale di lavorazione** completa/arricchita
- evidenza dei campi derivati/generati

## Azioni utente disponibili
- modificare la tabella finale
- continuare

## Fase B6 — Generazione documenti
- un documento per riga della tabella finale

---

## Regola unica sui warning
Warning e incongruenze non devono cambiare la struttura del flusso.
Servono a:
- informare,
- orientare,
- aiutare l’utente a correggere,
- senza impedire la prosecuzione.

---

## Regola unica sulle tabelle
### Prima tabella di lavorazione
Sempre presente, in ogni iter.
È il risultato della prima fase di analisi/precompilazione.

### Seconda tabella di lavorazione
Presente solo se il template contiene placeholder speciali.
È la tabella arricchita dopo DERIVE / GENERATE.

### In entrambe le fasi
La tabella deve essere:
- leggibile
- editabile
- centrale nella UX

---

## Requisiti UI/UX da implementare
1. schermata iniziale con due soli iter principali
2. upload separato template / input
3. pulsante esplicito di avanzamento dopo upload
4. mini-report A per il caso documentale
5. mini-report B per il caso tabellare
6. prima tabella editabile
7. secondo mini-report solo se esistono placeholder speciali
8. seconda tabella editabile
9. pulsante continua verso generazione
10. generazione finale da tabella definitiva

---

## Requisiti backend/comportamentali
1. supportare fase intermedia dopo upload
2. persistere/servire la prima tabella di lavorazione
3. supportare correzioni utente prima della generazione
4. eseguire i flow speciali solo dopo conferma utente
5. persistere/servire la seconda tabella di lavorazione
6. generare i documenti solo dalla tabella finale approvata/corrente
7. distinguere blocchi tecnici veri da warning superabili

---

## Fasi implementative

### Fase 1 — Audit implementativo
- rileggere UI e backend attuali rispetto a questa matrice
- individuare cosa già esiste e cosa manca

### Fase 2 — Allineamento backend
- introdurre o rifinire lo stato/fasi della lavorazione
- supportare la prima tabella come output intermedio esplicito
- supportare la seconda tabella come output dei flow speciali
- garantire comportamento warn-and-proceed

### Fase 3 — Allineamento frontend
- rifare la UX dei due iter principali secondo questo schema
- implementare primo mini-report e prima tabella editabile
- implementare secondo mini-report e seconda tabella editabile
- rendere chiaro il passaggio a generazione

### Fase 4 — Verifica
- test completo iter A senza speciali
- test completo iter A con speciali
- test completo iter B con match e senza speciali
- test completo iter B con non-match e speciali

### Fase 5 — Docs
- aggiornare `18`, `19`, `20`, `21`, `24`

---

## Definition of Done
Questo blocco è chiuso quando:
1. esistono davvero i due iter principali nella forma definita;
2. esiste la prima tabella intermedia in entrambi gli iter;
3. esiste la seconda tabella solo se ci sono placeholder speciali;
4. warning e incongruenze sono superabili dall’utente;
5. la generazione avviene sempre dalla tabella finale;
6. UI e backend sono coerenti con questa matrice.
