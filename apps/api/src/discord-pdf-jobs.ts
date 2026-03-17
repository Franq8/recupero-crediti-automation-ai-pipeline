import JSZip from 'jszip';

export type DiscordPdfJobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type DiscordPdfDocument = {
  filename: string;
  bytes: Uint8Array;
};

export async function buildDiscordPdfJobInputZip(documents: DiscordPdfDocument[]) {
  const zip = new JSZip();
  const docsFolder = zip.folder('generated-docx');
  for (const doc of documents) docsFolder?.file(doc.filename, doc.bytes);
  return zip.generateAsync({ type: 'uint8array' });
}

export async function readDiscordPdfJobInputZip(bytes: Uint8Array): Promise<DiscordPdfDocument[]> {
  const zip = await JSZip.loadAsync(bytes);
  const docs = Object.values(zip.files)
    .filter((file) => !file.dir && file.name.startsWith('generated-docx/') && file.name.toLowerCase().endsWith('.docx'));

  const out: DiscordPdfDocument[] = [];
  for (const file of docs) {
    const filename = file.name.replace(/^generated-docx\//, '');
    out.push({ filename, bytes: await file.async('uint8array') });
  }
  return out;
}

export async function buildDiscordPdfJobResultZip(documents: DiscordPdfDocument[]) {
  const zip = new JSZip();
  const pdfFolder = zip.folder('generated-pdf');
  for (const doc of documents) pdfFolder?.file(doc.filename, doc.bytes);
  return zip.generateAsync({ type: 'uint8array' });
}

export async function readDiscordPdfJobResultZip(bytes: Uint8Array): Promise<DiscordPdfDocument[]> {
  const zip = await JSZip.loadAsync(bytes);
  const docs = Object.values(zip.files)
    .filter((file) => !file.dir && file.name.startsWith('generated-pdf/') && file.name.toLowerCase().endsWith('.pdf'));

  const out: DiscordPdfDocument[] = [];
  for (const file of docs) {
    const filename = file.name.replace(/^generated-pdf\//, '');
    out.push({ filename, bytes: await file.async('uint8array') });
  }
  return out;
}

export function parseWorkerAuthHeader(value: unknown) {
  return String(value ?? '').trim();
}

export function workerAuthConfigured() {
  return Boolean(String(process.env.DOCGEN_WORKER_SHARED_SECRET ?? '').trim());
}

export function workerAuthMatches(value: unknown) {
  const expected = String(process.env.DOCGEN_WORKER_SHARED_SECRET ?? '').trim();
  if (!expected) return false;
  return parseWorkerAuthHeader(value) === expected;
}

export function remotePdfWorkerEnabled() {
  return String(process.env.DOCGEN_PDF_REMOTE_MODE ?? '').trim().toLowerCase() === 'worker';
}
