import JSZip from 'jszip';

const API = process.env.API_URL || 'http://localhost:8787';

async function mkDocx(lines) {
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
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array' });
}

async function readGeneratedDoc(zip, rowIndex) {
  const fileName = Object.keys(zip.files).find((file) => file.startsWith('generated-docx/') && file.includes(`row${rowIndex}_`) && file.endsWith('.docx'));
  if (!fileName) throw new Error(`missing generated doc for row ${rowIndex}`);
  const bytes = await zip.file(fileName)?.async('uint8array');
  const docZip = await JSZip.loadAsync(bytes);
  return docZip.file('word/document.xml')?.async('string');
}

async function runCase(name, templateLines, csv, expectSecondPhase) {
  const form = new FormData();
  form.append('actor', `discord-test-${name}`);
  form.append('file', new Blob([await mkDocx(templateLines)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), `${name}.docx`);
  form.append('file', new Blob([csv], { type: 'text/csv' }), `${name}.csv`);

  const res = await fetch(`${API}/discord/v1/template-table-autocontinue`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`${name}: endpoint failed ${res.status}`);
  if (!String(res.headers.get('content-type') || '').includes('application/zip')) throw new Error(`${name}: expected zip response`);

  const summary = JSON.parse(res.headers.get('x-rca-discord-summary') || '{}');
  if (summary.totalRows !== 2) throw new Error(`${name}: totalRows mismatch`);
  if (summary.generatedCount !== 2) throw new Error(`${name}: generatedCount mismatch`);
  if (Boolean(summary.hasSecondPhase) !== expectSecondPhase) throw new Error(`${name}: second phase mismatch`);

  const zip = await JSZip.loadAsync(await res.arrayBuffer());
  const report = await zip.file('report.md')?.async('string');
  const summaryCsv = await zip.file('summary.csv')?.async('string');
  if (!report?.includes('Discord v1 post-run report')) throw new Error(`${name}: report missing`);
  if (!summaryCsv?.includes('row_id')) throw new Error(`${name}: summary csv missing`);

  const generatedFiles = Object.keys(zip.files).filter((file) => file.startsWith('generated-docx/') && file.endsWith('.docx'));
  if (generatedFiles.length !== 2) throw new Error(`${name}: expected 2 generated docx, got ${generatedFiles.length}`);
  if (expectSecondPhase && !report.includes('Executed: yes')) throw new Error(`${name}: enrich phase not reported`);
  if (!expectSecondPhase && !report.includes('Executed: no')) throw new Error(`${name}: enrich skip not reported`);

  const row1Xml = await readGeneratedDoc(zip, 1);
  const row2Xml = await readGeneratedDoc(zip, 2);
  if (!row1Xml || !row2Xml) throw new Error(`${name}: missing generated document xml`);
  if (row1Xml.includes('{') || row1Xml.includes('[{') || row1Xml.includes('[[{')) throw new Error(`${name}: canonical placeholders still present in row 1`);
  if (row2Xml.includes('{') || row2Xml.includes('[{') || row2Xml.includes('[[{')) throw new Error(`${name}: canonical placeholders still present in row 2`);
}

async function run() {
  await runCase(
    'simple',
    ['Tribunale: {tribunale}', 'DI: {di_numero}', 'Capitale: {capitale_ingiunto}'],
    ['row_id,tribunale,di_numero,capitale_ingiunto', '1,Treviso,100/2026,1000.00', '2,Padova,101/2026,2500.50'].join('\n'),
    false
  );

  await runCase(
    'special',
    ['Tribunale: {tribunale}', 'DI: [{di_numero} estrai il numero del decreto]', 'Calc: [[{totale_complessivo} genera il totale complessivo finale]]'],
    ['row_id,tribunale,di_numero,totale_complessivo', '1,Treviso,100/2026,1000.00', '2,Padova,101/2026,2500.50'].join('\n'),
    true
  );

  console.log('DISCORD_V1_OK');
}

run().catch((error) => {
  console.error('DISCORD_V1_FAIL', error.message);
  process.exit(1);
});
