// Vendored from @chain/pvp-sdk (src/types.ts). Keep in sync with the registry.
export type HexString = `0x${string}`;

export type PvpMetadataPrimitive = string | number | boolean | null;
export type PvpMetadataValue =
  | PvpMetadataPrimitive
  | PvpMetadataValue[]
  | { [key: string]: PvpMetadataValue };
export type PvpMetadataBag = Record<string, PvpMetadataValue>;

/**
 * Host-provided identity/profile metadata for display inside the iframe. These fields are optional
 * UX hints and are not sourced from, or verified by, the PvP contracts.
 */
export type PvpPlayerMetadataV1 = {
  /** Stable host-app user id, when distinct from the wallet address. */
  userId?: string;
  /** Short handle, e.g. "alice". */
  username?: string;
  /** Human-readable name, e.g. "Alice Chen". */
  displayName?: string;
  avatarUrl?: string;
  profileUrl?: string;
  custom?: PvpMetadataBag;
};

export type PvpRoomParticipantMetadataV1 = PvpPlayerMetadataV1 & {
  /** Wallet address for a participant when known; spectators may not have one. */
  address?: `0x${string}`;
  role?: 'host' | 'player' | 'spectator';
};

/**
 * Host-app room context for the embedded game. Use this for labels and presence-style UI only; lobby
 * membership and settlement remain defined by `lobbies.items[].players` and on-chain state.
 */
export type PvpRoomMetadataV1 = {
  roomId?: string;
  slug?: string;
  title?: string;
  inviteUrl?: string;
  participants?: PvpRoomParticipantMetadataV1[];
  custom?: PvpMetadataBag;
};

export type PvpHostMetadataV1 = {
  /** Metadata for the connected viewer, if the host app has a profile for them. */
  viewer?: PvpPlayerMetadataV1;
  /** Metadata for the host app room/session that contains the game iframe. */
  room?: PvpRoomMetadataV1;
  /** App-specific serializable data for presentation-only features. */
  custom?: PvpMetadataBag;
};

export type PvpLobbyMetadataV1 = {
  title?: string;
  inviteUrl?: string;
  custom?: PvpMetadataBag;
};

/**
 * PvP game manifest. Mirrors the casino manifest but adds a `lobby` block (buy-in + player-count
 * bounds the host UI uses for defaults) and PvP-specific `capabilities`. The runtime validator in
 * `manifest.ts` additionally requires `presentation`, `lobby`, and `capabilities` to be present.
 */
export type PvpGameManifestV1 = {
  schemaVersion: 1;
  gameId: string;
  apiVersion: 1;
  defaultLocale: string;
  locales: Record<
    string,
    {
      name: string;
      description?: string;
    }
  >;
  /** Lobby defaults/bounds advertised to the host UI (create-form hints only — not on-chain). */
  lobby: {
    minPlayers: number;
    maxPlayers: number;
    /** Optional default buy-in (token base units, as a decimal string) the UI can prefill. */
    defaultBuyIn?: string;
    /** Whether the game starts automatically once the lobby reaches `maxPlayers`. */
    autoStartWhenFull: boolean;
  };
  assets?: {
    iconUrl?: string;
    coverUrl?: string;
  };
};

/** Lifecycle phase of a lobby. Mirrors the on-chain `LobbyPhase` enum in `IPvpGameV1.sol`. */
export type LobbyPhaseName =
  | 'NONE'
  | 'WAITING_FOR_PLAYERS'
  | 'IN_PROGRESS'
  | 'WAITING_RANDOMNESS'
  | 'WAITING_PLAYER_ACTION'
  | 'RESOLVED'
  | 'CANCELLED';

export type LobbyPlayer = {
  address: `0x${string}`;
  /** Smart Vault that funded this player's buy-in, when distinct from `address`. */
  vault?: `0x${string}`;
  /** Buy-in escrowed by this player (token base units, decimal string). */
  buyIn?: string;
  joinedAt?: number;
  /** True when this player is the connected host wallet (set by the host). */
  isYou?: boolean;
  /** Host-provided display/profile metadata, such as username or avatar. */
  metadata?: PvpPlayerMetadataV1;
};

/**
 * Per-player share of the *distributable* pot (total pot minus the protocol fee), present only once
 * a lobby reaches `RESOLVED`. `shareBps[i]` is the game-decided basis-point share for `players[i]`
 * (sums to 10000); `amounts[i]` is the host-computed token payout for convenient display.
 */
export type LobbyPayout = {
  players: Array<`0x${string}`>;
  shareBps: number[];
  amounts?: string[];
  /** Protocol fee taken off the top of the pot (token base units, decimal string). */
  feeAmount?: string;
};

export type LobbySnapshot = {
  lobbyId: string;
  gameAddress: `0x${string}`;
  creator: `0x${string}`;
  phase?: number;
  phaseName?: LobbyPhaseName;
  /** Per-player buy-in required to join (token base units, decimal string). */
  buyIn?: string;
  /** Total escrowed in the lobby so far (token base units, decimal string). */
  pot?: string;
  /** Protocol fee in basis points applied to the pot at resolution. */
  protocolFeeBps?: number;
  /** Seat cap chosen by the creator (the facet has no minimum — the game enforces that in `canStart`). */
  maxPlayers?: number;
  players: LobbyPlayer[];
  /** Host-provided lobby presentation metadata. Not authoritative for game rules. */
  metadata?: PvpLobbyMetadataV1;
  // Note: whose turn it is and any per-turn deadline are game-specific concerns that live inside
  // `raw.gameState` (the facet has no notion of them). The game's own guest UI decodes them from
  // `raw.gameState` — they are intentionally NOT host-provided snapshot fields.
  isResolved: boolean;
  createdAt?: number;
  startedAt?: number;
  resolvedAt?: number;
  lastEventTimestamp: number;
  payout?: LobbyPayout;
  raw: {
    config?: HexString;
    gameState?: HexString;
    randomness?: HexString;
    requestId?: HexString;
  };
};

export type PvpHostSnapshotV1 = {
  apiVersion: number;
  integration: {
    chainId: number;
    slug: string;
    gameAddress: `0x${string}`;
    manifest: PvpGameManifestV1;
  };
  wallet: {
    address?: `0x${string}`;
    smartVaultAddress?: `0x${string}`;
    status: 'ready' | 'disconnected' | 'setup-required' | 'session-key-mismatch';
  };
  token: {
    symbol?: string;
    decimals?: number;
  };
  balances: {
    smartVaultBalance?: string;
  };
  /** Protocol-level fee taken from every resolved pot (basis points). Display/preview hint. */
  protocol?: {
    feeBps?: number;
  };
  lobbies: {
    items: LobbySnapshot[];
  };
  /** Host-provided room/profile metadata for display-only iframe UI. */
  metadata?: PvpHostMetadataV1;
  ui: {
    locale: string;
    theme: 'light' | 'dark' | 'system';
  };
};

export type PvpHostApiV1 = {
  reportContentSize?(input: { minHeight: number }): Promise<void>;
  /**
   * Create a lobby, escrow the creator's buy-in, and enter `WAITING_FOR_PLAYERS`. The creator picks
   * the per-player `buyIn` and the seat cap `maxPlayers`; any game-specific setup goes in `config`
   * (validated by the game at start — there is no on-chain `quoteLobby`). The buy-in token is
   * supplied by the host.
   */
  createLobby(input: {
    buyIn: string;
    maxPlayers: number;
    config: HexString;
    randomnessRequestData?: HexString;
  }): Promise<{ lobbyId: string; transactionHash: HexString }>;
  /** Join an open lobby by escrowing the required buy-in. */
  joinLobby(input: {
    lobbyId: string;
    randomnessRequestData?: HexString;
  }): Promise<{ transactionHash: HexString }>;
  /** Leave an open lobby and refund the buy-in (only while `WAITING_FOR_PLAYERS`). */
  leaveLobby(input: { lobbyId: string }): Promise<{ transactionHash: HexString }>;
  /** Creator-triggered start once the game's `canStart` allows (also auto-starts when full). */
  startLobby(input: { lobbyId: string }): Promise<{ transactionHash: HexString }>;
  /** Submit a game-specific action for the connected player. */
  submitAction(input: {
    lobbyId: string;
    actionData: HexString;
    randomnessRequestData?: HexString;
  }): Promise<{ transactionHash: HexString }>;
  /** Cancel a stalled/abandoned lobby and refund buy-ins per facet rules. */
  cancelLobby(input: { lobbyId: string }): Promise<{ transactionHash: HexString }>;
};

export type PvpGuestApiV1 = {
  setState(snapshot: PvpHostSnapshotV1 | null): Promise<void>;
};

export type PvpGameManifestValidationResult =
  | {
      ok: true;
      manifest: PvpGameManifestV1;
    }
  | {
      ok: false;
      reason: string;
    };

export type GameManifestLocale = {
  locale: string;
  name: string;
  description?: string;
};

export type GameManifestMetadata = {
  locale: string;
  name: string;
  description?: string;
  iconUrl?: string;
  coverUrl?: string;
};
