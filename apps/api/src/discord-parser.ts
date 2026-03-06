export type ParsedDiscordCommand = {
  command: string;
  practiceId?: string;
  args: Record<string, unknown>;
};

function parseKeyValue(token: string): [string, string] | null {
  const i = token.indexOf('=');
  if (i <= 0) return null;
  return [token.slice(0, i), token.slice(i + 1)];
}

export function parseDiscordPrecettoMessage(input: string): ParsedDiscordCommand | null {
  const raw = input.trim();
  if (!raw.startsWith('/precetto')) return null;

  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;

  const cmd = parts[1].toLowerCase();
  const args: Record<string, unknown> = {};
  let practiceId: string | undefined;

  if (['status', 'extract', 'generate', 'generate-fast', 'attach', 'export', 'interessi', 'set'].includes(cmd)) {
    practiceId = parts[2];
  }

  if (cmd === 'set') {
    practiceId = parts[2];
    const kv = parseKeyValue(parts.slice(3).join(' '));
    if (!kv) return null;
    args.fieldKey = kv[0];
    args.value = kv[1];
  }

  if (cmd === 'interessi') {
    practiceId = parts[2];
    for (const t of parts.slice(3)) {
      const kv = parseKeyValue(t);
      if (kv) args[kv[0]] = kv[1];
    }
  }

  if (['generate', 'generate-fast'].includes(cmd)) {
    for (const t of parts.slice(3)) {
      const kv = parseKeyValue(t);
      if (kv) args[kv[0]] = kv[1];
    }
  }

  if (['attach', 'export', 'status', 'extract'].includes(cmd)) {
    for (const t of parts.slice(3)) {
      const kv = parseKeyValue(t);
      if (kv) args[kv[0]] = kv[1];
    }
  }

  return { command: cmd, practiceId, args };
}
