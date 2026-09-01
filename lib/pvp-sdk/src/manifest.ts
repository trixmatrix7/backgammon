import { z } from 'zod';
import type {
  GameManifestMetadata,
  PvpGameManifestV2,
  PvpGameManifestValidationResult,
} from './types';

const localeEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

const presentationSchema = z.object({
  mode: z.enum(['full-iframe', 'embedded']),
  hostPanels: z.object({ lobby: z.boolean(), history: z.boolean(), status: z.boolean() }),
});

const lobbySchema = z.object({
  access: z.enum(['public', 'game-defined']),
  entries: z.enum(['single', 'repeatable', 'game-defined']),
  defaultStake: z.string().regex(/^\d+$/).optional(),
  usesLobbyKeys: z.boolean(),
});

const capabilitiesSchema = z.object({
  createLobby: z.literal(true),
  enterLobby: z.boolean(),
  startLobby: z.boolean(),
  submitAction: z.boolean(),
  cancelLobby: z.boolean(),
  claimWinnings: z.boolean(),
  claimRefund: z.boolean(),
  claimPayout: z.boolean().optional(),
  resize: z.boolean(),
});

export const pvpGameManifestSchema = z
  .object({
    schemaVersion: z.literal(2, { error: 'Unsupported manifest schemaVersion or apiVersion.' }),
    apiVersion: z.literal(2, { error: 'Unsupported manifest schemaVersion or apiVersion.' }),
    gameId: z.string().min(1, { error: 'Manifest gameId and defaultLocale are required.' }),
    defaultLocale: z.string().min(1, {
      error: 'Manifest gameId and defaultLocale are required.',
    }),
    locales: z
      .record(z.string(), localeEntrySchema)
      .refine(value => Object.keys(value).length > 0, {
        error: 'Manifest locales must contain at least one locale.',
      }),
    presentation: presentationSchema,
    lobby: lobbySchema,
    capabilities: capabilitiesSchema,
    assets: z
      .object({ iconUrl: z.string().optional(), coverUrl: z.string().optional() })
      .optional(),
  })
  .superRefine((manifest, ctx) => {
    if (!manifest.locales[manifest.defaultLocale]?.name) {
      ctx.addIssue({
        code: 'custom',
        message: 'Manifest defaultLocale must exist in locales.',
        path: ['defaultLocale'],
      });
    }
  });

export const canonicalPvpGameId = (value: string | undefined | null): string => {
  if (!value) return '';
  let trimmed = value.trim();
  if (/Game$/i.test(trimmed)) trimmed = trimmed.replace(/Game$/i, '');
  return trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');
};

export const validatePvpGameManifest = (value: unknown): PvpGameManifestValidationResult => {
  const result = pvpGameManifestSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    if (issue?.path[0] === 'presentation') {
      return { ok: false, reason: 'Manifest presentation is invalid.' };
    }
    if (issue?.path[0] === 'capabilities') {
      return { ok: false, reason: 'Manifest capabilities are invalid.' };
    }
    if (issue?.path[0] === 'assets') return { ok: false, reason: 'Manifest assets are invalid.' };
    if (typeof value !== 'object' || value === null) {
      return { ok: false, reason: 'Manifest must be an object.' };
    }
    const prefix = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    return {
      ok: false,
      reason: issue?.message ? `${prefix}${issue.message}` : 'Manifest is invalid.',
    };
  }
  return { ok: true, manifest: result.data as PvpGameManifestV2 };
};

export const resolveManifestMetadata = (
  manifest: PvpGameManifestV2,
  requestedLocale: string,
): GameManifestMetadata => {
  const locale = manifest.locales[requestedLocale] ? requestedLocale : manifest.defaultLocale;
  const localized = manifest.locales[locale] ?? manifest.locales[manifest.defaultLocale];
  return {
    locale,
    name: localized.name,
    description: localized.description,
    iconUrl: manifest.assets?.iconUrl,
    coverUrl: manifest.assets?.coverUrl,
  };
};

export const assertSameOriginUrls = (manifestUrl: string, iframeUrl: string): boolean => {
  try {
    return new URL(manifestUrl).origin === new URL(iframeUrl).origin;
  } catch {
    return false;
  }
};
