import { describe, expect, it } from 'vite-plus/test';
import { canonicalPvpGameId, validatePvpGameManifest } from './manifest';

const manifest = {
  schemaVersion: 2,
  apiVersion: 2,
  gameId: 'JackpotGame',
  defaultLocale: 'en',
  locales: { en: { name: 'Jackpot' } },
  presentation: {
    mode: 'full-iframe',
    hostPanels: { lobby: false, history: false, status: false },
  },
  lobby: {
    access: 'public',
    entries: 'repeatable',
    defaultStake: '1000000',
    usesLobbyKeys: true,
  },
  capabilities: {
    createLobby: true,
    enterLobby: true,
    startLobby: true,
    submitAction: false,
    cancelLobby: true,
    claimWinnings: false,
    claimRefund: true,
    resize: true,
  },
} as const;

describe('PvP v2 manifest', () => {
  it('accepts repeat-entry games without player-count or fixed-buy-in fields', () => {
    const result = validatePvpGameManifest(manifest);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.lobby.entries).toBe('repeatable');
  });

  it('accepts manifests with and without the optional claimPayout capability', () => {
    expect(validatePvpGameManifest(manifest).ok).toBe(true);
    const withClaimPayout = validatePvpGameManifest({
      ...manifest,
      capabilities: { ...manifest.capabilities, claimPayout: true },
    });
    expect(withClaimPayout.ok).toBe(true);
    if (withClaimPayout.ok) expect(withClaimPayout.manifest.capabilities.claimPayout).toBe(true);
  });

  it('rejects API v1 manifests', () => {
    expect(validatePvpGameManifest({ ...manifest, schemaVersion: 1 }).ok).toBe(false);
  });

  it('requires default stake hints to use base-unit integer strings', () => {
    const result = validatePvpGameManifest({
      ...manifest,
      lobby: { ...manifest.lobby, defaultStake: '1.5' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/lobby\.defaultStake/);
      expect(result.reason).not.toBe('Manifest lobby is invalid.');
    }
  });

  it('surfaces field-level lobby validation errors', () => {
    const result = validatePvpGameManifest({
      ...manifest,
      lobby: { ...manifest.lobby, entries: 'repeat' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/lobby\.entries/);
      expect(result.reason).not.toBe('Manifest lobby is invalid.');
    }
  });

  it('canonicalizes game contract names', () => {
    expect(canonicalPvpGameId('JackpotGame')).toBe('jackpot');
  });
});
