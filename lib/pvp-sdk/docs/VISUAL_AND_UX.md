# Visual & UX expectations for PvP iframe games

## Runtime environment

- The main app embeds your game in an **iframe** with `sandbox="allow-scripts allow-same-origin"`.
  Design for a **single-page guest** that does not navigate away or open new windows.
- The host owns wallet, Smart Vault, and signing. Your UI assumes **no direct wallet access** — reflect
  state from **`PvpHostSnapshotV1`** only.

## Snapshot-driven, multi-player UI

Unlike casino (one player, one session at a time), PvP UIs are inherently **multi-player and
multi-phase**. Drive everything from `snapshot.lobbies.items`:

- **Lobby browser / create** (`WAITING_FOR_PLAYERS`): list open lobbies with `buyIn`, `pot`,
  `players.length` / `maxPlayers`, and a join button. Offer a create form (buy-in + seat cap +
  game `config`). Disable join when `balances.smartVaultBalance` < `buyIn` or `wallet.status !== 'ready'`.
- **Waiting room**: show seated `players[]` (use `isYou` to highlight self, `creator` for the host
  player). Use `players[].metadata.displayName` / `username` / `avatarUrl` when the host provides
  them, and fall back to shortened addresses. Show a start button to the creator once enough players
  have joined (the game decides via `canStart`; the manifest's suggested `minPlayers` is a good UI
  gate) unless the lobby auto-starts when full.
- **In-game** (`IN_PROGRESS` / `WAITING_PLAYER_ACTION` / `WAITING_RANDOMNESS`): render the board/state
  from `raw.gameState`. For turn-based games, decode the current actor (and any per-turn deadline) from
  `raw.gameState` — there is no host-provided `nextActor` — and only enable the action UI when it's the
  connected wallet's turn; otherwise show `waiting for <player>` (and a Skip button once the deadline
  passes).
- **Resolved** (`RESOLVED`): render `payout` (per-player `shareBps` / `amounts`, `feeAmount`) — a
  leaderboard/winner view. `CANCELLED` means buy-ins were refunded.

Host-provided metadata is display-only. `snapshot.metadata` can include viewer profile data, room
title/id/invite URL, and participants/spectators; `lobby.metadata` can include table labels; and
`players[].metadata` can include usernames, display names, avatars, profile URLs, and custom
JSON-serializable presentation data. Never use these fields for game rules, turn ownership, scoring,
or payouts; decode authoritative state from `raw.gameState` and contract-backed lobby fields.

Respect **`ui.theme`** (`light` | `dark` | `system`) and **`ui.locale`** where practical.

## Manifest (`game.manifest.json`)

Served at **`{gameBaseUrl}/game.manifest.json`** (same origin as the game). Validated by
`validatePvpGameManifest` in `@chain/pvp-sdk` (`src/manifest.ts`). Required fields:

- **`presentation`**: `mode` (`full-iframe` | `embedded`), `hostPanels` toggles
  (`lobby`, `history`, `status`).
- **`lobby`**: `minPlayers` (≥ 2), `maxPlayers` (≥ `minPlayers`), optional `defaultBuyIn`,
  `autoStartWhenFull`. These are **UI defaults** for the create-lobby form only — the creator passes
  the actual `buyIn` + seat cap to `createLobby`, and the game validates the rest in `canStart`.
- **`capabilities`**: `createLobby` must be `true`; booleans for `joinLobby`, `leaveLobby`,
  `startLobby`, `submitAction`, `cancelLobby`, `resize`.

**`gameId`** must match the canonical id from on-chain registration (`canonicalPvpGameId` — strips
trailing `Game`, lowercases, alphanumeric only). The host rejects mismatches.

## Motion & accessibility

- Prefer **reduced motion** via `prefers-reduced-motion`.
- Call `observeGameContentSize(hostApi)` from `@chain/pvp-sdk/guest` after the bridge resolves so
  the host can size the iframe to the game's current content.
- Ensure tap targets and contrast work at the height your game reports to the host.

## Assets

`manifest.assets.iconUrl` / `coverUrl` are optional; used in catalog/discovery when provided.
