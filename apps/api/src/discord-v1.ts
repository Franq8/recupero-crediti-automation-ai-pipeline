import JSZip from 'jszip';

export type DiscordV1Attachment = {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type DiscordV1FinalSummary = {
  totalRows: number;
  generatedCount: number;
  warningRows: number;
  errorRows: number;
  hasSecondPhase: boolean;
};

export function classifyDiscordV1Attachments(files: DiscordV1Attachment[]) {
  const templates = files.filter((file) => file.filename.toLowerCase().endsWith('.docx'));
  const tables = files.filter((file) => {
    const lower = file.filename.toLowerCase();
    return lower.endsWith('.xlsx') || lower.endsWith('.csv');
  });

  return { templates, tables };
}

export function buildDiscordV1ReportMarkdown(input: {
  practiceId: string;
  templateFilename: string;
  tableFilename: string;
  firstPhase: any;
  secondPhase: any | null;
  generationRows: Array<{
    rowIndex: number;
    filename?: string;
    status: 'generated' | 'error';
    missingFields: number;
    warnings: string[];
    error?: string;
  }>;
}) {
  const { practiceId, templateFilename, tableFilename, firstPhase, secondPhase, generationRows } = input;
  const generatedCount = generationRows.filter((row) => row.status === 'generated').length;
  const errorRows = generationRows.filter((row) => row.status === 'error').length;
  const warningRows = generationRows.filter((row) => row.warnings.length > 0 || row.missingFields > 0).length;

  const lines: string[] = [];
  lines.push('# Discord v1 post-run report');
  lines.push('');
  lines.push(`- Practice ID: ${practiceId}`);
  lines.push(`- Template: ${templateFilename}`);
  lines.push(`- Table: ${tableFilename}`);
  lines.push(`- Generated documents: ${generatedCount}/${generationRows.length}`);
  lines.push(`- Rows with warnings: ${warningRows}`);
  lines.push(`- Rows with errors: ${errorRows}`);
  lines.push('');

  lines.push('## Phase 1 — first table / prepare');
  lines.push(`- Mode: ${firstPhase?.mode ?? 'DETERMINISTIC_TABLE_FIRST'}`);
  lines.push(`- Outcome: ${firstPhase?.comparison?.outcome ?? 'n/a'}`);
  lines.push(`- Special placeholders detected: ${firstPhase?.hasSpecialPlaceholders ? 'yes' : 'no'}`);
  lines.push(`- Next action: ${firstPhase?.nextAction ?? 'n/a'}`);
  if (Array.isArray(firstPhase?.warnings) && firstPhase.warnings.length) {
    lines.push('- Warnings:');
    for (const warning of firstPhase.warnings) lines.push(`  - [${warning.code}] ${warning.message}`);
  } else {
    lines.push('- Warnings: none');
  }
  lines.push('');

  lines.push('## Phase 2 — final table / enrich');
  if (secondPhase) {
    lines.push('- Executed: yes');
    lines.push(`- Derived keys: ${(secondPhase.derivedKeys ?? []).length}`);
    lines.push(`- Generated keys: ${(secondPhase.generatedKeys ?? []).length}`);
    if (Array.isArray(secondPhase.warnings) && secondPhase.warnings.length) {
      lines.push('- Warnings:');
      for (const warning of secondPhase.warnings) lines.push(`  - [${warning.code}] ${warning.message}`);
    } else {
      lines.push('- Warnings: none');
    }
  } else {
    lines.push('- Executed: no');
    lines.push('- Reason: no special placeholders in template');
  }
  lines.push('');

  lines.push('## Phase 3 — final generation');
  for (const row of generationRows) {
    lines.push(`- Row ${row.rowIndex}: ${row.status}${row.filename ? ` -> ${row.filename}` : ''}; missingFields=${row.missingFields}`);
    for (const warning of row.warnings) lines.push(`  - warning: ${warning}`);
    if (row.error) lines.push(`  - error: ${row.error}`);
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('- Discord v1 auto-continues the standard web flow without intermediate confirmations.');
  lines.push('- Generation is attempted for every row; warnings do not block output.');
  lines.push('- Real technical errors remain blocking only for the affected row or invalid input contract.');

  return lines.join('\n');
}

export function buildDiscordV1SummaryCsv(rows: Array<{
  rowIndex: number;
  status: 'generated' | 'error';
  filename?: string;
  missingFields: number;
  warnings: string[];
  error?: string;
}>) {
  const esc = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const lines = [
    ['row_id', 'status', 'filename', 'missing_fields', 'warnings', 'error'].map(esc).join(',')
  ];
  for (const row of rows) {
    lines.push([
      row.rowIndex,
      row.status,
      row.filename ?? '',
      row.missingFields,
      row.warnings.join(' | '),
      row.error ?? ''
    ].map(esc).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export async function buildDiscordV1Zip(input: {
  generatedDocs: Array<{ filename: string; bytes: Uint8Array }>;
  reportMarkdown: string;
  summaryCsv: string;
}) {
  const zip = new JSZip();
  const docsFolder = zip.folder('generated-docx');
  for (const doc of input.generatedDocs) docsFolder?.file(doc.filename, doc.bytes);
  zip.file('report.md', input.reportMarkdown);
  zip.file('summary.csv', input.summaryCsv);
  return zip.generateAsync({ type: 'uint8array' });
}

export function buildDiscordV1FinalSummary(rows: Array<{
  status: 'generated' | 'error';
  missingFields: number;
  warnings: string[];
}>, hasSecondPhase: boolean): DiscordV1FinalSummary {
  return {
    totalRows: rows.length,
    generatedCount: rows.filter((row) => row.status === 'generated').length,
    warningRows: rows.filter((row) => row.warnings.length > 0 || row.missingFields > 0).length,
    errorRows: rows.filter((row) => row.status === 'error').length,
    hasSecondPhase
  };
}
