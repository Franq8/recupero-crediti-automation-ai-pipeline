import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function splitBaseAndExt(filename: string) {
  const ext = path.extname(filename);
  return { base: ext ? filename.slice(0, -ext.length) : filename, ext };
}

async function findSofficeBinary() {
  const candidates = [process.env.SOFFICE_BIN, 'soffice', 'libreoffice'].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ['--version'], { timeout: 15000 });
      return candidate;
    } catch {}
  }
  throw new Error('PDF conversion unavailable: soffice/libreoffice not installed in runtime');
}

export async function convertDocxBytesToPdf(input: { filename: string; bytes: Uint8Array }) {
  const soffice = await findSofficeBinary();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rca-pdf-'));
  const inputDir = path.join(tempRoot, 'input');
  const outDir = path.join(tempRoot, 'out');
  await fs.mkdir(inputDir, { recursive: true });
  await fs.mkdir(outDir, { recursive: true });

  const sourcePath = path.join(inputDir, input.filename);
  await fs.writeFile(sourcePath, Buffer.from(input.bytes));

  try {
    let conversionError: unknown = null;
    try {
      await execFileAsync(
        soffice,
        ['--headless', '--nologo', '--nolockcheck', '--nodefault', '--nofirststartwizard', '--convert-to', 'pdf', '--outdir', outDir, sourcePath],
        { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }
      );
    } catch (error) {
      conversionError = error;
    }

    const { base } = splitBaseAndExt(input.filename);
    const pdfFilename = `${base}.pdf`;
    const pdfPath = path.join(outDir, pdfFilename);

    try {
      const pdfBytes = new Uint8Array(await fs.readFile(pdfPath));
      return { filename: pdfFilename, bytes: pdfBytes };
    } catch {
      if (conversionError) throw conversionError;
      throw new Error(`PDF conversion failed: output file not found for ${input.filename}`);
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}
