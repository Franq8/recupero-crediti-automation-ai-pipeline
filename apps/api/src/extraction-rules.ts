export function normalizeItalianDate(input: string): string {
  const clean = input.replace(/\./g, '/').replace(/-/g, '/');
  const m = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return input;
  const d = m[1].padStart(2, '0');
  const mo = m[2].padStart(2, '0');
  let y = m[3];
  if (y.length === 2) y = `20${y}`;
  return `${y}-${mo}-${d}`;
}

export function sanitizeEntityName(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function sanitizeMoneyNumber(raw: string): number | null {
  const cleaned = raw.replace(/\./g, '').replace(',', '.').replace(/\s+/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
