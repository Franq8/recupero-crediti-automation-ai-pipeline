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

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }

  out.push(cur);
  return out;
}

function parseSummaryCsv(csv) {
  const lines = String(csv || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, idx) => [header, values[idx] ?? '']));
  });
}

async function readGeneratedDoc(zip, filename) {
  const fileName = Object.keys(zip.files).find((file) => file === `generated-docx/${filename}`);
  if (!fileName) throw new Error(`missing generated doc ${filename}`);
  const bytes = await zip.file(fileName)?.async('uint8array');
  const docZip = await JSZip.loadAsync(bytes);
  return docZip.file('word/document.xml')?.async('string');
}

async function runCase(name, templateLines, csv, expectSecondPhase, rowFlowResults) {
  const form = new FormData();
  form.append('actor', `discord-test-${name}`);
  form.append('file', new Blob([await mkDocx(templateLines)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), `${name}.docx`);
  form.append('file', new Blob([csv], { type: 'text/csv' }), `${name}.csv`);
  if (rowFlowResults) form.append('openclawRowFlowResultsJson', JSON.stringify(rowFlowResults));

  const res = await fetch(`${API}/discord/v1/template-table-autocontinue`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`${name}: endpoint failed ${res.status}`);
  if (!String(res.headers.get('content-type') || '').includes('application/json')) throw new Error(`${name}: expected json response`);

  const summary = JSON.parse(res.headers.get('x-rca-discord-summary') || '{}');
  const payload = await res.json();
  if (summary.totalRows !== 2) throw new Error(`${name}: totalRows mismatch`);
  if (summary.generatedCount !== 2) throw new Error(`${name}: generatedCount mismatch`);
  if (Boolean(summary.hasSecondPhase) !== expectSecondPhase) throw new Error(`${name}: second phase mismatch`);
  const downloadUrl = payload?.data?.download?.url || res.headers.get('x-rca-discord-download-url');
  if (!downloadUrl) throw new Error(`${name}: missing download url`);

  const downloadRes = await fetch(downloadUrl);
  if (!downloadRes.ok) throw new Error(`${name}: download failed ${downloadRes.status}`);
  if (!String(downloadRes.headers.get('content-type') || '').includes('application/zip')) throw new Error(`${name}: expected zip download`);

  const zip = await JSZip.loadAsync(await downloadRes.arrayBuffer());
  const report = await zip.file('report.md')?.async('string');
  const summaryCsv = await zip.file('summary.csv')?.async('string');
  if (!report?.includes('Discord v1 post-run report')) throw new Error(`${name}: report missing`);
  if (!summaryCsv?.includes('row_id')) throw new Error(`${name}: summary csv missing`);
  const summaryRows = parseSummaryCsv(summaryCsv);

  const generatedFiles = Object.keys(zip.files).filter((file) => file.startsWith('generated-docx/') && file.endsWith('.docx'));
  if (generatedFiles.length !== 2) throw new Error(`${name}: expected 2 generated docx, got ${generatedFiles.length}`);
  if (expectSecondPhase && !report.includes('Executed: yes')) throw new Error(`${name}: enrich phase not reported`);
  if (!expectSecondPhase && !report.includes('Executed: no')) throw new Error(`${name}: enrich skip not reported`);

  const row1Filename = summaryRows.find((row) => row.row_id === '1')?.filename;
  const row2Filename = summaryRows.find((row) => row.row_id === '2')?.filename;
  if (!row1Filename || !row2Filename) throw new Error(`${name}: summary csv missing filenames`);

  const row1Xml = await readGeneratedDoc(zip, row1Filename);
  const row2Xml = await readGeneratedDoc(zip, row2Filename);
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
    true,
    {
      '1': {
        deriveValues: { di_numero: '100/2026' },
        generateValues: { totale_complessivo: '1000.00' }
      },
      '2': {
        deriveValues: { di_numero: '101/2026' },
        generateValues: { totale_complessivo: '2500.50' }
      }
    }
  );

  console.log('DISCORD_V1_OK');
}

run().catch((error) => {
  console.error('DISCORD_V1_FAIL', error.message);
  process.exit(1);
});
