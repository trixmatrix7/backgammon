// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

enum LobbyPhase {
  NONE,
  WAITING_FOR_PLAYERS,
  IN_PROGRESS,
  WAITING_RANDOMNESS,
  WAITING_PLAYER_ACTION,
  RESOLVED,
  CANCELLED
}

enum SettlementMode {
  NONE,
  IMMEDIATE,
  CLAIMABLE
}

/// @notice Bounded lobby summary passed to games. Unbounded collections stay behind ledger views.
struct LobbyContext {
  uint256 lobbyId;
  bytes32 lobbyKey;
  address opener;
  address token;
  uint256 pot;
  uint256 participantCount;
  uint256 contributionCount;
  uint16 protocolFeeBps;
  uint32 step;
  LobbyPhase phase;
  bytes config;
  bytes gameState;
}

struct ParticipantContext {
  bool joined;
  uint256 totalStake;
  uint256 contributionCount;
}

struct ContributionRecord {
  uint256 contributionId;
  address participant;
  uint256 amount;
  bytes32 positionId;
  uint256 cumulativePot;
  uint64 contributedAt;
}

/// @notice Read-only protocol ledger available to game hooks through `msg.sender`.
interface IPvpLobbyLedgerV2 {
  /// @notice Load one contribution. Per-lobby IDs are dense 0-based indexes in append order:
  ///         valid ids are `0 .. contributionCount - 1`, matching `LobbyContext.contributionCount`.
  function getContribution(
    uint256 lobbyId,
    uint256 contributionId
  ) external view returns (ContributionRecord memory);

  function participantAt(uint256 lobbyId, uint256 index) external view returns (address);

  function participantIndex(
    uint256 lobbyId,
    address participant
  ) external view returns (bool joined, uint256 index);

  function getParticipantContext(
    uint256 lobbyId,
    address participant
  ) external view returns (ParticipantContext memory);

  function getPositionStake(uint256 lobbyId, bytes32 positionId) external view returns (uint256);
}

struct LobbyOpenResult {
  /// @dev Zero disables uniqueness. Non-zero keys are unique within the game contract's namespace.
  bytes32 lobbyKey;
  bytes newGameState;
}

struct EntryResult {
  /// @dev Games choose whether repeated entries share a position id or create distinct positions.
  bytes32 positionId;
  bytes newGameState;
}

struct PvpStepResult {
  bytes newGameState;
  LobbyPhase nextPhase;
  bool requestRandomnessNow;
  /// @dev Payout recipients, used only when `nextPhase` is RESOLVED; the protocol derives the
  ///      settlement mode from the length. Exactly one recipient settles IMMEDIATE: that address
  ///      receives the whole distributable pot (pot minus protocol fee). Zero (recipients not
  ///      enumerable at resolution) or several recipients settle CLAIMABLE via `getClaim`.
  address[] recipients;
}

struct ClaimQuote {
  address recipient;
  uint256 amount;
  bool valid;
}

/// @notice Stateless game-policy interface for protocol-owned PvP escrow and contribution ledgers.
interface IPvpGameV2 {
  /// @notice Validate creation and optionally assign a game-scoped unique lobby key.
  function onLobbyOpen(
    LobbyContext calldata ctx,
    address opener,
    bytes calldata openData
  ) external view returns (LobbyOpenResult memory);

  /// @notice Validate an explicit caller stake, including zero, and assign its game position.
  ///         Revert to reject admission, the amount, or a repeated entry.
  function onEntry(
    LobbyContext calldata ctx,
    ParticipantContext calldata participant,
    address entrant,
    uint256 stake,
    bytes calldata entryData
  ) external view returns (EntryResult memory);

  /// @notice Validate who may start and whether the lobby is ready, then advance the game.
  function onLobbyStart(
    LobbyContext calldata ctx,
    address actor,
    bytes calldata actionData
  ) external view returns (PvpStepResult memory);

  function onPlayerAction(
    LobbyContext calldata ctx,
    address actor,
    bytes calldata actionData
  ) external view returns (PvpStepResult memory);

  function onRandomness(
    LobbyContext calldata ctx,
    bytes32 randomness
  ) external view returns (PvpStepResult memory);

  /// @notice Games own normal and recovery cancellation policy. Cancellation always refunds in full.
  function canCancel(
    LobbyContext calldata ctx,
    address actor,
    bytes calldata cancelData
  ) external view returns (bool);

  /// @notice Resolve one game-defined claim. The protocol records claimId collection and caps total
  ///         transfers at the lobby's remaining distributable pot.
  function getClaim(
    LobbyContext calldata ctx,
    bytes32 claimId,
    bytes calldata claimData
  ) external view returns (ClaimQuote memory);
}
