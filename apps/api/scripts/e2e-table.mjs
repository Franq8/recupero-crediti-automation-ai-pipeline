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
    <w:p><w:r><w:t>Tribunale: {tribunale}</w:t></w:r></w:p>
    <w:p><w:r><w:t>DI: [{di_numero} estrai il numero del decreto]</w:t></w:r></w:p>
    <w:p><w:r><w:t>Capitale: [[{capitale_ingiunto} genera il capitale finale]]</w:t></w:r></w:p>
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

async function extractDocumentXml(docxBytes) {
  const zip = await JSZip.loadAsync(docxBytes);
  return zip.file('word/document.xml')?.async('string');
}

async function run() {
  const p = await postJson('/practices', { actor: 'smoke-table' });
  const practiceId = p.data.id;

  const docx = await mkMinimalDocx();
  const tplFd = new FormData();
  tplFd.append('name', 'smoke-table-template');
  tplFd.append('actor', 'smoke-table');
  tplFd.append('file', new Blob([docx], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'smoke-table-template.docx');
  const tpl = await postForm('/templates', tplFd);
  const templateId = tpl.data.id;
  await postJson(`/practices/${practiceId}/select-template`, { templateId, actor: 'smoke-table' });

  const structureRes = await fetch(`${API}/templates/${templateId}/table-structure/csv`);
  const structureCsv = await structureRes.text();
  if (!structureRes.ok) throw new Error('table-structure failed');
  if (!structureCsv.includes('row_id') || !structureCsv.includes('tribunale') || !structureCsv.includes('di_numero') || !structureCsv.includes('capitale_ingiunto')) throw new Error('clean keys missing from table structure');
  if (structureCsv.includes('{tribunale}') || structureCsv.includes('[{di_numero}') || structureCsv.includes('[[{capitale_ingiunto}')) throw new Error('table structure leaked raw placeholder syntax');

  const csv = [
    'row_id,tribunale,di_numero,capitale_ingiunto',
    '1,Treviso,100/2026,1000.00',
    '2,Padova,101/2026,2500.50'
  ].join('\n');

  const importFd = new FormData();
  importFd.append('actor', 'smoke-table');
  importFd.append('file', new Blob([csv], { type: 'text/csv' }), 'batch.csv');
  const imported = await postForm(`/practices/${practiceId}/import`, importFd);
  if (imported.data.importedRows !== 2) throw new Error('imported rows mismatch');

  const prepare = await postJson(`/practices/${practiceId}/workflow/prepare`, { actor: 'smoke-table', mode: 'DETERMINISTIC_TABLE_FIRST', templateId });
  if (!prepare.data?.hasSpecialPlaceholders) throw new Error('special placeholders not detected');

  const enrich = await postJson(`/practices/${practiceId}/workflow/enrich`, {
    actor: 'smoke-table',
    templateId,
    rowIndex: 2,
    deriveValues: { di_numero: '101/2026' },
    generateValues: { capitale_ingiunto: '2500.50' }
  });
  const finalValues = enrich.data?.row?.values ?? {};
  if (!('tribunale' in finalValues) || !('di_numero' in finalValues) || !('capitale_ingiunto' in finalValues)) throw new Error('final table missing clean keys');

  const docRes = await fetch(`${API}/practices/${practiceId}/generate-docx-from-row`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'smoke-table', rowIndex: 2, templateId })
  });
  if (!docRes.ok) throw new Error(`generate-docx-from-row failed: ${docRes.status}`);
  const docBytes = new Uint8Array(await docRes.arrayBuffer());
  const xml = await extractDocumentXml(docBytes);
  if (!xml?.includes('Padova') || !xml?.includes('101/2026') || !xml?.includes('2500.50')) throw new Error('generated docx not populated from clean keys');

  console.log('TABLE_SMOKE_OK');
}

run().catch((e) => {
  console.error('TABLE_SMOKE_FAIL', e.message);
  process.exit(1);
});
