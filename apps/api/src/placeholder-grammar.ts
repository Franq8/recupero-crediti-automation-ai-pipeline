export type PlaceholderKind = 'extract' | 'derive' | 'generate';

export type ParsedPlaceholder = {
  raw: string;
  key: string;
  kind: PlaceholderKind;
  instruction: string | null;
};

function normalizeKey(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

function normalizeInstruction(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeForLookup(input: string) {
  return input.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function parseTemplatePlaceholders(text: string): ParsedPlaceholder[] {
  const out: ParsedPlaceholder[] = [];
  const seen = new Set<string>();

  const push = (item: ParsedPlaceholder) => {
    const sig = `${item.kind}:${item.key}:${item.instruction ?? ''}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push(item);
  };

  const generateMatches = text.matchAll(/\[\[\s*\{\s*([^{}]+?)\s*\}\s*([\s\S]*?)\s*\]\]/g);
  for (const match of generateMatches) {
    const key = normalizeKey(match[1]);
    const instruction = normalizeInstruction(match[2] ?? '');
    if (!key || !instruction) continue;
    push({ raw: match[0], key, kind: 'generate', instruction });
  }

  const deriveMatches = text.matchAll(/\[\s*\{\s*([^{}]+?)\s*\}\s*([\s\S]*?)\s*\]/g);
  for (const match of deriveMatches) {
    const raw = match[0];
    const start = match.index ?? 0;
    const before = text.slice(Math.max(0, start - 1), start);
    const after = text.slice(start + raw.length, start + raw.length + 1);
    if (before === '[' || after === ']') continue;
    if (raw.startsWith('[[') && raw.endsWith(']]')) continue;
    const key = normalizeKey(match[1]);
    const instruction = normalizeInstruction(match[2] ?? '');
    if (!key || !instruction) continue;
    push({ raw, key, kind: 'derive', instruction });
  }

  const extractMatches = text.matchAll(/\{\s*([^{}\[\]]+?)\s*\}/g);
  for (const match of extractMatches) {
    const key = normalizeKey(match[1]);
    if (!key) continue;
    const before = text.slice(Math.max(0, match.index - 2), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 2);
    if (before.endsWith('[[') || before.endsWith('[') || after.startsWith(']]') || after.startsWith(']')) continue;
    push({ raw: match[0], key, kind: 'extract', instruction: null });
  }

  return out;
}

export function listTemplatePlaceholderKeys(text: string): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const item of parseTemplatePlaceholders(text)) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    keys.push(item.key);
  }
  return keys;
}

export function replaceCanonicalPlaceholders(xml: string, replacements: Record<string, string>) {
  let out = xml;

  for (const [key, value] of Object.entries(replacements)) {
    const escapedKey = escapeRegex(key);
    out = out.replace(new RegExp(`\\{\\s*${escapedKey}\\s*\\}`, 'g'), value);
    out = out.replace(new RegExp(`\\[\\s*\\{\\s*${escapedKey}\\s*\\}\\s*[\\s\\S]*?\\]`, 'g'), value);
    out = out.replace(new RegExp(`\\[\\[\\s*\\{\\s*${escapedKey}\\s*\\}\\s*[\\s\\S]*?\\]\\]`, 'g'), value);
  }

  out = out.replace(/\[\[\s*\{\s*([^{}]+?)\s*\}\s*[\s\S]*?\]\]/g, (full, rawKey) => {
    const norm = normalizeForLookup(String(rawKey));
    const found = Object.entries(replacements).find(([key]) => normalizeForLookup(key) === norm);
    return found ? found[1] : full;
  });

  out = out.replace(/\[\s*\{\s*([^{}]+?)\s*\}\s*[\s\S]*?\]/g, (full, rawKey) => {
    const norm = normalizeForLookup(String(rawKey));
    const found = Object.entries(replacements).find(([key]) => normalizeForLookup(key) === norm);
    return found ? found[1] : full;
  });

  out = out.replace(/\{\s*([^{}\[\]]+?)\s*\}/g, (full, rawKey) => {
    const norm = normalizeForLookup(String(rawKey));
    const found = Object.entries(replacements).find(([key]) => normalizeForLookup(key) === norm);
    return found ? found[1] : full;
  });

  return out;
}
