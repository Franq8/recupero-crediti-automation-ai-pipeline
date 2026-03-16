import JSZip from 'jszip';
import {
  listTemplatePlaceholderKeys,
  parseTemplatePlaceholders,
  replaceCanonicalPlaceholders
} from './placeholder-grammar.js';

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

function isWordArtifactKey(key: string) {
  const trimmed = String(key || '').trim();
  if (!trimmed) return true;
  if (/^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/i.test(trimmed)) return true;
  if (/^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/i.test(trimmed.replace(/[{}]/g, ''))) return true;
  if (/[<>]/.test(trimmed)) return true;
  return false;
}

function extractMergeFieldName(instr: string): string | null {
  const m = instr.match(/MERGEFIELD\s+"?([A-Za-z0-9_\.]+)"?/i);
  return m?.[1] ?? null;
}

type ParagraphTextNode = {
  start: number;
  end: number;
  textStart: number;
  textEnd: number;
  text: string;
};

function replaceMustacheAndChevrons(xml: string, replacements: Record<string, string>) {
  let out = replaceCanonicalPlaceholders(xml, replacements);
  for (const [key, value] of Object.entries(replacements)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\{\{\s*${escapedKey}\s*\}\}`, 'g'), value);
    out = out.replace(new RegExp(`«\s*${escapedKey}\s*»`, 'g'), value);
  }
  return out;
}

function replaceCanonicalPlaceholdersInParagraphRuns(
  paragraphXml: string,
  replacements: Record<string, string>
) {
  const textNodeRegex = /<w:t([^>]*)>([\s\S]*?)<\/w:t>/g;
  const nodes: ParagraphTextNode[] = [];
  const pieces: string[] = [];

  for (const match of paragraphXml.matchAll(textNodeRegex)) {
    const attrs = match[1] ?? '';
    const text = match[2] ?? '';
    const full = match[0];
    const start = match.index ?? 0;
    const openTag = `<w:t${attrs}>`;
    const textStart = start + openTag.length;
    const textEnd = textStart + text.length;
    nodes.push({ start, end: start + full.length, textStart, textEnd, text });
    pieces.push(text);
  }

  if (!nodes.length) return paragraphXml;

  const paragraphText = pieces.join('');
  const placeholders = parseTemplatePlaceholders(paragraphText)
    .map((item) => ({
      raw: item.raw,
      value: replacements[item.key] ?? replacements[
        Object.keys(replacements).find((key) => key.toLowerCase().trim() === item.key.toLowerCase().trim()) ?? ''
      ]
    }))
    .filter((item): item is { raw: string; value: string } => typeof item.value === 'string');

  if (!placeholders.length) return paragraphXml;

  const ops: Array<{ start: number; end: number; value: string }> = [];
  let searchFrom = 0;
  for (const item of placeholders) {
    const start = paragraphText.indexOf(item.raw, searchFrom);
    if (start === -1) continue;
    ops.push({ start, end: start + item.raw.length, value: item.value });
    searchFrom = start + item.raw.length;
  }

  if (!ops.length) return paragraphXml;

  const charToNodeIndex: number[] = [];
  let cursor = 0;
  nodes.forEach((node, nodeIndex) => {
    for (let i = 0; i < node.text.length; i += 1) charToNodeIndex[cursor + i] = nodeIndex;
    cursor += node.text.length;
  });

  const replacementsByNode = nodes.map((node) => node.text);
  for (let i = ops.length - 1; i >= 0; i -= 1) {
    const op = ops[i];
    const startNodeIndex = charToNodeIndex[op.start];
    const endNodeIndex = charToNodeIndex[op.end - 1];
    if (startNodeIndex === undefined || endNodeIndex === undefined) continue;

    const startNodeBase = nodes.slice(0, startNodeIndex).reduce((sum, node) => sum + node.text.length, 0);
    const endNodeBase = nodes.slice(0, endNodeIndex).reduce((sum, node) => sum + node.text.length, 0);
    const startOffset = op.start - startNodeBase;
    const endOffset = op.end - endNodeBase;

    const prefix = replacementsByNode[startNodeIndex].slice(0, startOffset);
    const suffix = replacementsByNode[endNodeIndex].slice(endOffset);
    replacementsByNode[startNodeIndex] = `${prefix}${op.value}${suffix}`;
    for (let nodeIndex = startNodeIndex + 1; nodeIndex <= endNodeIndex; nodeIndex += 1) {
      replacementsByNode[nodeIndex] = '';
    }
  }

  let out = paragraphXml;
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    out = `${out.slice(0, node.textStart)}${replacementsByNode[i]}${out.slice(node.textEnd)}`;
  }

  return out;
}

export function replaceCanonicalPlaceholdersPreservingDocxRuns(
  xml: string,
  replacements: Record<string, string>
) {
  return xml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraphXml) =>
    replaceCanonicalPlaceholdersInParagraphRuns(paragraphXml, replacements)
  );
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
    for (const m of mergeMatches) {
      const key = String(m[1] ?? '').trim();
      if (!isWordArtifactKey(key)) keys.add(key);
    }

    const textNodes = [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
    const linearText = textNodes.join('');
    if (!linearText) continue;

    const mustacheMatches = linearText.matchAll(/\{\{\s*([A-Za-z0-9_\.]+)\s*\}\}/g);
    for (const m of mustacheMatches) {
      const key = String(m[1] ?? '').trim();
      if (!isWordArtifactKey(key)) keys.add(key);
    }

    const chevronMatches = linearText.matchAll(/«\s*([A-Za-z0-9_\.]+)\s*»/g);
    for (const m of chevronMatches) {
      const key = String(m[1] ?? '').trim();
      if (!isWordArtifactKey(key)) keys.add(key);
    }

    for (const key of listTemplatePlaceholderKeys(linearText)) {
      if (!isWordArtifactKey(key)) keys.add(key);
    }
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
    xml = replaceCanonicalPlaceholdersPreservingDocxRuns(xml, replacements);
    xml = replaceMustacheAndChevrons(xml, replacements);
    xml = replaceFldSimple(xml, replacements);
    xml = replaceComplexFieldRuns(xml, replacements);

    zip.file(fileName, xml);
  }

  return zip.generateAsync({ type: 'uint8array' });
}
