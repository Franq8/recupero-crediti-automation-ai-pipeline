#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || path.join(os.homedir(), '.openclaw', 'openclaw.json');
const CHANNEL_ID = process.env.DOC_GENERATOR_CHANNEL_ID || '1482018084020551883';
const TEMPLATE_PATH = process.env.DOCGEN_TEMPLATE || path.resolve('tmp/discord-v1-fixtures/doc-generator-sample-template.docx');
const TABLE_PATH = process.env.DOCGEN_TABLE || path.resolve('tmp/discord-v1-fixtures/doc-generator-sample.csv');

function loadToken() {
  const raw = fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf8');
  const json = JSON.parse(raw);
  return json?.channels?.discord?.token || '';
}

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || loadToken();
if (!BOT_TOKEN) throw new Error('Missing Discord bot token');

async function main() {
  const form = new FormData();
  form.set('payload_json', JSON.stringify({ content: '' }));
  form.set('files[0]', new Blob([fs.readFileSync(TEMPLATE_PATH)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), path.basename(TEMPLATE_PATH));
  form.set('files[1]', new Blob([fs.readFileSync(TABLE_PATH)], { type: 'text/csv' }), path.basename(TABLE_PATH));

  const res = await fetch(`https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${BOT_TOKEN}` },
    body: form
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Discord upload failed ${res.status}: ${text}`);
  console.log(text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
