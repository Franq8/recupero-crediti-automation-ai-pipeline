import JSZip from 'jszip';

const API = 'http://localhost:8787';

async function mkDocx(xmlText) {
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
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${xmlText}</w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array' });
}

async function postJson(path, payload, expected) {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (expected && res.status !== expected) throw new Error(`${path} expected ${expected}, got ${res.status} ${text}`);
  if (!expected && !res.ok) throw new Error(`${path} -> ${res.status} ${text}`);
  return { status: res.status, data };
}

async function postForm(path, form) {
  const res = await fetch(`${API}${path}`, { method: 'POST', body: form });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${text}`);
  return data;
}

async function createPracticeAndTemplate(name, xmlText) {
  const practice = await postJson('/practices', { actor: 'matrix-test' });
  const practiceId = practice.data.data.id;
  const docx = await mkDocx(xmlText);
  const fd = new FormData();
  fd.append('name', name);
  fd.append('actor', 'matrix-test');
  fd.append('file', new Blob([docx], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), `${name}.docx`);
  const tpl = await postForm('/templates', fd);
  const templateId = tpl.data.id;
  await postJson(`/practices/${practiceId}/select-template`, { templateId, actor: 'matrix-test' });
  return { practiceId, templateId };
}

async function verifyDocumentFlowNoSpecial() {
  const { practiceId, templateId } = await createPracticeAndTemplate('matrix-doc-no-special', '<w:p><w:r><w:t>[tribunale]</w:t></w:r></w:p><w:p><w:r><w:t>Valore: {{tribunale}}</w:t></w:r></w:p>');
  const set = await postJson(`/practices/${practiceId}/document-sets`, { label: 'Set A', actor: 'matrix-test' });
  const documentSetId = set.data.data.id;
  const fd = new FormData();
  fd.append('actor', 'matrix-test');
  fd.append('kind', 'PRACTICE_DOCUMENT');
  fd.append('documentSetId', documentSetId);
  fd.append('file', new Blob(['Documento di prova'], { type: 'text/plain' }), 'doc.txt');
  await postForm(`/practices/${practiceId}/files`, fd);

  const prep = await postJson(`/practices/${practiceId}/workflow/prepare`, { actor: 'matrix-test', mode: 'STANDARD_DOCUMENT_SET', templateId, documentSetId, simpleFieldValues: { tribunale: 'Milano' } });
  if (prep.data.data.phase !== 'first-table') throw new Error('document flow first-table missing');
  if (prep.data.data.hasSpecialPlaceholders !== false) throw new Error('document flow no-special misdetected');
  const gen = await fetch(`${API}/practices/${practiceId}/generate-docx-from-row`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: 'matrix-test', rowIndex: 1, templateId }) });
  if (!gen.ok) throw new Error(`document flow generate failed ${gen.status}`);
  return 'iter-doc-no-special ok';
}

async function verifyDocumentFlowWithSpecial() {
  const { practiceId, templateId } = await createPracticeAndTemplate('matrix-doc-special', '<w:p><w:r><w:t>[tribunale]</w:t></w:r></w:p><w:p><w:r><w:t>[[giudice]]</w:t></w:r></w:p><w:p><w:r><w:t>[[[clausola_finale]]]</w:t></w:r></w:p><w:p><w:r><w:t>{{tribunale}}</w:t></w:r></w:p>');
  const set = await postJson(`/practices/${practiceId}/document-sets`, { label: 'Set B', actor: 'matrix-test' });
  const documentSetId = set.data.data.id;
  const fd = new FormData();
  fd.append('actor', 'matrix-test');
  fd.append('kind', 'PRACTICE_DOCUMENT');
  fd.append('documentSetId', documentSetId);
  fd.append('file', new Blob(['Documento con contesto'], { type: 'text/plain' }), 'doc.txt');
  await postForm(`/practices/${practiceId}/files`, fd);

  const prep = await postJson(`/practices/${practiceId}/workflow/prepare`, { actor: 'matrix-test', mode: 'STANDARD_DOCUMENT_SET', templateId, documentSetId, simpleFieldValues: { tribunale: 'Roma' } });
  if (!prep.data.data.hasSpecialPlaceholders) throw new Error('document flow special missing');
  const enrich = await postJson(`/practices/${practiceId}/workflow/enrich`, { actor: 'matrix-test', templateId, rowIndex: 1, deriveValues: { giudice: 'Dott. Verdi' }, generateValues: { clausola_finale: 'Testo finale' } });
  if (enrich.data.data.phase !== 'final-table') throw new Error('final-table missing');
  const row = await fetch(`${API}/practices/${practiceId}/table-rows/1`);
  const rowJson = await row.json();
  if (rowJson.data.values.giudice !== 'Dott. Verdi') throw new Error('derive not persisted');
  if (rowJson.data.values.clausola_finale !== 'Testo finale') throw new Error('generate not persisted');
  return 'iter-doc-special ok';
}

async function verifyTableFlowMismatchAndSpecial() {
  const { practiceId, templateId } = await createPracticeAndTemplate('matrix-table-special', '<w:p><w:r><w:t>Valore: {{tribunale}}</w:t></w:r></w:p><w:p><w:r><w:t>DI: {{di_numero}}</w:t></w:r></w:p><w:p><w:r><w:t>[[giudice]]</w:t></w:r></w:p>');
  const csv = ['row_id,tribunale,extra_colonna', '1,Napoli,foo'].join('\n');
  const importFd = new FormData();
  importFd.append('actor', 'matrix-test');
  importFd.append('file', new Blob([csv], { type: 'text/csv' }), 'table.csv');
  await postForm(`/practices/${practiceId}/import`, importFd);

  const prep = await postJson(`/practices/${practiceId}/workflow/prepare`, { actor: 'matrix-test', mode: 'DETERMINISTIC_TABLE_FIRST', templateId, rowIndex: 1 });
  const cmp = prep.data.data.comparison;
  if (cmp.outcome !== 'non-match') throw new Error('table mismatch not reported');
  if (!cmp.missing.includes('di_numero')) throw new Error('missing column not reported');
  const enrich = await postJson(`/practices/${practiceId}/workflow/enrich`, { actor: 'matrix-test', templateId, rowIndex: 1, deriveValues: { giudice: 'Dott.ssa Neri' } });
  if (enrich.data.data.row.values.giudice !== 'Dott.ssa Neri') throw new Error('table special enrich failed');
  const gen = await fetch(`${API}/practices/${practiceId}/generate-docx-from-row`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: 'matrix-test', rowIndex: 1, templateId }) });
  if (!gen.ok) throw new Error(`table flow generate failed ${gen.status}`);
  return 'iter-table-mismatch-special ok';
}

const results = [];
results.push(await verifyDocumentFlowNoSpecial());
results.push(await verifyDocumentFlowWithSpecial());
results.push(await verifyTableFlowMismatchAndSpecial());
console.log('MATRIX_VERIFY_OK');
for (const item of results) console.log(item);
