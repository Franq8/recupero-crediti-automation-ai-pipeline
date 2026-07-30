import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || path.join(os.homedir(), '.openclaw', 'openclaw.json');

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function jsonPointerGet(value, pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return undefined;
  return pointer.slice(1).split('/').reduce((current, segment) => {
    if (current === undefined || current === null) return undefined;
    return current[segment.replace(/~1/g, '/').replace(/~0/g, '~')];
  }, value);
}

function resolveSecretReference(ref, config, configPath) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return '';
  if (ref.source === 'env') return typeof process.env[ref.id] === 'string' ? process.env[ref.id] : '';
  if (ref.source !== 'file' || typeof ref.provider !== 'string' || typeof ref.id !== 'string') return '';

  const provider = config?.secrets?.providers?.[ref.provider];
  if (!provider || provider.source !== 'file' || typeof provider.path !== 'string') return '';
  const secretPath = path.isAbsolute(provider.path) ? provider.path : path.resolve(path.dirname(configPath), provider.path);
  const secrets = readJson(secretPath, `OpenClaw secret provider "${ref.provider}"`);
  const token = jsonPointerGet(secrets, ref.id);
  return typeof token === 'string' ? token : '';
}

export function loadDiscordBotToken(configPath = OPENCLAW_CONFIG_PATH) {
  const config = readJson(configPath, 'OpenClaw config');
  const configured = config?.channels?.discord?.token;
  if (typeof configured === 'string') return configured;
  return resolveSecretReference(configured, config, configPath);
}
