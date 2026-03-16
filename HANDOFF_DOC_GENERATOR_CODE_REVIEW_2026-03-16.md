# Handoff tecnico repo-only — doc-generator Discord v1

Date: 2026-03-16
Repo: `recupero-crediti-automation-ai-pipeline`
Remote: `https://github.com/Franq8/recupero-crediti-automation-ai-pipeline.git`
Branch: `refactor/ai-single-pipeline`
Target reader: sviluppatore che lavorerà **fuori dal Mac mini**, con accesso solo al repository/codice.

---

## 1. Obiettivo funzionale
Il canale Discord `doc-generator` deve implementare il flusso **template + tabella** coerente col design deciso:

- Discord è solo un ingresso UX semplificato
- il backend deve restare lo **stesso motore logico** del web
- il template DOCX definisce la struttura dei campi da usare
- la tabella sorgente fornisce i dati per riga
- la working table deve essere **template-driven**
- i segnaposto speciali nel template reale sono solo:
  - `Suo/Vostro`
  - `La/Vi`
- il modello/OpenClaw deve derivare questi 2 valori per ogni riga
- il DOCX finale deve essere generato dalla working table completa

---

## 2. Stato del problema al momento della consegna
### Cosa funziona ormai
- il listener Discord prende in carico i messaggi
- il naming pattern funziona
- i link download pubblici funzionano
- il parser dei field del template è stato molto ripulito
- il mini-test a 3 righe è stato portato a **0 placeholder mancanti**
- il flusso end-to-end piccolo è quindi sostanzialmente corretto

### Cosa NON è ancora affidabile
Sul batch completo reale (92 righe) il flusso non è ancora affidabile al 100%.

Ultimo comportamento osservato a livello logico:
- il run completo genera tutti i documenti
- ma resta un sottogruppo di documenti con placeholder mancanti
- in precedenza il pattern dominante era: mancano solo `La/Vi` e `Suo/Vostro` su un cluster di righe
- dopo ulteriori cambiamenti di batching/performance il residuo è cambiato, ma il problema non è stato chiuso definitivamente

Il punto importante è questo:
## il mini-test piccolo è pulito, il batch grande no

Questa differenza suggerisce un bug nel trattamento del caso massivo:
- batching/mapping risultati
- shape dei risultati OpenClaw multi-riga
- fallback silenziosi
- oppure gestione delle righe/casi anomali nella tabella reale

---

## 3. Flusso corretto atteso
Il flusso corretto, che il codice **dovrebbe** implementare, è questo:

1. carico `template.docx` + `table.xlsx/csv`
2. il backend estrae dal template i campi richiesti
3. costruisce una **working table template-driven**
   - solo campi richiesti dal template
   - inclusi `Suo/Vostro` e `La/Vi`
4. per ogni riga della tabella sorgente:
   - proietta i dati rilevanti nella working table
5. il motore OpenClaw/AI produce un output JSON strutturato per i due campi speciali
6. `workflow/enrich` scrive questi valori nella working table
7. `generate-docx-from-row` usa la working table finale
8. il DOCX non dovrebbe dover “capire” nulla di speciale oltre alla sostituzione normale dei placeholder

### Conseguenza importante
Se `Suo/Vostro` e `La/Vi` sono già presenti nella working table con i valori corretti,
allora il problema non è più nel motore AI ma nel mapping/render a valle.

Se invece mancano già nella working table,
il problema è a monte: prompt, shape output, mapping per riga, enrich.

---

## 4. Verifiche già fatte e risultati concreti

### 4.1 Segnaposto speciali reali del template
Verifica concreta fatta sul template reale:
- i veri segnaposto speciali sono solo:
  - `Suo/Vostro`
  - `La/Vi`

Non confondere con altri placeholder normali (`Email Pec`, `CODICE_FISCALE`, `Totale_dovuto`, ecc.).

---

### 4.2 Working table ed enrich
È stato verificato che il flusso logico base esiste davvero nel codice:
- la tabella di lavorazione è `TableRow.valuesJson`
- `workflow/enrich` fa merge di `deriveValues/generateValues`
- `generate-docx-from-row` legge `row.valuesJson`

Quindi il disegno concettuale è corretto.

---

### 4.3 Mini-test 3 righe
Con il template reale + mini-fixture 3 righe:
- il batch chiude
- naming corretto
- special placeholders sostituiti
- `documentsWithMissingPlaceholders: 0`

Questo è importantissimo perché prova che:
## il flusso base non è rotto in assoluto

---

### 4.4 Batch completo reale
Sul batch reale il comportamento non è ancora totalmente affidabile.

In una fase intermedia molto utile è emerso questo pattern:
- 92 documenti generati
- 17 documenti con warning
- per 16 righe mancavano solo:
  - `La/Vi`
  - `Suo/Vostro`
- una riga finale anomala aveva quasi tutti i placeholder mancanti

L’utente poi ha segnalato che nel file c’era una riga finale di totali.

Successivamente è stato testato anche un file corretto dall’utente, ma il residuo non è stato chiuso e il comportamento non è stato stabilizzato definitivamente.

---

## 5. Problemi strutturali trovati nel codice

### 5.1 `extractTemplateInstructions(...)` concatenava i text nodes Word con spazi
File:
- `apps/api/src/template-instructions.ts`

Problema originale:
- usava `textNodes.join(' ')`
- questo spezzava/corrompeva i placeholder reali Word

Fix introdotto:
- `join('')`

---

### 5.2 `extractTemplateFields(...)` parsava i placeholder sul raw XML
File:
- `apps/api/src/docx.ts`

Problema originale:
- il parser leggeva `mustache`, `chevron` e `listTemplatePlaceholderKeys(...)` sul raw XML
- questo produceva:
  - GUID spuri
  - frammenti XML nei placeholder
  - chiavi corrotte

Fix introdotti:
- linearizzazione del testo dai `<w:t>`
- parsing dei field sul testo linearizzato
- filtro di artefatti Word/GUID

Effetto:
- la lista campi del template è diventata molto più pulita

---

### 5.3 Working table non template-driven
File:
- `apps/api/src/server.ts`
- route `POST /discord/v1/template-table-autocontinue`

Problema originale:
- copiava quasi tutta la riga sorgente nella working table
- anziché proiettare solo i campi del template

Fix introdotto:
- uso di `buildTemplateTableStructure(...)`
- proiezione della riga sorgente sui soli campi del template

---

### 5.4 Parsing fragile di `openclaw agent --json`
File:
- `apps/api/scripts/doc-generator-discord-listener.mjs`

Problemi originali:
- parse fragile dell’envelope
- crash dell’intero batch su output malformato

Fix introdotti:
- estrazione primo oggetto JSON completo
- parsing più tollerante
- fallback per riga/batch

---

### 5.5 Performance troppo lenta
File:
- `apps/api/scripts/doc-generator-discord-listener.mjs`

Evoluzione:
1. seriale (1 riga = 1 prompt)
2. concorrenza semplice
3. concorrenza 12
4. batching multi-riga per prompt
   - 4 righe per prompt
   - 12 prompt concorrenti

Commit relativi sotto.

---

## 6. Ipotesi tecnica più probabile rimasta aperta
Dopo tutte le correzioni, la cosa più sospetta non è più il parser del template puro.

La differenza **mini-test pulito / batch completo non pulito** suggerisce soprattutto uno di questi problemi:

### Ipotesi A — batching multi-riga / mapping risultati
Il modello riceve più righe in un prompt, ma per alcuni batch:
- non restituisce tutte le row keys attese
- oppure la shape JSON non contiene correttamente `rows[rowIndex]`
- oppure alcune righe tornano senza `deriveValues`
- il fallback a `{}` fa perdere `La/Vi` / `Suo/Vostro`

### Ipotesi B — fallback silenzioso e non osservabile abbastanza
Il listener attuale può continuare anche se un batch OpenClaw è incompleto, ma questo può mascherare il fatto che alcune righe non hanno realmente ricevuto i valori speciali.

### Ipotesi C — righe anomale o shape diversa nel file reale
Possibile presenza di:
- righe finali di totali
- celle con formule / shape diverse
- righe che alterano la forma dei dati

Ma questo da solo non spiega i cluster coerenti sui due soli special placeholders, quindi non sembra la causa principale.

---

## 7. Cosa controllare subito nel codice
### A. Listener Discord — batch OpenClaw multi-riga
File:
- `apps/api/scripts/doc-generator-discord-listener.mjs`

Controllare in particolare:
- `computeSpecialPlaceholderRowResults(...)`
- shape attesa da `runOpenClawStructuredJson(...)`
- mapping:
  - `structured.rows[String(entry.rowIndex)]`
- fallback che mette `{ deriveValues: {}, generateValues: {} }`

### B. Verificare se per i batch problematici il modello restituisce davvero tutte le row keys
Suggerimento concreto:
- loggare per ogni batch:
  - row indexes richiesti
  - row indexes effettivamente presenti in `structured.rows`
  - chiavi presenti in `deriveValues`

Questo probabilmente chiarirebbe subito se il problema è nel batching.

### C. Confrontare una riga buona e una riga cattiva
Per esempio:
- una riga che popola `La/Vi` e `Suo/Vostro`
- una del cluster che li perde

Verificare:
1. prompt inviato
2. risposta OpenClaw grezza
3. `structured.rows`
4. `rowResults[rowIndex]`
5. `TableRow.valuesJson` dopo enrich

---

## 8. Commit già presenti e utili da leggere
Commit rilevanti sul branch `refactor/ai-single-pipeline`:

- `53a8a39` — Use public API base for Discord download links
- `3c42aea` — Fix public Discord download URL base resolution
- `b6d0c07` — Fix deployed Discord download base URL
- `92759ae` — Parse template fields from linearized DOCX text
- `55a0656` — Clean DOCX template field extraction
- `c92abe9` — Parallelize Discord special placeholder row processing
- `4cd8c07` — Batch multiple rows per OpenClaw prompt
- `99e38f3` — Add doc-generator handoff summary

Nota: questo handoff nuovo è quello da usare come riferimento principale, perché il precedente era troppo runtime-centric e non abbastanza utile per chi lavora solo sul repo.

---

## 9. Cosa suggerisco a chi prende il repo
### Obiettivo immediato
Chiudere il divario:
- mini-test piccolo = ok
- batch completo = non ancora affidabile

### Strategia consigliata
1. mantenere il mini-test 3 righe come baseline verde
2. aggiungere logging strutturato sui batch multi-riga OpenClaw
3. verificare presenza/assenza delle row keys nei risultati
4. se necessario, introdurre:
   - fallback per singola riga dentro batch multi-riga
   - oppure schema JSON molto più rigido
5. solo dopo ritestare il file completo

### Punto critico
Non bisogna più perdere tempo su:
- listener ingest
- link download
- naming
- parser template grezzo generale

I problemi grandi lì sono già stati affrontati.

Il punto vero rimasto aperto sembra molto più ristretto:
## robustezza del mapping risultati OpenClaw su batch completi multi-riga

---

## 10. Stato finale onesto
Il lavoro ha prodotto miglioramenti reali e sostanziali.
Il flusso è molto più vicino al corretto, ma non ancora chiuso al 100% sul file completo reale.

### In una riga
Se qualcuno prende il repo ora, la pista migliore da seguire non è “rifare tutto”, ma:
## ispezionare e rendere affidabile il ritorno/mapping dei batch OpenClaw multi-riga nel listener Discord
