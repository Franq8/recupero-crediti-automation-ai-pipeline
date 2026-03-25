import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { renderDocxTemplate, replaceCanonicalPlaceholdersPreservingDocxRuns } from './docx.js';

const replacements = { nome: 'Mario Rossi' };

test('replaceCanonicalPlaceholdersPreservingDocxRuns replaces canonical placeholders and strips brackets/instructions', () => {
  const xml = [
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:body>',
    '<w:p>',
    '<w:r><w:rPr><w:b/></w:rPr><w:t>{nome}</w:t></w:r>',
    '</w:p>',
    '<w:p>',
    '<w:r><w:rPr><w:b/></w:rPr><w:t>[{no</w:t></w:r>',
    '<w:r><w:rPr><w:b/></w:rPr><w:t>me} derivalo dal codice fiscale]</w:t></w:r>',
    '</w:p>',
    '<w:p>',
    '<w:r><w:rPr><w:i/></w:rPr><w:t>[[{nome}</w:t></w:r>',
    '<w:r><w:rPr><w:i/></w:rPr><w:t> inventa un nome epico]]</w:t></w:r>',
    '</w:p>',
    '</w:body>',
    '</w:document>'
  ].join('');

  const out = replaceCanonicalPlaceholdersPreservingDocxRuns(xml, replacements);

  assert.match(out, /<w:t>Mario Rossi<\/w:t>/);
  assert.equal((out.match(/Mario Rossi/g) ?? []).length, 3);
  assert.doesNotMatch(out, /derivalo dal codice fiscale/);
  assert.doesNotMatch(out, /inventa un nome epico/);
  assert.doesNotMatch(out, /\[|\]/);
  assert.match(out, /<w:rPr><w:b\/><\/w:rPr><w:t>Mario Rossi<\/w:t>/);
  assert.match(out, /<w:rPr><w:i\/><\/w:rPr><w:t>Mario Rossi<\/w:t>/);
});

test('renderDocxTemplate leaves placeholder text when source value is empty string', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>{campo}</w:t></w:r></w:p></w:body></w:document>');
  const buf = await zip.generateAsync({ type: 'uint8array' });
  const out = await renderDocxTemplate(buf, { campo: '' });
  const zipOut = await JSZip.loadAsync(out);
  const xml = await zipOut.file('word/document.xml')!.async('text');

  assert.match(xml, /<w:t>campo<\/w:t>/);
});

test('renderDocxTemplate removes placeholder text when source value is literal null string', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>{campo}</w:t></w:r></w:p></w:body></w:document>');
  const buf = await zip.generateAsync({ type: 'uint8array' });
  const out = await renderDocxTemplate(buf, { campo: 'null' });
  const zipOut = await JSZip.loadAsync(out);
  const xml = await zipOut.file('word/document.xml')!.async('text');

  assert.match(xml, /<w:t><\/w:t>/);
  assert.doesNotMatch(xml, /campo/);
});
