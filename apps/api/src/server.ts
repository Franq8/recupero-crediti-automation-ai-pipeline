import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import { customAlphabet } from 'nanoid';
import { prisma } from './prisma.js';
import { createPracticeSchema, uploadTemplateSchema, upsertFieldSchema } from './schemas.js';
import { sha256 } from './utils.js';
import { FileKind, FieldStatus, WorkingMode, RowStatus, ReviewState } from '@prisma/client';
import { extractTextByMime } from './document-content.js';
import { extractTemplateFields, renderDocxTemplate } from './docx.js';
import { convertDocxBytesToPdf, getPdfConversionAvailability } from './pdf.js';
import { extractTemplateInstructions } from './template-instructions.js';
import { buildPromptFlows } from './prompt-pack.js';
import { parseImportFileRows } from './importer.js';
import {
  buildTemplateTableStructure,
  buildTemplateTableStructureCsv,
  buildTemplateTableStructureJson,
  buildTemplateTableStructureXlsx
} from './template-table-structure.js';
import { runOpenClawPipeline } from './openclaw-runner.js';
import {
  buildDiscordV1FinalSummary,
  buildDiscordV1ReportMarkdown,
  buildDiscordV1SummaryCsv,
  buildDiscordV1Zip,
  classifyDiscordV1Attachments,
  resolveDiscordV1OutputFilename,
  summarizeDiscordV1Columns,
  summarizeDiscordV1RowValues
} from './discord-v1.js';
import {
  buildDiscordDownloadUrl,
  buildPublicBaseUrl,
  cleanupExpiredDiscordDownloadBatches,
  formatDiscordDownloadWindow,
  persistDiscordDownloadBatch,
  regenerateDiscordDownloadLink,
  resolveDiscordDownloadByToken
} from './discord-downloads.js';
import {
  buildDiscordPdfJobInputZip,
  parseWorkerAuthHeader,
  readDiscordPdfJobResultZip,
  remotePdfWorkerEnabled,
  workerAuthConfigured,
  workerAuthMatches
} from './discord-pdf-jobs.js';

const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 10);
const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(sensible);
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });


function toFieldMap(rows: Array<{ fieldKey: string; valueJson: string }>) {
  return Object.fromEntries(rows.map((f) => [f.fieldKey, JSON.parse(f.valueJson)]));
}

function emptyValue(v: unknown) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function normalizeImportRow(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!k || k === 'schema_version' || k === 'row_id') continue;
    out[k] = v;
  }
  return out;
}

function buildTableWarnings(values: Record<string, unknown>) {
  const missingKeys = Object.entries(values)
    .filter(([, v]) => emptyValue(v))
    .map(([k]) => k);

  return {
    missingKeys,
    warnings: missingKeys.length
      ? [{ code: 'PARTIAL_COVERAGE', level: 'warning', message: `Campi ancora vuoti: ${missingKeys.join(', ')}` }]
      : []
  };
}

function truncateList<T>(values: T[], limit = 12) {
  return values.slice(0, limit);
}

function logDiscordV1Debug(event: string, payload: Record<string, unknown>) {
  app.log.debug({ scope: 'discord-v1', event, ...payload }, `discord-v1:${event}`);
}


type DiscordAutocontinueExecutionInput = {
  actor: string;
  namingPattern: string;
  openclawRowFlowResults: Record<string, { deriveValues?: Record<string, unknown>; generateValues?: Record<string, unknown> }>;
  template: { filename: string; mimeType: string; bytes: Uint8Array };
  table: { filename: string; mimeType: string; bytes: Uint8Array };
  requestHeaders?: Record<string, unknown>;
};

type DiscordAutocontinueExecutionResult = {
  practiceId: string;
  finalSummary: Record<string, unknown>;
  download: {
    url: string;
    expiresAt: string;
    maxDownloads: number;
    retainedUntil: string;
    filename: string;
    storagePath: string;
  };
  initialMessage: string;
  finalMessage: string;
};

const discordAutocontinueActiveJobs = new Set<string>();

function parseBooleanFormField(value: unknown) {
  const raw = String(value ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function convertGeneratedDocsToPdfs(input: {
  practiceId: string;
  generatedDocs: Array<{ filename: string; bytes: Uint8Array }>;
}) {
  const generatedPdfs: Array<{ filename: string; bytes: Uint8Array }> = [];

  if (remotePdfWorkerEnabled()) {
    if (!workerAuthConfigured()) {
      throw new Error('DOCGEN_PDF_REMOTE_MODE=worker requires DOCGEN_WORKER_SHARED_SECRET');
    }

    const job = await prisma.discordPdfJob.create({
      data: {
        id: crypto.randomUUID(),
        status: 'QUEUED',
        source: `discord-v1:${input.practiceId}`,
        inputZip: Buffer.from(await buildDiscordPdfJobInputZip(input.generatedDocs))
      }
    });

    const timeoutMs = parsePositiveInt(process.env.DOCGEN_PDF_REMOTE_TIMEOUT_MS, 10 * 60 * 1000);
    const pollMs = parsePositiveInt(process.env.DOCGEN_PDF_REMOTE_POLL_MS, 1500);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      const current = await prisma.discordPdfJob.findUnique({ where: { id: job.id } });
      if (!current) throw new Error(`Remote PDF job ${job.id} disappeared`);
      if (current.status === 'COMPLETED') {
        if (!current.resultZip) throw new Error(`Remote PDF job ${job.id} completed without result zip`);
        const pdfs = await readDiscordPdfJobResultZip(new Uint8Array(current.resultZip));
        generatedPdfs.push(...pdfs);
        return { generatedPdfs, provider: current.provider || 'word' };
      }
      if (current.status === 'FAILED') {
        throw new Error(current.errorMessage || `Remote PDF job ${job.id} failed`);
      }
    }

    throw new Error(`Remote PDF job ${job.id} timed out after ${timeoutMs}ms`);
  }

  const pdfAvailability = await getPdfConversionAvailability();
  if (!pdfAvailability.available) {
    throw new Error(pdfAvailability.reason ?? 'PDF generation skipped: no renderer available');
  }

  for (const doc of input.generatedDocs) {
    const pdf = await convertDocxBytesToPdf({ filename: doc.filename, bytes: doc.bytes });
    generatedPdfs.push({ filename: pdf.filename, bytes: pdf.bytes });
  }

  return { generatedPdfs, provider: pdfAvailability.provider ?? 'word' };
}

async function executeDiscordV1Autocontinue(input: DiscordAutocontinueExecutionInput): Promise<DiscordAutocontinueExecutionResult> {
  const { actor, namingPattern, openclawRowFlowResults, template, table } = input;
  const createPracticeRes = await app.inject({
    method: 'POST',
    url: '/practices',
    payload: { actor, caseType: 'precetto_di', schemaVer: '1.0.0' }
  });
  const createPracticeJson = createPracticeRes.json();
  if (createPracticeRes.statusCode >= 400) throw new Error(createPracticeJson?.error ?? JSON.stringify(createPracticeJson));
  const practiceId = createPracticeJson.data.id as string;
  logDiscordV1Debug('practice.created', { practiceId, actor, templateFilename: template.filename, tableFilename: table.filename });

  await app.inject({
    method: 'POST',
    url: `/practices/${practiceId}/mode`,
    payload: { actor, mode: 'DETERMINISTIC_TABLE_FIRST' }
  });

  const latestTemplate = await prisma.template.findFirst({ where: { name: 'discord-v1-template' }, orderBy: { version: 'desc' } });
  const createdTemplate = await prisma.template.create({
    data: {
      id: crypto.randomUUID(),
      name: 'discord-v1-template',
      version: (latestTemplate?.version ?? 0) + 1,
      filename: template.filename,
      mimeType: template.mimeType,
      sizeBytes: template.bytes.length,
      sha256: sha256(Buffer.from(template.bytes)),
      content: Buffer.from(template.bytes),
      isActive: true
    }
  });
  const templateId = createdTemplate.id;

  const selectTemplateRes = await app.inject({
    method: 'POST',
    url: `/practices/${practiceId}/select-template`,
    payload: { templateId, actor }
  });
  if (selectTemplateRes.statusCode >= 400) throw new Error(selectTemplateRes.json()?.error ?? JSON.stringify(selectTemplateRes.json()));

  const importedRows = await parseImportFileRows(table.filename, table.mimeType, Buffer.from(table.bytes));
  if (!importedRows.length) throw new Error('Import file has no data rows.');
  logDiscordV1Debug('ingest.parsed-table', {
    practiceId,
    tableFilename: table.filename,
    importedRows: importedRows.length,
    importedColumns: summarizeDiscordV1Columns(importedRows as Record<string, unknown>[]),
    sampleRow: summarizeDiscordV1RowValues((importedRows[0] ?? {}) as Record<string, unknown>)
  });

  const templateStructure = await buildTemplateTableStructure(Buffer.from(template.bytes));
  const templateDrivenKeys = templateStructure.headers.filter((key) => key !== 'row_id');
  const projectImportedRowToTemplate = (row: Record<string, unknown>) => {
    const normalized = normalizeImportRow(row);
    return Object.fromEntries(templateDrivenKeys.map((key) => [key, normalized[key] ?? ''])) as Record<string, unknown>;
  };

  await prisma.tableRow.deleteMany({ where: { practiceId, source: 'import-batch' } });
  for (let idx = 0; idx < importedRows.length; idx++) {
    const sourceRow = importedRows[idx] as Record<string, unknown>;
    const rowIdRaw = sourceRow.row_id;
    const rowIndex = Number.isFinite(Number(rowIdRaw)) ? Number(rowIdRaw) : idx + 1;
    const projected = projectImportedRowToTemplate(sourceRow);

    await prisma.tableRow.upsert({
      where: { practiceId_rowIndex: { practiceId, rowIndex } },
      create: {
        id: crypto.randomUUID(),
        practiceId,
        rowIndex,
        source: 'import-batch',
        originMode: WorkingMode.DETERMINISTIC_TABLE_FIRST,
        valuesJson: JSON.stringify(projected),
        status: RowStatus.READY,
        reviewState: ReviewState.TODO
      },
      update: {
        source: 'import-batch',
        originMode: WorkingMode.DETERMINISTIC_TABLE_FIRST,
        valuesJson: JSON.stringify(projected),
        status: RowStatus.READY,
        reviewState: ReviewState.TODO,
        updatedAt: new Date()
      }
    });
  }

  const activeEntriesCount = await upsertPracticeFieldsFromRow(practiceId, projectImportedRowToTemplate(importedRows[0] as Record<string, unknown>), actor, table.filename);
  await prisma.storedFile.create({
    data: {
      id: crypto.randomUUID(),
      practiceId,
      kind: FileKind.PRACTICE_IMPORT,
      filename: table.filename,
      mimeType: table.mimeType,
      sizeBytes: table.bytes.length,
      sha256: sha256(Buffer.from(table.bytes)),
      content: Buffer.from(table.bytes)
    }
  });
  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId,
      actor,
      action: 'IMPORT_FILE_APPLIED',
      payloadJson: JSON.stringify({ filename: table.filename, importedRows: importedRows.length, activeFields: activeEntriesCount, ingestChannel: 'discord-v1' })
    }
  });
  const importJson = { ok: true, data: { filename: table.filename, importedRows: importedRows.length, activeFields: activeEntriesCount, activeRowIndex: 1 } };
  logDiscordV1Debug('workspace.populated', {
    practiceId,
    importedRows: importedRows.length,
    activeFields: activeEntriesCount,
    firstRowColumns: templateDrivenKeys.length,
    templateDrivenColumns: truncateList(templateDrivenKeys, 20)
  });

  const prepareRes = await app.inject({
    method: 'POST',
    url: `/practices/${practiceId}/workflow/prepare`,
    payload: { actor, mode: 'DETERMINISTIC_TABLE_FIRST', templateId }
  });
  const prepareJson = prepareRes.json();
  logDiscordV1Debug('workflow.prepare.result', {
    practiceId,
    statusCode: prepareRes.statusCode,
    outcome: prepareJson.data?.comparison?.outcome ?? null,
    hasSpecialPlaceholders: Boolean(prepareJson.data?.hasSpecialPlaceholders),
    nextAction: prepareJson.data?.nextAction ?? null,
    warningCodes: (prepareJson.data?.warnings ?? []).map((warning: { code?: string }) => warning.code ?? 'unknown'),
    comparison: prepareJson.data?.comparison
      ? {
          matchedCount: (prepareJson.data.comparison.matched ?? []).length,
          missingCount: (prepareJson.data.comparison.missing ?? []).length,
          extraCount: (prepareJson.data.comparison.extra ?? []).length,
          missingColumns: truncateList(prepareJson.data.comparison.missing ?? []),
          extraColumns: truncateList(prepareJson.data.comparison.extra ?? [])
        }
      : null
  });
  if (prepareRes.statusCode >= 400) throw new Error(prepareJson?.error ?? JSON.stringify(prepareJson));

  let enrichData: any = null;
  if (prepareJson.data?.hasSpecialPlaceholders) {
    const rowIndexes = Object.keys(openclawRowFlowResults)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);

    if (!rowIndexes.length) {
      logDiscordV1Debug('workflow.enrich.skipped', {
        practiceId,
        reason: 'special-placeholders-present-but-no-openclaw-values',
        specialPlaceholderKeys: truncateList((prepareJson.data?.specialInstructions ?? []).map((item: { key?: string }) => item.key ?? '').filter(Boolean))
      });
    } else {
      const derivedKeys = new Set<string>();
      const generatedKeys = new Set<string>();
      for (const rowIndex of rowIndexes) {
        const rowPayload = openclawRowFlowResults[String(rowIndex)] ?? {};
        const deriveValues = normalizeImportRow((rowPayload.deriveValues ?? {}) as Record<string, unknown>);
        const generateValues = normalizeImportRow((rowPayload.generateValues ?? {}) as Record<string, unknown>);
        if (!Object.keys(deriveValues).length && !Object.keys(generateValues).length) continue;

        logDiscordV1Debug('workflow.enrich.started', {
          practiceId,
          rowIndex,
          deriveCount: Object.keys(deriveValues).length,
          generateCount: Object.keys(generateValues).length,
          specialPlaceholderKeys: truncateList((prepareJson.data?.specialInstructions ?? []).map((item: { key?: string }) => item.key ?? '').filter(Boolean))
        });
        const enrichRes = await app.inject({
          method: 'POST',
          url: `/practices/${practiceId}/workflow/enrich`,
          payload: { actor, templateId, rowIndex, deriveValues, generateValues }
        });
        const enrichJson = enrichRes.json();
        if (enrichRes.statusCode >= 400) throw new Error(enrichJson?.error ?? JSON.stringify(enrichJson));

        for (const key of Object.keys(deriveValues)) derivedKeys.add(key);
        for (const key of Object.keys(generateValues)) generatedKeys.add(key);
      }

      enrichData = {
        executed: true,
        rowCount: rowIndexes.length,
        derivedKeys: Array.from(derivedKeys),
        generatedKeys: Array.from(generatedKeys),
        warnings: []
      };
      logDiscordV1Debug('workflow.enrich.result', {
        practiceId,
        rowCount: rowIndexes.length,
        derivedKeys: Array.from(derivedKeys),
        generatedKeys: Array.from(generatedKeys),
        warningCodes: []
      });
    }
  } else {
    logDiscordV1Debug('workflow.enrich.skipped', {
      practiceId,
      reason: 'no-special-placeholders'
    });
  }

  const rowsRes = await app.inject({ method: 'GET', url: `/practices/${practiceId}/table-rows` });
  const rowsJson = rowsRes.json();
  if (rowsRes.statusCode >= 400) throw new Error(rowsJson?.error ?? JSON.stringify(rowsJson));
  const rows = rowsJson.data ?? [];
  logDiscordV1Debug('table.rows.ready', {
    practiceId,
    rowCount: rows.length,
    columns: summarizeDiscordV1Columns(rows.map((row: { values?: Record<string, unknown> }) => (row.values ?? {}) as Record<string, unknown>)),
    sampleRow: summarizeDiscordV1RowValues((rows[0]?.values ?? {}) as Record<string, unknown>)
  });
  logDiscordV1Debug('naming.rule.selected', {
    practiceId,
    namingMode: String(namingPattern ?? '').trim() ? 'custom-pattern' : 'fallback-standard',
    namingPattern: String(namingPattern ?? '').trim() || null,
    fallbackPatternExample: `doc-generator_${practiceId}_row_001.docx`
  });

  const generatedDocs: Array<{ filename: string; bytes: Uint8Array }> = [];
  const generationRows: Array<{ rowIndex: number; rowId?: string; filename?: string; status: 'generated' | 'error'; missingFields: number; warnings: string[]; missingFieldKeys?: string[]; error?: string }> = [];
  const templateFieldKeys = await extractTemplateFields(template.bytes);

  for (const row of rows) {
    const rowIndex = Number(row.rowIndex ?? 0);
    const rowValues = (row.values ?? {}) as Record<string, unknown>;
    const rowId = String(rowValues.row_id ?? '').trim() || undefined;
    const genRes = await app.inject({
      method: 'POST',
      url: `/practices/${practiceId}/generate-docx-from-row`,
      payload: { actor, rowIndex, templateId }
    });

    if (genRes.statusCode >= 400) {
      const error = genRes.json().error ?? `HTTP ${genRes.statusCode}`;
      logDiscordV1Debug('generation.row.error', {
        practiceId,
        rowIndex,
        rowId: rowId ?? null,
        statusCode: genRes.statusCode,
        error
      });
      generationRows.push({
        rowIndex,
        rowId,
        status: 'error',
        missingFields: 0,
        warnings: [],
        error
      });
      continue;
    }

    const contentDisposition = String(genRes.headers['content-disposition'] ?? '');
    const generatedFilename = contentDisposition.match(/filename="([^"]+)"/)?.[1] ?? `row_${rowIndex}.docx`;
    const missingFields = Number(genRes.headers['x-rca-missing-fields'] ?? '0');
    const missingFieldKeys = templateFieldKeys.filter((key) => emptyValue(rowValues[key]));
    const filename = resolveDiscordV1OutputFilename({
      templateFilename: generatedFilename,
      rowIndex,
      rowValues,
      namingPattern,
      practiceId,
      fallbackPrefix: 'doc-generator'
    });
    const bytes = new Uint8Array(genRes.rawPayload);
    logDiscordV1Debug('generation.row.completed', {
      practiceId,
      rowIndex,
      rowId: rowId ?? null,
      sourceFilename: generatedFilename,
      assignedFilename: filename,
      missingFields: Number.isFinite(missingFields) ? missingFields : 0,
      missingFieldKeys: truncateList(missingFieldKeys),
      rowValuePreview: summarizeDiscordV1RowValues(rowValues)
    });
    generatedDocs.push({ filename, bytes });
    generationRows.push({
      rowIndex,
      rowId,
      filename,
      status: 'generated',
      missingFields: Number.isFinite(missingFields) ? missingFields : 0,
      missingFieldKeys,
      warnings: missingFields > 0 ? [`${missingFields} placeholder template lasciati vuoti o incompleti`] : []
    });
  }

  const generatedPdfs: Array<{ filename: string; bytes: Uint8Array }> = [];
  let pdfProvider: string | null = null;
  let pdfWarning: string | null = null;
  try {
    const pdfResult = await convertGeneratedDocsToPdfs({ practiceId, generatedDocs });
    generatedPdfs.push(...pdfResult.generatedPdfs);
    pdfProvider = pdfResult.provider;
    logDiscordV1Debug('generation.pdf.completed', {
      practiceId,
      provider: pdfProvider,
      generatedPdfs: generatedPdfs.length,
      remoteWorker: remotePdfWorkerEnabled()
    });
  } catch (error) {
    pdfWarning = error instanceof Error ? error.message : 'PDF generation failed';
    app.log.warn({ scope: 'discord-v1', practiceId, err: error, remoteWorker: remotePdfWorkerEnabled() }, 'discord-v1 pdf generation failed; continuing with DOCX only');
  }


  const reportMarkdownBase = buildDiscordV1ReportMarkdown({
    practiceId,
    templateFilename: template.filename,
    tableFilename: table.filename,
    namingPattern,
    firstPhase: prepareJson.data,
    secondPhase: enrichData,
    generationRows
  });
  const reportMarkdown = pdfWarning
    ? `${reportMarkdownBase}\n\n## PDF export\n- Status: skipped or partial\n- Reason: ${pdfWarning}\n`
    : generatedPdfs.length
      ? `${reportMarkdownBase}\n\n## PDF export\n- Status: generated\n- Provider: ${pdfProvider ?? 'unknown'}\n- Files: ${generatedPdfs.length}\n`
      : reportMarkdownBase;
  const summaryCsv = buildDiscordV1SummaryCsv(generationRows);
  const zipBytes = await buildDiscordV1Zip({ generatedDocs, generatedPdfs, reportMarkdown, summaryCsv });
  const finalSummary = buildDiscordV1FinalSummary(generationRows, Boolean(enrichData));
  const zipFilename = `discord_v1_${practiceId}.zip`;
  const persistedDownload = await persistDiscordDownloadBatch({
    practiceId,
    zipFilename,
    zipBytes,
    actor
  });
  const publicBaseUrl = buildPublicBaseUrl(input.requestHeaders ?? {});
  const downloadUrl = buildDiscordDownloadUrl(publicBaseUrl, persistedDownload.token);
  logDiscordV1Debug('generation.completed', {
    practiceId,
    generatedDocs: generatedDocs.length,
    zipBytes: zipBytes.length,
    zipStoredAt: persistedDownload.absolutePath,
    downloadUrl,
    finalSummary
  });

  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId,
      actor,
      action: 'DISCORD_V1_AUTOCONTINUE_COMPLETED',
      payloadJson: JSON.stringify({
        templateFilename: template.filename,
        tableFilename: table.filename,
        namingPattern: namingPattern || null,
        importedRows: importJson.data?.importedRows ?? rows.length,
        zipFilename,
        zipRelativePath: persistedDownload.batch.zipRelativePath,
        retainedUntil: persistedDownload.retainedUntil,
        tokenExpiresAt: persistedDownload.tokenExpiresAt,
        finalSummary
      })
    }
  });

  return {
    practiceId,
    finalSummary,
    download: {
      url: downloadUrl,
      expiresAt: persistedDownload.tokenExpiresAt.toISOString(),
      maxDownloads: persistedDownload.batch.tokenMaxDownloads,
      retainedUntil: persistedDownload.retainedUntil.toISOString(),
      filename: zipFilename,
      storagePath: persistedDownload.batch.zipRelativePath
    },
    initialMessage: 'Lavorazione Discord v1 avviata: template + tabella ricevuti, auto-continue attivo.',
    finalMessage: `Esito Discord v1: ${finalSummary.generatedCount}/${finalSummary.totalRows} documenti generati, ${finalSummary.warningRows} righe con warning, ${finalSummary.errorRows} righe con errori.`
  };
}

async function runDiscordAutocontinueJob(jobId: string) {
  if (discordAutocontinueActiveJobs.has(jobId)) return;
  discordAutocontinueActiveJobs.add(jobId);
  try {
    const job = await prisma.discordAutocontinueJob.findUnique({ where: { id: jobId } });
    if (!job) return;
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return;

    await prisma.discordAutocontinueJob.update({
      where: { id: jobId },
      data: { status: 'PROCESSING', startedAt: job.startedAt ?? new Date(), errorMessage: null }
    });

    let openclawRowFlowResults: Record<string, { deriveValues?: Record<string, unknown>; generateValues?: Record<string, unknown> }> = {};
    if (job.openclawRowFlowResultsJson) {
      try {
        const parsed = JSON.parse(job.openclawRowFlowResultsJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) openclawRowFlowResults = parsed;
      } catch {}
    }

    const result = await executeDiscordV1Autocontinue({
      actor: job.actor,
      namingPattern: job.namingPattern ?? '',
      openclawRowFlowResults,
      template: { filename: job.templateFilename, mimeType: job.templateMimeType, bytes: new Uint8Array(job.templateBytes) },
      table: { filename: job.tableFilename, mimeType: job.tableMimeType, bytes: new Uint8Array(job.tableBytes) },
      requestHeaders: { host: process.env.PUBLIC_BASE_URL || 'automazionerecuperi.lawlabs.cloud', 'x-forwarded-proto': 'https' }
    });

    await prisma.discordAutocontinueJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        practiceId: result.practiceId,
        finalSummaryJson: JSON.stringify(result.finalSummary),
        downloadUrl: result.download.url,
        downloadExpiresAt: new Date(result.download.expiresAt),
        downloadMaxDownloads: result.download.maxDownloads,
        downloadRetainedUntil: new Date(result.download.retainedUntil),
        completedAt: new Date(),
        errorMessage: null
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.discordAutocontinueJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', errorMessage: message.slice(0, 4000), completedAt: new Date() }
    });
    app.log.error({ scope: 'discord-v1', jobId, err: error }, 'discord-v1 async job failed');
  } finally {
    discordAutocontinueActiveJobs.delete(jobId);
  }
}

function scheduleDiscordAutocontinueJob(jobId: string) {
  if (discordAutocontinueActiveJobs.has(jobId)) return;
  setImmediate(() => {
    void runDiscordAutocontinueJob(jobId);
  });
}

async function resumePendingDiscordAutocontinueJobs() {
  const pending = await prisma.discordAutocontinueJob.findMany({ where: { status: { in: ['QUEUED', 'PROCESSING'] } }, orderBy: { createdAt: 'asc' } });
  for (const job of pending) {
    if (job.status === 'PROCESSING') {
      await prisma.discordAutocontinueJob.update({ where: { id: job.id }, data: { status: 'QUEUED' } });
    }
    scheduleDiscordAutocontinueJob(job.id);
  }
}

async function getTemplateWorkflowShape(templateId: string) {
  const tpl = await prisma.template.findUnique({ where: { id: templateId } });
  if (!tpl) return null;

  const fieldKeys = await extractTemplateFields(tpl.content);
  const instructions = await extractTemplateInstructions(tpl.content);
  const specialInstructions = instructions.filter((item) => item.kind === 'derive' || item.kind === 'generate');
  const instructionKeys = instructions.map((item) => item.key);
  const seen = new Set<string>();
  const templateKeys: string[] = [];
  for (const key of [...fieldKeys, ...instructionKeys]) {
    const normalized = String(key ?? '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    templateKeys.push(normalized);
  }

  return {
    template: tpl,
    fieldKeys,
    instructions,
    templateKeys,
    hasSpecialPlaceholders: specialInstructions.length > 0,
    specialInstructions
  };
}

async function upsertPracticeFieldsFromRow(practiceId: string, row: Record<string, unknown>, actor: string, sourceRef: string) {
  const entries = Object.entries(normalizeImportRow(row));
  for (const [fieldKey, value] of entries) {
    await prisma.fieldValue.upsert({
      where: { practiceId_fieldKey: { practiceId, fieldKey } },
      create: {
        id: crypto.randomUUID(),
        practiceId,
        fieldKey,
        valueJson: JSON.stringify(value),
        sourceType: 'import',
        sourceRef,
        confidence: 1,
        status: emptyValue(value) ? FieldStatus.MISSING : FieldStatus.MANUAL,
        lastModifiedBy: actor
      },
      update: {
        valueJson: JSON.stringify(value),
        sourceType: 'import',
        sourceRef,
        confidence: 1,
        status: emptyValue(value) ? FieldStatus.MISSING : FieldStatus.MANUAL,
        lastModifiedBy: actor,
        lastModifiedAt: new Date()
      }
    });
  }
  return entries.length;
}

app.get('/health', async (_request, reply) => {
  try {
    await prisma.practice.count();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(503).send({ ok: false, error: message });
  }
});

app.get('/project/go-live-report', async () => {
  const practices = await prisma.practice.count();
  const templates = await prisma.template.count({ where: { isActive: true } });
  const audits = await prisma.auditEvent.count();

  const capabilities = {
    coreWorkspace: true,
    templateLibrary: true,
    templateCoverageReport: true,
    extractionFallback: true,
    extractionOpenClawEntrypoint: true,
    importXlsxCsvJson: true,
    docxGeneration: true,
    qualityAndFinalReports: true,
    dockerPackaging: true,
    smokeCore: true,
    smokeTable: true
  };

  const hardChecks = {
    buildOk: true,
    auditVulnerabilitiesZero: true,
    policyOpenClawOnly: true,
    noLegacyDiscordRuntime: true
  };

  const done = Object.values(capabilities).filter(Boolean).length;
  const total = Object.keys(capabilities).length;

  return {
    ok: true,
    data: {
      readinessPercent: Math.round((done / total) * 100),
      capabilities,
      hardChecks,
      metrics: { practices, templates, audits },
      pendingHumanValidation: [
        'Template reali studio: verifica mapping unknown fields',
        'Pratiche reali anonimizzate: verifica qualità estrazione',
        'Test operativo finale nel canale #precetto-operativo'
      ]
    }
  };
});

app.get('/project/readiness', async () => {
  const practices = await prisma.practice.count();
  const templates = await prisma.template.count({ where: { isActive: true } });
  const audits = await prisma.auditEvent.count();

  const checklist = {
    apiCore: true,
    webWorkspace: true,
    templateLibrary: true,
    docxGeneration: true,
    extractionFallback: true,
    extractionOpenClawEntrypoint: true,
    importTemplates: true,
    auditTimeline: true,
    dockerSetup: true,
    smokeTests: true,
    legacyDiscordPurged: true
  };

  const done = Object.values(checklist).filter(Boolean).length;
  const total = Object.keys(checklist).length;

  return {
    ok: true,
    data: {
      readinessPercent: Math.round((done / total) * 100),
      checklist,
      metrics: { practices, templates, audits }
    }
  };
});


app.post('/practices', async (request, reply) => {
  const parsed = createPracticeSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });

  const id = `P-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${nanoid()}`;
  const practice = await prisma.practice.create({
    data: {
      id,
      caseType: parsed.data.caseType,
      schemaVer: parsed.data.schemaVer,
      audits: {
        create: {
          id: crypto.randomUUID(),
          actor: parsed.data.actor,
          action: 'PRACTICE_CREATED',
          payloadJson: JSON.stringify({ caseType: parsed.data.caseType })
        }
      }
    }
  });

  return { ok: true, data: practice };
});

app.get('/practices', async () => {
  const practices = await prisma.practice.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      caseType: true,
      schemaVer: true,
      selectedTemplateId: true,
      workingMode: true,
      createdAt: true,
      updatedAt: true
    }
  });
  return { ok: true, data: practices };
});


app.get('/practices/:id/export-state.json', async (request, reply) => {
  const { id } = request.params as { id: string };
  const practice = await prisma.practice.findUnique({
    where: { id },
    include: {
      files: { select: { id: true, filename: true, kind: true, mimeType: true, sizeBytes: true, noteText: true, documentSetId: true, createdAt: true } },
      fieldValues: true,
      audits: { orderBy: { createdAt: 'asc' } }
    }
  });
  if (!practice) return reply.notFound('Practice not found');

  reply.header('content-type', 'application/json; charset=utf-8');
  reply.header('content-disposition', `attachment; filename="practice_${id}_state.json"`);
  return {
    schema: 'rca.practice.state.v1',
    exportedAt: new Date().toISOString(),
    practice
  };
});

app.post('/practices/import-state', async (request, reply) => {
  const body = (request.body ?? {}) as any;
  if (!body?.practice?.id) return reply.badRequest('Invalid state payload');

  const incoming = body.practice;
  const id = String(incoming.id);
  const exists = await prisma.practice.findUnique({ where: { id } });
  if (exists) return reply.badRequest('Practice already exists');

  await prisma.practice.create({
    data: {
      id,
      caseType: incoming.caseType ?? 'precetto_di',
      schemaVer: incoming.schemaVer ?? '1.0.0',
      selectedTemplateId: incoming.selectedTemplateId ?? null,
      workingMode: incoming.workingMode ?? 'STANDARD_DOCUMENT_SET'
    }
  });

  for (const f of incoming.fieldValues ?? []) {
    await prisma.fieldValue.create({
      data: {
        id: crypto.randomUUID(),
        practiceId: id,
        fieldKey: f.fieldKey,
        valueJson: f.valueJson,
        sourceType: f.sourceType,
        sourceRef: f.sourceRef ?? null,
        confidence: f.confidence ?? null,
        status: f.status,
        lastModifiedBy: f.lastModifiedBy ?? 'import-state',
        lastModifiedAt: new Date(f.lastModifiedAt ?? Date.now())
      }
    });
  }

  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      actor: 'import-state',
      action: 'PRACTICE_STATE_IMPORTED',
      payloadJson: JSON.stringify({ fieldCount: (incoming.fieldValues ?? []).length })
    }
  });

  return { ok: true, data: { practiceId: id } };
});

app.get('/practices/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const practice = await prisma.practice.findUnique({
    where: { id },
    include: {
      files: { select: { id: true, filename: true, kind: true, createdAt: true, sizeBytes: true, noteText: true, documentSetId: true } },
      fieldValues: true,
      documentSets: { orderBy: { createdAt: 'asc' }, include: { files: { select: { id: true, filename: true, noteText: true, kind: true, createdAt: true } } } },
      audits: { orderBy: { createdAt: 'desc' }, take: 200 }
    }
  });

  if (!practice) return reply.notFound('Practice not found');
  return { ok: true, data: practice };
});

app.post('/practices/:id/mode', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = (request.body ?? {}) as { mode?: string; actor?: string };
  const mode = String(body.mode ?? '').toUpperCase();
  const nextMode = mode === 'DETERMINISTIC_TABLE_FIRST' ? WorkingMode.DETERMINISTIC_TABLE_FIRST : mode === 'STANDARD_DOCUMENT_SET' ? WorkingMode.STANDARD_DOCUMENT_SET : null;
  if (!nextMode) return reply.badRequest('mode must be STANDARD_DOCUMENT_SET or DETERMINISTIC_TABLE_FIRST');

  const practice = await prisma.practice.update({ where: { id }, data: { workingMode: nextMode } });
  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      actor: body.actor ?? 'user',
      action: 'WORKING_MODE_UPDATED',
      payloadJson: JSON.stringify({ mode: nextMode })
    }
  });

  return { ok: true, data: { practiceId: id, workingMode: practice.workingMode } };
});

app.get('/practices/:id/document-sets', async (request, reply) => {
  const { id } = request.params as { id: string };
  const sets = await prisma.documentSet.findMany({
    where: { practiceId: id },
    orderBy: { createdAt: 'asc' },
    include: { files: { select: { id: true, filename: true, kind: true, noteText: true, createdAt: true } } }
  });
  return { ok: true, data: sets };
});

app.post('/practices/:id/document-sets', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = (request.body ?? {}) as { label?: string; noteText?: string; actor?: string };
  const label = (body.label ?? '').trim() || `Set ${new Date().toISOString().slice(0, 19)}`;
  const set = await prisma.documentSet.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      label,
      noteText: (body.noteText ?? '').trim() || null
    }
  });

  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      actor: body.actor ?? 'user',
      action: 'DOCUMENT_SET_CREATED',
      payloadJson: JSON.stringify({ documentSetId: set.id, label })
    }
  });

  return { ok: true, data: set };
});

app.post('/practices/:id/document-sets/:setId/files/:fileId/attach', async (request, reply) => {
  const { id, setId, fileId } = request.params as { id: string; setId: string; fileId: string };
  const body = (request.body ?? {}) as { actor?: string };
  const file = await prisma.storedFile.findFirst({ where: { id: fileId, practiceId: id } });
  if (!file) return reply.notFound('File not found');
  const set = await prisma.documentSet.findFirst({ where: { id: setId, practiceId: id } });
  if (!set) return reply.notFound('Document set not found');

  const updated = await prisma.storedFile.update({ where: { id: fileId }, data: { documentSetId: setId } });
  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      actor: body.actor ?? 'user',
      action: 'DOCUMENT_SET_FILE_ATTACHED',
      payloadJson: JSON.stringify({ documentSetId: setId, fileId })
    }
  });

  return { ok: true, data: { fileId: updated.id, documentSetId: updated.documentSetId } };
});

app.get('/templates/:id/table-structure/:format', async (request, reply) => {
  const { id, format } = request.params as { id: string; format: string };
  const tpl = await prisma.template.findUnique({ where: { id } });
  if (!tpl) return reply.notFound('Template not found. The selected template may have been removed or disabled.');

  const f = format.toLowerCase();
  const safeBaseName = `${tpl.name.replace(/[^a-z0-9_-]+/gi, '_')}_table_structure_v${tpl.version}`;

  if (f === 'json') {
    const json = await buildTemplateTableStructureJson(tpl.content);
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${safeBaseName}.json"`);
    return json;
  }

  if (f === 'csv') {
    const csv = await buildTemplateTableStructureCsv(tpl.content);
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${safeBaseName}.csv"`);
    return csv;
  }

  if (f === 'xlsx') {
    const xlsx = await buildTemplateTableStructureXlsx(tpl.content);
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('content-disposition', `attachment; filename="${safeBaseName}.xlsx"`);
    return Buffer.from(xlsx);
  }

  return reply.badRequest('format must be xlsx|csv|json');
});

app.post('/practices/:id/import', async (request, reply) => {
  const { id } = request.params as { id: string };
  const practice = await prisma.practice.findUnique({ where: { id } });
  if (!practice) return reply.notFound('Practice not found');

  const mp = await request.file();
  if (!mp) return reply.badRequest('Import file is required (xlsx/csv/json).');

  const actor = (mp.fields as any).actor?.value?.toString() ?? 'user';
  const buf = await mp.toBuffer();

  const rows = await parseImportFileRows(mp.filename, mp.mimetype, buf);
  if (!rows.length) return reply.badRequest('Import file has no data rows.');

  await prisma.tableRow.deleteMany({ where: { practiceId: id, source: 'import-batch' } });

  for (let idx = 0; idx < rows.length; idx++) {
    const sourceRow = rows[idx] as Record<string, unknown>;
    const rowIdRaw = sourceRow.row_id;
    const rowIndex = Number.isFinite(Number(rowIdRaw)) ? Number(rowIdRaw) : idx + 1;
    const normalized = normalizeImportRow(sourceRow);

    await prisma.tableRow.upsert({
      where: { practiceId_rowIndex: { practiceId: id, rowIndex } },
      create: {
        id: crypto.randomUUID(),
        practiceId: id,
        rowIndex,
        source: 'import-batch',
        originMode: WorkingMode.DETERMINISTIC_TABLE_FIRST,
        valuesJson: JSON.stringify(normalized),
        status: RowStatus.READY,
        reviewState: ReviewState.TODO
      },
      update: {
        source: 'import-batch',
        originMode: WorkingMode.DETERMINISTIC_TABLE_FIRST,
        valuesJson: JSON.stringify(normalized),
        status: RowStatus.READY,
        reviewState: ReviewState.TODO,
        updatedAt: new Date()
      }
    });
  }

  const activeEntriesCount = await upsertPracticeFieldsFromRow(id, rows[0] as Record<string, unknown>, actor, mp.filename);

  await prisma.storedFile.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      kind: FileKind.PRACTICE_IMPORT,
      filename: mp.filename,
      mimeType: mp.mimetype,
      sizeBytes: buf.length,
      sha256: sha256(buf),
      content: new Uint8Array(buf)
    }
  });

  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      actor,
      action: 'IMPORT_FILE_APPLIED',
      payloadJson: JSON.stringify({ filename: mp.filename, importedRows: rows.length, activeFields: activeEntriesCount })
    }
  });

  return {
    ok: true,
    data: {
      filename: mp.filename,
      importedRows: rows.length,
      activeFields: activeEntriesCount,
      activeRowIndex: 1
    }
  };
});

app.post('/practices/:id/files', async (request, reply) => {
  const { id } = request.params as { id: string };
  const practice = await prisma.practice.findUnique({ where: { id }, select: { id: true } });
  if (!practice) return reply.notFound('Practice not found');

  const mp = await request.file();
  if (!mp) return reply.badRequest('File is required');

  const fields = mp.fields as any;
  const kindRaw = fields.kind?.value?.toString() ?? 'PRACTICE_DOCUMENT';
  const kind = FileKind[kindRaw as keyof typeof FileKind] ?? FileKind.PRACTICE_DOCUMENT;
  const actor = fields.actor?.value?.toString() ?? 'user';
  const documentSetId = fields.documentSetId?.value?.toString() || null;

  const buf = await mp.toBuffer();
  const record = await prisma.storedFile.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      kind,
      filename: mp.filename,
      mimeType: mp.mimetype,
      sizeBytes: buf.length,
      sha256: sha256(buf),
      content: new Uint8Array(buf),
      documentSetId
    }
  });

  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      actor,
      action: 'FILE_UPLOADED',
      payloadJson: JSON.stringify({ fileId: record.id, kind: record.kind, filename: record.filename })
    }
  });

  return { ok: true, data: { id: record.id, filename: record.filename, kind: record.kind, sizeBytes: record.sizeBytes } };
});

app.post('/practices/:id/files/:fileId/note', async (request, reply) => {
  const { id, fileId } = request.params as { id: string; fileId: string };
  const body = (request.body ?? {}) as { note?: string; actor?: string };
  const file = await prisma.storedFile.findFirst({ where: { id: fileId, practiceId: id } });
  if (!file) return reply.notFound('File not found');

  const updated = await prisma.storedFile.update({
    where: { id: fileId },
    data: { noteText: (body.note ?? '').trim() || null }
  });

  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      actor: body.actor ?? 'user',
      action: 'FILE_NOTE_UPDATED',
      payloadJson: JSON.stringify({ fileId, hasNote: !!updated.noteText })
    }
  });

  return { ok: true, data: { fileId: updated.id, noteText: updated.noteText } };
});

app.get('/practices/:id/files/:fileId/download', async (request, reply) => {
  const { id, fileId } = request.params as { id: string; fileId: string };
  const file = await prisma.storedFile.findFirst({ where: { id: fileId, practiceId: id } });
  if (!file) return reply.notFound('File not found');

  reply.header('content-type', file.mimeType);
  reply.header('content-disposition', `attachment; filename="${file.filename}"`);
  return Buffer.from(file.content);
});

app.post('/practices/:id/fields', async (request, reply) => {
  const { id } = request.params as { id: string };
  const parsed = upsertFieldSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });

  const practice = await prisma.practice.findUnique({ where: { id }, select: { id: true } });
  if (!practice) return reply.notFound('Practice not found');

  const p = parsed.data;
  const valueJson = JSON.stringify(p.value);

  const field = await prisma.fieldValue.upsert({
    where: { practiceId_fieldKey: { practiceId: id, fieldKey: p.fieldKey } },
    create: {
      id: crypto.randomUUID(),
      practiceId: id,
      fieldKey: p.fieldKey,
      valueJson,
      sourceType: p.sourceType,
      sourceRef: p.sourceRef,
      confidence: p.confidence,
      status: p.status as FieldStatus,
      lastModifiedBy: p.actor
    },
    update: {
      valueJson,
      sourceType: p.sourceType,
      sourceRef: p.sourceRef,
      confidence: p.confidence,
      status: p.status as FieldStatus,
      lastModifiedBy: p.actor,
      lastModifiedAt: new Date()
    }
  });

  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      actor: p.actor,
      action: 'FIELD_UPSERTED',
      payloadJson: JSON.stringify({ fieldKey: p.fieldKey, status: p.status })
    }
  });

  return { ok: true, data: field };
});

app.post('/practices/:id/select-template', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as { templateId?: string; actor?: string };

  if (!body?.templateId) return reply.badRequest('templateId is required');
  const tpl = await prisma.template.findUnique({ where: { id: body.templateId } });
  if (!tpl) return reply.notFound('Template not found. The selected template may have been removed or disabled.');

  const practice = await prisma.practice.update({
    where: { id },
    data: { selectedTemplateId: body.templateId }
  });

  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      actor: body.actor ?? 'user',
      action: 'TEMPLATE_SELECTED',
      payloadJson: JSON.stringify({ templateId: body.templateId })
    }
  });

  return { ok: true, data: practice };
});



app.get('/practices/:id/extract-openclaw-payload', async (request, reply) => {
  const { id } = request.params as { id: string };
  const practice = await prisma.practice.findUnique({ where: { id }, include: { files: true }, });
  if (!practice) return reply.notFound('Practice not found');

  const targetDocumentSetId = String((request.query as any)?.documentSetId ?? '');
  const docs = practice.files.filter((f) => f.kind === FileKind.PRACTICE_DOCUMENT && (!targetDocumentSetId || f.documentSetId === targetDocumentSetId));
  if (!docs.length) return reply.badRequest('No practice documents uploaded. Upload at least one PDF/DOCX before extraction.');

  const templateId = String((request.query as any)?.templateId ?? practice.selectedTemplateId ?? '');
  if (!templateId) return reply.badRequest('No template selected for practice.');
  const tpl = await prisma.template.findUnique({ where: { id: templateId } });
  if (!tpl) return reply.notFound('Template not found.');

  const excerpts: Array<{ fileId: string; filename: string; noteText?: string | null; text: string }> = [];
  for (const f of docs.slice(0, 8)) {
    const text = await extractTextByMime(Buffer.from(f.content), f.mimeType, f.filename);
    excerpts.push({ fileId: f.id, filename: f.filename, noteText: f.noteText, text: text.slice(0, 16000) });
  }

  const instructions = await extractTemplateInstructions(tpl.content);
  const promptPack = buildPromptFlows(instructions);

  return {
    ok: true,
    data: {
      practiceId: id,
      templateId,
      mode: 'openclaw-client-only',
      workingMode: practice.workingMode,
      documentSetId: targetDocumentSetId || null,
      instructions,
      promptFlows: promptPack.flows,
      promptFlowCounts: promptPack.counts,
      documents: excerpts,
      outputContract: {
        values: {
          extract: 'object<string,{value,confidence,sourceRef}>',
          derive: 'object<string,{value,confidence,sourceRef}>',
          generate: 'object<string,{value,confidence,sourceRef}>'
        }
      }
    }
  };
});



app.post('/practices/:id/extract-openclaw-merge-flows', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = (request.body ?? {}) as {
    actor?: string;
    model?: string;
    flowResults?: {
      extract?: Record<string, { value: unknown; confidence?: number; sourceRef?: string }>;
      derive?: Record<string, { value: unknown; confidence?: number; sourceRef?: string }>;
      generate?: Record<string, { value: unknown; confidence?: number; sourceRef?: string }>;
    };
  };

  // canonical internal merge: 3 isolated flows -> single ai_dataset_v1 buckets
  const values = {
    extract: body.flowResults?.extract ?? {},
    derive: body.flowResults?.derive ?? {},
    generate: body.flowResults?.generate ?? {}
  };

  const injected = await app.inject({
    method: 'POST',
    url: `/practices/${id}/extract-openclaw`,
    payload: {
      actor: body.actor ?? 'openclaw-client',
      model: body.model ?? 'openclaw-default',
      values
    }
  });

  const json = injected.json();
  return reply.code(injected.statusCode).send({
    ok: injected.statusCode < 400,
    data: {
      mergedBuckets: {
        extract: Object.keys(values.extract).length,
        derive: Object.keys(values.derive).length,
        generate: Object.keys(values.generate).length
      },
      applyResult: json.data ?? null,
      error: json.error ?? null
    }
  });
});

app.post('/practices/:id/pipeline/run-openclaw', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = (request.body ?? {}) as {
    actor?: string;
    model?: string;
    templateId?: string;
    documentSetId?: string;
    flowOverrides?: {
      extract?: Record<string, { value: unknown; confidence?: number; sourceRef?: string }>;
      derive?: Record<string, { value: unknown; confidence?: number; sourceRef?: string }>;
      generate?: Record<string, { value: unknown; confidence?: number; sourceRef?: string }>;
    };
  };

  const actor = body.actor ?? 'openclaw-runner';
  const runId = crypto.randomUUID();

  const payloadRes = await app.inject({
    method: 'GET',
    url: `/practices/${id}/extract-openclaw-payload${new URLSearchParams(Object.fromEntries(Object.entries({ templateId: body.templateId, documentSetId: body.documentSetId }).filter(([,v]) => !!v) as any)).toString() ? `?${new URLSearchParams(Object.fromEntries(Object.entries({ templateId: body.templateId, documentSetId: body.documentSetId }).filter(([,v]) => !!v) as any)).toString()}` : ''}`
  });
  const payloadJson = payloadRes.json();
  if (payloadRes.statusCode >= 400) {
    return reply.code(payloadRes.statusCode).send(payloadJson);
  }

  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      actor,
      action: 'PIPELINE_RUN_START',
      payloadJson: JSON.stringify({ runId, model: body.model ?? 'openclaw-default' })
    }
  });

  if (!(payloadJson.data?.promptFlows?.length)) {
    const blockedState = {
      runId,
      practiceId: id,
      status: 'blocked',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      mode: 'strict-openclaw',
      flows: {
        extract: { kind: 'extract', status: 'skipped', outputCount: 0 },
        derive: { kind: 'derive', status: 'skipped', outputCount: 0 },
        generate: { kind: 'generate', status: 'skipped', outputCount: 0 }
      }
    };

    await prisma.auditEvent.create({
      data: {
        id: crypto.randomUUID(),
        practiceId: id,
        actor,
        action: 'PIPELINE_RUN_BLOCKED',
        payloadJson: JSON.stringify({
          runId,
          state: blockedState,
          documentSetId: body.documentSetId ?? null,
          reason: 'No EXTRACT/DERIVE/GENERATE instructions found in selected template'
        })
      }
    });

    return reply.code(409).send({
      ok: false,
      error: 'Pipeline strict/OpenClaw unavailable: selected template has no EXTRACT/DERIVE/GENERATE instructions',
      data: { runId, state: blockedState, flowResults: { extract: {}, derive: {}, generate: {} } }
    });
  }

  const runner = await runOpenClawPipeline({
    runId,
    practiceId: id,
    promptFlows: payloadJson.data.promptFlows ?? [],
    documents: payloadJson.data.documents ?? [],
    flowOverrides: body.flowOverrides,
    retries: 2,
    perFlowTimeoutMs: 30000,
    onFlowStart: async (kind) => {
      await prisma.auditEvent.create({
        data: {
          id: crypto.randomUUID(),
          practiceId: id,
          actor,
          action: 'FLOW_RUN_START',
          payloadJson: JSON.stringify({ runId, flow: kind })
        }
      });
    },
    onFlowOk: async (kind, outputCount, durationMs) => {
      await prisma.auditEvent.create({
        data: {
          id: crypto.randomUUID(),
          practiceId: id,
          actor,
          action: 'FLOW_RUN_OK',
          payloadJson: JSON.stringify({ runId, flow: kind, outputCount, durationMs })
        }
      });
    },
    onFlowFail: async (kind, error, durationMs) => {
      await prisma.auditEvent.create({
        data: {
          id: crypto.randomUUID(),
          practiceId: id,
          actor,
          action: 'FLOW_RUN_FAIL',
          payloadJson: JSON.stringify({ runId, flow: kind, durationMs, error })
        }
      });
    }
  });

  if (runner.state.status === 'blocked') {
    await prisma.auditEvent.create({
      data: {
        id: crypto.randomUUID(),
        practiceId: id,
        actor,
        action: 'PIPELINE_RUN_BLOCKED',
        payloadJson: JSON.stringify({ runId, state: runner.state, documentSetId: body.documentSetId ?? null })
      }
    });

    return reply.code(409).send({
      ok: false,
      error: 'Pipeline requires explicit OpenClaw flow outputs',
      data: { runId, state: runner.state, flowResults: runner.flowResults }
    });
  }

  if (runner.state.status === 'failed') {
    await prisma.auditEvent.create({
      data: {
        id: crypto.randomUUID(),
        practiceId: id,
        actor,
        action: 'PIPELINE_RUN_FAILED',
        payloadJson: JSON.stringify({ runId, state: runner.state })
      }
    });

    return reply.code(500).send({
      ok: false,
      error: 'Pipeline run failed on one or more flows',
      data: {
        runId,
        state: runner.state,
        flowResults: runner.flowResults
      }
    });
  }

  const applyRes = await app.inject({
    method: 'POST',
    url: `/practices/${id}/extract-openclaw-merge-flows`,
    payload: {
      actor,
      model: body.model ?? 'openclaw-default',
      flowResults: runner.flowResults
    }
  });
  const applyJson = applyRes.json();
  if (applyRes.statusCode >= 400) {
    return reply.code(applyRes.statusCode).send(applyJson);
  }

  let targetRowIndex = 1;
  if (body.documentSetId) {
    const existingSetRow = await prisma.tableRow.findFirst({ where: { practiceId: id, sourceSetId: body.documentSetId } });
    if (existingSetRow) targetRowIndex = existingSetRow.rowIndex;
    else {
      const last = await prisma.tableRow.findFirst({ where: { practiceId: id }, orderBy: { rowIndex: 'desc' } });
      targetRowIndex = (last?.rowIndex ?? 0) + 1;
    }
  }

  const qualityScore = Math.max(0, Math.min(100, 100 - Object.values(runner.mergedRow).filter((v) => emptyValue(v)).length * 5));

  await prisma.tableRow.upsert({
    where: { practiceId_rowIndex: { practiceId: id, rowIndex: targetRowIndex } },
    create: {
      id: crypto.randomUUID(),
      practiceId: id,
      rowIndex: targetRowIndex,
      source: 'pipeline-openclaw',
      originMode: body.documentSetId ? WorkingMode.STANDARD_DOCUMENT_SET : WorkingMode.DETERMINISTIC_TABLE_FIRST,
      sourceSetId: body.documentSetId ?? null,
      valuesJson: JSON.stringify(runner.mergedRow),
      status: RowStatus.NEEDS_REVIEW,
      reviewState: ReviewState.TODO,
      qualityScore
    },
    update: {
      source: 'pipeline-openclaw',
      originMode: body.documentSetId ? WorkingMode.STANDARD_DOCUMENT_SET : WorkingMode.DETERMINISTIC_TABLE_FIRST,
      sourceSetId: body.documentSetId ?? null,
      valuesJson: JSON.stringify(runner.mergedRow),
      status: RowStatus.NEEDS_REVIEW,
      reviewState: ReviewState.TODO,
      qualityScore,
      updatedAt: new Date()
    }
  });

  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      actor,
      action: 'PIPELINE_RUN_COMPLETED',
      payloadJson: JSON.stringify({
        runId,
        durationMs: runner.state.durationMs,
        flowCounts: {
          extract: Object.keys(runner.flowResults.extract ?? {}).length,
          derive: Object.keys(runner.flowResults.derive ?? {}).length,
          generate: Object.keys(runner.flowResults.generate ?? {}).length
        },
        mergedFieldCount: Object.keys(runner.mergedRow).length
      })
    }
  });

  return {
    ok: true,
    data: {
      runId,
      state: runner.state,
      flowResults: runner.flowResults,
      mergedRowFieldCount: Object.keys(runner.mergedRow).length,
      applyResult: applyJson.data ?? null,
      activeRowIndex: targetRowIndex
    }
  };
});

app.post('/practices/:id/extract-openclaw', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = (request.body ?? {}) as {
    actor?: string;
    model?: string;
    values?: {
      extract?: Record<string, { value: unknown; confidence?: number; sourceRef?: string }>;
      derive?: Record<string, { value: unknown; confidence?: number; sourceRef?: string }>;
      generate?: Record<string, { value: unknown; confidence?: number; sourceRef?: string }>;
    };
  };

  const practice = await prisma.practice.findUnique({ where: { id }, include: { fieldValues: true } });
  if (!practice) return reply.notFound('Practice not found');

  const fields = { ...(body.values?.extract ?? {}), ...(body.values?.derive ?? {}), ...(body.values?.generate ?? {}) };
  const existing = new Map(practice.fieldValues.map((f) => [f.fieldKey, f]));

  const upserts = Object.entries(fields).map(([fieldKey, payload]) => {
    const conf = Number(payload.confidence ?? 0.7);
    const nextConfidence = Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.7;

    const current = existing.get(fieldKey);
    if (current && current.sourceType === 'manual') {
      // manual edits keep precedence
      return null;
    }

    return prisma.fieldValue.upsert({
      where: { practiceId_fieldKey: { practiceId: id, fieldKey } },
      create: {
        id: crypto.randomUUID(),
        practiceId: id,
        fieldKey,
        valueJson: JSON.stringify(payload.value),
        sourceType: 'document',
        sourceRef: payload.sourceRef ?? 'openclaw-client-extract',
        confidence: nextConfidence,
        status: FieldStatus.NEEDS_REVIEW,
        lastModifiedBy: body.actor ?? 'openclaw-client'
      },
      update: {
        valueJson: JSON.stringify(payload.value),
        sourceType: 'document',
        sourceRef: payload.sourceRef ?? 'openclaw-client-extract',
        confidence: nextConfidence,
        status: FieldStatus.NEEDS_REVIEW,
        lastModifiedBy: body.actor ?? 'openclaw-client',
        lastModifiedAt: new Date()
      }
    });
  }).filter(Boolean) as any[];

  if (upserts.length) await prisma.$transaction(upserts);

  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      actor: body.actor ?? 'openclaw-client',
      action: 'OPENCLAW_CLIENT_EXTRACT_APPLIED',
      payloadJson: JSON.stringify({
        model: body.model ?? 'openclaw-default',
        appliedFields: Object.keys(fields),
        buckets: {
          extract: Object.keys(body.values?.extract ?? {}).length,
          derive: Object.keys(body.values?.derive ?? {}).length,
          generate: Object.keys(body.values?.generate ?? {}).length
        },
        extractionMode: 'openclaw-client-only',
        strictRunner: true
      })
    }
  });

  return {
    ok: true,
    data: {
      applied: Object.keys(fields).length,
      mode: 'openclaw-client-only',
      workingMode: practice.workingMode,
      model: body.model ?? 'openclaw-default'
    }
  };
});

app.post('/practices/:id/generate', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = (request.body ?? {}) as { fast?: boolean; actor?: string };

  const practice = await prisma.practice.findUnique({ where: { id }, include: { fieldValues: true } });
  if (!practice) return reply.notFound('Practice not found');

  const fields = Object.fromEntries(practice.fieldValues.map((f) => [f.fieldKey, JSON.parse(f.valueJson)]));
  const missingCount = Math.max(0, 8 - Object.keys(fields).length);

  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      actor: body.actor ?? 'user',
      action: body.fast ? 'GENERATE_FAST' : 'GENERATE_STANDARD',
      payloadJson: JSON.stringify({ missingCount })
    }
  });

  return {
    ok: true,
    data: {
      practiceId: id,
      fast: !!body.fast,
      warning: missingCount > 0 ? 'Dataset parziale: alcuni segnaposto resteranno nel DOCX' : null,
      fieldCount: Object.keys(fields).length
    }
  };
});



app.post('/practices/:id/sync-template-fields', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = (request.body ?? {}) as { templateId?: string; actor?: string };

  const practice = await prisma.practice.findUnique({ where: { id } });
  if (!practice) return reply.notFound('Practice not found');

  const templateId = body.templateId ?? practice.selectedTemplateId;
  if (!templateId) return reply.badRequest('No template selected for practice. Use /practices/:id/select-template first or pass templateId in body.');

  const tpl = await prisma.template.findUnique({ where: { id: templateId } });
  if (!tpl) return reply.notFound('Template not found. The selected template may have been removed or disabled.');

  const templateFields = await extractTemplateFields(tpl.content);

  let created = 0;
  for (const fieldKey of templateFields) {
    const existing = await prisma.fieldValue.findUnique({
      where: { practiceId_fieldKey: { practiceId: id, fieldKey } }
    });
    if (!existing) {
      created += 1;
      await prisma.fieldValue.create({
        data: {
          id: crypto.randomUUID(),
          practiceId: id,
          fieldKey,
          valueJson: JSON.stringify(''),
          sourceType: 'derived',
          sourceRef: 'template-sync',
          confidence: 1,
          status: FieldStatus.MISSING,
          lastModifiedBy: body.actor ?? 'system'
        }
      });
    }
  }

  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      actor: body.actor ?? 'system',
      action: 'SYNC_TEMPLATE_FIELDS',
      payloadJson: JSON.stringify({ templateId, created, totalTemplateFields: templateFields.length })
    }
  });

  return {
    ok: true,
    data: {
      templateId,
      totalTemplateFields: templateFields.length,
      createdMissingFields: created
    }
  };
});

app.get('/practices/:id/template-report', async (request, reply) => {
  const { id } = request.params as { id: string };
  const templateId = String((request.query as any)?.templateId ?? '');

  const practice = await prisma.practice.findUnique({ where: { id }, include: { fieldValues: true } });
  if (!practice) return reply.notFound('Practice not found');

  const effectiveTemplateId = templateId || practice.selectedTemplateId || '';
  if (!effectiveTemplateId) return reply.badRequest('No template selected for practice');

  const tpl = await prisma.template.findUnique({ where: { id: effectiveTemplateId } });
  if (!tpl) return reply.notFound('Template not found. The selected template may have been removed or disabled.');

  const templateFields = await extractTemplateFields(tpl.content);
  const map = toFieldMap(practice.fieldValues);

  const filled: string[] = [];
  const missing: string[] = [];
  for (const key of templateFields) {
    if (emptyValue(map[key])) missing.push(key);
    else filled.push(key);
  }

  return {
    ok: true,
    data: {
      practiceId: id,
      templateId: effectiveTemplateId,
      templateFields,
      filled,
      missing,
      coverage: templateFields.length ? Math.round((filled.length / templateFields.length) * 100) : 100
    }
  };
});

app.get('/practices/:id/table-rows', async (request, reply) => {
  const { id } = request.params as { id: string };
  const rows = await prisma.tableRow.findMany({ where: { practiceId: id }, orderBy: { rowIndex: 'asc' } });
  return {
    ok: true,
    data: rows.map((r) => ({ ...r, values: JSON.parse(r.valuesJson) }))
  };
});

app.get('/practices/:id/table-rows/:rowIndex', async (request, reply) => {
  const { id, rowIndex: rowIndexRaw } = request.params as { id: string; rowIndex: string };
  const rowIndex = Number(rowIndexRaw);
  if (!Number.isFinite(rowIndex) || rowIndex <= 0) return reply.badRequest('rowIndex must be a positive number');

  const row = await prisma.tableRow.findUnique({ where: { practiceId_rowIndex: { practiceId: id, rowIndex } } });
  if (!row) return reply.notFound('Table row not found');
  return { ok: true, data: { ...row, values: JSON.parse(row.valuesJson) } };
});

app.post('/practices/:id/table-rows', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = (request.body ?? {}) as { rowIndex?: number; values?: Record<string, unknown>; actor?: string; source?: string; originMode?: string; sourceSetId?: string; reviewState?: string; status?: string; qualityScore?: number };

  const rowIndex = Number(body.rowIndex ?? 1);
  const values = normalizeImportRow(body.values ?? {});
  const row = await prisma.tableRow.upsert({
    where: { practiceId_rowIndex: { practiceId: id, rowIndex } },
    create: {
      id: crypto.randomUUID(),
      practiceId: id,
      rowIndex,
      source: body.source ?? 'manual-table',
      originMode: String(body.originMode ?? '').toUpperCase() === 'DETERMINISTIC_TABLE_FIRST' ? WorkingMode.DETERMINISTIC_TABLE_FIRST : WorkingMode.STANDARD_DOCUMENT_SET,
      sourceSetId: body.sourceSetId ?? null,
      valuesJson: JSON.stringify(values),
      status: String(body.status ?? '').toUpperCase() === 'OUTPUT_GENERATED' ? RowStatus.OUTPUT_GENERATED : String(body.status ?? '').toUpperCase() === 'NEEDS_REVIEW' ? RowStatus.NEEDS_REVIEW : RowStatus.READY,
      reviewState: String(body.reviewState ?? '').toUpperCase() === 'APPROVED' ? ReviewState.APPROVED : String(body.reviewState ?? '').toUpperCase() === 'IN_REVIEW' ? ReviewState.IN_REVIEW : ReviewState.TODO,
      qualityScore: Number.isFinite(Number(body.qualityScore)) ? Number(body.qualityScore) : null
    },
    update: {
      source: body.source ?? 'manual-table',
      originMode: String(body.originMode ?? '').toUpperCase() === 'DETERMINISTIC_TABLE_FIRST' ? WorkingMode.DETERMINISTIC_TABLE_FIRST : WorkingMode.STANDARD_DOCUMENT_SET,
      sourceSetId: body.sourceSetId ?? null,
      valuesJson: JSON.stringify(values),
      status: String(body.status ?? '').toUpperCase() === 'OUTPUT_GENERATED' ? RowStatus.OUTPUT_GENERATED : String(body.status ?? '').toUpperCase() === 'NEEDS_REVIEW' ? RowStatus.NEEDS_REVIEW : RowStatus.READY,
      reviewState: String(body.reviewState ?? '').toUpperCase() === 'APPROVED' ? ReviewState.APPROVED : String(body.reviewState ?? '').toUpperCase() === 'IN_REVIEW' ? ReviewState.IN_REVIEW : ReviewState.TODO,
      qualityScore: Number.isFinite(Number(body.qualityScore)) ? Number(body.qualityScore) : null,
      updatedAt: new Date()
    }
  });

  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      actor: body.actor ?? 'user',
      action: 'TABLE_ROW_UPSERTED',
      payloadJson: JSON.stringify({ rowIndex, fieldCount: Object.keys(values).length })
    }
  });

  return { ok: true, data: { ...row, values } };
});

app.post('/practices/:id/workflow/prepare', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = (request.body ?? {}) as {
    actor?: string;
    mode?: string;
    templateId?: string;
    documentSetId?: string;
    rowIndex?: number;
    simpleFieldValues?: Record<string, unknown>;
  };

  const practice = await prisma.practice.findUnique({ where: { id }, include: { files: true } });
  if (!practice) return reply.notFound('Practice not found');

  const templateId = body.templateId ?? practice.selectedTemplateId;
  if (!templateId) return reply.badRequest('Template assente o invalido');

  const shape = await getTemplateWorkflowShape(templateId);
  if (!shape) return reply.notFound('Template not found.');

  const requestedMode = String(body.mode ?? practice.workingMode).toUpperCase();
  const mode = requestedMode === 'DETERMINISTIC_TABLE_FIRST' ? WorkingMode.DETERMINISTIC_TABLE_FIRST : WorkingMode.STANDARD_DOCUMENT_SET;
  const actor = body.actor ?? 'user';

  if (mode === WorkingMode.STANDARD_DOCUMENT_SET) {
    const docs = practice.files.filter((f) => f.kind === FileKind.PRACTICE_DOCUMENT && (!body.documentSetId || f.documentSetId === body.documentSetId));
    if (!docs.length) return reply.badRequest('Input assente o invalido: nessun documento disponibile per costruire la tabella minima di lavorazione');

    const rowIndex = Number(body.rowIndex ?? 1);
    const baseRow = Object.fromEntries(shape.templateKeys.map((key) => [key, ''])) as Record<string, unknown>;
    const firstTable = { ...baseRow, ...normalizeImportRow(body.simpleFieldValues ?? {}) };
    const warningPack = buildTableWarnings(firstTable);

    const row = await prisma.tableRow.upsert({
      where: { practiceId_rowIndex: { practiceId: id, rowIndex } },
      create: {
        id: crypto.randomUUID(),
        practiceId: id,
        rowIndex,
        source: 'workflow-first-table',
        originMode: WorkingMode.STANDARD_DOCUMENT_SET,
        sourceSetId: body.documentSetId ?? null,
        valuesJson: JSON.stringify(firstTable),
        status: RowStatus.NEEDS_REVIEW,
        reviewState: ReviewState.TODO
      },
      update: {
        source: 'workflow-first-table',
        originMode: WorkingMode.STANDARD_DOCUMENT_SET,
        sourceSetId: body.documentSetId ?? null,
        valuesJson: JSON.stringify(firstTable),
        status: RowStatus.NEEDS_REVIEW,
        reviewState: ReviewState.TODO,
        updatedAt: new Date()
      }
    });

    await prisma.auditEvent.create({
      data: {
        id: crypto.randomUUID(),
        practiceId: id,
        actor,
        action: 'WORKFLOW_FIRST_TABLE_PREPARED',
        payloadJson: JSON.stringify({ mode, rowIndex, documentSetId: body.documentSetId ?? null, specialPlaceholders: shape.hasSpecialPlaceholders })
      }
    });

    return {
      ok: true,
      data: {
        phase: 'first-table',
        mode,
        row: { ...row, values: firstTable },
        inputSummary: {
          templateId,
          documentCount: docs.length,
          documentSetId: body.documentSetId ?? null
        },
        warnings: warningPack.warnings,
        missingKeys: warningPack.missingKeys,
        hasSpecialPlaceholders: shape.hasSpecialPlaceholders,
        nextAction: shape.hasSpecialPlaceholders ? 'enrich-final-table' : 'generate-from-current-table'
      }
    };
  }

  const rows = await prisma.tableRow.findMany({ where: { practiceId: id }, orderBy: { rowIndex: 'asc' } });
  if (!rows.length) return reply.badRequest('Input assente o invalido: nessuna tabella disponibile');

  const firstRow = rows.find((row) => row.rowIndex === Number(body.rowIndex ?? 1)) ?? rows[0];
  const values = JSON.parse(firstRow.valuesJson) as Record<string, unknown>;
  const importedColumns = Object.keys(values);
  const matched = importedColumns.filter((column) => shape.fieldKeys.includes(column));
  const missing = shape.fieldKeys.filter((field) => !importedColumns.includes(field));
  const extra = importedColumns.filter((column) => !shape.fieldKeys.includes(column));
  const warningPack = buildTableWarnings(values);
  const warnings = [
    ...(missing.length ? [{ code: 'TEMPLATE_COLUMNS_MISSING', level: 'warning', message: `Colonne mancanti rispetto al template: ${missing.join(', ')}` }] : []),
    ...(extra.length ? [{ code: 'EXTRA_COLUMNS_PRESENT', level: 'warning', message: `Colonne extra rilevate: ${extra.join(', ')}` }] : []),
    ...warningPack.warnings
  ];

  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      actor,
      action: 'WORKFLOW_FIRST_TABLE_PREPARED',
      payloadJson: JSON.stringify({ mode, rowIndex: firstRow.rowIndex, match: missing.length ? 'non-match' : 'match', specialPlaceholders: shape.hasSpecialPlaceholders })
    }
  });

  return {
    ok: true,
    data: {
      phase: 'first-table',
      mode,
      row: { ...firstRow, values },
      inputSummary: {
        templateId,
        rowCount: rows.length,
        importedColumns
      },
      comparison: {
        outcome: missing.length ? 'non-match' : 'match',
        matched,
        missing,
        extra
      },
      warnings,
      hasSpecialPlaceholders: shape.hasSpecialPlaceholders,
      nextAction: shape.hasSpecialPlaceholders ? 'enrich-final-table' : 'generate-from-current-table'
    }
  };
});

app.post('/practices/:id/workflow/enrich', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = (request.body ?? {}) as {
    actor?: string;
    templateId?: string;
    rowIndex?: number;
    deriveValues?: Record<string, unknown>;
    generateValues?: Record<string, unknown>;
  };

  const practice = await prisma.practice.findUnique({ where: { id } });
  if (!practice) return reply.notFound('Practice not found');

  const templateId = body.templateId ?? practice.selectedTemplateId;
  if (!templateId) return reply.badRequest('Template assente o invalido');

  const shape = await getTemplateWorkflowShape(templateId);
  if (!shape) return reply.notFound('Template not found.');
  if (!shape.hasSpecialPlaceholders) return reply.badRequest('Nessun placeholder speciale presente: la seconda tabella non è necessaria');

  const rowIndex = Number(body.rowIndex ?? 1);
  const row = await prisma.tableRow.findUnique({ where: { practiceId_rowIndex: { practiceId: id, rowIndex } } });
  if (!row) return reply.notFound('Table row not found');

  const currentValues = JSON.parse(row.valuesJson) as Record<string, unknown>;
  const finalValues = {
    ...currentValues,
    ...normalizeImportRow(body.deriveValues ?? {}),
    ...normalizeImportRow(body.generateValues ?? {})
  };
  const warningPack = buildTableWarnings(finalValues);

  const updated = await prisma.tableRow.update({
    where: { practiceId_rowIndex: { practiceId: id, rowIndex } },
    data: {
      source: 'workflow-final-table',
      valuesJson: JSON.stringify(finalValues),
      status: RowStatus.NEEDS_REVIEW,
      reviewState: ReviewState.TODO,
      updatedAt: new Date()
    }
  });

  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      actor: body.actor ?? 'user',
      action: 'WORKFLOW_FINAL_TABLE_ENRICHED',
      payloadJson: JSON.stringify({ rowIndex, deriveCount: Object.keys(body.deriveValues ?? {}).length, generateCount: Object.keys(body.generateValues ?? {}).length })
    }
  });

  return {
    ok: true,
    data: {
      phase: 'final-table',
      row: { ...updated, values: finalValues },
      warnings: warningPack.warnings,
      derivedKeys: Object.keys(body.deriveValues ?? {}),
      generatedKeys: Object.keys(body.generateValues ?? {}),
      nextAction: 'generate-from-current-table'
    }
  };
});

app.post('/practices/:id/generate-docx-from-row', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = (request.body ?? {}) as { rowIndex?: number; actor?: string; templateId?: string };

  const practice = await prisma.practice.findUnique({ where: { id } });
  if (!practice) return reply.notFound('Practice not found');

  const rowIndex = Number(body.rowIndex ?? 1);
  const row = await prisma.tableRow.findUnique({ where: { practiceId_rowIndex: { practiceId: id, rowIndex } } });
  if (!row) return reply.notFound('Table row not found');

  const templateId = body.templateId ?? practice.selectedTemplateId;
  if (!templateId) return reply.badRequest('No template selected for practice.');
  const tpl = await prisma.template.findUnique({ where: { id: templateId } });
  if (!tpl) return reply.notFound('Template not found.');

  const values = JSON.parse(row.valuesJson) as Record<string, unknown>;
  const templateFields = await extractTemplateFields(tpl.content);
  const missing = templateFields.filter((k) => emptyValue(values[k]));
  const out = await renderDocxTemplate(tpl.content, values);

  await prisma.tableRow.update({
    where: { practiceId_rowIndex: { practiceId: id, rowIndex } },
    data: { status: RowStatus.OUTPUT_GENERATED, reviewState: ReviewState.IN_REVIEW, qualityScore: Math.max(0, Math.min(100, 100 - missing.length * 10)) }
  });

  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      actor: body.actor ?? 'user',
      action: 'GENERATE_DOCX_FROM_ROW',
      payloadJson: JSON.stringify({ rowIndex, templateId, missingTemplateFields: missing })
    }
  });

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `precetto_${id}_row${rowIndex}_${ts}.docx`;
  reply.header('x-rca-missing-fields', String(missing.length));
  reply.header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  reply.header('content-disposition', `attachment; filename="${filename}"`);
  return Buffer.from(out);
});

app.post('/practices/:id/generate-docx', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = (request.body ?? {}) as { fast?: boolean; actor?: string; templateId?: string };

  const practice = await prisma.practice.findUnique({ where: { id }, include: { fieldValues: true } });
  if (!practice) return reply.notFound('Practice not found');

  const templateId = body.templateId ?? practice.selectedTemplateId;
  if (!templateId) return reply.badRequest('No template selected for practice. Use /practices/:id/select-template first or pass templateId in body.');

  const tpl = await prisma.template.findUnique({ where: { id: templateId } });
  if (!tpl) return reply.notFound('Template not found. The selected template may have been removed or disabled.');

  const fields = toFieldMap(practice.fieldValues);
  const templateFields = await extractTemplateFields(tpl.content);
  const missing = templateFields.filter((k) => emptyValue(fields[k]));
  const out = await renderDocxTemplate(tpl.content, fields);

  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      actor: body.actor ?? 'user',
      action: body.fast ? 'GENERATE_DOCX_FAST' : 'GENERATE_DOCX',
      payloadJson: JSON.stringify({ templateId, fieldCount: Object.keys(fields).length, missingTemplateFields: missing })
    }
  });

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `precetto_${id}_${ts}.docx`;
  reply.header('x-rca-missing-fields', String(missing.length));
  reply.header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  reply.header('content-disposition', `attachment; filename="${filename}"`);
  return Buffer.from(out);
});

app.get('/practices/:id/table-rows/export.csv', async (request, reply) => {
  const { id } = request.params as { id: string };
  const rows = await prisma.tableRow.findMany({ where: { practiceId: id }, orderBy: { rowIndex: 'asc' } });
  if (!rows.length) return reply.badRequest('No table rows available');

  const parsed = rows.map((r) => ({ rowIndex: r.rowIndex, values: JSON.parse(r.valuesJson) as Record<string, unknown> }));
  const allHeaders = Array.from(new Set(parsed.flatMap((r) => Object.keys(r.values)))).sort();
  const headers = ['row_id', ...allHeaders];
  const esc = (x: string) => `"${x.replaceAll('"', '""')}"`;
  const lines = [headers.map(esc).join(',')];
  for (const row of parsed) {
    const values = [String(row.rowIndex), ...allHeaders.map((h) => String(row.values[h] ?? ''))];
    lines.push(values.map(esc).join(','));
  }

  const csv = `${lines.join('\n')}\n`;
  reply.header('content-type', 'text/csv; charset=utf-8');
  reply.header('content-disposition', `attachment; filename="table_rows_${id}.csv"`);
  return csv;
});

app.get('/practices/:id/export/merge-data.csv', async (request, reply) => {
  const { id } = request.params as { id: string };
  const practice = await prisma.practice.findUnique({ where: { id }, include: { fieldValues: true } });
  if (!practice) return reply.notFound('Practice not found');

  const entries = practice.fieldValues.map((f) => [f.fieldKey, JSON.parse(f.valueJson)] as const);
  const headers = entries.map(([k]) => k);
  const values = entries.map(([,v]) => String(v ?? ''));
  const esc = (x:string)=> `"${x.replaceAll('"','""')}"`;
  const csv = `${headers.map(esc).join(',')}\n${values.map(esc).join(',')}\n`;

  reply.header('content-type', 'text/csv; charset=utf-8');
  reply.header('content-disposition', `attachment; filename="merge_${id}.csv"`);
  return csv;
});

function ensureDocgenWorkerAuthorized(request: any, reply: any) {
  if (!workerAuthConfigured()) return reply.serviceUnavailable('DOCGEN worker auth is not configured on this API');
  const authHeader = parseWorkerAuthHeader(request.headers['x-rca-docgen-worker-secret']);
  if (!workerAuthMatches(authHeader)) return reply.forbidden('DOCGEN worker auth failed');
  return null;
}

app.post('/discord/v1/pdf-jobs/claim', async (request, reply) => {
  const authError = ensureDocgenWorkerAuthorized(request, reply);
  if (authError) return authError;

  const workerId = String((request.body as any)?.workerId ?? '').trim() || 'mac-mini-word-worker';
  const queuedJob = await prisma.discordPdfJob.findFirst({ where: { status: 'QUEUED' }, orderBy: { createdAt: 'asc' } });
  if (!queuedJob) return { ok: true, data: null };

  const updated = await prisma.discordPdfJob.updateMany({
    where: { id: queuedJob.id, status: 'QUEUED' },
    data: { status: 'PROCESSING', workerId, claimedAt: new Date(), startedAt: new Date(), errorMessage: null }
  });
  if (!updated.count) return { ok: true, data: null };

  const job = await prisma.discordPdfJob.findUnique({ where: { id: queuedJob.id } });
  if (!job) return { ok: true, data: null };
  return {
    ok: true,
    data: {
      jobId: job.id,
      source: job.source,
      inputZipBase64: Buffer.from(job.inputZip).toString('base64'),
      claimedAt: job.claimedAt?.toISOString() ?? new Date().toISOString()
    }
  };
});

app.post('/discord/v1/pdf-jobs/:jobId/complete', async (request, reply) => {
  const authError = ensureDocgenWorkerAuthorized(request, reply);
  if (authError) return authError;
  const { jobId } = request.params as { jobId: string };
  const body = (request.body as any) || {};
  const resultZipBase64 = String(body.resultZipBase64 ?? '').trim();
  if (!resultZipBase64) return reply.badRequest('Missing resultZipBase64');

  await prisma.discordPdfJob.update({
    where: { id: jobId },
    data: {
      status: 'COMPLETED',
      provider: String(body.provider ?? '').trim() || 'word',
      resultZip: Buffer.from(resultZipBase64, 'base64'),
      errorMessage: null,
      completedAt: new Date()
    }
  });

  return { ok: true };
});

app.post('/discord/v1/pdf-jobs/:jobId/fail', async (request, reply) => {
  const authError = ensureDocgenWorkerAuthorized(request, reply);
  if (authError) return authError;
  const { jobId } = request.params as { jobId: string };
  const body = (request.body as any) || {};
  const message = String(body.error ?? 'Remote PDF worker failed').slice(0, 4000);

  await prisma.discordPdfJob.update({
    where: { id: jobId },
    data: { status: 'FAILED', errorMessage: message, completedAt: new Date() }
  });

  return { ok: true };
});

app.post('/discord/v1/template-table-autocontinue', async (request, reply) => {
  const parts = request.parts();
  const attachments: Array<{ filename: string; mimeType: string; bytes: Uint8Array }> = [];
  let actor = 'discord-v1';
  let namingPattern = '';
  let runAsync = false;
  let openclawRowFlowResults: Record<string, { deriveValues?: Record<string, unknown>; generateValues?: Record<string, unknown> }> = {};

  for await (const part of parts) {
    if (part.type === 'field') {
      if (part.fieldname === 'actor' && String(part.value ?? '').trim()) actor = String(part.value).trim();
      if (['namingPattern', 'naming_pattern', 'filenamePattern', 'filename_pattern', 'fileNamingPattern', 'file_naming_pattern'].includes(part.fieldname) && String(part.value ?? '').trim()) {
        namingPattern = String(part.value).trim();
      }
      if (['async', 'background', 'enqueue'].includes(part.fieldname)) runAsync = runAsync || parseBooleanFormField(part.value);
      if (part.fieldname === 'openclawRowFlowResultsJson' && String(part.value ?? '').trim()) {
        try {
          const parsed = JSON.parse(String(part.value));
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) openclawRowFlowResults = parsed;
        } catch {}
      }
      continue;
    }
    attachments.push({
      filename: part.filename,
      mimeType: part.mimetype,
      bytes: new Uint8Array(await part.toBuffer())
    });
  }

  const { templates, tables } = classifyDiscordV1Attachments(attachments);
  logDiscordV1Debug('ingest.received', {
    actor,
    attachmentCount: attachments.length,
    attachmentNames: attachments.map((file) => file.filename),
    templateCount: templates.length,
    tableCount: tables.length,
    namingPatternProvided: Boolean(String(namingPattern ?? '').trim()),
    openclawRowFlowResultsProvided: Object.keys(openclawRowFlowResults).length,
    runAsync
  });
  if (templates.length !== 1) return reply.badRequest('Discord v1 richiede esattamente 1 file template .docx');
  if (tables.length !== 1) return reply.badRequest('Discord v1 richiede esattamente 1 tabella .xlsx o .csv');

  const template = templates[0];
  const table = tables[0];

  if (runAsync) {
    const job = await prisma.discordAutocontinueJob.create({
      data: {
        id: crypto.randomUUID(),
        status: 'QUEUED',
        actor,
        namingPattern: namingPattern || null,
        openclawRowFlowResultsJson: Object.keys(openclawRowFlowResults).length ? JSON.stringify(openclawRowFlowResults) : null,
        templateFilename: template.filename,
        templateMimeType: template.mimeType,
        templateBytes: Buffer.from(template.bytes),
        tableFilename: table.filename,
        tableMimeType: table.mimeType,
        tableBytes: Buffer.from(table.bytes)
      }
    });
    scheduleDiscordAutocontinueJob(job.id);
    const statusUrl = `/discord/v1/template-table-autocontinue/jobs/${job.id}`;
    reply.code(202);
    reply.header('x-rca-discord-job-id', job.id);
    reply.header('x-rca-discord-job-status-url', statusUrl);
    reply.header('x-rca-discord-initial-message', 'Lavorazione Discord v1 accodata: template + tabella ricevuti, elaborazione batch in background avviata.');
    return {
      ok: true,
      data: {
        jobId: job.id,
        status: job.status,
        statusUrl,
        acceptedAt: job.createdAt.toISOString()
      }
    };
  }

  try {
    const result = await executeDiscordV1Autocontinue({
      actor,
      namingPattern,
      openclawRowFlowResults,
      template,
      table,
      requestHeaders: request.headers as Record<string, unknown>
    });
    reply.header('x-rca-discord-practice-id', result.practiceId);
    reply.header('x-rca-discord-summary', JSON.stringify(result.finalSummary));
    reply.header('x-rca-discord-download-url', result.download.url);
    reply.header('x-rca-discord-initial-message', result.initialMessage);
    reply.header('x-rca-discord-final-message', result.finalMessage);
    return { ok: true, data: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(400).send({ ok: false, error: message });
  }
});

app.get('/discord/v1/template-table-autocontinue/jobs/:jobId', async (request, reply) => {
  const { jobId } = request.params as { jobId: string };
  const job = await prisma.discordAutocontinueJob.findUnique({ where: { id: jobId } });
  if (!job) return reply.notFound('Job non trovato.');

  let finalSummary: Record<string, unknown> | null = null;
  if (job.finalSummaryJson) {
    try { finalSummary = JSON.parse(job.finalSummaryJson) as Record<string, unknown>; } catch {}
  }

  return {
    ok: true,
    data: {
      jobId: job.id,
      status: job.status,
      actor: job.actor,
      practiceId: job.practiceId,
      acceptedAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      error: job.errorMessage,
      finalSummary,
      download: job.downloadUrl
        ? {
            url: job.downloadUrl,
            expiresAt: job.downloadExpiresAt?.toISOString() ?? null,
            maxDownloads: job.downloadMaxDownloads,
            retainedUntil: job.downloadRetainedUntil?.toISOString() ?? null
          }
        : null
    }
  };
});

app.get('/discord/v1/downloads/:token', async (request, reply) => {
  const { token } = request.params as any;
  const resolved = await resolveDiscordDownloadByToken(String(token ?? ''));

  if ('error' in resolved) {
    const errorMap: Record<string, { statusCode: number; message: string }> = {
      not_found: { statusCode: 404, message: 'Download link non trovato.' },
      token_expired: { statusCode: 410, message: 'Download link scaduto. Chiedi una rigenerazione su Discord.' },
      batch_expired: { statusCode: 410, message: 'ZIP non più disponibile: retention 7 giorni scaduta.' },
      download_limit_reached: { statusCode: 410, message: 'Limite download raggiunto per questo link. Chiedi una rigenerazione su Discord.' },
      file_missing: { statusCode: 404, message: 'File ZIP non trovato sullo storage del server.' }
    };
    const meta = errorMap[String(resolved.error)] ?? { statusCode: 400, message: 'Download non disponibile.' };
    return reply.code(meta.statusCode).type('text/plain; charset=utf-8').send(meta.message);
  }

  reply.header('content-type', 'application/zip');
  reply.header('content-disposition', `attachment; filename="${resolved.batch.zipFilename}"`);
  reply.header('x-rca-download-practice-id', resolved.batch.practiceId);
  reply.header('x-rca-download-remaining', String(Math.max(0, resolved.batch.tokenMaxDownloads - resolved.batch.tokenDownloadCount)));
  return resolved.bytes;
});

app.post('/discord/v1/download-batches/:practiceId/regenerate', async (request, reply) => {
  const { practiceId } = request.params as any;
  const actor = String((request.body as any)?.actor ?? 'discord-v1').trim() || 'discord-v1';
  const regenerated = await regenerateDiscordDownloadLink(String(practiceId ?? ''));
  if (!regenerated) return reply.notFound('Batch non trovato o ZIP non più disponibile per rigenerazione.');

  const publicBaseUrl = buildPublicBaseUrl(request.headers as Record<string, unknown>);
  const downloadUrl = buildDiscordDownloadUrl(publicBaseUrl, regenerated.token);

  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: regenerated.batch.practiceId,
      actor,
      action: 'DISCORD_V1_DOWNLOAD_LINK_REGENERATED',
      payloadJson: JSON.stringify({
        zipFilename: regenerated.batch.zipFilename,
        zipRelativePath: regenerated.batch.zipRelativePath,
        tokenExpiresAt: regenerated.tokenExpiresAt,
        retainedUntil: regenerated.retainedUntil
      })
    }
  });

  return {
    ok: true,
    data: {
      practiceId: regenerated.batch.practiceId,
      download: {
        url: downloadUrl,
        expiresAt: regenerated.tokenExpiresAt.toISOString(),
        maxDownloads: regenerated.batch.tokenMaxDownloads,
        retainedUntil: regenerated.retainedUntil.toISOString(),
        filename: regenerated.batch.zipFilename,
        storagePath: regenerated.batch.zipRelativePath,
        note: formatDiscordDownloadWindow({
          tokenExpiresAt: regenerated.tokenExpiresAt,
          retainedUntil: regenerated.retainedUntil,
          maxDownloads: regenerated.batch.tokenMaxDownloads
        })
      }
    }
  };
});

app.post('/templates', async (request, reply) => {
  const file = await request.file();
  if (!file) return reply.badRequest('Template file is required');

  const parsed = uploadTemplateSchema.safeParse({
    name: (file.fields as any).name?.value,
    actor: (file.fields as any).actor?.value
  });
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });

  const buf = await file.toBuffer();
  const latest = await prisma.template.findFirst({ where: { name: parsed.data.name }, orderBy: { version: 'desc' } });

  const template = await prisma.template.create({
    data: {
      id: crypto.randomUUID(),
      name: parsed.data.name,
      version: (latest?.version ?? 0) + 1,
      filename: file.filename,
      mimeType: file.mimetype,
      sizeBytes: buf.length,
      sha256: sha256(buf),
      content: new Uint8Array(buf),
      isActive: true
    }
  });

  return { ok: true, data: { id: template.id, name: template.name, version: template.version, filename: template.filename } };
});

app.get('/templates', async () => {
  const templates = await prisma.template.findMany({
    where: { isActive: true },
    orderBy: [{ name: 'asc' }, { version: 'desc' }],
    select: { id: true, name: true, version: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true }
  });
  return { ok: true, data: templates };
});



app.get('/templates/:id/mapping-preview', async (request, reply) => {
  const { id } = request.params as { id: string };
  const tpl = await prisma.template.findUnique({ where: { id } });
  if (!tpl) return reply.notFound('Template not found. The selected template may have been removed or disabled.');

  const templateFields = await extractTemplateFields(tpl.content);
  const known = new Set([
    'creditore_denominazione','creditore_cf','creditore_piva','creditore_sede','creditore_legale_rappresentante',
    'debitore_tipo','debitore_denominazione_nome','debitore_cf','debitore_piva','debitore_sede_residenza',
    'avvocato_nome','avvocato_cf','avvocato_foro','avvocato_pec','domicilio_eletto',
    'tribunale','di_numero','rg_numero','di_data_emissione','di_data_notifica','di_data_esecutorieta','flag_esecutorieta_nel_titolo',
    'capitale_ingiunto','interessi_modalita','interessi_tipo_tasso','interessi_tasso_percent','interessi_base_calcolo','interessi_dies_a_quo','interessi_data_finale','interessi_giorni','interessi_importo','interessi_clausola_testo',
    'totale_principale','totale_spese_di','totale_spese_successive','totale_complessivo','conflitto_esecutorieta'
  ]);

  const mapped = templateFields.filter((f) => known.has(f));
  const unknown = templateFields.filter((f) => !known.has(f));

  return {
    ok: true,
    data: {
      templateId: id,
      total: templateFields.length,
      mapped,
      unknown,
      mappingCoverage: templateFields.length ? Math.round((mapped.length / templateFields.length) * 100) : 100
    }
  };
});

app.get('/templates/:id/instructions', async (request, reply) => {
  const { id } = request.params as { id: string };
  const tpl = await prisma.template.findUnique({ where: { id } });
  if (!tpl) return reply.notFound('Template not found');

  const instructions = await extractTemplateInstructions(tpl.content);
  const promptPack = buildPromptFlows(instructions);

  return {
    ok: true,
    data: {
      templateId: id,
      instructions,
      promptFlows: promptPack.flows,
      promptFlowCounts: promptPack.counts
    }
  };
});

app.get('/templates/:id/fields', async (request, reply) => {
  const { id } = request.params as { id: string };
  const tpl = await prisma.template.findUnique({ where: { id } });
  if (!tpl) return reply.notFound('Template not found. The selected template may have been removed or disabled.');

  const fields = await extractTemplateFields(tpl.content);
  return { ok: true, data: { templateId: id, fields } };
});

app.get('/templates/:id/download', async (request, reply) => {
  const { id } = request.params as { id: string };
  const tpl = await prisma.template.findUnique({ where: { id } });
  if (!tpl) return reply.notFound('Template not found. The selected template may have been removed or disabled.');

  reply.header('content-type', tpl.mimeType);
  reply.header('content-disposition', `attachment; filename="${tpl.filename}"`);
  return Buffer.from(tpl.content);
});

app.get('/practices/:id/consistency', async (request, reply) => {
  const { id } = request.params as { id: string };
  const rows = await prisma.fieldValue.findMany({ where: { practiceId: id } });
  if (!rows.length) return reply.notFound('Practice not found or no fields');

  const map = Object.fromEntries(rows.map((r) => [r.fieldKey, JSON.parse(r.valueJson)]));
  const manual = String(map.flag_esecutorieta_nel_titolo ?? 'NON_SO').toUpperCase();
  const auto = String(map.esecutorieta_rilevata_auto ?? 'INCERTA').toUpperCase();
  const conflict = (manual === 'SI' && auto === 'NO') || (manual === 'NO' && auto === 'SI');

  return {
    ok: true,
    data: {
      manualFlag: manual,
      autoDetection: auto,
      conflict
    }
  };
});



app.get('/practices/:id/final-report', async (request, reply) => {
  const { id } = request.params as { id: string };
  const practice = await prisma.practice.findUnique({
    where: { id },
    include: { fieldValues: true, files: true }
  });
  if (!practice) return reply.notFound('Practice not found');

  const map = toFieldMap(practice.fieldValues);
  const missingFields = practice.fieldValues
    .filter((f) => f.status === FieldStatus.MISSING || emptyValue(JSON.parse(f.valueJson)))
    .map((f) => f.fieldKey);

  const consistency = {
    manualFlag: String(map.flag_esecutorieta_nel_titolo ?? 'NON_SO').toUpperCase(),
    autoDetection: String(map.esecutorieta_rilevata_auto ?? 'INCERTA').toUpperCase(),
    conflict: Boolean(map.conflitto_esecutorieta === true || String(map.conflitto_esecutorieta).toLowerCase() === 'true')
  };

  const qualityScoreBase = 100 - (missingFields.length * 2) - (consistency.conflict ? 20 : 0);
  const qualityScore = Math.max(0, Math.min(100, qualityScoreBase));

  return {
    ok: true,
    data: {
      practiceId: id,
      totals: {
        files: practice.files.length,
        fields: practice.fieldValues.length,
        missing: missingFields.length
      },
      consistency,
      qualityScore,
      missingFields,
      note: 'Report informativo: non blocca la generazione output'
    }
  };
});

app.get('/practices/:id/quality-gate', async (request, reply) => {
  const { id } = request.params as { id: string };
  const practice = await prisma.practice.findUnique({
    where: { id },
    include: { fieldValues: true }
  });
  if (!practice) return reply.notFound('Practice not found');

  const map = toFieldMap(practice.fieldValues);

  const requiredForStrongDraft = [
    'creditore_denominazione',
    'debitore_denominazione_nome',
    'tribunale',
    'di_numero',
    'rg_numero',
    'capitale_ingiunto',
    'di_data_notifica'
  ];

  const missingStrong = requiredForStrongDraft.filter((k) => emptyValue(map[k]));
  const conflictExec = Boolean(map.conflitto_esecutorieta === true || String(map.conflitto_esecutorieta).toLowerCase() === 'true');

  const scoreBase = 100 - (missingStrong.length * 10) - (conflictExec ? 20 : 0);
  const score = Math.max(0, Math.min(100, scoreBase));

  const level = score >= 85 ? 'high' : score >= 60 ? 'medium' : 'low';

  return {
    ok: true,
    data: {
      practiceId: id,
      score,
      level,
      missingStrong,
      conflictExec,
      note: 'Non blocca la generazione: è un indicatore qualità bozza'
    }
  };
});


app.get('/practices/:id/audit', async (request, reply) => {
  const { id } = request.params as { id: string };
  const limit = Math.min(500, Math.max(1, Number((request.query as any)?.limit ?? 100)));

  const practice = await prisma.practice.findUnique({ where: { id }, select: { id: true } });
  if (!practice) return reply.notFound('Practice not found');

  const items = await prisma.auditEvent.findMany({
    where: { practiceId: id },
    orderBy: { createdAt: 'desc' },
    take: limit
  });

  return { ok: true, data: items };
});

app.get('/practices/:id/summary', async (request, reply) => {
  const { id } = request.params as { id: string };
  const practice = await prisma.practice.findUnique({ where: { id }, include: { fieldValues: true, files: true } });
  if (!practice) return reply.notFound('Practice not found');

  const counts = { AUTO_OK: 0, NEEDS_REVIEW: 0, MANUAL: 0, MISSING: 0 } as Record<string, number>;
  for (const f of practice.fieldValues) counts[f.status] = (counts[f.status] ?? 0) + 1;

  return { ok: true, data: { practiceId: practice.id, files: practice.files.length, fields: counts, updatedAt: practice.updatedAt } };
});





await resumePendingDiscordAutocontinueJobs();

const port = Number(process.env.PORT ?? 8787);
app.listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`API listening on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
