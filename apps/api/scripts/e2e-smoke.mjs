import JSZip from 'jszip';

const API = process.env.API_URL || 'http://localhost:8787';

async function mkMinimalDocx() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.folder('_rels')?.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.folder('word')?.file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Tribunale: {{tribunale}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>DI: {{di_numero}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Capitale: {{capitale_ingiunto}}</w:t></w:r></w:p>
  </w:body>
</w:document>`);
  return zip.generateAsync({ type: 'uint8array' });
}

async function postJson(path, payload) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function postForm(path, form) {
  const res = await fetch(`${API}${path}`, { method: 'POST', body: form });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function run() {
  const health = await fetch(`${API}/health`);
  if (!health.ok) throw new Error(`API health failed: ${health.status}`);

  const p = await postJson('/practices', { actor: 'smoke' });
  const practiceId = p.data.id;
  console.log('practice:', practiceId);

  const docx = await mkMinimalDocx();
  const tplFd = new FormData();
  tplFd.append('name', 'smoke-template');
  tplFd.append('actor', 'smoke');
  tplFd.append('file', new Blob([docx], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'smoke-template.docx');
  const tpl = await postForm('/templates', tplFd);
  const templateId = tpl.data.id;
  console.log('template:', templateId);

  await postJson(`/practices/${practiceId}/select-template`, { templateId, actor: 'smoke' });
  await postJson(`/practices/${practiceId}/sync-template-fields`, { templateId, actor: 'smoke' });

  await postJson(`/practices/${practiceId}/fields`, { fieldKey: 'tribunale', value: 'Treviso', status: 'MANUAL', sourceType: 'manual', actor: 'smoke' });
  await postJson(`/practices/${practiceId}/fields`, { fieldKey: 'di_numero', value: '667/2024', status: 'MANUAL', sourceType: 'manual', actor: 'smoke' });
  await postJson(`/practices/${practiceId}/fields`, { fieldKey: 'capitale_ingiunto', value: 14594.48, status: 'MANUAL', sourceType: 'manual', actor: 'smoke' });

  const gen = await fetch(`${API}/practices/${practiceId}/generate-docx`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'smoke', templateId })
  });
  if (!gen.ok) throw new Error(`generate-docx failed: ${gen.status}`);
  const bytes = new Uint8Array(await gen.arrayBuffer());
  if (bytes.byteLength < 300) throw new Error('Generated DOCX too small');
  console.log('docx-bytes:', bytes.byteLength);

  console.log('SMOKE_OK');
}

run().catch((e) => {
  console.error('SMOKE_FAIL', e.message);
  process.exit(1);
});
