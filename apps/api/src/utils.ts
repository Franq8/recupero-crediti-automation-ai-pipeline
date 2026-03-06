import { createHash } from 'node:crypto';

export function sha256(input: Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function parseJsonSafe<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
