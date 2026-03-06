# 02 — Requisiti funzionali e non funzionali

## RF-01 Pratica
- Creazione pratica con `practice_id` univoco.
- Persistenza stato pratica e autosave.

## RF-02 Ingestion unificata
- Un’unica schermata dati accetta tre fonti:
  1) upload documenti PDF/DOCX,
  2) import XLSX/CSV/JSON,
  3) editing manuale diretto.
- Le fonti non creano modalità separate: alimentano lo stesso dataset.

## RF-03 Estrazione e precompilazione
- Azione `Estrai informazioni` avvia pipeline LLM-first e precompila campi.
- Regole deterministiche/regex fungono da supporto, non da blocco.
- Per ogni campo estratto: valore, fonte, confidenza, stato.

## RF-04 Workspace campi unico
- Tutti i campi restano sempre visibili/editabili.
- Stati campo: `AUTO_OK`, `NEEDS_REVIEW`, `MANUAL`, `MISSING`.
- Conflitti tra fonti evidenziati e risolvibili dall’utente.

## RF-05 Percorsi utente
- **Percorso standard**: estrazione + revisione + generazione.
- **Percorso rapido** (`Genera subito documento`): salto diretto alla generazione.
- Entrambi i percorsi consentono output anche con dati parziali.

## RF-06 Interessi
- `none`: nessun calcolo + clausola standard.
- `simple`: calcolo unico (base, tasso, dal, al) con selettore tipo tasso.
- Selettore tipo tasso: `legale` | `mora`, default = `legale`.
- `complex_placeholder`: non implementato in v1.

## RF-07 Esecutorietà
- Campo manuale obbligatorio `flag_esecutorieta_nel_titolo` (SI/NO/NON_SO).
- Verifica automatica nel testo DI.
- Incoerenza => `CONFLICT_EXECUTORIETA` con conferma esplicita.

## RF-08 Output
- Export dataset merge (CSV/XLSX).
- Generazione DOCX compilato da template.
- Nel percorso rapido, i segnaposto senza valore restano non compilati.

## RF-09 Audit
- Traccia completa: chi ha modificato cosa, quando, da quale fonte.
- Versione regole/calcoli registrata per ogni export.

## RF-10 Discord parity (v1)
- Flusso operativo parallelo via comandi Discord.
- Upload allegati, extraction, patch campi, generate/generate-fast, restituzione DOCX.

---

## Requisiti non funzionali
- Performance target: estrazione iniziale < 20s su pratica media (obiettivo v1)
- Affidabilità: nessuna perdita dati su refresh/crash (autosave)
- Sicurezza: accesso per utenti autorizzati, nessun invio esterno automatico
- Portabilità: run locale Mac mini; predisposizione deploy VPS
- Osservabilità: log strutturati per debugging e audit
