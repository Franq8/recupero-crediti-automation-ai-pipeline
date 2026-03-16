#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseImportFileRows } from '../dist/importer.js';
import { analyzeStructuredBatchRows } from '../dist/doc-generator-openclaw.js';
import { extractTemplateInstructions } from '../dist/template-instructions.js';

const DEFAULT_GUILD_ID = '1465850645138637018';
const DEFAULT_CHANNEL_ID = '1482018084020551883';
const DEFAULT_API_BASE = process.env.DOC_GENERATOR_API_BASE || 'https://automazionerecuperi.lawlabs.cloud/api';
const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || path.join(os.homedir(), '.openclaw', 'openclaw.json');

function loadOpenClawToken() {
  try {
    const raw = fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf8');
    const json = JSON.parse(raw);
    return json?.channels?.discord?.token || '';
  } catch {
    return '';
  }
}

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || loadOpenClawToken();
const GUILD_ID = process.env.DOC_GENERATOR_GUILD_ID || DEFAULT_GUILD_ID;
const CHANNEL_ID = process.env.DOC_GENERATOR_CHANNEL_ID || DEFAULT_CHANNEL_ID;
const API_BASE = DEFAULT_API_BASE.replace(/\/$/, '');
const API_URL = `${API_BASE}/discord/v1/template-table-autocontinue`;
const USER_AGENT = 'rca-doc-generator-listener/1.0';
const ALLOW_BOT_MESSAGES = process.env.DOC_GENERATOR_ALLOW_BOT_MESSAGES === '1';
const REGENERATE_REGEX = /\b(?:rigenera|regen|link)\s+([A-Za-z0-9-]{8,})\b/i;
const execFileAsync = promisify(execFile);
const OPENCLAW_AGENT = process.env.DOC_GENERATOR_OPENCLAW_AGENT || 'main';
const OPENCLAW_SESSION_ID = process.env.DOC_GENERATOR_OPENCLAW_SESSION_ID || 'rca-doc-generator-special-placeholders';
const OPENCLAW_ROW_CONCURRENCY = Math.max(1, Number.parseInt(process.env.DOC_GENERATOR_OPENCLAW_ROW_CONCURRENCY || '12', 10) || 12);
const OPENCLAW_ROWS_PER_PROMPT = Math.max(1, Number.parseInt(process.env.DOC_GENERATOR_OPENCLAW_ROWS_PER_PROMPT || '4', 10) || 4);

if (!BOT_TOKEN) {
  console.error('Missing Discord bot token. Set DISCORD_BOT_TOKEN or configure ~/.openclaw/openclaw.json');
  process.exit(1);
}

const AttachmentKind = {
  TEMPLATE: 'template',
  TABLE: 'table'
};

function normalizeAttachments(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  return Object.values(raw);
}

let ws;
let heartbeatTimer = null;
let sequence = null;
let sessionId = null;
let shuttingDown = false;
const processedMessageIds = new Set();

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function classifyAttachment(att) {
  const name = String(att?.filename || '').toLowerCase();
  if (name.endsWith('.docx')) return AttachmentKind.TEMPLATE;
  if (name.endsWith('.xlsx') || name.endsWith('.csv')) return AttachmentKind.TABLE;
  return null;
}

function normalizeImportRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (!key || key === 'schema_version' || key === 'row_id') continue;
    out[key] = value;
  }
  return out;
}

function stripJsonFences(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : raw;
}

function extractFirstJsonObject(text) {
  const raw = String(text || '');
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (start === -1) {
      if (ch === '{') {
        start = i;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }

  return '';
}

function safePreview(text, max = 400) {
  return String(text || '').replace(/\s+/g, ' ').slice(0, max);
}

function parseStructuredAgentText(text) {
  const stripped = stripJsonFences(text).trim();
  if (!stripped) return null;

  try {
    return JSON.parse(stripped);
  } catch {}

  const firstObject = extractFirstJsonObject(stripped);
  if (!firstObject) return null;

  try {
    return JSON.parse(firstObject);
  } catch {
    return null;
  }
}

function buildOpenClawSessionId(rowIndexes) {
  const scope = rowIndexes.length ? rowIndexes.map((rowIndex) => String(rowIndex)).join('-') : 'no-rows';
  const nonce = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${OPENCLAW_SESSION_ID}-${scope}-${nonce}`.slice(0, 180);
}

function buildSpecialPlaceholderPrompt({ deriveItems, generateItems, batch }) {
  return [
    'Sei il motore OpenClaw per i segnaposti speciali del progetto recupero-crediti-automation-ai-pipeline.',
    'Lavora solo sui dati delle righe fornite.',
    'Restituisci SOLO JSON valido, senza markdown, senza testo extra.',
    'Per ogni riga restituisci deriveValues e generateValues.',
    'Se un valore non è determinabile dai dati della riga, usa stringa vuota.',
    'OUTPUT SHAPE OBBLIGATORIA:',
    JSON.stringify({ rows: { '1': { deriveValues: {}, generateValues: {} } } }, null, 2),
    'ISTRUZIONI DERIVE:',
    JSON.stringify(deriveItems, null, 2),
    'ISTRUZIONI GENERATE:',
    JSON.stringify(generateItems, null, 2),
    'ROWS:',
    JSON.stringify(batch.map((entry) => ({ rowIndex: entry.rowIndex, values: entry.rowValues })), null, 2)
  ].join('\n\n');
}

function summarizeBatchDiagnostics(diagnostics) {
  return diagnostics
    .filter((item) => item.missingDeriveKeys.length || item.missingGenerateKeys.length)
    .map((item) => ({
      rowIndex: item.rowIndex,
      deriveKeys: item.deriveKeys,
      generateKeys: item.generateKeys,
      missingDeriveKeys: item.missingDeriveKeys,
      missingGenerateKeys: item.missingGenerateKeys
    }));
}

async function runOpenClawStructuredJson(prompt, { sessionId = OPENCLAW_SESSION_ID } = {}) {
  const { stdout } = await execFileAsync('openclaw', [
    'agent',
    '--agent', OPENCLAW_AGENT,
    '--session-id', sessionId,
    '--thinking', 'off',
    '--json',
    '--message', prompt
  ], {
    cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..'),
    maxBuffer: 10 * 1024 * 1024
  });

  const envelopeRaw = extractFirstJsonObject(stdout);
  if (!envelopeRaw) throw new Error(`OpenClaw envelope missing JSON object. stdout=${safePreview(stdout)}`);
  const payload = JSON.parse(envelopeRaw);
  const text = payload?.result?.payloads?.[0]?.text || '';
  const structured = parseStructuredAgentText(text);
  if (!structured || typeof structured !== 'object') {
    throw new Error(`OpenClaw structured payload missing/invalid JSON. text=${safePreview(text)}`);
  }
  return structured;
}

async function computeSpecialPlaceholderRowResults({ templateBytes, tableBytes, tableFilename, tableMimeType }) {
  const instructions = await extractTemplateInstructions(templateBytes);
  const deriveItems = instructions.filter((item) => item.kind === 'derive').map((item) => ({ key: item.key, instruction: item.instruction || '' }));
  const generateItems = instructions.filter((item) => item.kind === 'generate').map((item) => ({ key: item.key, instruction: item.instruction || '' }));

  if (!deriveItems.length && !generateItems.length) return null;

  const rows = await parseImportFileRows(tableFilename, tableMimeType, Buffer.from(tableBytes));
  const rowResults = {};
  const deriveKeys = deriveItems.map((item) => item.key);
  const generateKeys = generateItems.map((item) => item.key);

  const rowEntries = rows.map((sourceRowRaw, idx) => {
    const sourceRow = sourceRowRaw || {};
    const rowIdRaw = sourceRow.row_id;
    const rowIndex = Number.isFinite(Number(rowIdRaw)) ? Number(rowIdRaw) : idx + 1;
    return { rowIndex, rowValues: normalizeImportRow(sourceRow) };
  });

  async function runBatch(batch) {
    const prompt = buildSpecialPlaceholderPrompt({ deriveItems, generateItems, batch });
    const analysis = analyzeStructuredBatchRows({
      structuredRows: (await runOpenClawStructuredJson(prompt, {
        sessionId: buildOpenClawSessionId(batch.map((entry) => entry.rowIndex))
      }))?.rows,
      rowIndexes: batch.map((entry) => entry.rowIndex),
      deriveKeys,
      generateKeys
    });

    return analysis;
  }

  const batches = [];
  for (let i = 0; i < rowEntries.length; i += OPENCLAW_ROWS_PER_PROMPT) {
    batches.push(rowEntries.slice(i, i + OPENCLAW_ROWS_PER_PROMPT));
  }

  const tasks = batches.map((batch) => async () => {
    async function retryRow(entry, reason) {
      try {
        const analysis = await runBatch([entry]);
        rowResults[String(entry.rowIndex)] = analysis.rowResults[String(entry.rowIndex)];
        log(
          analysis.incompleteRowIndexes.length ? 'openclaw.row.retry.incomplete' : 'openclaw.row.retry.recovered',
          JSON.stringify({
            rowIndex: entry.rowIndex,
            reason,
            returnedRowKeys: analysis.returnedRowKeys,
            unexpectedRowKeys: analysis.unexpectedRowKeys,
            missingRowIndexes: analysis.missingRowIndexes,
            incompleteRowIndexes: analysis.incompleteRowIndexes,
            diagnostics: summarizeBatchDiagnostics(analysis.diagnostics)
          })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log('openclaw.row.retry.failed', JSON.stringify({ rowIndex: entry.rowIndex, reason, message }));
        rowResults[String(entry.rowIndex)] = rowResults[String(entry.rowIndex)] || { deriveValues: {}, generateValues: {} };
      }
    }

    try {
      const analysis = await runBatch(batch);
      for (const entry of batch) {
        rowResults[String(entry.rowIndex)] = analysis.rowResults[String(entry.rowIndex)];
      }

      log('openclaw.batch.done', JSON.stringify({
        rowIndexes: batch.map((entry) => entry.rowIndex),
        returnedRowKeys: analysis.returnedRowKeys,
        unexpectedRowKeys: analysis.unexpectedRowKeys,
        missingRowIndexes: analysis.missingRowIndexes,
        incompleteRowIndexes: analysis.incompleteRowIndexes,
        diagnostics: summarizeBatchDiagnostics(analysis.diagnostics)
      }));

      if (!analysis.incompleteRowIndexes.length) return;

      const retryIndexes = new Set(analysis.incompleteRowIndexes);
      const retryEntries = batch.filter((entry) => retryIndexes.has(entry.rowIndex));
      log('openclaw.batch.retrying-rows', JSON.stringify({
        rowIndexes: batch.map((entry) => entry.rowIndex),
        retryRowIndexes: retryEntries.map((entry) => entry.rowIndex),
        reason: 'missing-row-results-or-required-keys'
      }));
      for (const entry of retryEntries) {
        await retryRow(entry, 'batch-incomplete');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log('openclaw.batch.parse-failed', JSON.stringify({ rowIndexes: batch.map((entry) => entry.rowIndex), message }));
      for (const entry of batch) {
        await retryRow(entry, 'batch-parse-failed');
      }
    }
  });

  for (let start = 0; start < tasks.length; start += OPENCLAW_ROW_CONCURRENCY) {
    const chunk = tasks.slice(start, start + OPENCLAW_ROW_CONCURRENCY);
    await Promise.all(chunk.map((task) => task()));
    log('openclaw.chunk.done', JSON.stringify({
      completedBatches: Math.min(start + OPENCLAW_ROW_CONCURRENCY, tasks.length),
      totalBatches: tasks.length,
      concurrency: OPENCLAW_ROW_CONCURRENCY,
      rowsPerPrompt: OPENCLAW_ROWS_PER_PROMPT
    }));
  }

  for (const entry of rowEntries) {
    rowResults[String(entry.rowIndex)] = rowResults[String(entry.rowIndex)] || { deriveValues: {}, generateValues: {} };
  }

  return rowResults;
}

async function discordApi(pathname, init = {}, attempt = 0) {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bot ${BOT_TOKEN}`);
  headers.set('User-Agent', USER_AGENT);
  const res = await fetch(`https://discord.com/api/v10${pathname}`, { ...init, headers });
  if (res.status === 429 && attempt < 5) {
    const text = await res.text();
    let retryMs = 1000;
    try {
      const json = JSON.parse(text);
      if (typeof json.retry_after === 'number') retryMs = Math.ceil(json.retry_after * 1000) + 250;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, retryMs));
    return discordApi(pathname, init, attempt + 1);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord API ${pathname} failed: HTTP ${res.status} ${text}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return res;
}

async function sendChannelMessage(content, extra = {}) {
  return discordApi(`/channels/${CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] }, ...extra })
  });
}

async function fetchBytes(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Download failed ${res.status} for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function runBatchFromMessage(message) {
  const attachments = normalizeAttachments(message.attachments).map((att) => ({
    id: att.id,
    filename: att.filename,
    url: att.url,
    contentType: att.content_type || att.contentType || 'application/octet-stream',
    kind: classifyAttachment(att)
  }));
  const templates = attachments.filter((a) => a.kind === AttachmentKind.TEMPLATE);
  const tables = attachments.filter((a) => a.kind === AttachmentKind.TABLE);

  if (attachments.length !== 2 || templates.length !== 1 || tables.length !== 1) {
    await sendChannelMessage('Input non valido: carica esattamente 1 template .docx e 1 tabella .xlsx/.csv nello stesso messaggio.');
    return;
  }

  const template = templates[0];
  const table = tables[0];
  const [templateBytes, tableBytes] = await Promise.all([fetchBytes(template.url), fetchBytes(table.url)]);

  const namingPattern = String(message.content || '').trim();
  const rowFlowResults = await computeSpecialPlaceholderRowResults({
    templateBytes,
    tableBytes,
    tableFilename: table.filename,
    tableMimeType: table.contentType
  });

  const form = new FormData();
  form.set('actor', `discord-doc-generator:${message.author?.username || 'unknown'}:${message.id}`);
  if (namingPattern) form.set('namingPattern', namingPattern);
  if (rowFlowResults) form.set('openclawRowFlowResultsJson', JSON.stringify(rowFlowResults));
  form.set('template', new Blob([templateBytes], { type: template.contentType }), template.filename);
  form.set('table', new Blob([tableBytes], { type: table.contentType }), table.filename);

  const res = await fetch(API_URL, { method: 'POST', body: form, headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    const text = await res.text();
    await sendChannelMessage(`Errore batch: ${text.slice(0, 1500)}`);
    return;
  }

  const payload = await res.json();
  const finalMessage = res.headers.get('x-rca-discord-final-message') || 'Lavorazione completata.';
  const practiceId = payload?.data?.practiceId || res.headers.get('x-rca-discord-practice-id');
  const download = payload?.data?.download;
  if (!download?.url) {
    await sendChannelMessage(`Errore batch: risposta senza link di download.${practiceId ? ` Practice: \`${practiceId}\`` : ''}`);
    return;
  }

  const suffix = practiceId ? `\nPractice: \`${practiceId}\`` : '';
  const retention = download.retainedUntil ? `\nRetention ZIP: fino a ${download.retainedUntil}` : '';
  await sendChannelMessage(`${finalMessage}${suffix}\nDownload: ${download.url}\nValido fino a: ${download.expiresAt}\nMax download: ${download.maxDownloads}${retention}`);
}

async function handleRegenerateRequest(message) {
  const content = String(message?.content || '').trim();
  const match = content.match(REGENERATE_REGEX);
  if (!match) return false;

  const practiceId = match[1];
  const res = await fetch(`${API_BASE}/discord/v1/download-batches/${encodeURIComponent(practiceId)}/regenerate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ actor: `discord-doc-generator:${message.author?.username || 'unknown'}:${message.id}` })
  });

  if (!res.ok) {
    const text = await res.text();
    await sendChannelMessage(`Rigenerazione fallita per \`${practiceId}\`: ${text.slice(0, 1500)}`);
    return true;
  }

  const payload = await res.json();
  const download = payload?.data?.download;
  await sendChannelMessage(`Nuovo link per \`${practiceId}\`:\n${download.url}\nValido fino a: ${download.expiresAt}\nMax download: ${download.maxDownloads}\nRetention ZIP: fino a ${download.retainedUntil}`);
  return true;
}

async function handleMessageCreate(message) {
  log('message.received', JSON.stringify({
    id: message?.id ?? null,
    channel_id: message?.channel_id ?? null,
    guild_id: message?.guild_id ?? null,
    author_bot: Boolean(message?.author?.bot),
    attachment_count: normalizeAttachments(message?.attachments).length,
    content_preview: String(message?.content || '').slice(0, 120)
  }));
  if (!message) return;
  if (processedMessageIds.has(message.id)) {
    log('message.skipped', JSON.stringify({ id: message.id, reason: 'already-processed' }));
    return;
  }
  if (message.channel_id !== CHANNEL_ID) {
    log('message.skipped', JSON.stringify({ id: message.id, reason: 'wrong-channel', channel_id: message.channel_id, expected: CHANNEL_ID }));
    return;
  }
  if (message.guild_id !== GUILD_ID) {
    log('message.skipped', JSON.stringify({ id: message.id, reason: 'wrong-guild', guild_id: message.guild_id, expected: GUILD_ID }));
    return;
  }
  const attachments = normalizeAttachments(message.attachments);
  const attachmentCount = attachments.length;
  if (attachmentCount === 0) {
    log('message.regen-check', JSON.stringify({ id: message.id }));
    await handleRegenerateRequest(message);
    return;
  }
  if (message.author?.bot) {
    if (!ALLOW_BOT_MESSAGES) {
      log('message.skipped', JSON.stringify({ id: message.id, reason: 'bot-message-disabled' }));
      return;
    }
    const kinds = attachments.map(classifyAttachment).filter(Boolean);
    const templateCount = kinds.filter((k) => k === AttachmentKind.TEMPLATE).length;
    const tableCount = kinds.filter((k) => k === AttachmentKind.TABLE).length;
    if (!(attachmentCount === 2 && templateCount === 1 && tableCount === 1)) {
      log('message.skipped', JSON.stringify({ id: message.id, reason: 'bot-message-invalid-attachments', attachmentCount, templateCount, tableCount }));
      return;
    }
  }
  processedMessageIds.add(message.id);
  log('message.accepted', JSON.stringify({ id: message.id, attachmentCount }));
  if (processedMessageIds.size > 500) {
    const first = processedMessageIds.values().next().value;
    if (first) processedMessageIds.delete(first);
  }

  try {
    log('batch.start', JSON.stringify({ id: message.id }));
    await runBatchFromMessage(message);
    log('batch.done', JSON.stringify({ id: message.id }));
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : '';
    log('message processing failed', text);
    if (stack) log('message processing stack', stack);
    try {
      await sendChannelMessage(`Errore batch inatteso: ${text.slice(0, 1500)}`);
    } catch (sendError) {
      log('failed to send error message', sendError instanceof Error ? sendError.message : String(sendError));
    }
  }
}

function startHeartbeat(intervalMs) {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ op: 1, d: sequence }));
    }
  }, intervalMs);
}

function connectGateway() {
  ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');

  ws.addEventListener('open', () => log('discord gateway connected'));
  ws.addEventListener('close', (event) => {
    log('discord gateway closed', `code=${event.code}`, `reason=${event.reason || ''}`);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    if (!shuttingDown) setTimeout(connectGateway, 3000);
  });
  ws.addEventListener('error', (event) => {
    log('discord gateway error', event?.message || 'unknown');
  });
  ws.addEventListener('message', async (event) => {
    const payload = JSON.parse(String(event.data));
    if (payload.s != null) sequence = payload.s;

    if (payload.op === 10) {
      startHeartbeat(payload.d.heartbeat_interval);
      ws.send(JSON.stringify({
        op: 2,
        d: {
          token: BOT_TOKEN,
          intents: 1 << 9 | 1 << 10 | 1 << 15,
          properties: { os: process.platform, browser: 'openclaw-doc-generator', device: 'openclaw-doc-generator' }
        }
      }));
      return;
    }

    if (payload.op === 11) return;

    if (payload.t === 'READY') {
      sessionId = payload.d.session_id;
      log('discord gateway ready', `session=${sessionId}`);
      return;
    }

    if (payload.t === 'MESSAGE_CREATE') {
      await handleMessageCreate(payload.d);
    }
  });
}

process.on('SIGINT', () => {
  shuttingDown = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  ws?.close(1000, 'shutdown');
  process.exit(0);
});
process.on('SIGTERM', () => {
  shuttingDown = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  ws?.close(1000, 'shutdown');
  process.exit(0);
});

log('starting doc-generator listener', `channel=${CHANNEL_ID}`, `api=${API_URL}`);
connectGateway();
