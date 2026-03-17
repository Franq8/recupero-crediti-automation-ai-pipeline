import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type PdfConversionProvider = 'word' | 'libreoffice';

export type PdfConversionResult = {
  filename: string;
  bytes: Uint8Array;
  provider: PdfConversionProvider;
};

export type PdfConversionAvailability = {
  available: boolean;
  provider?: PdfConversionProvider;
  reason?: string;
};

function splitBaseAndExt(filename: string) {
  const ext = path.extname(filename);
  return { base: ext ? filename.slice(0, -ext.length) : filename, ext };
}

function isTruthyEnv(value: string | undefined) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function commandWorks(command: string, args: string[]) {
  try {
    await execFileAsync(command, args, { timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

async function findWordApplication() {
  if (process.platform !== 'darwin' || isTruthyEnv(process.env.PDF_WORD_DISABLE)) return null;

  const envPath = String(process.env.WORD_APP_PATH ?? '').trim();
  const candidates = [
    envPath,
    '/Applications/Microsoft Word.app',
    path.join(os.homedir(), 'Applications', 'Microsoft Word.app')
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }

  if (await commandWorks('open', ['-Ra', 'Microsoft Word'])) return 'Microsoft Word';
  return null;
}

async function findSofficeBinary() {
  if (!isTruthyEnv(process.env.PDF_ENABLE_LIBREOFFICE_FALLBACK)) return null;
  const candidates = [process.env.SOFFICE_BIN, 'soffice', 'libreoffice'].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (await commandWorks(candidate, ['--version'])) return candidate;
  }
  return null;
}

async function convertWithWord(input: { filename: string; bytes: Uint8Array }): Promise<PdfConversionResult> {
  const wordApp = await findWordApplication();
  if (!wordApp) throw new Error('Microsoft Word automation is not available on this Mac');

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rca-word-pdf-'));
  const inputDir = path.join(tempRoot, 'input');
  const outDir = path.join(tempRoot, 'out');
  await fs.mkdir(inputDir, { recursive: true });
  await fs.mkdir(outDir, { recursive: true });

  const sourcePath = path.join(inputDir, input.filename);
  const { base } = splitBaseAndExt(input.filename);
  const pdfFilename = `${base}.pdf`;
  const pdfPath = path.join(outDir, pdfFilename);
  await fs.writeFile(sourcePath, Buffer.from(input.bytes));

  const scriptLines = [
    'on run argv',
    'set inputPosix to item 1 of argv',
    'set outputPosix to item 2 of argv',
    'set inputFile to POSIX file inputPosix',
    'set outputFile to POSIX file outputPosix',
    'tell application "Microsoft Word"',
    'activate',
    'set display alerts to alerts none',
    'set sourceDoc to open inputFile read only true',
    'save as sourceDoc file name outputFile file format format PDF',
    'close sourceDoc saving no',
    'end tell',
    'end run'
  ];

  try {
    await execFileAsync('osascript', [...scriptLines.flatMap((line) => ['-e', line]), sourcePath, pdfPath], {
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, HOME: process.env.HOME ?? os.homedir() }
    });

    const pdfBytes = new Uint8Array(await fs.readFile(pdfPath));
    return { filename: pdfFilename, bytes: pdfBytes, provider: 'word' };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function convertWithLibreOffice(input: { filename: string; bytes: Uint8Array }): Promise<PdfConversionResult> {
  const soffice = await findSofficeBinary();
  if (!soffice) throw new Error('LibreOffice fallback is not enabled or not installed in runtime');

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rca-pdf-'));
  const inputDir = path.join(tempRoot, 'input');
  const outDir = path.join(tempRoot, 'out');
  const profileDir = path.join(tempRoot, 'profile');
  await fs.mkdir(inputDir, { recursive: true });
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(profileDir, { recursive: true });

  const sourcePath = path.join(inputDir, input.filename);
  await fs.writeFile(sourcePath, Buffer.from(input.bytes));

  try {
    let conversionError: unknown = null;
    try {
      await execFileAsync(
        soffice,
        [
          '--headless',
          '--nologo',
          '--nolockcheck',
          '--nodefault',
          '--nofirststartwizard',
          `-env:UserInstallation=file://${profileDir}`,
          '--convert-to',
          'pdf',
          '--outdir',
          outDir,
          sourcePath
        ],
        { timeout: 120000, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, HOME: tempRoot } }
      );
    } catch (error) {
      conversionError = error;
    }

    const { base } = splitBaseAndExt(input.filename);
    const pdfFilename = `${base}.pdf`;
    const pdfPath = path.join(outDir, pdfFilename);

    try {
      const pdfBytes = new Uint8Array(await fs.readFile(pdfPath));
      return { filename: pdfFilename, bytes: pdfBytes, provider: 'libreoffice' };
    } catch {
      if (conversionError) throw conversionError;
      throw new Error(`PDF conversion failed: output file not found for ${input.filename}`);
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export async function getPdfConversionAvailability(): Promise<PdfConversionAvailability> {
  if (await findWordApplication()) {
    return { available: true, provider: 'word' };
  }

  if (await findSofficeBinary()) {
    return { available: true, provider: 'libreoffice' };
  }

  return {
    available: false,
    reason: 'No PDF renderer available. Install Microsoft Word on the Mac mini or explicitly enable LibreOffice fallback.'
  };
}

export async function convertDocxBytesToPdf(input: { filename: string; bytes: Uint8Array }): Promise<PdfConversionResult> {
  const providers: Array<() => Promise<PdfConversionResult>> = [];

  if (await findWordApplication()) providers.push(() => convertWithWord(input));
  if (await findSofficeBinary()) providers.push(() => convertWithLibreOffice(input));

  let lastError: unknown = null;
  for (const provider of providers) {
    try {
      return await provider();
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error('PDF conversion unavailable: no renderer available (Microsoft Word preferred, LibreOffice fallback optional)');
}
