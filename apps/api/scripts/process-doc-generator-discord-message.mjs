#!/usr/bin/env node
import path from 'node:path';
import { loadDiscordBotToken } from './lib/openclaw-discord-token.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseImportFileRows } from '../dist/importer.js';
import { analyzeStructuredBatchRows } from '../dist/doc-generator-openclaw.js';
import { extractTemplateInstructions } from '../dist/template-instructions.js';

const execFileAsync = promisify(execFile);
const DEFAULT_GUILD_ID = '1465850645138637018';
const DEFAULT_CHANNEL_ID = '1482018084020551883';
const DEFAULT_API_BASE = process.env.DOC_GENERATOR_API_BASE || 'https://automazionerecuperi.lawlabs.cloud/api';
const API_BASE = DEFAULT_API_BASE.replace(/\/$/, '');
const API_URL = `${API_BASE}/discord/v1/template-table-autocontinue`;
const JOB_POLL_MS = Math.max(1500, Number.parseInt(process.env.DOC_GENERATOR_JOB_POLL_MS || '3000', 10) || 3000);
const USER_AGENT = 'rca-doc-generator-processor/1.0';
const OPENCLAW_AGENT = process.env.DOC_GENERATOR_OPENCLAW_AGENT || 'main';
const OPENCLAW_SESSION_ID = process.env.DOC_GENERATOR_OPENCLAW_SESSION_ID || 'rca-doc-generator-special-placeholders';
const OPENCLAW_ROW_CONCURRENCY = Math.max(1, Number.parseInt(process.env.DOC_GENERATOR_OPENCLAW_ROW_CONCURRENCY || '2', 10) || 2);
const OPENCLAW_ROWS_PER_PROMPT = Math.max(1, Number.parseInt(process.env.DOC_GENERATOR_OPENCLAW_ROWS_PER_PROMPT || '25', 10) || 25);
const CHANNEL_ID = process.env.DOC_GENERATOR_CHANNEL_ID || DEFAULT_CHANNEL_ID;
const GUILD_ID = process.env.DOC_GENERATOR_GUILD_ID || DEFAULT_GUILD_ID;

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || loadDiscordBotToken();
if (!BOT_TOKEN) throw new Error('Missing Discord bot token');

const AttachmentKind = { TEMPLATE: 'template', TABLE: 'table' };
function normalizeAttachments(raw) { if (Array.isArray(raw)) return raw; if (!raw || typeof raw !== 'object') return []; return Object.values(raw); }
function classifyAttachment(att) { const name = String(att?.filename || '').toLowerCase(); if (name.endsWith('.docx')) return AttachmentKind.TEMPLATE; if (name.endsWith('.xlsx') || name.endsWith('.csv')) return AttachmentKind.TABLE; return null; }
function normalizeImportRow(row) { const out = {}; for (const [key, value] of Object.entries(row || {})) { if (!key || key === 'schema_version' || key === 'row_id') continue; out[key] = value; } return out; }
function stripJsonFences(text) { const raw = String(text || '').trim(); const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i); return fenced ? fenced[1].trim() : raw; }
function extractFirstJsonObject(text) { const raw = String(text || ''); let start=-1, depth=0, inString=false, escaped=false; for (let i=0;i<raw.length;i+=1){ const ch=raw[i]; if (start===-1) { if (ch==='{'){ start=i; depth=1; } continue; } if (inString){ if (escaped) escaped=false; else if (ch==='\\') escaped=true; else if (ch==='"') inString=false; continue; } if (ch==='"'){ inString=true; continue; } if (ch==='{') depth+=1; if (ch==='}') { depth-=1; if (depth===0) return raw.slice(start, i+1); } } return ''; }
function parseStructuredAgentText(text) { const stripped = stripJsonFences(text).trim(); if (!stripped) return null; try { return JSON.parse(stripped); } catch {} const firstObject = extractFirstJsonObject(stripped); if (!firstObject) return null; try { return JSON.parse(firstObject); } catch { return null; } }
function buildOpenClawSessionId(rowIndexes) { const scope = rowIndexes.length ? rowIndexes.map((rowIndex) => String(rowIndex)).join('-') : 'no-rows'; const nonce = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; return `${OPENCLAW_SESSION_ID}-${scope}-${nonce}`.slice(0, 180); }
function buildSpecialPlaceholderPrompt({ deriveItems, generateItems, batch }) { return [
  'Sei il motore OpenClaw per i segnaposti speciali del progetto recupero-crediti-automation-ai-pipeline.',
  'Lavora solo sui dati delle righe fornite.',
  'Restituisci SOLO JSON valido, senza markdown, senza testo extra.',
  'Per ogni riga restituisci deriveValues e generateValues.',
  'Se un valore non è determinabile dai dati della riga, usa stringa vuota.',
  'OUTPUT SHAPE OBBLIGATORIA:',
  JSON.stringify({ rows: { '1': { deriveValues: {}, generateValues: {} } } }, null, 2),
  'ISTRUZIONI DERIVE:', JSON.stringify(deriveItems, null, 2),
  'ISTRUZIONI GENERATE:', JSON.stringify(generateItems, null, 2),
  'ROWS:', JSON.stringify(batch.map((entry) => ({ rowIndex: entry.rowIndex, values: entry.rowValues })), null, 2)
].join('\n\n'); }

async function discordApi(pathname, init = {}, attempt = 0) {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bot ${BOT_TOKEN}`);
  headers.set('User-Agent', USER_AGENT);
  const res = await fetch(`https://discord.com/api/v10${pathname}`, { ...init, headers });
  if (res.status === 429 && attempt < 5) {
    const text = await res.text();
    let retryMs = 1000;
    try { const json = JSON.parse(text); if (typeof json.retry_after === 'number') retryMs = Math.ceil(json.retry_after * 1000) + 250; } catch {}
    await new Promise((resolve) => setTimeout(resolve, retryMs));
    return discordApi(pathname, init, attempt + 1);
  }
  if (!res.ok) throw new Error(`Discord API ${pathname} failed: HTTP ${res.status} ${await res.text()}`);
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return res;
}
async function sendChannelMessage(content, extra = {}) { return discordApi(`/channels/${CHANNEL_ID}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, allowed_mentions: { parse: [] }, ...extra }) }); }
async function fetchBytes(url) { const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } }); if (!res.ok) throw new Error(`Download failed ${res.status} for ${url}`); return new Uint8Array(await res.arrayBuffer()); }

async function runOpenClawStructuredJson(prompt, sessionId) {
  const args = ['agent', '--agent', OPENCLAW_AGENT, '--session-id', sessionId, '--thinking', 'off', '--json', '--message', prompt];
  const { stdout } = await execFileAsync('openclaw', args, { cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..'), maxBuffer: 10 * 1024 * 1024 });
  const envelopeRaw = extractFirstJsonObject(stdout);
  if (!envelopeRaw) throw new Error('OpenClaw envelope missing JSON');
  const payload = JSON.parse(envelopeRaw);
  const text = payload?.result?.payloads?.[0]?.text || '';
  const structured = parseStructuredAgentText(text);
  if (!structured || typeof structured !== 'object') throw new Error('OpenClaw structured payload missing/invalid JSON');
  return structured;
}

async function computeSpecialPlaceholderRowResults({ templateBytes, tableBytes, tableFilename, tableMimeType }) {
  const instructions = await extractTemplateInstructions(templateBytes);
  const deriveItems = instructions.filter((item) => item.kind === 'derive').map((item) => ({ key: item.key, instruction: item.instruction || '' }));
  const generateItems = instructions.filter((item) => item.kind === 'generate').map((item) => ({ key: item.key, instruction: item.instruction || '' }));
  if (!deriveItems.length && !generateItems.length) return null;
  const rows = await parseImportFileRows(tableFilename, tableMimeType, Buffer.from(tableBytes));
  const deriveKeys = deriveItems.map((item) => item.key);
  const generateKeys = generateItems.map((item) => item.key);
  const rowResults = {};
  const rowEntries = rows.map((sourceRowRaw, idx) => { const sourceRow = sourceRowRaw || {}; const rowIdRaw = sourceRow.row_id; const rowIndex = Number.isFinite(Number(rowIdRaw)) ? Number(rowIdRaw) : idx + 1; return { rowIndex, rowValues: normalizeImportRow(sourceRow) }; });
  async function runBatch(batch) {
    const prompt = buildSpecialPlaceholderPrompt({ deriveItems, generateItems, batch });
    return analyzeStructuredBatchRows({ structuredRows: (await runOpenClawStructuredJson(prompt, buildOpenClawSessionId(batch.map((entry) => entry.rowIndex))))?.rows, rowIndexes: batch.map((entry) => entry.rowIndex), deriveKeys, generateKeys });
  }
  const batches = []; for (let i=0;i<rowEntries.length;i+=OPENCLAW_ROWS_PER_PROMPT) batches.push(rowEntries.slice(i, i + OPENCLAW_ROWS_PER_PROMPT));
  for (let start=0; start<batches.length; start+=OPENCLAW_ROW_CONCURRENCY) {
    const chunk = batches.slice(start, start + OPENCLAW_ROW_CONCURRENCY);
    const analyses = await Promise.all(chunk.map(async (batch) => {
      try { return await runBatch(batch); }
      catch {
        const local = { rowResults: {} };
        for (const entry of batch) {
          try { const single = await runBatch([entry]); local.rowResults[String(entry.rowIndex)] = single.rowResults[String(entry.rowIndex)]; }
          catch { local.rowResults[String(entry.rowIndex)] = { deriveValues: {}, generateValues: {} }; }
        }
        return local;
      }
    }));
    for (const analysis of analyses) Object.assign(rowResults, analysis.rowResults || {});
  }
  for (const entry of rowEntries) rowResults[String(entry.rowIndex)] ||= { deriveValues: {}, generateValues: {} };
  return rowResults;
}

async function fetchTargetMessage(messageId) {
  if (messageId) return discordApi(`/channels/${CHANNEL_ID}/messages/${messageId}`);
  const messages = await discordApi(`/channels/${CHANNEL_ID}/messages?limit=10`);
  const target = messages.find((m) => String(m.guild_id || '') === GUILD_ID && !m.author?.bot && normalizeAttachments(m.attachments).length > 0);
  if (!target) throw new Error('No processable message found in doc-generator channel');
  return target;
}

async function main() {
  const messageId = process.argv[2] || process.env.DOC_GENERATOR_MESSAGE_ID || '';
  const message = await fetchTargetMessage(messageId);
  const attachments = normalizeAttachments(message.attachments).map((att) => ({ id: att.id, filename: att.filename, url: att.url, contentType: att.content_type || att.contentType || 'application/octet-stream', kind: classifyAttachment(att) }));
  const templates = attachments.filter((a) => a.kind === AttachmentKind.TEMPLATE);
  const tables = attachments.filter((a) => a.kind === AttachmentKind.TABLE);
  if (attachments.length !== 2 || templates.length !== 1 || tables.length !== 1) throw new Error('Input non valido: serve esattamente 1 template .docx e 1 tabella .xlsx/.csv');
  const template = templates[0];
  const table = tables[0];
  const [templateBytes, tableBytes] = await Promise.all([fetchBytes(template.url), fetchBytes(table.url)]);
  const namingPattern = String(message.content || '').trim();
  const rowFlowResults = await computeSpecialPlaceholderRowResults({ templateBytes, tableBytes, tableFilename: table.filename, tableMimeType: table.contentType });
  const form = new FormData();
  form.set('actor', `discord-doc-generator:main-flow:${message.author?.username || 'unknown'}:${message.id}`);
  if (namingPattern) form.set('namingPattern', namingPattern);
  if (rowFlowResults) form.set('openclawRowFlowResultsJson', JSON.stringify(rowFlowResults));
  form.set('async', 'true');
  form.set('template', new Blob([templateBytes], { type: template.contentType }), template.filename);
  form.set('table', new Blob([tableBytes], { type: table.contentType }), table.filename);
  const res = await fetch(API_URL, { method: 'POST', body: form, headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Errore batch: ${(await res.text()).slice(0, 1500)}`);
  const payload = await res.json();
  const jobId = payload?.data?.jobId || res.headers.get('x-rca-discord-job-id');
  const statusPath = payload?.data?.statusUrl || res.headers.get('x-rca-discord-job-status-url');
  if (!jobId || !statusPath) throw new Error('Errore batch: risposta async senza jobId/statusUrl');
  await sendChannelMessage(`Lavorazione avviata. Job: \`${jobId}\`
Template: ${template.filename}
Tabella: ${table.filename}`, { reply_message_id: message.id, message_reference: { message_id: message.id, channel_id: CHANNEL_ID, guild_id: GUILD_ID } });

  let finalPayload = null;
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MS));
    const statusRes = await fetch(`${API_BASE}${statusPath}`, { headers: { 'User-Agent': USER_AGENT } });
    if (!statusRes.ok) throw new Error(`Errore status job: ${(await statusRes.text()).slice(0, 1000)}`);
    const statusPayload = await statusRes.json();
    const status = statusPayload?.data?.status;
    if (status === 'QUEUED' || status === 'PROCESSING') continue;
    finalPayload = statusPayload;
    break;
  }

  const practiceId = finalPayload?.data?.practiceId || null;
  const download = finalPayload?.data?.download;
  const summary = finalPayload?.data?.finalSummary || {};
  if (finalPayload?.data?.status === 'FAILED') throw new Error(`Errore batch: ${finalPayload?.data?.error || 'job failed'}`);
  if (!download?.url) throw new Error(`Errore batch: risposta finale senza link di download.${practiceId ? ` Practice: ${practiceId}` : ''}`);
  const finalMessage = `Esito Discord v1: ${summary.generatedCount ?? '?'} / ${summary.totalRows ?? '?'} documenti generati, ${summary.warningRows ?? 0} righe con warning, ${summary.errorRows ?? 0} righe con errori.`;
  const suffix = practiceId ? `
Practice: \`${practiceId}\`` : '';
  const retention = download.retainedUntil ? `
Retention ZIP: fino a ${download.retainedUntil}` : '';
  await sendChannelMessage(`${finalMessage}${suffix}
Download: ${download.url}
Valido fino a: ${download.expiresAt}
Max download: ${download.maxDownloads}${retention}`, { reply_message_id: message.id, message_reference: { message_id: message.id, channel_id: CHANNEL_ID, guild_id: GUILD_ID } });
  console.log(JSON.stringify({ ok: true, practiceId, downloadUrl: download.url, jobId, messageId: message.id }));
}

main().catch(async (err) => {
  const text = err instanceof Error ? err.message : String(err);
  try { await sendChannelMessage(`Errore batch inatteso: ${text.slice(0, 1500)}`); } catch {}
  console.error(err);
  process.exit(1);
});
