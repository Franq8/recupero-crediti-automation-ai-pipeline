#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertDocxBytesToPdf, getPdfConversionAvailability } from '../dist/pdf.js';
import {
  buildDiscordPdfJobResultZip,
  readDiscordPdfJobInputZip
} from '../dist/discord-pdf-jobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_API_BASE = process.env.DOC_GENERATOR_API_BASE || 'https://automazionerecuperi.lawlabs.cloud/api';
const API_BASE = DEFAULT_API_BASE.replace(/\/$/, '');
const WORKER_SECRET = String(process.env.DOCGEN_WORKER_SHARED_SECRET ?? '').trim();
const WORKER_ID = String(process.env.DOCGEN_PDF_WORKER_ID ?? `${os.hostname()}-word-pdf`).trim();
const POLL_MS = Math.max(1500, Number.parseInt(process.env.DOCGEN_PDF_WORKER_POLL_MS || '3000', 10) || 3000);
const USER_AGENT = 'rca-doc-generator-pdf-worker/1.0';

if (!WORKER_SECRET) throw new Error('Missing DOCGEN_WORKER_SHARED_SECRET');

async function api(pathname, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('User-Agent', USER_AGENT);
  headers.set('x-rca-docgen-worker-secret', WORKER_SECRET);
  const res = await fetch(`${API_BASE}${pathname}`, { ...init, headers });
  if (!res.ok) throw new Error(`API ${pathname} failed: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function claimJob() {
  const payload = await api('/discord/v1/pdf-jobs/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workerId: WORKER_ID })
  });
  return payload?.data || null;
}

async function completeJob(jobId, resultZipBase64, provider) {
  await api(`/discord/v1/pdf-jobs/${jobId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resultZipBase64, provider })
  });
}

async function failJob(jobId, error) {
  await api(`/discord/v1/pdf-jobs/${jobId}/fail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: String(error instanceof Error ? error.message : error).slice(0, 4000) })
  });
}

async function processJob(job) {
  const docs = await readDiscordPdfJobInputZip(Buffer.from(job.inputZipBase64, 'base64'));
  const availability = await getPdfConversionAvailability();
  if (!availability.available) throw new Error(availability.reason || 'No PDF converter available on worker');

  const results = [];
  const providers = new Set();
  for (const doc of docs) {
    const pdf = await convertDocxBytesToPdf(doc);
    results.push({ filename: pdf.filename, bytes: pdf.bytes });
    providers.add(pdf.provider);
  }

  const resultZip = await buildDiscordPdfJobResultZip(results);
  const provider = providers.size === 1 ? Array.from(providers)[0] : 'mixed';
  await completeJob(job.jobId, Buffer.from(resultZip).toString('base64'), provider);
  console.log(JSON.stringify({ ok: true, jobId: job.jobId, source: job.source, converted: results.length, provider }));
}

async function main() {
  console.log(JSON.stringify({ ok: true, status: 'starting', workerId: WORKER_ID, apiBase: API_BASE, cwd: __dirname }));
  while (true) {
    const job = await claimJob();
    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      continue;
    }

    try {
      await processJob(job);
    } catch (error) {
      try { await failJob(job.jobId, error); } catch (reportError) { console.error(reportError); }
      console.error(error);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
