import JSZip from 'jszip';
import { replaceCanonicalPlaceholders } from './placeholder-grammar.js';

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
  documentsWithMissingPlaceholders: number;
};

export type DiscordV1GenerationRow = {
  rowIndex: number;
  rowId?: string;
  filename?: string;
  status: 'generated' | 'error';
  missingFields: number;
  warnings: string[];
  missingFieldKeys?: string[];
  error?: string;
};

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'SI' : 'NO';
  return String(value).trim();
}

function sanitizeFilenameSegment(value: string) {
  return value
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitExtension(filename: string) {
  const match = filename.match(/^(.*?)(\.[A-Za-z0-9]+)$/);
  if (!match) return { basename: filename, extension: '' };
  return { basename: match[1], extension: match[2] };
}

function escapeCsv(value: unknown) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export function classifyDiscordV1Attachments(files: DiscordV1Attachment[]) {
  const templates = files.filter((file) => file.filename.toLowerCase().endsWith('.docx'));
  const tables = files.filter((file) => {
    const lower = file.filename.toLowerCase();
    return lower.endsWith('.xlsx') || lower.endsWith('.csv');
  });

  return { templates, tables };
}

export function buildDiscordV1FallbackFilename(input: {
  templateFilename: string;
  rowIndex: number;
  practiceId?: string | null;
  prefix?: string | null;
}) {
  const { templateFilename, rowIndex, practiceId, prefix } = input;
  const { extension } = splitExtension(templateFilename);
  const basePrefix = sanitizeFilenameSegment(String(prefix ?? '').trim()) || 'doc-generator';
  const practiceSegment = sanitizeFilenameSegment(String(practiceId ?? '').trim());
  const rowSegment = String(Math.max(1, Number(rowIndex) || 1)).padStart(3, '0');
  const stableBase = practiceSegment ? `${basePrefix}_${practiceSegment}_row_${rowSegment}` : `${basePrefix}_row_${rowSegment}`;
  return `${stableBase}${extension || '.docx'}`;
}

export function resolveDiscordV1OutputFilename(input: {
  templateFilename: string;
  rowIndex: number;
  rowValues?: Record<string, unknown>;
  namingPattern?: string | null;
  practiceId?: string | null;
  fallbackPrefix?: string | null;
}) {
  const { templateFilename, rowIndex, rowValues = {}, namingPattern, practiceId, fallbackPrefix } = input;
  const { extension } = splitExtension(templateFilename);
  const fallback = buildDiscordV1FallbackFilename({
    templateFilename,
    rowIndex,
    practiceId,
    prefix: fallbackPrefix
  });

  const trimmedPattern = String(namingPattern ?? '').trim();
  if (!trimmedPattern) return fallback;

  const replacements = Object.fromEntries(
    Object.entries(rowValues).map(([key, value]) => [key, sanitizeFilenameSegment(normalizeValue(value))])
  );

  let rendered = replaceCanonicalPlaceholders(trimmedPattern, replacements);
  rendered = rendered.replace(/\{\s*([^{}\[\]]+?)\s*\}/g, (_, rawKey) => {
    const key = String(rawKey ?? '').trim();
    const exact = replacements[key];
    if (typeof exact === 'string') return exact;
    const normalized = key.toLowerCase();
    const found = Object.entries(replacements).find(([candidate]) => candidate.toLowerCase() === normalized);
    return found?.[1] ?? '';
  });

  rendered = sanitizeFilenameSegment(rendered)
    .replace(/\s+/g, ' ')
    .replace(/^-+|-+$/g, '')
    .trim();

  if (!rendered) return fallback;
  if (/\.[A-Za-z0-9]{2,5}$/.test(rendered)) return rendered;
  return `${rendered}${extension || '.docx'}`;
}

export function buildDiscordV1ReportMarkdown(input: {
  practiceId: string;
  templateFilename: string;
  tableFilename: string;
  namingPattern?: string | null;
  firstPhase: any;
  secondPhase: any | null;
  generationRows: DiscordV1GenerationRow[];
}) {
  const { practiceId, templateFilename, tableFilename, namingPattern, firstPhase, secondPhase, generationRows } = input;
  const generatedCount = generationRows.filter((row) => row.status === 'generated').length;
  const errorRows = generationRows.filter((row) => row.status === 'error').length;
  const warningRows = generationRows.filter((row) => row.warnings.length > 0 || row.missingFields > 0).length;
  const documentsWithMissingPlaceholders = generationRows.filter((row) => row.missingFields > 0).length;
  const problematicRows = generationRows.filter((row) => row.status === 'error' || row.missingFields > 0 || row.warnings.length > 0);

  const lines: string[] = [];
  lines.push('# Discord v1 post-run report');
  lines.push('');
  lines.push(`- Practice ID: ${practiceId}`);
  lines.push(`- Template: ${templateFilename}`);
  lines.push(`- Table: ${tableFilename}`);
  lines.push(`- Naming pattern: ${String(namingPattern ?? '').trim() || 'fallback standard (doc-generator_<practiceId>_row_<nnn>.docx)'}`);
  lines.push(`- Generated documents: ${generatedCount}/${generationRows.length}`);
  lines.push(`- Rows with warnings: ${warningRows}`);
  lines.push(`- Rows with errors: ${errorRows}`);
  lines.push(`- Documents/rows with unpopulated placeholders: ${documentsWithMissingPlaceholders}`);
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
    lines.push(`- Reason: ${firstPhase?.hasSpecialPlaceholders ? 'special placeholders detected, but no derive/generate values were provided by OpenClaw/AI' : 'no special placeholders in template'}`);
  }
  lines.push('');

  lines.push('## Phase 3 — final generation');
  lines.push(`- Total problematic rows/documents: ${problematicRows.length}`);
  if (problematicRows.length) {
    lines.push('- Problematic documents overview:');
    for (const row of problematicRows) {
      const rowLabel = row.rowId ? `row ${row.rowIndex} (${row.rowId})` : `row ${row.rowIndex}`;
      const fileLabel = row.filename ? ` -> ${row.filename}` : '';
      const issueParts = [
        row.status === 'error' ? 'generation error' : null,
        row.missingFields > 0 ? `${row.missingFields} unpopulated placeholders` : null,
        row.warnings.length > 0 ? `${row.warnings.length} warnings` : null
      ].filter(Boolean);
      lines.push(`  - ${rowLabel}${fileLabel}: ${issueParts.join('; ')}`);
    }
    lines.push('');
  }

  for (const row of generationRows) {
    const rowLabel = row.rowId ? `Row ${row.rowIndex} (${row.rowId})` : `Row ${row.rowIndex}`;
    lines.push(`- ${rowLabel}: ${row.status}${row.filename ? ` -> ${row.filename}` : ''}; missingFields=${row.missingFields}`);
    if (row.missingFieldKeys?.length) lines.push(`  - missing placeholder keys: ${row.missingFieldKeys.join(', ')}`);
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

export function summarizeDiscordV1Columns(rows: Record<string, unknown>[]) {
  const columnSet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row ?? {})) {
      if (key) columnSet.add(key);
    }
  }

  return Array.from(columnSet).sort();
}

export function summarizeDiscordV1RowValues(rowValues: Record<string, unknown>, limit = 12) {
  const entries = Object.entries(rowValues ?? {}).slice(0, limit);
  return Object.fromEntries(
    entries.map(([key, value]) => {
      if (value === null || value === undefined) return [key, ''];
      if (typeof value === 'string') return [key, value.length > 80 ? `${value.slice(0, 77)}...` : value];
      if (typeof value === 'number' || typeof value === 'boolean') return [key, value];
      return [key, `[${Array.isArray(value) ? 'array' : typeof value}]`];
    })
  );
}

export function buildDiscordV1SummaryCsv(rows: DiscordV1GenerationRow[]) {
  const lines = [
    ['row_id', 'source_row_id', 'status', 'filename', 'missing_fields', 'missing_field_keys', 'warnings', 'error'].map(escapeCsv).join(',')
  ];
  for (const row of rows) {
    lines.push([
      row.rowIndex,
      row.rowId ?? '',
      row.status,
      row.filename ?? '',
      row.missingFields,
      (row.missingFieldKeys ?? []).join(' | '),
      row.warnings.join(' | '),
      row.error ?? ''
    ].map(escapeCsv).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export async function buildDiscordV1Zip(input: {
  generatedDocs: Array<{ filename: string; bytes: Uint8Array }>;
  generatedPdfs?: Array<{ filename: string; bytes: Uint8Array }>;
  reportMarkdown: string;
  summaryCsv: string;
}) {
  const zip = new JSZip();
  const docsFolder = zip.folder('generated-docx');
  const pdfsFolder = zip.folder('generated-pdf');
  for (const doc of input.generatedDocs) docsFolder?.file(doc.filename, doc.bytes);
  for (const pdf of input.generatedPdfs ?? []) pdfsFolder?.file(pdf.filename, pdf.bytes);
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
    hasSecondPhase,
    documentsWithMissingPlaceholders: rows.filter((row) => row.missingFields > 0).length
  };
}
