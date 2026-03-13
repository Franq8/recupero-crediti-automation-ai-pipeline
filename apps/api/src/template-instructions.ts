import JSZip from 'jszip';

export type PlaceholderKind = 'extract' | 'derive' | 'generate';

export type TemplateInstruction = {
  raw: string;
  key: string;
  kind: PlaceholderKind;
};

function normalizeKey(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

export async function extractTemplateInstructions(docxBytes: Uint8Array): Promise<TemplateInstruction[]> {
  const zip = await JSZip.loadAsync(docxBytes);
  const docXml = await zip.file('word/document.xml')?.async('text');
  if (!docXml) return [];

  const textNodes = [...docXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
  const text = textNodes.join(' ');

  const out: TemplateInstruction[] = [];
  const seen = new Set<string>();

  // Order matters: triple -> double -> single
  const triple = [...text.matchAll(/\[\[\[\s*([^\]]+?)\s*\]\]\]/g)];
  for (const m of triple) {
    const key = normalizeKey(m[1]);
    const sig = `generate:${key}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ raw: m[0], key, kind: 'generate' });
  }

  const double = [...text.matchAll(/\[\[\s*([^\]]+?)\s*\]\]/g)];
  for (const m of double) {
    // Skip triple already captured
    if (m[0].startsWith('[[[')) continue;
    const key = normalizeKey(m[1]);
    const sig = `derive:${key}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ raw: m[0], key, kind: 'derive' });
  }

  const single = [...text.matchAll(/\[\s*([^\[\]]+?)\s*\]/g)];
  for (const m of single) {
    // Ignore brackets belonging to double/triple
    const raw = m[0];
    if (raw.startsWith('[[') || raw.endsWith(']]')) continue;
    const key = normalizeKey(m[1]);
    const sig = `extract:${key}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ raw, key, kind: 'extract' });
  }

  return out;
}
