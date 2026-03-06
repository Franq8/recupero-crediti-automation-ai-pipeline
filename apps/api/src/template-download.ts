import ExcelJS from 'exceljs';

const IMPORT_TEMPLATE_FIELDS = [
  'schema_version',
  'creditore_denominazione',
  'creditore_cf',
  'creditore_piva',
  'creditore_sede',
  'debitore_tipo',
  'debitore_denominazione_nome',
  'debitore_cf',
  'debitore_piva',
  'debitore_sede_residenza',
  'avvocato_nome',
  'avvocato_cf',
  'avvocato_foro',
  'avvocato_pec',
  'tribunale',
  'di_numero',
  'rg_numero',
  'di_data_emissione',
  'di_data_notifica',
  'flag_esecutorieta_nel_titolo',
  'di_data_esecutorieta',
  'capitale_ingiunto',
  'interessi_modalita',
  'interessi_tipo_tasso',
  'interessi_base_calcolo',
  'interessi_dies_a_quo',
  'interessi_data_finale',
  'interessi_clausola_testo'
] as const;

function getImportTemplateRow() {
  return {
    schema_version: '1.0.0',
    creditore_denominazione: '',
    creditore_cf: '',
    creditore_piva: '',
    creditore_sede: '',
    debitore_tipo: '',
    debitore_denominazione_nome: '',
    debitore_cf: '',
    debitore_piva: '',
    debitore_sede_residenza: '',
    avvocato_nome: '',
    avvocato_cf: '',
    avvocato_foro: '',
    avvocato_pec: '',
    tribunale: '',
    di_numero: '',
    rg_numero: '',
    di_data_emissione: '',
    di_data_notifica: '',
    flag_esecutorieta_nel_titolo: 'NON_SO',
    di_data_esecutorieta: '',
    capitale_ingiunto: '',
    interessi_modalita: 'none',
    interessi_tipo_tasso: 'legale',
    interessi_base_calcolo: '',
    interessi_dies_a_quo: '',
    interessi_data_finale: '',
    interessi_clausola_testo: ''
  } as Record<string, string>;
}

export async function buildImportTemplateXlsx(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('precetto_import');

  ws.addRow([...IMPORT_TEMPLATE_FIELDS]);
  const row = getImportTemplateRow();
  ws.addRow(IMPORT_TEMPLATE_FIELDS.map((k: string) => String(row[k] ?? '')));

  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => { c.width = 24; });

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

export function buildImportTemplateCsv(): string {
  const row = getImportTemplateRow();
  const esc = (x: string) => `"${x.replaceAll('"', '""')}"`;
  const headers = IMPORT_TEMPLATE_FIELDS.map((h: string) => esc(h)).join(',');
  const values = IMPORT_TEMPLATE_FIELDS.map((k: string) => esc(String(row[k] ?? ''))).join(',');
  return `${headers}\n${values}\n`;
}

export function buildImportTemplateJson(): string {
  const row = getImportTemplateRow();
  return JSON.stringify(row, null, 2);
}
