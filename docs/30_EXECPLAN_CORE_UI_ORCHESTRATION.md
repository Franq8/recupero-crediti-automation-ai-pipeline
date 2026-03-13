# 30 — ExecPlan: Core UI orchestration (3 flussi + tabella finale)

## Obiettivo
Chiudere il nucleo del nuovo design:
- parsing placeholder 3 classi (`[ ]`, `[[ ]]`, `[[[ ]]]`),
- esecuzione flussi separati EXTRACT/DERIVE/GENERATE,
- merge dataset unico,
- tabella finale visibile in UI,
- generazione Word da tabella.

## Scope (incluso)
1. UI: step unico "Run AI Pipeline" con stato per ogni flusso.
2. API: endpoint orchestration state (start/status/result) lato pratica.
3. Persistenza: salvataggio `ai_dataset_v1` per pratica.
4. UI: tabella finale esplicita (preview righe/colonne).
5. Output: generate docx basato esclusivamente su tabella/dataset finale.

## Scope (escluso)
- multi-set batch
- modalità tabella deterministica CSV/XLSX-first
- espansioni Discord

## Contratti dati
### ai_dataset_v1
```json
{
  "values": {
    "extract": {"key": {"value": "...", "confidence": 0.0, "sourceRef": "..."}},
    "derive": {"key": {"value": "...", "confidence": 0.0, "sourceRef": "..."}},
    "generate": {"key": {"value": "...", "confidence": 0.0, "sourceRef": "..."}}
  },
  "mergedRow": {"placeholderKey": "final value"}
}
```

## Passi implementativi

### Fase A — Backend orchestration shell
- [ ] A1: endpoint `POST /practices/:id/pipeline/run` (inizia run logico)
- [ ] A2: endpoint `GET /practices/:id/pipeline/status`
- [ ] A3: endpoint `GET /practices/:id/pipeline/result`
- [ ] A4: persistenza `ai_dataset_v1` (riuso `FieldValue` + meta audit)

### Fase B — Merge canonico dataset
- [ ] B1: funzione merge bucket -> `mergedRow`
- [ ] B2: policy conflitti bucket (precedenza: extract < derive < generate solo quando stessa chiave)
- [ ] B3: endpoint `POST /practices/:id/pipeline/apply` per consolidare row finale

### Fase C — UI orchestration
- [ ] C1: sezione "AI Pipeline" con 3 step visibili
- [ ] C2: trigger unico `Run AI Pipeline`
- [ ] C3: progress e stato per bucket
- [ ] C4: gestione errori per singolo bucket

### Fase D — Tabella finale
- [ ] D1: componente `FinalRowTable` in UI
- [ ] D2: mapping visuale placeholder -> valore
- [ ] D3: evidenza valori mancanti

### Fase E — Generazione docx da tabella
- [ ] E1: generazione usa solo `mergedRow`
- [ ] E2: report campi non popolati

## Quality gates
- Build green
- Nessun endpoint legacy richiamato dalla UI
- Un solo percorso operativo visibile all’utente
- Smoke manuale: upload docs + template -> run pipeline -> tabella -> docx

## Criterio Done
Il blocco è concluso quando un utente può:
1) caricare docs + template,
2) lanciare il run unico,
3) vedere la tabella finale,
4) generare il docx finale senza passaggi manuali intermedi.
