import JSZip from 'jszip';
import { parseTemplatePlaceholders, type ParsedPlaceholder, type PlaceholderKind } from './placeholder-grammar.js';

export type { PlaceholderKind };

export type TemplateInstruction = ParsedPlaceholder;

export async function extractTemplateInstructions(docxBytes: Uint8Array): Promise<TemplateInstruction[]> {
  const zip = await JSZip.loadAsync(docxBytes);
  const chunks: string[] = [];

  for (const name of Object.keys(zip.files)) {
    if (!name.startsWith('word/') || !name.endsWith('.xml')) continue;
    const xml = await zip.file(name)?.async('text');
    if (!xml) continue;
    const textNodes = [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
    if (textNodes.length) chunks.push(textNodes.join(''));
  }

  return parseTemplatePlaceholders(chunks.join(' '));
}
