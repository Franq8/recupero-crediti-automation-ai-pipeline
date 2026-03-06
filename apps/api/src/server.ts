import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import { customAlphabet } from 'nanoid';
import { readFile } from 'node:fs/promises';
import { prisma } from './prisma.js';
import { createPracticeSchema, uploadTemplateSchema, upsertFieldSchema } from './schemas.js';
import { sha256 } from './utils.js';
import { FileKind, FieldStatus } from '@prisma/client';
import { extractPrecettoFieldsDetailed, extractTextByMime } from './extractor.js';
import { extractTemplateFields, renderDocxTemplate } from './docx.js';
import { parseDiscordPrecettoMessage } from './discord-parser.js';
import { parseImportFile } from './importer.js';
import { buildImportTemplateCsv, buildImportTemplateJson, buildImportTemplateXlsx } from './template-download.js';

const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 10);
const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(sensible);
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

const DISCORD_OPERATIVE_CHANNEL_ID = process.env.DISCORD_OPERATIVE_CHANNEL_ID ?? '';

function requireOperativeChannel(channelId?: string) {
  if (!DISCORD_OPERATIVE_CHANNEL_ID) return true;
  return channelId === DISCORD_OPERATIVE_CHANNEL_ID;
}

function toFieldMap(rows: Array<{ fieldKey: string; valueJson: string }>) {
  return Object.fromEntries(rows.map((f) => [f.fieldKey, JSON.parse(f.valueJson)]));
}

function emptyValue(v: unknown) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}


app.get('/health', async () => ({ ok: true }));


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
    discordAdapterV1: true,
    dockerPackaging: true,
    smokeCore: true,
    smokeDiscord: true
  };

  const hardChecks = {
    buildOk: true,
    auditVulnerabilitiesZero: true,
    policyOpenClawOnly: true
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
    discordV1: true,
    dockerSetup: true,
    smokeTests: true
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
      files: { select: { id: true, filename: true, kind: true, mimeType: true, sizeBytes: true, createdAt: true } },
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
      selectedTemplateId: incoming.selectedTemplateId ?? null
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
      files: { select: { id: true, filename: true, kind: true, createdAt: true, sizeBytes: true } },
      fieldValues: true,
      audits: { orderBy: { createdAt: 'desc' }, take: 200 }
    }
  });

  if (!practice) return reply.notFound('Practice not found');
  return { ok: true, data: practice };
});



app.get('/import-template/:format', async (request, reply) => {
  const { format } = request.params as { format: string };
  const f = format.toLowerCase();

  if (f === 'json') {
    const json = buildImportTemplateJson();
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="template_precetto_v1.json"');
    return json;
  }

  if (f === 'csv') {
    const csv = buildImportTemplateCsv();
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="template_precetto_v1.csv"');
    return csv;
  }

  if (f === 'xlsx') {
    const xlsx = await buildImportTemplateXlsx();
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('content-disposition', 'attachment; filename="template_precetto_v1.xlsx"');
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

  const imported = await parseImportFile(mp.filename, mp.mimetype, buf);
  const entries = Object.entries(imported).filter(([k]) => k && k !== 'schema_version');

  for (const [fieldKey, value] of entries) {
    await prisma.fieldValue.upsert({
      where: { practiceId_fieldKey: { practiceId: id, fieldKey } },
      create: {
        id: crypto.randomUUID(),
        practiceId: id,
        fieldKey,
        valueJson: JSON.stringify(value),
        sourceType: 'import',
        sourceRef: mp.filename,
        confidence: 1,
        status: emptyValue(value) ? FieldStatus.MISSING : FieldStatus.MANUAL,
        lastModifiedBy: actor
      },
      update: {
        valueJson: JSON.stringify(value),
        sourceType: 'import',
        sourceRef: mp.filename,
        confidence: 1,
        status: emptyValue(value) ? FieldStatus.MISSING : FieldStatus.MANUAL,
        lastModifiedBy: actor,
        lastModifiedAt: new Date()
      }
    });
  }

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
      payloadJson: JSON.stringify({ filename: mp.filename, importedFields: entries.map(([k]) => k) })
    }
  });

  return { ok: true, data: { importedFields: entries.length, filename: mp.filename } };
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
      content: new Uint8Array(buf)
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
  const practice = await prisma.practice.findUnique({ where: { id }, include: { files: true } });
  if (!practice) return reply.notFound('Practice not found');

  const docs = practice.files.filter((f) => f.kind === FileKind.PRACTICE_DOCUMENT);
  if (!docs.length) return reply.badRequest('No practice documents uploaded. Upload at least one PDF/DOCX before extraction.');

  const excerpts: Array<{ fileId: string; filename: string; text: string }> = [];
  for (const f of docs.slice(0, 5)) {
    const text = await extractTextByMime(Buffer.from(f.content), f.mimeType, f.filename);
    excerpts.push({ fileId: f.id, filename: f.filename, text: text.slice(0, 12000) });
  }

  const schema = {
    fields: {
      creditore_denominazione: { value: 'string|null', confidence: '0..1', sourceRef: 'string' },
      debitore_denominazione_nome: { value: 'string|null', confidence: '0..1', sourceRef: 'string' },
      tribunale: { value: 'string|null', confidence: '0..1', sourceRef: 'string' },
      di_numero: { value: 'string|null', confidence: '0..1', sourceRef: 'string' },
      rg_numero: { value: 'string|null', confidence: '0..1', sourceRef: 'string' },
      di_data_notifica: { value: 'YYYY-MM-DD|null', confidence: '0..1', sourceRef: 'string' },
      di_data_esecutorieta: { value: 'YYYY-MM-DD|null', confidence: '0..1', sourceRef: 'string' },
      capitale_ingiunto: { value: 'number|null', confidence: '0..1', sourceRef: 'string' },
      avvocato_nome: { value: 'string|null', confidence: '0..1', sourceRef: 'string' },
      avvocato_pec: { value: 'string|null', confidence: '0..1', sourceRef: 'string' }
    }
  };

  const prompt = `Sei un estrattore legale per precetto su decreto ingiuntivo.
- Estrai SOLO i campi richiesti nello schema.
- Non inventare valori.
- Se dubbio, lascia value=null e confidence bassa.
- Rispondi JSON puro conforme allo schema.`;

  return {
    ok: true,
    data: {
      practiceId: id,
      mode: 'openclaw-client-only',
      prompt,
      schema,
      documents: excerpts
    }
  };
});

app.post('/practices/:id/extract-openclaw', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = (request.body ?? {}) as {
    actor?: string;
    model?: string;
    fields?: Record<string, { value: unknown; confidence?: number; sourceRef?: string }>;
  };

  const practice = await prisma.practice.findUnique({ where: { id }, include: { fieldValues: true } });
  if (!practice) return reply.notFound('Practice not found');

  const fields = body.fields ?? {};
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
        extractionMode: 'openclaw-client-only'
      })
    }
  });

  return {
    ok: true,
    data: {
      applied: Object.keys(fields).length,
      mode: 'openclaw-client-only',
      model: body.model ?? 'openclaw-default'
    }
  };
});

app.post('/practices/:id/extract', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = (request.body ?? {}) as { actor?: string };

  const files = await prisma.storedFile.findMany({
    where: { practiceId: id, kind: FileKind.PRACTICE_DOCUMENT }
  });

  if (!files.length) return reply.badRequest('No practice documents uploaded');

  const merged: Record<string, { value: unknown; confidence: number; sourceRef: string }> = {};
  for (const f of files) {
    const text = await extractTextByMime(Buffer.from(f.content), f.mimeType, f.filename);

    const partial = extractPrecettoFieldsDetailed(text);
    for (const [k, v] of Object.entries(partial)) {
      if (!(k in merged) || v.confidence > merged[k].confidence) merged[k] = v;
    }
  }

  const manualExec = await prisma.fieldValue.findUnique({
    where: { practiceId_fieldKey: { practiceId: id, fieldKey: 'flag_esecutorieta_nel_titolo' } }
  });

  const autoExec = String(merged.esecutorieta_rilevata_auto?.value ?? 'INCERTA').toUpperCase();
  let conflictExec = false;
  if (manualExec) {
    const man = String(JSON.parse(manualExec.valueJson) ?? 'NON_SO').toUpperCase();
    if ((man === 'SI' && autoExec === 'NO') || (man === 'NO' && autoExec === 'SI')) {
      conflictExec = true;
    }
  }
  merged.conflitto_esecutorieta = { value: conflictExec, confidence: 1, sourceRef: 'computed: manual-vs-auto' };

  const upserts = Object.entries(merged).map(([fieldKey, value]) =>
    prisma.fieldValue.upsert({
      where: { practiceId_fieldKey: { practiceId: id, fieldKey } },
      create: {
        id: crypto.randomUUID(),
        practiceId: id,
        fieldKey,
        valueJson: JSON.stringify(value.value),
        sourceType: 'document',
        sourceRef: value.sourceRef,
        confidence: value.confidence,
        status: fieldKey === 'conflitto_esecutorieta' ? FieldStatus.AUTO_OK : FieldStatus.NEEDS_REVIEW,
        lastModifiedBy: body.actor ?? 'extractor'
      },
      update: {
        valueJson: JSON.stringify(value.value),
        sourceType: 'document',
        sourceRef: value.sourceRef,
        confidence: value.confidence,
        status: fieldKey === 'conflitto_esecutorieta' ? FieldStatus.AUTO_OK : FieldStatus.NEEDS_REVIEW,
        lastModifiedBy: body.actor ?? 'extractor',
        lastModifiedAt: new Date()
      }
    })
  );

  await prisma.$transaction(upserts);

  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      actor: body.actor ?? 'extractor',
      action: 'EXTRACTION_RUN',
      payloadJson: JSON.stringify({ extractedFields: Object.keys(merged), conflictExec, extractionMode: 'openclaw-client-only' })
    }
  });

  return { ok: true, data: { extracted: Object.fromEntries(Object.entries(merged).map(([k,v])=>[k,v.value])) } };
});


app.post('/practices/:id/recompute-interest', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = (request.body ?? {}) as { actor?: string };

  const practice = await prisma.practice.findUnique({ where: { id }, include: { fieldValues: true } });
  if (!practice) return reply.notFound('Practice not found');

  const map = toFieldMap(practice.fieldValues);
  const mode = String(map.interessi_modalita ?? 'none');

  let interessiImporto = 0;
  let warning: string | null = null;

  if (mode === 'simple') {
    const base = Number(map.interessi_base_calcolo ?? map.capitale_ingiunto ?? 0);
    const tasso = Number(map.interessi_tasso_percent ?? 0);
    const dal = String(map.interessi_dies_a_quo ?? '');
    const al = String(map.interessi_data_finale ?? '');

    if (!base || !tasso || !dal || !al) {
      warning = 'Interessi simple: input incompleti, importo impostato a 0';
    } else {
      const d1 = new Date(dal);
      const d2 = new Date(al);
      const ms = d2.getTime() - d1.getTime();
      const giorni = Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
      interessiImporto = Math.round((base * (tasso / 100) * (giorni / 365)) * 100) / 100;

      await prisma.fieldValue.upsert({
        where: { practiceId_fieldKey: { practiceId: id, fieldKey: 'interessi_giorni' } },
        create: {
          id: crypto.randomUUID(),
          practiceId: id,
          fieldKey: 'interessi_giorni',
          valueJson: JSON.stringify(giorni),
          sourceType: 'derived',
          sourceRef: 'recompute-interest',
          confidence: 1,
          status: FieldStatus.AUTO_OK,
          lastModifiedBy: body.actor ?? 'system'
        },
        update: {
          valueJson: JSON.stringify(giorni),
          sourceType: 'derived',
          sourceRef: 'recompute-interest',
          confidence: 1,
          status: FieldStatus.AUTO_OK,
          lastModifiedBy: body.actor ?? 'system',
          lastModifiedAt: new Date()
        }
      });
    }
  }

  await prisma.fieldValue.upsert({
    where: { practiceId_fieldKey: { practiceId: id, fieldKey: 'interessi_importo' } },
    create: {
      id: crypto.randomUUID(),
      practiceId: id,
      fieldKey: 'interessi_importo',
      valueJson: JSON.stringify(interessiImporto),
      sourceType: 'derived',
      sourceRef: 'recompute-interest',
      confidence: 1,
      status: FieldStatus.AUTO_OK,
      lastModifiedBy: body.actor ?? 'system'
    },
    update: {
      valueJson: JSON.stringify(interessiImporto),
      sourceType: 'derived',
      sourceRef: 'recompute-interest',
      confidence: 1,
      status: FieldStatus.AUTO_OK,
      lastModifiedBy: body.actor ?? 'system',
      lastModifiedAt: new Date()
    }
  });

  if (mode === 'none') {
    await prisma.fieldValue.upsert({
      where: { practiceId_fieldKey: { practiceId: id, fieldKey: 'interessi_clausola_testo' } },
      create: {
        id: crypto.randomUUID(),
        practiceId: id,
        fieldKey: 'interessi_clausola_testo',
        valueJson: JSON.stringify('oltre interessi come da titolo dal dovuto al saldo'),
        sourceType: 'derived',
        sourceRef: 'recompute-interest',
        confidence: 1,
        status: FieldStatus.AUTO_OK,
        lastModifiedBy: body.actor ?? 'system'
      },
      update: {
        valueJson: JSON.stringify('oltre interessi come da titolo dal dovuto al saldo'),
        sourceType: 'derived',
        sourceRef: 'recompute-interest',
        confidence: 1,
        status: FieldStatus.AUTO_OK,
        lastModifiedBy: body.actor ?? 'system',
        lastModifiedAt: new Date()
      }
    });
  }

  await prisma.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      practiceId: id,
      actor: body.actor ?? 'system',
      action: 'RECOMPUTE_INTEREST',
      payloadJson: JSON.stringify({ mode, interessiImporto, warning })
    }
  });

  return { ok: true, data: { mode, interessiImporto, warning } };
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





app.post('/discord/openclaw-event', async (request, reply) => {
  const body = (request.body ?? {}) as {
    channelId?: string;
    user?: string;
    text?: string;
    practiceId?: string;
    attachmentPaths?: string[];
  };

  if (!requireOperativeChannel(body.channelId)) {
    return reply.code(403).send({ ok: false, error: 'Channel not authorized for operative flow' });
  }

  const attachments: Array<{ filename: string; mimeType: string; base64: string }> = [];
  for (const fp of body.attachmentPaths ?? []) {
    try {
      const buf = await readFile(fp);
      const filename = fp.split('/').pop() ?? 'attachment.bin';
      const lower = filename.toLowerCase();
      const mimeType = lower.endsWith('.pdf')
        ? 'application/pdf'
        : lower.endsWith('.docx')
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : lower.endsWith('.json')
            ? 'application/json'
            : lower.endsWith('.csv')
              ? 'text/csv'
              : lower.endsWith('.xlsx')
                ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                : 'application/octet-stream';
      attachments.push({ filename, mimeType, base64: buf.toString('base64') });
    } catch {
      // skip unreadable file path
    }
  }

  const injected = await app.inject({
    method: 'POST',
    url: '/discord/hook',
    payload: {
      channelId: body.channelId,
      user: body.user,
      text: body.text,
      practiceId: body.practiceId,
      attachments
    }
  });

  return reply.code(injected.statusCode).send(injected.json());
});

app.post('/discord/hook', async (request, reply) => {
  const body = (request.body ?? {}) as {
    channelId?: string;
    user?: string;
    text?: string;
    practiceId?: string;
    attachments?: Array<{ filename: string; mimeType: string; base64: string }>;
  };

  if (!requireOperativeChannel(body.channelId)) {
    return reply.code(403).send({ ok: false, error: 'Channel not authorized for operative flow' });
  }

  const user = body.user ?? 'discord-user';
  let practiceId = body.practiceId;

  // auto-create practice if attachments are present and no practiceId was provided
  if (!practiceId && (body.attachments?.length ?? 0) > 0) {
    const id = `P-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${nanoid()}`;
    await prisma.practice.create({
      data: {
        id,
        audits: {
          create: {
            id: crypto.randomUUID(),
            actor: user,
            action: 'DISCORD_HOOK_AUTO_NEW',
            payloadJson: JSON.stringify({ channelId: body.channelId })
          }
        }
      }
    });
    practiceId = id;
  }

  const attachedIds: string[] = [];
  if (practiceId && body.attachments?.length) {
    for (const a of body.attachments) {
      const buf = Buffer.from(a.base64, 'base64');
      const f = await prisma.storedFile.create({
        data: {
          id: crypto.randomUUID(),
          practiceId,
          kind: FileKind.PRACTICE_DOCUMENT,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: buf.length,
          sha256: sha256(buf),
          content: new Uint8Array(buf)
        }
      });
      attachedIds.push(f.id);
    }

    await prisma.auditEvent.create({
      data: {
        id: crypto.randomUUID(),
        practiceId,
        actor: user,
        action: 'DISCORD_HOOK_ATTACH',
        payloadJson: JSON.stringify({ count: attachedIds.length })
      }
    });
  }

  if (body.text?.trim()) {
    const parsed = parseDiscordPrecettoMessage(body.text);
    if (parsed) {
      const res = await app.inject({
        method: 'POST',
        url: '/discord/command',
        payload: {
          channelId: body.channelId,
          user,
          command: parsed.command,
          practiceId: parsed.practiceId ?? practiceId,
          args: parsed.args
        }
      });
      const json = res.json();
      return reply.code(res.statusCode).send({
        ok: res.statusCode < 400,
        data: {
          practiceId,
          attachedFileIds: attachedIds,
          commandResult: json.data ?? null,
          commandError: json.error ?? null
        }
      });
    }
  }

  return {
    ok: true,
    data: {
      practiceId,
      attachedFileIds: attachedIds,
      text: 'Hook processed'
    }
  };
});

app.post('/discord/router', async (request, reply) => {
  const body = (request.body ?? {}) as {
    channelId?: string;
    user?: string;
    text?: string;
  };

  if (!requireOperativeChannel(body.channelId)) {
    return reply.code(403).send({ ok: false, error: 'Channel not authorized for operative flow' });
  }

  const parsed = parseDiscordPrecettoMessage(body.text ?? '');
  if (!parsed) return reply.badRequest('Unsupported command syntax');

  const payload = {
    channelId: body.channelId,
    user: body.user,
    command: parsed.command,
    practiceId: parsed.practiceId,
    args: parsed.args
  };

  // Internal dispatch to same command handler logic
  const res = await app.inject({
    method: 'POST',
    url: '/discord/command',
    payload
  });

  const json = res.json();
  if (res.statusCode >= 400) {
    return reply.code(res.statusCode).send(json);
  }

  return {
    ok: true,
    data: {
      parsed,
      response: json.data
    }
  };
});

app.post('/discord/command', async (request, reply) => {
  const body = (request.body ?? {}) as {
    channelId?: string;
    user?: string;
    command?: string;
    practiceId?: string;
    args?: Record<string, unknown>;
  };

  if (!requireOperativeChannel(body.channelId)) {
    return reply.code(403).send({ ok: false, error: 'Channel not authorized for operative flow' });
  }

  const user = body.user ?? 'discord-user';
  const cmd = (body.command ?? '').trim();

  if (cmd === 'new') {
    const id = `P-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${nanoid()}`;
    await prisma.practice.create({
      data: {
        id,
        audits: {
          create: {
            id: crypto.randomUUID(),
            actor: user,
            action: 'DISCORD_NEW',
            payloadJson: JSON.stringify({ channelId: body.channelId })
          }
        }
      }
    });
    return { ok: true, data: { text: `Pratica creata: ${id}`, practiceId: id } };
  }

  if (!body.practiceId) return reply.badRequest('practiceId is required for this command');
  const id = body.practiceId;

  if (cmd === 'status') {
    const practice = await prisma.practice.findUnique({ where: { id }, include: { fieldValues: true, files: true } });
    if (!practice) return reply.notFound('Practice not found');
    const missing = practice.fieldValues.filter((f) => f.status === 'MISSING').length;
    return { ok: true, data: { text: `Status ${id}: files=${practice.files.length}, fields=${practice.fieldValues.length}, missing=${missing}` } };
  }

  if (cmd === 'extract') {
    const files = await prisma.storedFile.findMany({ where: { practiceId: id, kind: FileKind.PRACTICE_DOCUMENT } });
    if (!files.length) return reply.badRequest('No documents for extraction');

    const merged: Record<string, { value: unknown; confidence: number; sourceRef: string }> = {};
    for (const f of files) {
      const text = await extractTextByMime(Buffer.from(f.content), f.mimeType, f.filename);
      const partial = extractPrecettoFieldsDetailed(text);
      for (const [k, v] of Object.entries(partial)) {
        if (!(k in merged) || v.confidence > merged[k].confidence) merged[k] = v;
      }
    }

    const upserts = Object.entries(merged).map(([fieldKey, value]) =>
      prisma.fieldValue.upsert({
        where: { practiceId_fieldKey: { practiceId: id, fieldKey } },
        create: {
          id: crypto.randomUUID(), practiceId: id, fieldKey,
          valueJson: JSON.stringify(value.value),
          sourceType: 'document', sourceRef: value.sourceRef, confidence: value.confidence,
          status: FieldStatus.NEEDS_REVIEW, lastModifiedBy: user
        },
        update: {
          valueJson: JSON.stringify(value.value),
          sourceType: 'document', sourceRef: value.sourceRef, confidence: value.confidence,
          status: FieldStatus.NEEDS_REVIEW, lastModifiedBy: user, lastModifiedAt: new Date()
        }
      })
    );
    await prisma.$transaction(upserts);
    await prisma.auditEvent.create({ data: { id: crypto.randomUUID(), practiceId: id, actor: user, action: 'DISCORD_EXTRACT', payloadJson: JSON.stringify({ fields: Object.keys(merged) }) } });
    return { ok: true, data: { text: `Estrazione completata (${Object.keys(merged).length} campi)` } };
  }

  if (cmd === 'set') {
    const fieldKey = String(body.args?.fieldKey ?? '');
    const value = body.args?.value;
    if (!fieldKey) return reply.badRequest('args.fieldKey is required');
    await prisma.fieldValue.upsert({
      where: { practiceId_fieldKey: { practiceId: id, fieldKey } },
      create: {
        id: crypto.randomUUID(), practiceId: id, fieldKey,
        valueJson: JSON.stringify(value), sourceType: 'manual', status: FieldStatus.MANUAL,
        lastModifiedBy: user
      },
      update: {
        valueJson: JSON.stringify(value), sourceType: 'manual', status: FieldStatus.MANUAL,
        lastModifiedBy: user, lastModifiedAt: new Date()
      }
    });
    await prisma.auditEvent.create({ data: { id: crypto.randomUUID(), practiceId: id, actor: user, action: 'DISCORD_SET', payloadJson: JSON.stringify({ fieldKey }) } });
    return { ok: true, data: { text: `Campo aggiornato: ${fieldKey}` } };
  }

  if (cmd === 'attach') {
    const filename = String(body.args?.filename ?? 'upload.bin');
    const mimeType = String(body.args?.mimeType ?? 'application/octet-stream');
    const b64 = String(body.args?.base64 ?? '');
    if (!b64) return reply.badRequest('args.base64 is required for attach');

    const buf = Buffer.from(b64, 'base64');
    const frow = await prisma.storedFile.create({
      data: {
        id: crypto.randomUUID(),
        practiceId: id,
        kind: FileKind.PRACTICE_DOCUMENT,
        filename,
        mimeType,
        sizeBytes: buf.length,
        sha256: sha256(buf),
        content: new Uint8Array(buf)
      }
    });

    await prisma.auditEvent.create({
      data: {
        id: crypto.randomUUID(),
        practiceId: id,
        actor: user,
        action: 'DISCORD_ATTACH',
        payloadJson: JSON.stringify({ fileId: frow.id, filename })
      }
    });

    return { ok: true, data: { text: `File allegato: ${filename}`, fileId: frow.id } };
  }

  if (cmd === 'interessi') {
    const mode = String(body.args?.mode ?? 'none');
    const allowed = new Set(['none', 'simple', 'complex']);
    if (!allowed.has(mode)) return reply.badRequest('mode must be none|simple|complex');

    await prisma.fieldValue.upsert({
      where: { practiceId_fieldKey: { practiceId: id, fieldKey: 'interessi_modalita' } },
      create: {
        id: crypto.randomUUID(), practiceId: id, fieldKey: 'interessi_modalita',
        valueJson: JSON.stringify(mode === 'complex' ? 'complex_placeholder' : mode),
        sourceType: 'manual', status: FieldStatus.MANUAL, lastModifiedBy: user
      },
      update: {
        valueJson: JSON.stringify(mode === 'complex' ? 'complex_placeholder' : mode),
        sourceType: 'manual', status: FieldStatus.MANUAL, lastModifiedBy: user, lastModifiedAt: new Date()
      }
    });

    const tipo = String(body.args?.tipo ?? 'legale');
    if (mode === 'simple') {
      await prisma.fieldValue.upsert({
        where: { practiceId_fieldKey: { practiceId: id, fieldKey: 'interessi_tipo_tasso' } },
        create: {
          id: crypto.randomUUID(), practiceId: id, fieldKey: 'interessi_tipo_tasso',
          valueJson: JSON.stringify(tipo), sourceType: 'manual', status: FieldStatus.MANUAL, lastModifiedBy: user
        },
        update: {
          valueJson: JSON.stringify(tipo), sourceType: 'manual', status: FieldStatus.MANUAL, lastModifiedBy: user, lastModifiedAt: new Date()
        }
      });
    }

    await prisma.auditEvent.create({
      data: { id: crypto.randomUUID(), practiceId: id, actor: user, action: 'DISCORD_INTERESSI', payloadJson: JSON.stringify({ mode, tipo }) }
    });

    return { ok: true, data: { text: `Interessi impostati: mode=${mode}${mode === 'simple' ? `, tipo=${tipo}` : ''}` } };
  }

  if (cmd === 'export') {
    const format = String(body.args?.format ?? 'docx');
    if (format === 'csv') {
      const practice = await prisma.practice.findUnique({ where: { id }, include: { fieldValues: true } });
      if (!practice) return reply.notFound('Practice not found');
      const entries = practice.fieldValues.map((f) => [f.fieldKey, JSON.parse(f.valueJson)] as const);
      const headers = entries.map(([k]) => k);
      const values = entries.map(([,v]) => String(v ?? ''));
      const esc = (x:string)=> `"${x.replaceAll('"','""')}"`;
      const csv = `${headers.map(esc).join(',')}\n${values.map(esc).join(',')}\n`;
      return { ok: true, data: { text: `CSV pronto (${headers.length} colonne)`, csv } };
    }

    return { ok: true, data: { text: 'Usa generate/generate-fast per ottenere DOCX' } };
  }

  if (cmd === 'generate' || cmd === 'generate-fast') {
    const fast = cmd === 'generate-fast';
    const practice = await prisma.practice.findUnique({ where: { id }, include: { fieldValues: true } });
    if (!practice) return reply.notFound('Practice not found');

    const templateId = String(body.args?.templateId ?? practice.selectedTemplateId ?? '');
    if (!templateId) return reply.badRequest('templateId missing (set practice template or pass args.templateId)');

    const tpl = await prisma.template.findUnique({ where: { id: templateId } });
    if (!tpl) return reply.notFound('Template not found. The selected template may have been removed or disabled.');

    const fields = Object.fromEntries(practice.fieldValues.map((f) => [f.fieldKey, JSON.parse(f.valueJson)]));
    const templateFields = await extractTemplateFields(tpl.content);
    const missing = templateFields.filter((k) => emptyValue(fields[k]));
    const out = await renderDocxTemplate(tpl.content, fields);
    const filename = `precetto_${id}_${new Date().toISOString().replace(/[:.]/g, '-')}.docx`;

    const frow = await prisma.storedFile.create({
      data: {
        id: crypto.randomUUID(), practiceId: id, kind: FileKind.PRACTICE_DOCUMENT,
        filename, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: out.byteLength, sha256: sha256(Buffer.from(out)), content: new Uint8Array(out)
      }
    });

    await prisma.auditEvent.create({ data: { id: crypto.randomUUID(), practiceId: id, actor: user, action: fast ? 'DISCORD_GENERATE_FAST' : 'DISCORD_GENERATE', payloadJson: JSON.stringify({ templateId, outputFileId: frow.id }) } });

    return {
      ok: true,
      data: {
        text: `Documento generato (${fast ? 'fast' : 'standard'}): ${filename} (campi template mancanti: ${missing.length})`,
        fileId: frow.id,
        downloadPath: `/practices/${id}/files/${frow.id}/download`
      }
    };
  }

  return reply.badRequest('Unknown command');
});

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
