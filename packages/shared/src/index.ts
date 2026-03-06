export const PRACTICE_SCHEMA_VERSION = '1.0.0';

export * from './import-template';

export const CORE_FIELD_KEYS = [
  'creditore_denominazione',
  'debitore_denominazione_nome',
  'tribunale',
  'di_numero',
  'rg_numero',
  'capitale_ingiunto',
  'di_data_notifica',
  'flag_esecutorieta_nel_titolo'
] as const;
