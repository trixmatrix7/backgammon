# Changelog

Versions use `YYYY.MM.DD-N`, where `N` increments when multiple SDK changes ship on the same day.

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
