import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDiscordPdfJobInputZip,
  buildDiscordPdfJobResultZip,
  readDiscordPdfJobInputZip,
  readDiscordPdfJobResultZip,
  workerAuthMatches
} from './discord-pdf-jobs.js';

test('discord pdf job input zip roundtrips docx payloads', async () => {
  const zipBytes = await buildDiscordPdfJobInputZip([
    { filename: 'a.docx', bytes: new Uint8Array([1, 2, 3]) },
    { filename: 'b.docx', bytes: new Uint8Array([4, 5]) }
  ]);

  const docs = await readDiscordPdfJobInputZip(zipBytes);
  assert.deepEqual(docs.map((doc) => doc.filename), ['a.docx', 'b.docx']);
  assert.deepEqual(Array.from(docs[0].bytes), [1, 2, 3]);
  assert.deepEqual(Array.from(docs[1].bytes), [4, 5]);
});

test('discord pdf job result zip roundtrips pdf payloads', async () => {
  const zipBytes = await buildDiscordPdfJobResultZip([
    { filename: 'a.pdf', bytes: new Uint8Array([9, 8, 7]) }
  ]);

  const docs = await readDiscordPdfJobResultZip(zipBytes);
  assert.deepEqual(docs.map((doc) => doc.filename), ['a.pdf']);
  assert.deepEqual(Array.from(docs[0].bytes), [9, 8, 7]);
});

test('worker auth requires exact shared secret', () => {
  const previous = process.env.DOCGEN_WORKER_SHARED_SECRET;
  process.env.DOCGEN_WORKER_SHARED_SECRET = 'top-secret';
  try {
    assert.equal(workerAuthMatches('top-secret'), true);
    assert.equal(workerAuthMatches('wrong'), false);
    assert.equal(workerAuthMatches(''), false);
  } finally {
    if (previous === undefined) delete process.env.DOCGEN_WORKER_SHARED_SECRET;
    else process.env.DOCGEN_WORKER_SHARED_SECRET = previous;
  }
});
