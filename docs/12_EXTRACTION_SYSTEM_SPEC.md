# 12 — Sistema di estrazione informazioni (Precetto su DI)

## 1) Obiettivo
Estrarre in modo affidabile i dati necessari a predisporre un atto di precetto su DI, partendo da documenti caricati + integrazione manuale guidata.

## 2) Principio di progetto
- **Norma-first**: schema dati costruito sui requisiti legali del precetto (art. 480 c.p.c.), non sul singolo fac-simile.
- **LLM-first extraction**: il modello ha spazio decisionale ampio in fase di estrazione; regole/regex sono di supporto e fallback, non vincoli rigidi.
- **Evidence-based extraction**: ogni campo estratto conserva fonte (file, pagina/snippet) e confidenza.
- **Human-in-the-loop**: revisione rapida nello stesso workspace, con possibilità di proseguire anche con dati parziali.

## 3) Slot documentali logici (interni al motore, non necessariamente separati in UI)

### Slot A — Decreto ingiuntivo (provvedimento)
- Tipo: PDF
- Stato: **obbligatorio**
- Finalità: titolo, parti, capitale ingiunto, spese monitorio, clausola interessi nel titolo.

### Slot B — Prova notifica titolo esecutivo
- Tipo: PDF (relata/PEC/notifica)
- Stato: **obbligatorio logico** (può essere sostituito da data manuale con flag responsabilità utente)
- Finalità: data notificazione titolo (richiamata da art. 480 c.p.c.).

### Slot C — Provvedimento di esecutorietà / formula esecutiva
- Tipo: PDF
- Stato: **condizionale** (necessario quando non già incorporato chiaramente nel titolo)
- Alternativa: inserimento manuale data/provvedimento con warning elevato.
- Nota casistica: include sia decreti non provvisoriamente esecutivi (con successiva declaratoria) sia decreti con provvisoria esecutorietà già nel titolo.

### Flag di controllo esecutorietà (manuale + automatico)
- Campo UI obbligatorio: `flag_esecutorieta_nel_titolo` (SI/NO/NON_SO).
- Estrazione automatica: il parser cerca indicatori nel DI (es. formule/provvedimenti di esecutorietà).
- Strategia: doppio binario manuale + automatico.
- Se incoerenza tra flag utente e rilevazione automatica: stato `CONFLICT_EXECUTORIETA` + avviso bloccante di conferma.

### Slot D — Documenti accessori importi/spese
- Tipo: PDF (es. imposta registro, nota spese, prova notifiche)
- Stato: facoltativo
- Finalità: valorizzazione voci economiche ulteriori.

## 4) Campi critici minimi (blocco export se assenti)
- Identità creditore e debitore
- Estremi DI (numero, R.G., giudice/tribunale)
- Capitale ingiunto
- Intimazione/termine 10 giorni (generato da template)
- Data notifica titolo (da documento o manuale)
- Dati per esecutorietà del titolo (documento o manuale)

## 5) Pipeline tecnica
1. Upload + classificazione file per slot
2. Parsing documento (testo/OCR se necessario)
3. Estrazione candidate values per campo tramite flusso OpenClaw client (LLM-first via client, senza API key app)
   - endpoint applicativo di ricezione: `POST /practices/:id/extract-openclaw`
4. Fallback rules/regex su campi non coperti o a bassa confidenza (`POST /practices/:id/extract`)
5. Normalizzazione (date, importi, anagrafiche)
6. Risoluzione conflitti (più fonti)
7. Scoring confidenza campo
8. UI review con evidenza fonti
9. Persistenza + export merge

## 6) Regole di conflitto
- Se due valori divergono: non scegliere automaticamente, marcare `NEEDS_REVIEW`.
- Preferenza fonti (default): provvedimento giudiziale > atto di parte > allegato contabile.

## 7) Output strutturato interno (esempio)
Per ogni campo:
- `value`
- `source_file`
- `source_page`
- `source_excerpt`
- `confidence`
- `status` = AUTO_OK | NEEDS_REVIEW | MANUAL

## 8) Modalità interessi
- `none`: nessun calcolo, clausola standard.
- `simple`: base+tasso+dies a quo+data finale.
- `complex_placeholder`: non implementata in v1.

## 9) Compliance e audit
- Traccia completa delle modifiche manuali
- Log versione regole
- Export report validazione allegabile al fascicolo interno
