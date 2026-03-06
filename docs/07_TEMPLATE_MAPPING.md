# 07 — Mapping template merge (bozza)

## Obiettivo
Mappare ogni campo dati a una colonna della tabella merge usata dal template Word.

## Convenzione colonne (proposta)
- prefisso `p_` per parti
- prefisso `t_` per titolo
- prefisso `i_` per interessi
- prefisso `v_` per voci economiche

Esempi:
- `p_creditore_denominazione`
- `t_di_numero`
- `i_modalita`
- `i_importo`
- `v_capitale_ingiunto`
- `v_totale_complessivo`

## Task successivo
- Importare template Word reale
- Estrarre elenco MERGEFIELD
- Completare mapping 1:1 campo↔segnaposto
