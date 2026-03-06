const API = process.env.API_URL || 'http://localhost:8787';

async function postJson(path, payload) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function run() {
  // 1) create practice through discord command
  const created = await postJson('/discord/command', {
    channelId: process.env.DISCORD_OPERATIVE_CHANNEL_ID || '1471526846259527725',
    user: 'discord-smoke',
    command: 'new'
  });
  const practiceId = created.data.practiceId;
  if (!practiceId) throw new Error('No practiceId returned');

  // 2) set minimal fields via command
  await postJson('/discord/command', {
    channelId: process.env.DISCORD_OPERATIVE_CHANNEL_ID || '1471526846259527725',
    user: 'discord-smoke',
    command: 'set',
    practiceId,
    args: { fieldKey: 'tribunale', value: 'Treviso' }
  });

  await postJson('/discord/router', {
    channelId: process.env.DISCORD_OPERATIVE_CHANNEL_ID || '1471526846259527725',
    user: 'discord-smoke',
    text: `/precetto set ${practiceId} di_numero=667/2024`
  });

  // 3) status
  const status = await postJson('/discord/command', {
    channelId: process.env.DISCORD_OPERATIVE_CHANNEL_ID || '1471526846259527725',
    user: 'discord-smoke',
    command: 'status',
    practiceId
  });

  if (!status.data?.text?.includes(practiceId)) {
    throw new Error('Status text missing practice id');
  }

  console.log('DISCORD_SMOKE_OK', practiceId);
}

run().catch((e) => {
  console.error('DISCORD_SMOKE_FAIL', e.message);
  process.exit(1);
});
