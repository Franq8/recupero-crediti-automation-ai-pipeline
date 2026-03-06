# 03 — Dizionario dati (Precetto su DI)

## Metadati pratica
- `practice_id` (string)
- `case_type` = `precetto_di`
- `schema_version` (string)
- `created_at`, `updated_at`

## A. Parti
- `creditore_denominazione`
- `creditore_cf`
- `creditore_piva`
- `creditore_sede`
- `creditore_legale_rappresentante`
- `debitore_tipo` (PF|societa|ente)
- `debitore_denominazione_nome`
- `debitore_cf`
- `debitore_piva`
- `debitore_sede_residenza`

## B. Difensore
- `avvocato_nome`
- `avvocato_cf`
- `avvocato_foro`
- `avvocato_pec`
- `domicilio_eletto`

## C. Titolo (DI)
- `tribunale`
- `di_numero`
- `rg_numero`
- `di_data_emissione`
- `di_data_notifica`
- `flag_esecutorieta_nel_titolo` (SI|NO|NON_SO)
- `esecutorieta_rilevata_auto` (SI|NO|INCERTA)
- `di_data_esecutorieta`
- `conflitto_esecutorieta` (boolean)

## D. Importi
- `capitale_ingiunto`
- `spese_di_vive`
- `compenso_di`
- `spese_generali_di`
- `cpa_di`
- `iva_di`
- `imposta_registro_di`
- `spese_successive_precetto`
- `costo_notifica_precetto`
- `totale_principale`
- `totale_spese_di`
- `totale_spese_successive`
- `totale_complessivo`

## E. Interessi
- `interessi_modalita` (none|simple|complex_placeholder)
- `interessi_tipo_tasso` (legale|moratorio|custom)
- `interessi_tasso_percent`
- `interessi_base_calcolo`
- `interessi_dies_a_quo`
- `interessi_data_finale`
- `interessi_giorni`
- `interessi_importo`
- `interessi_clausola_testo`

## F. Tracking campo (per ogni campo)
- `value`
- `source_type` (document|import|manual|derived)
- `source_file`
- `source_page`
- `source_excerpt`
- `confidence` (0..1, solo document)
- `status` (AUTO_OK|NEEDS_REVIEW|MANUAL|MISSING)
- `last_modified_by`
- `last_modified_at`

## G. Validazione pratica
- `campi_critici_ok` (boolean)
- `warning_list` (array)
- `error_list` (array)
