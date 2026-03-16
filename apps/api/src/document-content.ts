import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import { extractSpreadsheetDocumentText } from './importer.js';

export async function extractTextByMime(buf: Buffer, mime: string, filename: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (mime.includes('pdf') || lower.endsWith('.pdf')) {
    const out = await pdf(buf);
    return out.text || '';
  }

  if (mime.includes('wordprocessingml') || lower.endsWith('.docx')) {
    const out = await mammoth.extractRawText({ buffer: buf });
    return out.value || '';
  }

  const spreadsheetText = await extractSpreadsheetDocumentText(filename, mime, buf);
  if (spreadsheetText !== null) return spreadsheetText;

  return buf.toString('utf-8');
}
