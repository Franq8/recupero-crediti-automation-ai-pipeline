import JSZip from 'jszip';
import { listTemplatePlaceholderKeys, replaceCanonicalPlaceholders } from './placeholder-grammar.js';

const XML_TARGETS = [
  'word/document.xml',
  'word/header1.xml',
  'word/header2.xml',
  'word/header3.xml',
  'word/footer1.xml',
  'word/footer2.xml',
  'word/footer3.xml'
];

function xmlEscape(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'SI' : 'NO';
  return String(value);
}

function extractMergeFieldName(instr: string): string | null {
  const m = instr.match(/MERGEFIELD\s+"?([A-Za-z0-9_\.]+)"?/i);
  return m?.[1] ?? null;
}

function replaceMustacheAndChevrons(xml: string, replacements: Record<string, string>) {
  let out = replaceCanonicalPlaceholders(xml, replacements);
  for (const [key, value] of Object.entries(replacements)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\{\{\s*${escapedKey}\s*\}\}`, 'g'), value);
    out = out.replace(new RegExp(`«\s*${escapedKey}\s*»`, 'g'), value);
  }
  return out;
}

// Handles: <w:fldSimple w:instr=" MERGEFIELD fieldName ... "> ... <w:t>...</w:t> ... </w:fldSimple>
function replaceFldSimple(xml: string, replacements: Record<string, string>) {
  return xml.replace(/<w:fldSimple([^>]*)>([\s\S]*?)<\/w:fldSimple>/g, (full, attrs, inner) => {
    const instrMatch = attrs.match(/w:instr="([^"]+)"/);
    if (!instrMatch) return full;
    const field = extractMergeFieldName(instrMatch[1]);
    if (!field || !(field in replacements)) return full;

    const val = replacements[field];
    const patchedInner = inner.replace(/<w:t[^>]*>[\s\S]*?<\/w:t>/, `<w:t>${val}</w:t>`);
    return `<w:fldSimple${attrs}>${patchedInner}</w:fldSimple>`;
  });
}

// Handles complex MERGEFIELD with begin/instrText/separate/result/end
function replaceComplexFieldRuns(xml: string, replacements: Record<string, string>) {
  // paragraph-level heuristic: process each paragraph independently
  return xml.replace(/<w:p[\s\S]*?<\/w:p>/g, (pXml) => {
    const instrMatches = [...pXml.matchAll(/<w:instrText[^>]*>([\s\S]*?)<\/w:instrText>/g)];
    if (!instrMatches.length) return pXml;

    let out = pXml;
    for (const im of instrMatches) {
      const field = extractMergeFieldName(im[1]);
      if (!field || !(field in replacements)) continue;
      const val = replacements[field];

      // from <w:fldChar w:fldCharType="separate"/> to <w:fldChar w:fldCharType="end"/>
      out = out.replace(
        /(<w:fldChar[^>]*w:fldCharType="separate"[^>]*\/>)([\s\S]*?)(<w:fldChar[^>]*w:fldCharType="end"[^>]*\/>)|(<w:fldChar[^>]*w:fldCharType="separate"[^>]*>\s*<\/w:fldChar>)([\s\S]*?)(<w:fldChar[^>]*w:fldCharType="end"[^>]*>\s*<\/w:fldChar>)/,
        (...args) => {
          const sepA = args[1] ?? args[4];
          const endA = args[3] ?? args[6];
          return `${sepA}<w:r><w:t>${val}</w:t></w:r>${endA}`;
        }
      );
    }
    return out;
  });
}

export async function extractTemplateFields(docxBytes: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(docxBytes);
  const keys = new Set<string>();

  for (const name of Object.keys(zip.files)) {
    if (!name.startsWith('word/') || !name.endsWith('.xml')) continue;
    const xml = await zip.file(name)?.async('text');
    if (!xml) continue;

    const mergeMatches = xml.matchAll(/MERGEFIELD\s+"?([A-Za-z0-9_\.]+)"?/g);
    for (const m of mergeMatches) keys.add(m[1]);

    const mustacheMatches = xml.matchAll(/\{\{\s*([A-Za-z0-9_\.]+)\s*\}\}/g);
    for (const m of mustacheMatches) keys.add(m[1]);

    const chevronMatches = xml.matchAll(/«\s*([A-Za-z0-9_\.]+)\s*»/g);
    for (const m of chevronMatches) keys.add(m[1]);

    for (const key of listTemplatePlaceholderKeys(xml)) keys.add(key);
  }

  return Array.from(keys).sort();
}

export async function renderDocxTemplate(
  docxBytes: Uint8Array,
  fieldMap: Record<string, unknown>
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(docxBytes);

  const replacements = Object.fromEntries(
    Object.entries(fieldMap).map(([k, v]) => [k, xmlEscape(normalizeValue(v))])
  );

  for (const fileName of XML_TARGETS) {
    const file = zip.file(fileName);
    if (!file) continue;

    let xml = await file.async('text');
    xml = replaceMustacheAndChevrons(xml, replacements);
    xml = replaceFldSimple(xml, replacements);
    xml = replaceComplexFieldRuns(xml, replacements);

    zip.file(fileName, xml);
  }

  return zip.generateAsync({ type: 'uint8array' });
}
