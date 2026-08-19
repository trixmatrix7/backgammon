// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Lifecycle of a player-vs-player lobby. The `PvpGameFacet` owns transitions; your game
///         contract only proposes the next phase via `PvpStepResult.nextPhase`.
enum LobbyPhase {
  NONE,
  WAITING_FOR_PLAYERS, // lobby open; players may join/leave; not started
  IN_PROGRESS, // game started; accepting actions from any player (or a turn order)
  WAITING_RANDOMNESS, // a randomness request is outstanding
  WAITING_PLAYER_ACTION, // turn-based: waiting on a player the game tracks in gameState
  RESOLVED, // terminal: pot distributed per PayoutSplit
  CANCELLED // terminal: buy-ins refunded
}

/// @notice One seat in a lobby. `vault` is the funding Smart Vault when distinct from `player`.
struct PlayerSlot {
  address player;
  address vault;
  uint256 buyIn;
  uint64 joinedAt;
}

/// @notice Full lobby context passed to every game step handler. `config` is the PvP analogue of the
///         casino `gameData` (game-specific lobby setup); `gameState` is opaque per-game storage.
struct LobbyContext {
  uint256 lobbyId;
  address creator;
  uint256 buyIn; // per-player buy-in required to join
  uint256 pot; // total tokens escrowed in the lobby
  uint8 maxPlayers; // seat cap chosen by the creator
  uint32 step; // monotonically increasing action counter
  bytes config;
  bytes gameState;
  PlayerSlot[] players;
}

/// @notice Game-decided distribution of the *distributable* pot (`pot - protocolFee`).
///         `shareBps[i]` is the basis-point share for `players[i]` and MUST sum to 10_000.
///         `players` must be a subset of (and in any order relative to) the lobby members; any member
///         omitted, or present with a 0 share, simply receives nothing (a "loser").
struct PayoutSplit {
  address[] players;
  uint256[] shareBps;
}

/// @notice Returned by every step handler. The facet validates and applies it. Note there is no
///         "next actor" field: whose turn it is (and any per-turn deadline) is purely the game's
///         concern and lives inside `newGameState`. The facet never reasons about turn order; the
///         game enforces it in `onPlayerAction` and the game's own UI decodes it from `gameState`.
struct PvpStepResult {
  bytes newGameState;
  LobbyPhase nextPhase;
  /// @dev Set true to make the facet request randomness now. Valid from ANY step handler, including
  ///      `onPlayerAction` — an action may itself trigger a roll (decide → randomness → decide again).
  bool requestRandomnessNow;
  /// @dev Populated (and validated to sum to 10_000) only when `nextPhase == RESOLVED`.
  PayoutSplit payout;
}

/// @notice Interface a PvP game contract implements. Funds never touch the house liquidity pool:
///         players wager against each other into a shared pot. The protocol takes a fee at
///         resolution and the game decides how the remaining pot is split (supports points-based,
///         ranked, or winner-take-all scoring — the facet does not assume fixed placements).
interface IPvpGameV1 {
  /// @notice May the lobby leave `WAITING_FOR_PLAYERS` given its current players? The game owns ALL
  ///         lobby validation here — minimum players, team parity, and any `config` invariants. The
  ///         facet only knows the creator-chosen `buyIn` and `maxPlayers` (seat cap); there is no
  ///         `quoteLobby`. The facet calls this on `startLobby` and on fill (for auto-start).
  function canStart(LobbyContext calldata ctx) external view returns (bool);

  /// @notice Called once when the lobby starts. Return the initial `gameState` and the next phase
  ///         (e.g. `WAITING_PLAYER_ACTION` — recording whose turn it is in gameState — or
  ///         `WAITING_RANDOMNESS` for a deal).
  function onLobbyStart(LobbyContext calldata ctx) external view returns (PvpStepResult memory);

  /// @notice Called when `player` (= `msg.sender` of `submitAction`) submits `actionData`. The facet
  ///         does NOT enforce turn order — it forwards every caller here and the game decides what is
  ///         valid. This is deliberate so that:
  ///           - the game owns arbitrary turn structure (e.g. decide → request randomness → the SAME
  ///             player decides again), which a fixed facet-level turn-guard could not express; and
  ///           - **anyone can "skip" a slacking player**: encode a per-turn deadline in `gameState`,
  ///             accept a SKIP action from any caller once `block.timestamp` passes it, and forfeit
  ///             the no-show (they simply get a 0 share at resolution).
  ///         A normal move should therefore validate `player` against the game's own current actor;
  ///         a SKIP/timeout action validates the deadline instead of the caller. May return
  ///         `requestRandomnessNow = true` to roll as part of the action.
  function onPlayerAction(
    LobbyContext calldata ctx,
    address player,
    bytes calldata actionData
  ) external view returns (PvpStepResult memory);

  /// @notice Called when the randomness provider fulfills an outstanding request.
  function onRandomness(
    LobbyContext calldata ctx,
    bytes32 randomness
  ) external view returns (PvpStepResult memory);
}
