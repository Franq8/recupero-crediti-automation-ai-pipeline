# Handoff — doc-generator Discord v1

Date: 2026-03-16
Repo: `recupero-crediti-automation-ai-pipeline`
Remote: `https://github.com/Franq8/recupero-crediti-automation-ai-pipeline.git`
Branch: `refactor/ai-single-pipeline`

## Obiettivo perseguito
Ripristinare il flusso `doc-generator` Discord in modo coerente col design deciso:
- Discord come solo punto di ingresso UX semplificato
- backend comune col web
- naming corretto
- link pubblico corretto
- working table guidata dal template
- segnaposto speciali (`Suo/Vostro`, `La/Vi`) popolati correttamente
- batch completo stabile sul file reale

## Stato al momento della consegna
### Risolto
1. **Link download pubblico corretto**
   - eliminati fallback localhost/127.0.0.1
   - base URL corretto con `/api`
   - deploy live corretto

2. **Trigger listener Discord**
   - il listener ora prende in carico il messaggio correttamente
   - logging di ingest aggiunto

3. **Naming pattern**
   - il listener ora passa `namingPattern`
   - naming finale corretto nei DOCX generati

4. **Schema template / placeholder extraction molto migliorato**
   - `extractTemplateInstructions(...)`: unione `w:t` con `join('')` anziché `join(' ')`
   - `extractTemplateFields(...)`: parsing su testo linearizzato dei `<w:t>` invece che su raw XML
   - filtraggio di artefatti Word/GUID
   - working table molto più pulita

5. **Working table template-driven**
   - il ramo Discord `template + tabella` non copia più ciecamente tutta la riga sorgente
   - usa la struttura del template come base

6. **Mini-test 3 righe**
   - riuscito pulito
   - `documentsWithMissingPlaceholders: 0`
   - nessun warning
   - questo prova che il flusso base, su caso ridotto, è stato sostanzialmente riparato

7. **Performance migliorata**
   - inizialmente seriale
   - poi concorrenza 12
   - poi batching multi-riga:
     - 12 prompt in parallelo
     - 4 righe per prompt

## Non risolto completamente
### Problema residuo principale
Sul batch completo reale (file grande) il flusso continua a lasciare un numero residuo di documenti con placeholder mancanti.

### Ultimi esiti rilevanti
1. **Run completo con file originale**
   - Practice: `P-20260316-8MQ800SWAI`
   - `92/92` documenti generati
   - `17` documenti con placeholder mancanti
   - pattern dominante sui residui:
     - per 16 righe mancavano solo `La/Vi` e `Suo/Vostro`
   - 1 riga finale anomala con quasi tutti i placeholder mancanti, poi spiegata dall’utente come riga totale nel file Excel

2. **Run completo con file Excel corretto dall’utente**
   - esito peggiore riportato: `documentsWithMissingPlaceholders: 24`
   - non è stato ancora aperto/analizzato il report corretto di questo run al momento della consegna

## Diagnosi tecnica finale più probabile
Il problema residuo **non sembra più** nel parser DOCX di base o nel working table schema generale.

Il mini-test pulito suggerisce che il flusso è corretto in sé.

Il problema residuo sul batch completo sembra più probabilmente qui:
- **batching/mapping dei risultati OpenClaw multi-riga**, oppure
- comportamento non uniforme del modello su alcuni gruppi di righe, oppure
- fallback silenzioso a `{}` per alcuni batch/rowIndex, con conseguente perdita di `La/Vi` e `Suo/Vostro`

In altre parole:
- il caso ridotto funziona
- il caso grande degrada su un sottoinsieme di righe
- quindi il bug residuo è verosimilmente nel trattamento dei risultati su batch completi, non nella logica di sostituzione semplice

## Verifiche concrete svolte
### Conferme ottenute
- i segnaposto speciali reali del template sono solo:
  - `Suo/Vostro`
  - `La/Vi`
- il modello è in grado di produrre valori corretti su mini-test
- i valori speciali entrano nella working table nel mini-test
- nel mini-test il DOCX finale sostituisce correttamente i placeholder
- il parser dei template fields prima era realmente sporco e produceva GUID/XML spazzatura
- dopo il fix il set campi è diventato pulito

### Problemi trovati e affrontati
- parsing fragile di `openclaw agent --json`
- trigger listener non osservabile → aggiunto logging
- base URL download errato
- compose live con `PUBLIC_API_BASE_URL` sbagliato
- working table non template-driven
- parser template field su raw XML
- serializzazione troppo lenta del calcolo special placeholders

## Commit rilevanti già presenti sul branch
Nell’ordine generale del lavoro, tra i più importanti:
- `53a8a39` — Use public API base for Discord download links
- `3c42aea` — Fix public Discord download URL base resolution
- `b6d0c07` — Fix deployed Discord download base URL
- `92759ae` — Parse template fields from linearized DOCX text
- `55a0656` — Clean DOCX template field extraction
- `c92abe9` — Parallelize Discord special placeholder row processing
- `4cd8c07` — Batch multiple rows per OpenClaw prompt

## Stato git al momento della consegna
- branch: `refactor/ai-single-pipeline`
- remote: `origin`
- working tree pulita salvo file runtime locali non versionati in `apps/api/storage/` (non rilevanti per il codice)

## Cosa consiglierei come prossimo passo in altro ambiente
1. **Aprire e analizzare il report esatto del run con file Excel corretto dall’utente**
   - capire pattern dei 24 residui
2. **Tracciare esplicitamente i risultati OpenClaw per batch multi-riga**
   - per ogni batch, loggare quali `rowIndex` sono presenti in `structured.rows`
   - loggare se mancano `La/Vi` o `Suo/Vostro` su righe che poi risultano fallite
3. **Confrontare batch buono vs batch cattivo**
   - stessa forma prompt
   - stessa shape JSON ricevuta
4. **Se necessario, rendere più rigido il contratto JSON del modello**
   - ad es. schema con tutte le row keys attese obbligatorie
5. **Se necessario, fallback per singola riga dentro batch multi-riga**
   - se un batch torna incompleto, rieseguire solo quelle righe singolarmente

## Nota finale onesta
Il flusso è stato migliorato molto e il mini-test è pulito, ma il batch completo reale non è ancora affidabile al 100%.
Il problema residuo è ormai stretto e concretamente attaccabile, ma non è stato chiuso in questa sessione.
