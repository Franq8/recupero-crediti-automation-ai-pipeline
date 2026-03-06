import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import { normalizeItalianDate, sanitizeEntityName, sanitizeMoneyNumber } from './extraction-rules.js';

export type ExtractedField = {
  value: unknown;
  confidence: number;
  sourceRef: string;
};

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

  return buf.toString('utf-8');
}

function excerptAround(text: string, index: number, radius = 90) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function capture(
  fieldKey: string,
  match: RegExpMatchArray | null,
  source: string,
  confidence: number,
  parser: (m: RegExpMatchArray) => unknown = (m) => m[1]
): [string, ExtractedField] | null {
  if (!match || match.index === undefined) return null;
  const value = parser(match);
  if (value === null || value === undefined || value === '') return null;
  return [
    fieldKey,
    {
      value,
      confidence,
      sourceRef: excerptAround(source, match.index)
    }
  ];
}

export function extractPrecettoFieldsDetailed(text: string): Record<string, ExtractedField> {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const out: Record<string, ExtractedField> = {};

  const diMatch = normalized.match(/D\.?I\.?\s*n\.?\s*(\d+\/?\d{2,4})/i);
  const rgMatch = normalized.match(/R\.?G\.?\s*n\.?\s*(\d+\/?\d{2,4})/i);
  const tribunalMatch = normalized.match(/Tribunale\s+di\s+([A-Za-zÀ-ÿ' ]+)/i);

  const capitaleMatch = normalized.match(/somma\s+di\s+€?\.?\s*([\d\.,]+)/i)
    || normalized.match(/Capitale\s+€\s*([\d\.,]+)/i);

  const notificaMatch = normalized.match(/notificat[oa]\s+in\s+data\s+(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/i);
  const esecMatch = normalized.match(/dichiarat[oa]\s+esecutiv[oa]\s+in\s+data\s+(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/i);

  // party-side extraction (LLM-first strategy will later enrich this; regex as fallback helper)
  const creditoreMatch = normalized.match(/Il\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ'\-\s\.]{4,120}?)\s*,\s*con\s+sede/i);
  const debitoreMatch = normalized.match(/ingiungev[ao]\s+a(?:lla|al|alla\s+Società|alla\s+Societa)?\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9'\-\s\.]{4,120}?)(?:\s*\(|,\s*con\s+sede)/i);
  const avvMatch = normalized.match(/Avv\.\s*([A-ZÀ-Ÿ][A-Za-zÀ-ÿ'\-\s]{3,80})/i);
  const pecMatch = normalized.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);

  for (const c of [
    capture('di_numero', diMatch, normalized, 0.92),
    capture('rg_numero', rgMatch, normalized, 0.9),
    capture('tribunale', tribunalMatch, normalized, 0.85, (m) => sanitizeEntityName(m[1])),
    capture('di_data_notifica', notificaMatch, normalized, 0.78, (m) => normalizeItalianDate(m[1])),
    capture('di_data_esecutorieta', esecMatch, normalized, 0.82, (m) => normalizeItalianDate(m[1])),
    capture('creditore_denominazione', creditoreMatch, normalized, 0.6, (m) => sanitizeEntityName(m[1])),
    capture('debitore_denominazione_nome', debitoreMatch, normalized, 0.62, (m) => sanitizeEntityName(m[1])),
    capture('avvocato_nome', avvMatch, normalized, 0.7, (m) => sanitizeEntityName(m[1])),
    capture('avvocato_pec', pecMatch, normalized, 0.72, (m) => m[1].toLowerCase())
  ]) {
    if (c) out[c[0]] = c[1];
  }

  if (capitaleMatch && capitaleMatch.index !== undefined) {
    const amount = sanitizeMoneyNumber(capitaleMatch[1]);
    if (amount !== null) {
      out.capitale_ingiunto = {
        value: amount,
        confidence: 0.78,
        sourceRef: excerptAround(normalized, capitaleMatch.index)
      };
    }
  }

  if (esecMatch) {
    out.esecutorieta_rilevata_auto = {
      value: 'SI',
      confidence: 0.8,
      sourceRef: excerptAround(normalized, esecMatch.index ?? 0)
    };
  } else {
    out.esecutorieta_rilevata_auto = {
      value: 'INCERTA',
      confidence: 0.4,
      sourceRef: 'Nessuna formula chiara di esecutorietà trovata nel testo estratto'
    };
  }

  return out;
}
