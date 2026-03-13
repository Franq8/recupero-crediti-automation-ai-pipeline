# 32 — ExecPlan: Tabella finale esplicita + output DOCX per riga

## Obiettivo
Rendere visibile e operativa la tabella finale (dataset consolidato) come artefatto centrale, e generare il documento Word partendo da quella tabella.

## Scope (incluso)
1. Persistenza tabella finale (row-level) per pratica.
2. UI tabella finale esplicita, con edit controllato.
3. Generazione DOCX basata su riga selezionata.
4. Report campi compilati/mancanti per riga.

## Scope (escluso)
- multi-set batch (coperto in execplan dedicato)
- flusso tabella-deterministica CSV/XLSX-first (coperto in execplan dedicato)

## Data model target
### TableRow (logico)
```json
{
  "rowId": "string",
  "practiceId": "string",
  "values": {"placeholderKey": "finalValue"},
  "meta": {
    "source": "pipeline-openclaw",
    "updatedAt": "ISO",
    "qualityScore": 0
  }
}
```

## Passi implementativi

### Fase A — Backend row endpoints
- [ ] A1: `GET /practices/:id/table-rows`
- [ ] A2: `POST /practices/:id/table-rows` (create/update row)
- [ ] A3: `GET /practices/:id/table-rows/:rowId`
- [ ] A4: `POST /practices/:id/generate-docx-from-row`

### Fase B — Merge row integration
- [ ] B1: pipeline apply salva anche `mergedRow` come riga attiva
- [ ] B2: row metadata con qualità/campi mancanti

### Fase C — UI table view
- [ ] C1: tabella con colonne dinamiche da placeholder
- [ ] C2: evidenza missing values per cella
- [ ] C3: selezione riga attiva per generate docx

### Fase D — Output per riga
- [ ] D1: generate docx da `row.values` (solo riga selezionata)
- [ ] D2: export CSV della tabella finale

## Quality gates
- Build green
- Righe visualizzabili e persistenti
- DOCX generato coerente con riga selezionata
- Campi mancanti chiaramente tracciati

## Criterio Done
L’utente può:
1) vedere la tabella finale esplicita,
2) selezionare una riga,
3) generare il DOCX coerente con quella riga,
4) esportare la tabella.
