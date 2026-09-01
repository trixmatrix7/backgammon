# Visual & UX expectations for PvP iframe games

## Runtime environment

- The main app embeds your game in an **iframe** with `sandbox="allow-scripts allow-same-origin"`.
  Design for a **single-page guest** that does not navigate away or open new windows.
- The host owns wallet, Smart Vault, and signing. Your UI assumes **no direct wallet access** — reflect
  state from **`PvpHostSnapshotV2`** only.

## Snapshot-driven, multi-player UI

Unlike casino (one player, one session at a time), PvP UIs are inherently **multi-player and
multi-phase**. Drive everything from `snapshot.lobbies.items`, then **page** participants and
contributions when you need lists:

```ts
const participants = await hostApi.getLobbyParticipants({ lobbyId, limit: 50 });
const contributions = await hostApi.getLobbyContributions({ lobbyId, limit: 100 });
```

Do **not** assume a complete `players[]` array on the lobby snapshot — v2 only carries counts, pot,
and the connected viewer's aggregate (`lobby.viewer`).

### Phase-by-phase UI

- **Lobby browser / create** (`WAITING_FOR_PLAYERS`): list open lobbies with `asset`, `pot`,
  `participantCount` / `contributionCount`, optional `lobbyKey`, and an enter button. Offer a create
  form that picks the escrow **asset**, encodes game **`config`**, and collects any **`openData`**.
  Prefill stake inputs from the manifest's `lobby.defaultStake` when present. Disable enter when the
  relevant `assets[]` balance is insufficient or `wallet.status !== 'ready'`.
- **Waiting room**: show paged participants (use `isYou` / `lobby.viewer` to highlight self). Display
  `opener` only as **attribution** — never label it owner, host-of-record, or assume it can start or
  cancel. Start eligibility is game-defined (e.g. Point Duel's configured administrator; Jackpot's
  post-close anyone). Use participant `metadata.displayName` / `username` / `avatarUrl` when the host
  provides them; fall back to shortened addresses.
- **In-game** (`IN_PROGRESS` / `WAITING_PLAYER_ACTION` / `WAITING_RANDOMNESS`): render the board/state
  from `raw.gameState`. For turn-based games, decode the current actor (and any per-turn deadline)
  from `raw.gameState` — there is no host-provided `nextActor` — and only enable the action UI when
  it is the connected wallet's turn; otherwise show "waiting for \<player\>" (and a Skip button once
  the deadline passes).
- **Resolved** (`RESOLVED`): render `lobby.settlement`:
  - **Immediate** — the `winner` and `amount`, plus `feeAmount`. If `deferred` is set the transfer
    failed at settlement and anyone may trigger `hostApi.claimPayout({ lobbyId })` — show a collect
    control to everyone (execution cannot redirect the recorded winner), and feature-detect the
    method since older hosts omit it.
  - **Claimable** — remaining pot and a claim control. A claim button may be shown to **anyone**
    because execution cannot redirect the recipient.
- **Cancelled** (`CANCELLED`): show independently **claimable full refunds** per participant
  (`claimRefund`), not a single batch refund animation that waits on other players.

### Explicit stakes

Ask the user for an **explicit stake** on every entry and explain game validation before signing
(exact amount, minimum, free entry, or open amount). `stake: '0'` is valid at the protocol boundary
but may still be rejected by the game. Format amounts with the lobby's own `asset.decimals` — the
escrow asset is **lobby-scoped**, not a single global snapshot token.

### Restricted lobbies

For `lobby.access === 'game-defined'` (manifest hint), obtain signed admission data **before** calling
`enterLobby`. Host room membership and `metadata.room.participants` are **not** authoritative for
on-chain admission.

### Host metadata (display-only)

Host-provided metadata is presentation-only. `snapshot.metadata` can include viewer profile data, room
title/id/invite URL, and participants/spectators; `lobby.metadata` can include table labels; and
participant metadata can include usernames, display names, avatars, profile URLs, and custom
JSON-serializable presentation data.

**Never** use these fields for game rules, turn ownership, scoring, eligibility, or payouts. Decode
authoritative state from `raw.gameState`, `raw.config`, contract-backed lobby fields, and the ledger
pages.

Respect **`ui.theme`** (`light` | `dark` | `system`) and **`ui.locale`** where practical.

## Manifest (`game.manifest.json`)

Served at **`{gameBaseUrl}/game.manifest.json`** (same origin as the game). Validated by
`validatePvpGameManifest` in `@chain/pvp-sdk` (`src/manifest.ts`). Required shape:

- **`presentation`**: `mode` (`full-iframe` | `embedded`), `hostPanels` toggles
  (`lobby`, `history`, `status`).
- **`lobby`** (catalog hints only; contract is authoritative):
  - `access`: `public` | `game-defined`
  - `entries`: `single` | `repeatable` | `game-defined`
  - `defaultStake`: optional base-unit integer string for input prefills
  - `usesLobbyKeys`: whether the game can create keyed canonical lobbies
- **`capabilities`**: `createLobby` must be `true`; booleans for `enterLobby`, `startLobby`,
  `submitAction`, `cancelLobby`, `claimWinnings`, `claimRefund`, `resize`.

**`gameId`** must match the canonical id from on-chain registration (`canonicalPvpGameId` — strips
trailing `Game`, lowercases, alphanumeric only). The host rejects mismatches.

Height is a **runtime** concern: when `capabilities.resize` is true, call
`observeGameContentSize(hostApi)` from `@chain/pvp-sdk/guest` after the bridge resolves so the host
can size the iframe to the game's current content. There is no static `presentation.minHeight` in the
manifest.

## Motion & accessibility

- Prefer **reduced motion** via `prefers-reduced-motion`.
- Ensure tap targets and contrast work at the height your game reports to the host.
- Prefer progressive disclosure for large jackpots (page contributions; show cumulative pot and your
  ticket share without loading every ledger row on mount).

## Assets

`manifest.assets.iconUrl` / `coverUrl` are optional; used in catalog/discovery when provided.

## Quick checklist

| Do                                                           | Don't                                                      |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| Treat `PvpHostSnapshotV2` as a summary + page the rest       | Expect a full `players[]` on every lobby                   |
| Label `opener` as attribution only                           | Call the opener owner / assume start-cancel rights         |
| Collect explicit stakes; show game validation rules          | Silent fixed buy-in UX when the game allows variable stake |
| Render immediate vs claimable settlement differently         | Assume every resolution auto-pays the connected wallet     |
| Show per-participant refund claims on cancel                 | Block UI waiting for a global refund batch                 |
| Decode `raw.config` / `raw.gameState` with the game ABI only | Drive eligibility or payouts from host metadata            |
