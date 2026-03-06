# 14 — Ingestion unificata (fonti multiple, workspace unico)

## Obiettivo
Accettare input da fonti diverse senza separare l’esperienza utente in “modalità” rigide.

## Fonti supportate
1. Documenti PDF/DOCX (upload in box unico)
2. Import strutturato da `XLSX` / `CSV` / `JSON`
3. Inserimento manuale diretto nei campi sempre presenti

## Modello operativo
- Tutte le fonti alimentano lo stesso oggetto `PracticeData`.
- L’utente lavora sempre nella stessa schermata campi.
- L’estrazione non apre un percorso separato: precompila soltanto.

## Template ufficiali scaricabili
- `template_precetto_v1.xlsx`
- `template_precetto_v1.csv`
- `template_precetto_v1.json`

### Requisiti template
- Header stabili e versionati
- Campo `schema_version`
- Dizionario tipi/obbligatorietà allegato
- Esempio record compilato

## Provenienza campo
Per ogni campo memorizzare:
- `value`
- `source_type` (document | import | manual)
- `source_ref` (file/pagina/snippet, se disponibile)
- `confidence` (solo estrazione documentale)
- `status` (AUTO_OK | NEEDS_REVIEW | MANUAL | MISSING)

## Priorità e conflitti
- Default: `manual` > `import` > `document_extraction`
- Conflitto forte: warning + richiesta conferma nel workspace
- Audit log completo delle sovrascritture

## Doppio comando utente
- `Estrai informazioni`: aggiorna precompilazione e lascia controllo umano
- `Genera subito documento`: bypass revisione completa e genera anche con dati parziali
