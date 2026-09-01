export type HexString = `0x${string}`;

export type PvpMetadataPrimitive = string | number | boolean | null;
export type PvpMetadataValue =
  | PvpMetadataPrimitive
  | PvpMetadataValue[]
  | { [key: string]: PvpMetadataValue };
export type PvpMetadataBag = Record<string, PvpMetadataValue>;

export type PvpPlayerMetadataV2 = {
  userId?: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  profileUrl?: string;
  custom?: PvpMetadataBag;
};

export type PvpRoomParticipantMetadataV2 = PvpPlayerMetadataV2 & {
  address?: HexString;
  role?: 'host' | 'player' | 'spectator';
};

/** Display-only host room context. It never grants on-chain lobby admission. */
export type PvpRoomMetadataV2 = {
  roomId?: string;
  slug?: string;
  title?: string;
  inviteUrl?: string;
  participants?: PvpRoomParticipantMetadataV2[];
  custom?: PvpMetadataBag;
};

export type PvpHostMetadataV2 = {
  viewer?: PvpPlayerMetadataV2;
  room?: PvpRoomMetadataV2;
  custom?: PvpMetadataBag;
};

export type PvpLobbyMetadataV2 = {
  title?: string;
  inviteUrl?: string;
  custom?: PvpMetadataBag;
};

/** Static catalog/UI hints. The game contract remains authoritative for every lobby. */
export type PvpGameManifestV2 = {
  schemaVersion: 2;
  gameId: string;
  apiVersion: 2;
  defaultLocale: string;
  locales: Record<string, { name: string; description?: string }>;
  presentation: {
    mode: 'full-iframe' | 'embedded';
    hostPanels: { lobby: boolean; history: boolean; status: boolean };
  };
  lobby: {
    /** UI hint only. Games may vary admission rules between lobbies. */
    access: 'public' | 'game-defined';
    /** UI hint only. The game validates whether another entry is accepted. */
    entries: 'single' | 'repeatable' | 'game-defined';
    /** Optional base-unit amount to prefill. Zero and variable stakes are valid. */
    defaultStake?: string;
    /** Whether the game may assign lobby keys for game-scoped uniqueness. */
    usesLobbyKeys: boolean;
  };
  capabilities: {
    createLobby: true;
    enterLobby: boolean;
    startLobby: boolean;
    submitAction: boolean;
    cancelLobby: boolean;
    claimWinnings: boolean;
    claimRefund: boolean;
    /** Optional — whether the game offers collection of parked deferred payouts itself. */
    claimPayout?: boolean;
    resize: boolean;
  };
  assets?: { iconUrl?: string; coverUrl?: string };
};

export type LobbyPhaseName =
  | 'NONE'
  | 'WAITING_FOR_PLAYERS'
  | 'IN_PROGRESS'
  | 'WAITING_RANDOMNESS'
  | 'WAITING_PLAYER_ACTION'
  | 'RESOLVED'
  | 'CANCELLED';

export type SettlementModeName = 'IMMEDIATE' | 'CLAIMABLE';

export type PvpAssetBalance = {
  address: HexString;
  symbol?: string;
  decimals?: number;
  iconUrl?: string;
  balance?: string;
};

export type LobbyParticipant = {
  address: HexString;
  totalStake: string;
  contributionCount: number;
  isYou?: boolean;
  /** True once this address has collected at least one claimable-settlement claim. */
  claimed?: boolean;
  /** Sum of claimable-settlement claims already paid to this address. */
  claimedAmount?: string;
  /** Claim ids this address has already collected. Claim id semantics are game-defined. */
  claimedClaimIds?: HexString[];
  metadata?: PvpPlayerMetadataV2;
};

export type LobbyContribution = {
  contributionId: string;
  participant: HexString;
  amount: string;
  positionId: HexString;
  cumulativePot: string;
  contributedAt?: number;
};

export type PvpPage<T> = {
  items: T[];
  nextCursor?: string;
};

export type ImmediatePayoutSnapshot = {
  winner: HexString;
  amount: string;
  /** True while the settlement-time transfer failed and the payout awaits `claimPayout`. */
  deferred?: boolean;
};

export type LobbySettlement = {
  mode: SettlementModeName;
  feeAmount?: string;
  payoutRemaining?: string;
  immediate?: ImmediatePayoutSnapshot;
};

export type RandomnessRequestV2 = {
  /** Per-lobby request counter; PvP games request randomness per throw. */
  nonce: string;
  requestId: HexString;
  randomness?: HexString;
  fulfilled: boolean;
  /** Hash of the VRF fulfillment transaction; absent until fulfilled (or on older hosts). */
  transactionHash?: HexString;
};

export type VrfVerificationChecksV2 = {
  vrfProofValid: boolean;
  vrfBetaMatchesRandomness: boolean;
  fastVerifyComponentsMatch: boolean;
  enclaveSignatureValid: boolean;
  signerMatchesFulfiller: boolean;
};

export type RandomnessRequestVerificationV2 = RandomnessRequestV2 & {
  /**
   * Raw fulfillment artifacts read from the Verify Network router, so the
   * result can be re-verified independently of the host's verdict.
   */
  artifacts?: {
    randomness: HexString;
    proof: [HexString, HexString, HexString, HexString];
    uPoint: [HexString, HexString];
    vComponents: [HexString, HexString, HexString, HexString];
    enclaveSignature: HexString;
    /** VRF input; always equals `requestId`. */
    alpha: HexString;
  };
  /** Enclave address assigned to fulfill the request (EIP-712 signer). */
  fulfiller?: HexString;
  /** Registered secp256k1 public key of the fulfiller node, as [x, y]. */
  nodePublicKey?: [HexString, HexString];
  checks?: VrfVerificationChecksV2;
  /** True when every check passed. */
  valid?: boolean;
};

export type RandomnessVerificationV2 = {
  /** False when the environment does not use Verify Network VRF. */
  supported: boolean;
  chainId: number;
  routerAddress?: HexString;
  requests: RandomnessRequestVerificationV2[];
};

export type LobbySnapshot = {
  lobbyId: string;
  /** Optional game-defined key. Unique only within the game when present. */
  lobbyKey?: HexString;
  gameAddress: HexString;
  /** Transaction sender that opened the lobby. Carries no implicit authority. */
  opener: HexString;
  asset: { address: HexString; symbol?: string; decimals?: number; iconUrl?: string };
  phase?: number;
  phaseName?: LobbyPhaseName;
  pot: string;
  participantCount: number;
  contributionCount: number;
  protocolFeeBps?: number;
  /** Connected address's aggregate, if it has entered this lobby. */
  viewer?: LobbyParticipant;
  metadata?: PvpLobbyMetadataV2;
  isResolved: boolean;
  createdAt?: number;
  startedAt?: number;
  resolvedAt?: number;
  lastEventTimestamp: number;
  settlement?: LobbySettlement;
  raw: {
    config?: HexString;
    gameState?: HexString;
    /** Latest fulfilled VRF word; per-throw games get the full list below. */
    randomness?: HexString;
    requestId?: HexString;
    randomnessRequests?: RandomnessRequestV2[];
    /** Hash of the transaction that created the lobby; absent on older hosts. */
    createTransactionHash?: HexString;
    /** Hash of the transaction that resolved the lobby; absent until resolved. */
    resolveTransactionHash?: HexString;
  };
};

export type PvpHostSnapshotV2 = {
  apiVersion: 2;
  integration: {
    chainId: number;
    slug: string;
    gameAddress: HexString;
    manifest: PvpGameManifestV2;
  };
  wallet: {
    address?: HexString;
    status: 'ready' | 'disconnected' | 'setup-required' | 'session-key-mismatch';
  };
  assets: PvpAssetBalance[];
  protocol?: { feeBps?: number };
  lobbies: { items: LobbySnapshot[] };
  metadata?: PvpHostMetadataV2;
  ui: {
    locale: string;
    theme: 'light' | 'dark' | 'system';
    viewport?: {
      /**
       * Height in px from the top of the game's iframe to the bottom edge of
       * the visible screen, before the user scrolls. Excludes host chrome
       * overlaying the viewport bottom (e.g. the mobile navigation bar).
       * Layouts that want their primary action at the screen edge should size
       * the content above it to `availableHeight` minus the action's own
       * height.
       */
      availableHeight: number;
    };
  };
};

export type PvpHostApiV2 = {
  reportContentSize?(input: { minHeight: number }): Promise<void>;
  createLobby(input: {
    asset: HexString;
    config: HexString;
    openData?: HexString;
    randomnessRequestData?: HexString;
  }): Promise<{ lobbyId: string; transactionHash: HexString }>;
  /**
   * Submit an explicit stake and opaque entry data. The game may accept zero, require an exact
   * amount, allow repeated entries, or reject the call.
   */
  enterLobby(input: {
    lobbyId: string;
    stake: string;
    entryData?: HexString;
  }): Promise<{ contributionId: string; transactionHash: HexString }>;
  startLobby(input: {
    lobbyId: string;
    actionData?: HexString;
    randomnessRequestData?: HexString;
  }): Promise<{ transactionHash: HexString }>;
  submitAction(input: {
    lobbyId: string;
    actionData: HexString;
    randomnessRequestData?: HexString;
  }): Promise<{ transactionHash: HexString }>;
  cancelLobby(input: {
    lobbyId: string;
    cancelData?: HexString;
  }): Promise<{ transactionHash: HexString }>;
  /** Permissionless execution; the game-returned recipient cannot be redirected. */
  claimWinnings(input: {
    lobbyId: string;
    claimId: HexString;
    claimData?: HexString;
  }): Promise<{ recipient: HexString; amount: string; transactionHash: HexString }>;
  /** Permissionless full cancellation refund for the named participant. */
  claimRefund(input: {
    lobbyId: string;
    participant: HexString;
  }): Promise<{ amount: string; transactionHash: HexString }>;
  /**
   * Optional — feature-detect. Permissionless collection of an immediate payout whose
   * settlement-time transfer failed (`settlement.immediate.deferred`). Funds always go to the
   * winner recorded at resolution, regardless of who triggers the call.
   */
  claimPayout?(input: {
    lobbyId: string;
  }): Promise<{ winner: HexString; amount: string; transactionHash: HexString }>;
  getLobbyParticipants(input: {
    lobbyId: string;
    cursor?: string;
    limit?: number;
  }): Promise<PvpPage<LobbyParticipant>>;
  getLobbyContributions(input: {
    lobbyId: string;
    cursor?: string;
    limit?: number;
  }): Promise<PvpPage<LobbyContribution>>;
  /** Optional — feature-detect. Verifies every VRF fulfillment of a lobby. */
  getRandomnessVerification?(input: { lobbyId: string }): Promise<RandomnessVerificationV2>;
};

export type PvpGuestApiV2 = {
  setState(snapshot: PvpHostSnapshotV2 | null): Promise<void>;
};

export type PvpGameManifestValidationResult =
  | { ok: true; manifest: PvpGameManifestV2 }
  | { ok: false; reason: string };

export type GameManifestLocale = { locale: string; name: string; description?: string };
export type GameManifestMetadata = {
  locale: string;
  name: string;
  description?: string;
  iconUrl?: string;
  coverUrl?: string;
};
