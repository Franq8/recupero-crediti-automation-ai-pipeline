# 33 — ExecPlan: Multi-set batch + note per documento

## Obiettivo
Supportare import multi-riga (set multipli) e nota per ciascun documento pratica, con generazione DOCX per singola riga tabella.

## Scope (incluso)
1. Import CSV/XLSX/JSON con più righe -> persistenza righe tabella.
2. Nota documento (`noteText`) modificabile per ogni file pratica.
3. Prompt payload OpenClaw arricchito con nota documento.
4. Endpoint generate DOCX da riga (`rowIndex`).

## Scope (escluso)
- orchestratore runner automatico esterno
- UI batch avanzata con wizard

## Passi implementativi
- [ ] Estendere schema DB (`TableRow`, `StoredFile.noteText`).
- [ ] Import multi-riga con salvataggio deterministic row index.
- [ ] Endpoint `POST /practices/:id/files/:fileId/note`.
- [ ] Endpoint table rows (`GET/POST`) + `generate-docx-from-row`.
- [ ] Build + verifica smoke base.

## Done
- Multi-set operativo su API.
- Note documento presenti nel payload di estrazione OpenClaw.
- DOCX generabile da riga specifica.
