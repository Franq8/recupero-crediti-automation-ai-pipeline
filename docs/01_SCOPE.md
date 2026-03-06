# 01 — Scope e confini

## In scope (v1)
- Casistica: **Atto di precetto su decreto ingiuntivo**
- Input unificato su **un’unica schermata dati**:
  - upload documenti (PDF/DOCX) in box unico,
  - import strutturato (Excel/CSV/JSON),
  - inserimento/modifica manuale sugli stessi campi.
- Campi sempre visibili/editabili; l’estrazione precompila dove possibile.
- Template scaricabili (Excel/CSV/JSON) preimpostati per raccolta dati.
- Doppio comando operativo:
  1) `Estrai informazioni` (con revisione utente),
  2) `Genera subito documento` (bypass revisione, anche con dati parziali).
- Interessi con 3 modalità:
  1) non calcolare,
  2) calcolo semplice,
  3) calcolo complesso (placeholder, non implementato).
- Output tabellare per stampa unione Word.
- Upload template DOCX per singola pratica + libreria template persistente (DB/blob storage) richiamabile senza re-upload.

## Out of scope (v1)
- Automazione piena multi-casistica (es. pignoramenti, citazioni, ecc.)
- Calcolo interessi complesso multi-fattura/multi-scadenza
- Deposito telematico, notifiche automatiche, PEC automation
- OCR avanzato su scansioni di bassa qualità (si valuterà dopo)

## Obiettivo qualità v1
- Ridurre errori di trascrizione
- Ridurre tempo di predisposizione bozza
- Rendere espliciti i punti ambigui (mai “inventare” dati)
