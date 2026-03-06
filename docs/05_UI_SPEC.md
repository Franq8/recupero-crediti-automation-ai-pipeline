# 05 — UI Spec minima

## Schermate

### S1 — Dashboard pratiche
- Elenco pratiche
- Crea nuova pratica

### S2 — Ingestion unificata
- **Unico box upload** per documenti PDF/DOCX
- Sezione import file strutturato (XLSX/CSV/JSON)
- Download template compilabili (Excel/CSV/JSON)

### S3 — Workspace dati (core)
- Campi sempre presenti (Parti, Titolo, Importi, Difensore, Interessi)
- I campi si precompilano in base a estrazione/import
- L’utente modifica/integra negli stessi campi
- Stato campo: `estratto`, `manuale`, `mancante`
- Pannello evidenze fonte (file/pagina/snippet)

### S4 — Azioni principali affiancate
- Pulsante 1: `Estrai informazioni`
- Pulsante 2: `Genera subito documento`

#### Comportamento Pulsante 1 (standard)
- Aggiorna estrazione
- Mostra i campi precompilati/mancanti nel workspace unico
- Non blocca la prosecuzione anche in presenza di campi vuoti

#### Comportamento Pulsante 2 (bypass)
- Salta controllo completo
- Avvia flusso fino al documento finale
- Mantiene eventuali segnaposto non valorizzati
- Mostra warning esplicito prima di procedere

### S5 — Riepilogo e output
- Tabella importi finale
- Warning/errori
- Export merge + documento finale

## Regole UX
- Nessuna separazione artificiale manuale/documenti: un solo workspace dati
- Autosave continuo
- Tooltip su origine campo
- Ogni modifica manuale tracciata
