# 34 — ExecPlan: Modalità tabella deterministica (CSV/XLSX-first)

## Obiettivo
Rendere CSV/XLSX il percorso principale deterministic-first per popolare la tabella finale.

## Scope (incluso)
1. Contratto colonne stabile con `row_id` + chiavi canonical.
2. Parsing deterministico (niente inferenza fuzzy sui campi import).
3. Export tabella consolidata in CSV canonico.
4. Applicazione riga attiva su campi pratica.

## Scope (escluso)
- retrocompatibilità con formati legacy non allineati

## Passi implementativi
- [ ] Parser CSV/XLSX/JSON a righe multiple uniforme.
- [ ] Enforcement `row_id` (fallback indice progressivo).
- [ ] Endpoint `GET /practices/:id/table-rows/export.csv`.
- [ ] Audit eventi import/export tabella.
- [ ] Build + validazione e2e su fixture realistica.

## Done
- Import/export tabellare deterministico disponibile e documentato.
