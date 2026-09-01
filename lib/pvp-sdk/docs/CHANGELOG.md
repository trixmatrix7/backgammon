# Changelog

Versions use `YYYY.MM.DD-N`, where `N` increments when multiple SDK changes ship on the same day.

## 2026.08.31-1

### Added

- Added per-player claim state to **`LobbyParticipant`** (so it appears on `lobby.viewer` and on
  rows from `getLobbyParticipants`):
  - **`claimed`** — true once the address has collected at least one claimable-settlement claim.
  - **`claimedAmount`** — sum of claims already paid to the address.
  - **`claimedClaimIds`** — the claim ids already collected; check the specific id when a game
    issues several claims per player. Claim id semantics are game-defined.

  This lets a returning player's game skip a `claimWinnings` transaction it already sent — the
  settlement alone never said whether the share was collected.

### Compatibility

- Additive and optional: older hosts omit all three fields, and an absent field means "unknown",
  not "unclaimed" — a resent claim is safe (it reverts as already collected) but wasted.

## 2026.08.30-1

### Added

- Added optional **`PvpHostApiV2.claimPayout({ lobbyId })`** so games can offer collection of an
  immediate payout whose settlement-time transfer failed (`settlement.immediate.deferred`). The
  call is permissionless — it always pays the winner recorded at resolution — and resolves with
  `{ winner, amount, transactionHash }`.
- Added optional manifest capability **`capabilities.claimPayout`** declaring that the game renders
  its own collect control for parked payouts; hosts may keep their own fallback control when the
  flag is absent or false.

### Compatibility

- Additive and optional: feature-detect `host.claimPayout` before calling — older hosts omit it,
  and manifests without `capabilities.claimPayout` remain valid.

## 2026.08.20-1

### Changed

- **Breaking (contract interface):** `PvpStepResult` now returns **`address[] recipients`** on
  resolution and no longer declares a settlement mode; the protocol derives it from the length.
  Exactly **one** recipient settles IMMEDIATE — that address receives the whole distributable pot.
  Zero (not enumerable) or several recipients settle CLAIMABLE via `getClaim`. The old
  `ImmediatePayout` amounts arrays and `MAX_IMMEDIATE_RECIPIENTS` are removed (Point Duel now
  settles via per-participant claims, or immediately when a single player scores).
- The winner transfer no longer reverts resolution on failure: the payout is parked on the lobby
  and collected via the new permissionless **`claimPayout(lobbyId)`**; the facet emits
  `PvpLobbyPayoutDeferred` when this happens.
- `ImmediatePayoutSnapshot` is now `{ winner, amount, deferred? }`.

## 2026.07.26-1

### Added

- Added transaction hashes to lobby snapshots so games can render real block-explorer `/tx/` links
  instead of falling back to the game contract's address page:
  - **`raw.createTransactionHash`** — the transaction that created the lobby.
  - **`raw.resolveTransactionHash`** — the transaction that resolved the lobby; absent until
    resolved.
  - **`raw.randomnessRequests[].transactionHash`** — the VRF fulfillment transaction, per request;
    absent until that request is fulfilled. Because the `getRandomnessVerification` result extends
    the request shape, the same hash also appears on each verification entry.
- Explorer links prove a transaction exists, not that the randomness is fair — keep the client-side
  `getRandomnessVerification` verdict as the primary fairness signal and treat `/tx/` links as
  secondary. See `RANDOMNESS_VERIFICATION.md`.

### Compatibility

- Additive and optional: older hosts omit all three fields, and lobbies projected before this
  version have no hashes (only a re-indexed environment backfills them). Keep an address-link (or
  no-link) fallback when a hash is absent.

## 2026.07.20-1

### Added

- Added **`raw.randomnessRequests`** to lobby snapshots — every VRF request of the lobby in
  request order (`{ nonce, requestId, randomness?, fulfilled }`). Per-throw games see one entry
  per throw; `raw.randomness` / `raw.requestId` keep reflecting only the latest request.
- Added optional **`PvpHostApiV2.getRandomnessVerification({ lobbyId })`** — the host reads the
  ECVRF fulfillment artifacts from the Verify Network router and verifies them client-side
  (proof, output, EIP-712 enclave signature, signer identity). Returns per-request verdicts plus
  the raw artifacts so the result can be re-verified independently. See
  `RANDOMNESS_VERIFICATION.md` for the full contract and rendering rules.

### Compatibility

- Additive and optional: feature-detect `host.getRandomnessVerification` before calling; older
  hosts also omit `raw.randomnessRequests`. On environments without Verify Network (local dev)
  the method resolves with `supported: false`.

## 2026.07.19-1

### Added

- Added optional **`PvpHostSnapshotV2.ui.viewport.availableHeight`** — the height in px from the
  top of the game's iframe to the bottom edge of the visible screen, before the user scrolls. Games
  that want their primary action to land exactly at the screen edge should size the content above
  it to `availableHeight` minus the action's own height. The value is measured against the small
  viewport (`svh` semantics), so it stays stable while scrolling collapses mobile browser chrome
  and only changes on real resizes or orientation changes.
- CSS viewport units cannot replace this value: the host grows the iframe to fit the game's
  reported content height, so inside the iframe `100vh` equals the full content height, not the
  visible screen.

### Compatibility

- Additive and optional: games running against older hosts simply receive no `ui.viewport` and
  should fall back to their existing layout.

## 2026.07.18-1

### Added

- Added optional **`iconUrl`** to **`PvpAssetBalance`** and **`LobbySnapshot.asset`** — an absolute
  URL of the token's icon so games can render it next to balances and stakes.

### Compatibility

- Additive and optional: games running against older hosts simply receive no `iconUrl` and should
  fall back to a text symbol.

## 2026.07.10-1

### Breaking

- Replaced API v1's fixed buy-in, unique seat, creator privilege, `uint8` player cap, and full
  `players[]` snapshots with the game-policy-oriented API v2 model.
- Added explicit game-validated entries (including zero and repeated stakes), game-defined positions,
  optional lobby keys, a protocol-owned contribution ledger, and paginated reads.
- Added immediate settlement for at most ten recipients and game-computed claimable settlement.
- Removed vault identity from PvP types; the submitting address is the participant.
- Replaced `IPvpGameV1` with `IPvpGameV2` and added a scheduled weighted Jackpot reference game.

## 2026.07.03-1

### Added

- Added optional **`PvpHostApiV1.reportContentSize({ minHeight })`** so PvP iframe games can report
  their current required content height to the host after the bridge connects.
- Added **`reportGameContentSize(hostApi)`** and **`observeGameContentSize(hostApi)`** helpers in
  `@chain/pvp-sdk/guest`. Games can use the observer to report initial height and subsequent layout
  changes without wiring their own `ResizeObserver`.

### Changed

- Removed static **`presentation.minHeight`** from PvP game manifest validation and examples. Height
  is now a runtime concern reported by the child iframe when `capabilities.resize` is supported.

### Compatibility

- Dynamic sizing is additive: older games that do not call `reportContentSize` continue to render
  using the host's existing frame fallback.
- `reportContentSize` is optional on the host API so games can safely run against older hosts by
  checking for the method or using `observeGameContentSize`, which no-ops when unsupported.

## 2026.06.28-1

### Added

- Added host-to-game metadata support to `PvpHostSnapshotV1`.
- Added `PvpHostSnapshotV1.metadata` for parent-app context shared with the iframe, including:
  - `viewer` profile metadata for the connected viewer.
  - `room` metadata for room id, slug, title, invite URL, and participants/spectators.
  - `custom` JSON-serializable host data for presentation-only features.
- Added `LobbySnapshot.metadata` for lobby/table labels, invite URLs, and custom presentation data.
- Added `LobbyPlayer.metadata` for seated-player profile data such as `userId`, `username`,
  `displayName`, `avatarUrl`, and `profileUrl`.
- Added JSON-safe metadata helper types:
  - `PvpMetadataPrimitive`
  - `PvpMetadataValue`
  - `PvpMetadataBag`
- Added structured metadata types:
  - `PvpPlayerMetadataV1`
  - `PvpRoomParticipantMetadataV1`
  - `PvpRoomMetadataV1`
  - `PvpHostMetadataV1`
  - `PvpLobbyMetadataV1`
- Re-exported the metadata types from `@chain/pvp-sdk/host` and `@chain/pvp-sdk/guest`, so host and
  game iframe code can import them from the bridge entrypoints.
- Documented common metadata that host apps may pass to games: usernames, display names, avatars,
  profile URLs, room titles, room/invite links, participants, spectators, lobby labels, and
  app-specific custom metadata.
- Documented that host-provided metadata is display-only and must not be used for authoritative game
  rules, turn ownership, eligibility, scoring, payouts, or any contract-sensitive logic.

### Compatibility

- The metadata fields are optional and backward-compatible with existing hosts and games.
