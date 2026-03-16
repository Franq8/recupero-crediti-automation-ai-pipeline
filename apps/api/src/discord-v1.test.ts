import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDiscordV1FallbackFilename,
  buildDiscordV1FinalSummary,
  buildDiscordV1ReportMarkdown,
  buildDiscordV1SummaryCsv,
  resolveDiscordV1OutputFilename,
  summarizeDiscordV1Columns,
  summarizeDiscordV1RowValues
} from './discord-v1.js';

test('resolveDiscordV1OutputFilename applies naming pattern placeholders and preserves docx extension', () => {
  const filename = resolveDiscordV1OutputFilename({
    templateFilename: 'precetto_P-TEST_row1_2026-01-01.docx',
    rowIndex: 1,
    namingPattern: 'Diffida Condifesa-{Socio}',
    rowValues: { Socio: 'Mario Rossi' }
  });

  assert.equal(filename, 'Diffida Condifesa-Mario Rossi.docx');
});

test('buildDiscordV1FallbackFilename uses stable standard naming', () => {
  const filename = buildDiscordV1FallbackFilename({
    templateFilename: 'base.docx',
    rowIndex: 7,
    practiceId: 'P-TEST',
    prefix: 'doc-generator'
  });

  assert.equal(filename, 'doc-generator_P-TEST_row_007.docx');
});

test('resolveDiscordV1OutputFilename falls back to stable standard naming when pattern resolves to empty', () => {
  const filename = resolveDiscordV1OutputFilename({
    templateFilename: 'base.docx',
    rowIndex: 7,
    namingPattern: '{MissingField}',
    rowValues: {},
    practiceId: 'P-TEST',
    fallbackPrefix: 'doc-generator'
  });

  assert.equal(filename, 'doc-generator_P-TEST_row_007.docx');
});

test('discord v1 report highlights problematic documents and missing placeholders', () => {
  const report = buildDiscordV1ReportMarkdown({
    practiceId: 'P-TEST',
    templateFilename: 'template.docx',
    tableFilename: 'table.csv',
    namingPattern: 'Diffida-{Socio}',
    firstPhase: { mode: 'DETERMINISTIC_TABLE_FIRST', comparison: { outcome: 'match' }, hasSpecialPlaceholders: false, nextAction: 'generate-from-current-table' },
    secondPhase: null,
    generationRows: [
      {
        rowIndex: 1,
        rowId: 'A-1',
        filename: 'Diffida-Mario Rossi.docx',
        status: 'generated',
        missingFields: 2,
        missingFieldKeys: ['indirizzo', 'cf'],
        warnings: ['2 placeholder template lasciati vuoti o incompleti']
      },
      {
        rowIndex: 2,
        rowId: 'A-2',
        filename: 'Diffida-Luigi Verdi.docx',
        status: 'error',
        missingFields: 0,
        warnings: [],
        error: 'render failed'
      }
    ]
  });

  assert.match(report, /Naming pattern: Diffida-\{Socio\}/);
  assert.match(report, /Documents\/rows with unpopulated placeholders: 1/);
  assert.match(report, /Problematic documents overview:/);
  assert.match(report, /row 1 \(A-1\) -> Diffida-Mario Rossi\.docx: 2 unpopulated placeholders; 1 warnings/);
  assert.match(report, /row 2 \(A-2\) -> Diffida-Luigi Verdi\.docx: generation error/);
  assert.match(report, /missing placeholder keys: indirizzo, cf/);
  assert.match(report, /Reason: no special placeholders in template/);
});

test('discord v1 report states when special placeholders exist but no OpenClaw values were provided', () => {
  const report = buildDiscordV1ReportMarkdown({
    practiceId: 'P-TEST',
    templateFilename: 'template.docx',
    tableFilename: 'table.csv',
    firstPhase: { mode: 'DETERMINISTIC_TABLE_FIRST', comparison: { outcome: 'match' }, hasSpecialPlaceholders: true, nextAction: 'enrich-final-table' },
    secondPhase: null,
    generationRows: []
  });

  assert.match(report, /Special placeholders detected: yes/);
  assert.match(report, /Executed: no/);
  assert.match(report, /Reason: special placeholders detected, but no derive\/generate values were provided by OpenClaw\/AI/);
});

test('discord v1 summary csv exposes assigned filename and missing field keys', () => {
  const csv = buildDiscordV1SummaryCsv([
    {
      rowIndex: 1,
      rowId: 'ROW-1',
      filename: 'Diffida-Mario Rossi.docx',
      status: 'generated',
      missingFields: 2,
      missingFieldKeys: ['indirizzo', 'cf'],
      warnings: ['warn 1']
    }
  ]);

  assert.match(csv, /"row_id","source_row_id","status","filename","missing_fields","missing_field_keys","warnings","error"/);
  assert.match(csv, /"1","ROW-1","generated","Diffida-Mario Rossi\.docx","2","indirizzo \| cf","warn 1",""/);
});

test('discord v1 final summary counts rows with missing placeholders', () => {
  const summary = buildDiscordV1FinalSummary([
    { status: 'generated', missingFields: 1, warnings: ['warn'] },
    { status: 'generated', missingFields: 0, warnings: [] },
    { status: 'error', missingFields: 0, warnings: [] }
  ], true);

  assert.equal(summary.totalRows, 3);
  assert.equal(summary.generatedCount, 2);
  assert.equal(summary.warningRows, 1);
  assert.equal(summary.errorRows, 1);
  assert.equal(summary.documentsWithMissingPlaceholders, 1);
  assert.equal(summary.hasSecondPhase, true);
});

test('discord v1 debug summarizers keep logs compact and structured', () => {
  const columns = summarizeDiscordV1Columns([
    { a: 'x', b: 'y' },
    { b: 'z', c: 3 }
  ]);
  const preview = summarizeDiscordV1RowValues({
    a: 'short',
    b: 'x'.repeat(100),
    c: 42,
    d: { nested: true }
  });

  assert.deepEqual(columns, ['a', 'b', 'c']);
  assert.deepEqual(preview, {
    a: 'short',
    b: `${'x'.repeat(77)}...`,
    c: 42,
    d: '[object]'
  });
});
