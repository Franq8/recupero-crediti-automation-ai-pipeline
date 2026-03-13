# 41 — ExecPlan: Final validation / go-live closing block

## Obiettivo
Chiudere il progetto con una validazione finale seria e un giudizio definitivo di go-live, evitando nuove deviazioni architetturali.

## Scopo
1. Rieseguire verifica completa backend/frontend/runtime.
2. Validare i tre iter di prodotto nella forma finale:
   - solo template,
   - template + documentazione,
   - template + tabella.
3. Verificare output tabella/workspace/DOCX.
4. Consolidare documentazione finale.
5. Emettere giudizio conclusivo:
   - pronto
   - pronto con limiti
   - non ancora pronto

## Vincoli
- Nessuna nuova macro-funzionalità.
- Solo fix/hardening emersi dalla validazione.
- Nessun ritorno di legacy/back-compat non richiesta.
- Se per una validazione perfetta servono materiali reali non disponibili, esplicitare il limite invece di inventare copertura finta.

---

## FASE 1 — Verifica tecnica completa
### Step 1.1
- build workspace completa
- check endpoint/core routes attive
- controllo assenza residui runtime legacy noti

### Step 1.2
- verifica rapida UI build e wiring frontend/backend

### Verifica
- baseline tecnica pulita prima dei test prodotto

---

## FASE 2 — Validazione finale dei 3 iter
### Iter A — solo template
- upload template
- export struttura tabellare CSV/XLSX/JSON
- verifica coerenza chiavi

### Iter B — template + documentazione
- document set reale/anonymized
- flow EXTRACT/DERIVE/GENERATE
- generazione riga workspace
- output DOCX

### Iter C — template + tabella
- table-first matching OK
- table-first mismatch
- blocchi/warning coerenti
- output DOCX da riga

### Verifica
- esito puntuale per ogni iter

---

## FASE 3 — Correzioni finali eventuali
- correggere solo problemi reali emersi
- rieseguire la verifica del punto corretto

---

## FASE 4 — Consolidamento finale docs
Aggiornare:
- `docs/18_IMPLEMENTATION_LOG.md`
- `docs/19_RUNBOOK.md`
- `docs/20_API_QUICKREF.md`
- `docs/21_HANDOFF_CHECKLIST.md`
- `docs/24_OPEN_POINTS_PLAN.md`

---

## FASE 5 — Giudizio conclusivo
Produrre un giudizio finale esplicito con:
- stato reale del progetto
- limiti residui concreti
- eventuali prerequisiti prima dell’uso pieno

## Definition of Done
Il blocco è chiuso quando:
1. i 3 iter sono stati rivisti nella forma finale;
2. eventuali difetti reali emersi sono stati corretti o esplicitati;
3. esiste un giudizio go-live definitivo e motivato.
