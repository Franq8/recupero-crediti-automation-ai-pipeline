import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function ensureDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) return;

  const here = path.dirname(fileURLToPath(import.meta.url));
  const apiRoot = path.resolve(here, '..');
  const envPath = path.join(apiRoot, '.env');

  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }

  if (!process.env.DATABASE_URL?.trim()) {
    process.env.DATABASE_URL = 'file:./dev.db';
  }
}

ensureDatabaseUrl();

export const prisma = new PrismaClient();
