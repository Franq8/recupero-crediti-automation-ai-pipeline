export type StructuredRowResult = {
  deriveValues?: Record<string, unknown>;
  generateValues?: Record<string, unknown>;
};

export type NormalizedStructuredRowResult = {
  deriveValues: Record<string, unknown>;
  generateValues: Record<string, unknown>;
};

export type StructuredBatchDiagnostic = {
  rowIndex: number;
  deriveKeys: string[];
  generateKeys: string[];
  missingDeriveKeys: string[];
  missingGenerateKeys: string[];
};

export type StructuredBatchAnalysis = {
  expectedRowIndexes: number[];
  returnedRowIndexes: number[];
  returnedRowKeys: string[];
  unexpectedRowKeys: string[];
  missingRowIndexes: number[];
  incompleteRowIndexes: number[];
  rowResults: Record<string, NormalizedStructuredRowResult>;
  diagnostics: StructuredBatchDiagnostic[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueNonEmptyKeys(keys: string[]) {
  return Array.from(new Set(keys.map((key) => String(key ?? '').trim()).filter(Boolean)));
}

function findMissingExpectedKeys(expectedKeys: string[], values: Record<string, unknown>) {
  return uniqueNonEmptyKeys(expectedKeys).filter((key) => !Object.prototype.hasOwnProperty.call(values, key));
}

export function normalizeStructuredRowResult(structured: StructuredRowResult | null | undefined): NormalizedStructuredRowResult {
  return {
    deriveValues: isRecord(structured?.deriveValues) ? structured.deriveValues : {},
    generateValues: isRecord(structured?.generateValues) ? structured.generateValues : {}
  };
}

export function analyzeStructuredBatchRows(input: {
  structuredRows: unknown;
  rowIndexes: number[];
  deriveKeys: string[];
  generateKeys: string[];
}): StructuredBatchAnalysis {
  const rows = isRecord(input.structuredRows) ? input.structuredRows : {};
  const expectedRowIndexes = input.rowIndexes.filter((rowIndex) => Number.isFinite(rowIndex) && rowIndex > 0);
  const expectedRowKeys = new Set(expectedRowIndexes.map((rowIndex) => String(rowIndex)));
  const returnedRowKeys = Object.keys(rows);
  const returnedRowIndexes = returnedRowKeys
    .map((rowKey) => Number(rowKey))
    .filter((rowIndex) => Number.isFinite(rowIndex) && rowIndex > 0);
  const unexpectedRowKeys = returnedRowKeys.filter((rowKey) => !expectedRowKeys.has(rowKey));
  const rowResults: Record<string, NormalizedStructuredRowResult> = {};
  const diagnostics: StructuredBatchDiagnostic[] = [];
  const missingRowIndexes: number[] = [];
  const incompleteRowIndexes: number[] = [];

  for (const rowIndex of expectedRowIndexes) {
    const rowKey = String(rowIndex);
    const hasRow = Object.prototype.hasOwnProperty.call(rows, rowKey);
    const normalized = normalizeStructuredRowResult(hasRow ? (rows[rowKey] as StructuredRowResult) : undefined);
    const missingDeriveKeys = findMissingExpectedKeys(input.deriveKeys, normalized.deriveValues);
    const missingGenerateKeys = findMissingExpectedKeys(input.generateKeys, normalized.generateValues);

    rowResults[rowKey] = normalized;
    diagnostics.push({
      rowIndex,
      deriveKeys: Object.keys(normalized.deriveValues),
      generateKeys: Object.keys(normalized.generateValues),
      missingDeriveKeys,
      missingGenerateKeys
    });

    if (!hasRow) missingRowIndexes.push(rowIndex);
    if (!hasRow || missingDeriveKeys.length || missingGenerateKeys.length) incompleteRowIndexes.push(rowIndex);
  }

  return {
    expectedRowIndexes,
    returnedRowIndexes,
    returnedRowKeys,
    unexpectedRowKeys,
    missingRowIndexes,
    incompleteRowIndexes,
    rowResults,
    diagnostics
  };
}
