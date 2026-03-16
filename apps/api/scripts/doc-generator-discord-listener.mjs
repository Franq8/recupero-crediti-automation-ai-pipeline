#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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

  const form = new FormData();
  form.set('actor', `discord-doc-generator:${message.author?.username || 'unknown'}:${message.id}`);
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
  if (!message || processedMessageIds.has(message.id)) return;
  if (message.channel_id !== CHANNEL_ID) return;
  if (message.guild_id !== GUILD_ID) return;
  const attachments = normalizeAttachments(message.attachments);
  const attachmentCount = attachments.length;
  if (attachmentCount === 0) {
    await handleRegenerateRequest(message);
    return;
  }
  if (message.author?.bot) {
    if (!ALLOW_BOT_MESSAGES) return;
    const kinds = attachments.map(classifyAttachment).filter(Boolean);
    const templateCount = kinds.filter((k) => k === AttachmentKind.TEMPLATE).length;
    const tableCount = kinds.filter((k) => k === AttachmentKind.TABLE).length;
    if (!(attachmentCount === 2 && templateCount === 1 && tableCount === 1)) return;
  }
  processedMessageIds.add(message.id);
  if (processedMessageIds.size > 500) {
    const first = processedMessageIds.values().next().value;
    if (first) processedMessageIds.delete(first);
  }

  try {
    await runBatchFromMessage(message);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    log('message processing failed', text);
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
