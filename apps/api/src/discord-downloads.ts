import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { prisma } from './prisma.js';

const DOWNLOAD_LINK_TTL_MS = 60 * 60 * 1000;
const DOWNLOAD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DOWNLOAD_MAX_COUNT = 3;
const CANONICAL_PUBLIC_API_BASE_URL = 'https://automazionerecuperi.lawlabs.cloud/api';

function resolveStorageDir() {
  const configured = String(process.env.DISCORD_DOWNLOAD_STORAGE_DIR ?? '').trim();
  if (configured) return path.resolve(configured);
  return path.resolve('/data/discord-downloads');
}

function isLocalhostLikeHost(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized.startsWith('localhost:') || normalized.startsWith('127.0.0.1:') || normalized.startsWith('[::1]');
}

function sanitizePublicApiBaseUrl(value: string) {
  const normalized = value.trim().replace(/\/$/, '');
  if (!normalized) return '';

  try {
    const url = new URL(normalized);
    if (isLocalhostLikeHost(url.host) || isLocalhostLikeHost(url.hostname)) return '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function buildPublicBaseUrl(headers?: Record<string, unknown>) {
  const configured = sanitizePublicApiBaseUrl(String(process.env.PUBLIC_API_BASE_URL ?? ''));
  if (configured) return configured;

  const forwardedProto = String(headers?.['x-forwarded-proto'] ?? '').trim();
  const forwardedHost = String(headers?.['x-forwarded-host'] ?? '').trim();
  const forwardedPrefix = String(headers?.['x-forwarded-prefix'] ?? '').trim().replace(/\/$/, '');
  if (forwardedHost) {
    const proto = forwardedProto || (isLocalhostLikeHost(forwardedHost) ? 'http' : 'https');
    const derived = sanitizePublicApiBaseUrl(`${proto}://${forwardedHost}${forwardedPrefix}`);
    if (derived) return derived;
  }

  const host = String(headers?.host ?? '').trim();
  if (host) {
    const proto = forwardedProto || (isLocalhostLikeHost(host) ? 'http' : 'https');
    const derived = sanitizePublicApiBaseUrl(`${proto}://${host}`);
    if (derived) return derived;
    if (isLocalhostLikeHost(host)) return `${proto}://${host}`.replace(/\/$/, '');
  }

  return CANONICAL_PUBLIC_API_BASE_URL;
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function safeTokenEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function generateDownloadToken() {
  return randomBytes(24).toString('base64url');
}

export async function persistDiscordDownloadBatch(input: {
  practiceId: string;
  zipFilename: string;
  zipBytes: Uint8Array;
  actor: string;
}) {
  await cleanupExpiredDiscordDownloadBatches();

  const storageDir = resolveStorageDir();
  await fs.mkdir(storageDir, { recursive: true });

  const retainedUntil = new Date(Date.now() + DOWNLOAD_RETENTION_MS);
  const storedFilename = `${input.practiceId}.zip`;
  const absolutePath = path.join(storageDir, storedFilename);
  await fs.writeFile(absolutePath, Buffer.from(input.zipBytes));

  const token = generateDownloadToken();
  const tokenHash = hashToken(token);
  const tokenExpiresAt = new Date(Date.now() + DOWNLOAD_LINK_TTL_MS);
  const relativePath = path.posix.join('discord-downloads', storedFilename);
  const sha256 = createHash('sha256').update(input.zipBytes).digest('hex');

  const batch = await prisma.discordDownloadBatch.upsert({
    where: { practiceId: input.practiceId },
    create: {
      id: crypto.randomUUID(),
      practiceId: input.practiceId,
      zipFilename: input.zipFilename,
      zipRelativePath: relativePath,
      zipSha256: sha256,
      zipSizeBytes: input.zipBytes.length,
      retainedUntil,
      tokenHash,
      tokenExpiresAt,
      tokenMaxDownloads: DOWNLOAD_MAX_COUNT,
      tokenDownloadCount: 0,
      createdBy: input.actor
    },
    update: {
      zipFilename: input.zipFilename,
      zipRelativePath: relativePath,
      zipSha256: sha256,
      zipSizeBytes: input.zipBytes.length,
      retainedUntil,
      tokenHash,
      tokenExpiresAt,
      tokenMaxDownloads: DOWNLOAD_MAX_COUNT,
      tokenDownloadCount: 0,
      createdBy: input.actor,
      updatedAt: new Date()
    }
  });

  return { batch, token, tokenExpiresAt, retainedUntil, absolutePath };
}

export async function regenerateDiscordDownloadLink(practiceId: string) {
  await cleanupExpiredDiscordDownloadBatches();
  const batch = await prisma.discordDownloadBatch.findUnique({ where: { practiceId } });
  if (!batch) return null;
  if (batch.retainedUntil.getTime() <= Date.now()) return null;

  const absolutePath = path.join(resolveStorageDir(), path.basename(batch.zipRelativePath));
  try {
    await fs.access(absolutePath);
  } catch {
    return null;
  }

  const token = generateDownloadToken();
  const tokenHash = hashToken(token);
  const tokenExpiresAt = new Date(Date.now() + DOWNLOAD_LINK_TTL_MS);

  const updated = await prisma.discordDownloadBatch.update({
    where: { id: batch.id },
    data: {
      tokenHash,
      tokenExpiresAt,
      tokenMaxDownloads: DOWNLOAD_MAX_COUNT,
      tokenDownloadCount: 0,
      updatedAt: new Date()
    }
  });

  return { batch: updated, token, tokenExpiresAt, retainedUntil: updated.retainedUntil, absolutePath };
}

export async function resolveDiscordDownloadByToken(token: string) {
  await cleanupExpiredDiscordDownloadBatches();
  const tokenHash = hashToken(token);
  const candidates = await prisma.discordDownloadBatch.findMany({ where: { tokenHash } });
  const batch = candidates.find((item) => safeTokenEqual(item.tokenHash, tokenHash));
  if (!batch) return { error: 'not_found' as const };
  if (batch.tokenExpiresAt.getTime() <= Date.now()) return { error: 'token_expired' as const, batch };
  if (batch.retainedUntil.getTime() <= Date.now()) return { error: 'batch_expired' as const, batch };
  if (batch.tokenDownloadCount >= batch.tokenMaxDownloads) return { error: 'download_limit_reached' as const, batch };

  const absolutePath = path.join(resolveStorageDir(), path.basename(batch.zipRelativePath));
  try {
    const file = await fs.readFile(absolutePath);
    const updated = await prisma.discordDownloadBatch.update({
      where: { id: batch.id },
      data: {
        tokenDownloadCount: { increment: 1 },
        lastDownloadedAt: new Date(),
        updatedAt: new Date()
      }
    });
    return { batch: updated, bytes: file };
  } catch {
    return { error: 'file_missing' as const, batch };
  }
}

export async function cleanupExpiredDiscordDownloadBatches() {
  const expired = await prisma.discordDownloadBatch.findMany({
    where: {
      retainedUntil: { lte: new Date() }
    }
  });
  if (!expired.length) return { deletedFiles: 0, deletedRows: 0 };

  let deletedFiles = 0;
  for (const batch of expired) {
    const absolutePath = path.join(resolveStorageDir(), path.basename(batch.zipRelativePath));
    try {
      await fs.unlink(absolutePath);
      deletedFiles += 1;
    } catch {}
  }

  const deleted = await prisma.discordDownloadBatch.deleteMany({
    where: { id: { in: expired.map((item) => item.id) } }
  });

  return { deletedFiles, deletedRows: deleted.count };
}

export function buildDiscordDownloadUrl(baseUrl: string, token: string) {
  return `${baseUrl}/discord/v1/downloads/${encodeURIComponent(token)}`;
}

export function formatDiscordDownloadWindow(input: { tokenExpiresAt: Date; retainedUntil: Date; maxDownloads: number }) {
  const expiresInMinutes = Math.max(1, Math.round((input.tokenExpiresAt.getTime() - Date.now()) / 60000));
  const retainedUntilIso = input.retainedUntil.toISOString();
  return `link valido ${expiresInMinutes} min, max ${input.maxDownloads} download, ZIP conservato fino a ${retainedUntilIso}`;
}
