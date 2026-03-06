import { z } from 'zod';

export const createPracticeSchema = z.object({
  caseType: z.string().default('precetto_di'),
  schemaVer: z.string().default('1.0.0'),
  actor: z.string().default('system')
});

export const upsertFieldSchema = z.object({
  fieldKey: z.string().min(1),
  value: z.unknown(),
  sourceType: z.enum(['manual', 'import', 'document', 'derived']).default('manual'),
  sourceRef: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  status: z.enum(['AUTO_OK', 'NEEDS_REVIEW', 'MANUAL', 'MISSING']),
  actor: z.string().default('user')
});

export const uploadTemplateSchema = z.object({
  name: z.string().min(1),
  actor: z.string().default('user')
});
