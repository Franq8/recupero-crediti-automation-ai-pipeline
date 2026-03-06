# 06 — Regole di calcolo (v1)

## 1) Interessi

### Modalità `none`
- `interessi_importo = 0`
- Clausola standard valorizzata in `interessi_clausola_testo`
- Testo default (modificabile):
  - `oltre interessi come da titolo dal dovuto al saldo`

### Modalità `simple`
Input obbligatori:
- `interessi_base_calcolo`
- `interessi_tasso_percent`
- `interessi_dies_a_quo`
- `interessi_data_finale`

Formula:
- `interessi_giorni = data_finale - dies_a_quo` (in giorni, inclusione/esclusione come da implementazione unica documentata)
- `interessi_importo = base * (tasso/100) * (giorni/365)`

Regole:
- arrotondamento finale a 2 decimali
- validazione `data_finale >= dies_a_quo`
- se input incompleti: stato `NEEDS_REVIEW`, nessun calcolo

### Modalità `complex_placeholder`
- Nessun calcolo in v1
- UI segnala non disponibile

## 2) Totali economici
- `totale_principale = capitale_ingiunto + interessi_importo`
- `totale_spese_di = spese_di_vive + compenso_di + spese_generali_di + cpa_di + iva_di + imposta_registro_di`
- `totale_spese_successive = spese_successive_precetto + costo_notifica_precetto`
- `totale_complessivo = totale_principale + totale_spese_di + totale_spese_successive`

## 3) Validazioni
- no importi negativi
- campi monetari in formato numerico normalizzato (punto decimale interno)
- date in ISO interno (`YYYY-MM-DD`), localizzate solo in UI

## 4) Regola generale generazione output
- Le formule si applicano solo ai campi disponibili
- Nessun blocco su campi mancanti (sia percorso standard sia rapido)
- Segnaposto non valorizzati restano nel DOCX finale
- Warning pre-generazione quando il dataset è parziale
