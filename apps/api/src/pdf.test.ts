import test from 'node:test';
import assert from 'node:assert/strict';
import { getPdfConversionAvailability } from './pdf.js';

test('pdf availability reports unavailable when Word is disabled and LibreOffice fallback is not enabled', async () => {
  const previousWordDisable = process.env.PDF_WORD_DISABLE;
  const previousLibreFallback = process.env.PDF_ENABLE_LIBREOFFICE_FALLBACK;
  const previousWordAppPath = process.env.WORD_APP_PATH;
  const previousSofficeBin = process.env.SOFFICE_BIN;

  process.env.PDF_WORD_DISABLE = '1';
  process.env.PDF_ENABLE_LIBREOFFICE_FALLBACK = '0';
  process.env.WORD_APP_PATH = '/definitely/missing/Microsoft Word.app';
  process.env.SOFFICE_BIN = '/definitely/missing/soffice';

  try {
    const availability = await getPdfConversionAvailability();
    assert.equal(availability.available, false);
    assert.match(String(availability.reason ?? ''), /No PDF renderer available/);
  } finally {
    if (previousWordDisable === undefined) delete process.env.PDF_WORD_DISABLE;
    else process.env.PDF_WORD_DISABLE = previousWordDisable;

    if (previousLibreFallback === undefined) delete process.env.PDF_ENABLE_LIBREOFFICE_FALLBACK;
    else process.env.PDF_ENABLE_LIBREOFFICE_FALLBACK = previousLibreFallback;

    if (previousWordAppPath === undefined) delete process.env.WORD_APP_PATH;
    else process.env.WORD_APP_PATH = previousWordAppPath;

    if (previousSofficeBin === undefined) delete process.env.SOFFICE_BIN;
    else process.env.SOFFICE_BIN = previousSofficeBin;
  }
});
