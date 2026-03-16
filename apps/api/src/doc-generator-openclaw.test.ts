import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStructuredBatchRows } from './doc-generator-openclaw.js';

test('analyzeStructuredBatchRows flags missing rows and missing required placeholder keys', () => {
  const analysis = analyzeStructuredBatchRows({
    structuredRows: {
      '1': {
        deriveValues: { 'La/Vi': 'La' },
        generateValues: { 'Suo/Vostro': 'Suo' }
      },
      '3': {
        deriveValues: { 'La/Vi': '' },
        generateValues: {}
      },
      unexpected: {
        deriveValues: { ignored: true }
      }
    },
    rowIndexes: [1, 2, 3],
    deriveKeys: ['La/Vi'],
    generateKeys: ['Suo/Vostro']
  });

  assert.deepEqual(analysis.returnedRowKeys, ['1', '3', 'unexpected']);
  assert.deepEqual(analysis.missingRowIndexes, [2]);
  assert.deepEqual(analysis.incompleteRowIndexes, [2, 3]);
  assert.deepEqual(analysis.unexpectedRowKeys, ['unexpected']);
  assert.deepEqual(analysis.rowResults['1'], {
    deriveValues: { 'La/Vi': 'La' },
    generateValues: { 'Suo/Vostro': 'Suo' }
  });
  assert.deepEqual(analysis.rowResults['2'], {
    deriveValues: {},
    generateValues: {}
  });
  assert.deepEqual(analysis.diagnostics, [
    {
      rowIndex: 1,
      deriveKeys: ['La/Vi'],
      generateKeys: ['Suo/Vostro'],
      missingDeriveKeys: [],
      missingGenerateKeys: []
    },
    {
      rowIndex: 2,
      deriveKeys: [],
      generateKeys: [],
      missingDeriveKeys: ['La/Vi'],
      missingGenerateKeys: ['Suo/Vostro']
    },
    {
      rowIndex: 3,
      deriveKeys: ['La/Vi'],
      generateKeys: [],
      missingDeriveKeys: [],
      missingGenerateKeys: ['Suo/Vostro']
    }
  ]);
});

test('analyzeStructuredBatchRows treats explicit empty-string values as complete keys', () => {
  const analysis = analyzeStructuredBatchRows({
    structuredRows: {
      '7': {
        deriveValues: { 'La/Vi': '' },
        generateValues: { 'Suo/Vostro': '' }
      }
    },
    rowIndexes: [7],
    deriveKeys: ['La/Vi'],
    generateKeys: ['Suo/Vostro']
  });

  assert.deepEqual(analysis.missingRowIndexes, []);
  assert.deepEqual(analysis.incompleteRowIndexes, []);
});
