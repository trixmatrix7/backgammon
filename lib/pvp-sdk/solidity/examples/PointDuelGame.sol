// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {
  ClaimQuote,
  EntryResult,
  IPvpGameV2,
  IPvpLobbyLedgerV2,
  LobbyContext,
  LobbyOpenResult,
  LobbyPhase,
  ParticipantContext,
  PvpStepResult
} from '../IPvpGameV2.sol';

/// @notice Fixed-stake reference game. The pot splits proportionally to scores. A single positive
///         scorer is paid the whole distributable pot immediately; otherwise each recipient claims
///         their share with their address as the claim id.
contract PointDuelGame is IPvpGameV2 {
  uint256 private constant BPS = 10_000;
  uint256 private constant MAX_PARTICIPANTS = 10;
  /// @dev Bound scores so `total` and `distributable * score` cannot overflow under n ≤ 10.
  uint256 private constant MAX_SCORE = type(uint64).max;

  error InvalidConfig();
  error AlreadyEntered();
  error WrongStake();
  error LobbyNotReady();
  error WrongPhase();
  error NotAdministrator();
  error NotParticipant();
  error AlreadySubmitted();
  error ScoreTooHigh();
  error NoRandomness();

  /// config = abi.encode(uint256 requiredStake, address administrator)
  function onLobbyOpen(
    LobbyContext calldata ctx,
    address,
    bytes calldata
  ) external pure returns (LobbyOpenResult memory result) {
    (uint256 requiredStake, address administrator) = abi.decode(ctx.config, (uint256, address));
    if (requiredStake == 0 || administrator == address(0)) revert InvalidConfig();
    result.newGameState = '';
  }

  function onEntry(
    LobbyContext calldata ctx,
    ParticipantContext calldata participant,
    address entrant,
    uint256 stake,
    bytes calldata
  ) external pure returns (EntryResult memory result) {
    if (ctx.phase != LobbyPhase.WAITING_FOR_PLAYERS) revert WrongPhase();
    (uint256 requiredStake, ) = abi.decode(ctx.config, (uint256, address));
    if (participant.joined) revert AlreadyEntered();
    if (ctx.participantCount >= MAX_PARTICIPANTS) revert LobbyNotReady();
    if (stake != requiredStake) revert WrongStake();
    result.positionId = bytes32(uint256(uint160(entrant)));
    result.newGameState = ctx.gameState;
  }

  function onLobbyStart(
    LobbyContext calldata ctx,
    address actor,
    bytes calldata
  ) external pure returns (PvpStepResult memory result) {
    (, address administrator) = abi.decode(ctx.config, (uint256, address));
    if (actor != administrator) revert NotAdministrator();
    if (ctx.participantCount < 2) revert LobbyNotReady();

    result.newGameState = abi.encode(
      new uint256[](ctx.participantCount),
      new bool[](ctx.participantCount)
    );
    result.nextPhase = LobbyPhase.IN_PROGRESS;
  }

  function onPlayerAction(
    LobbyContext calldata ctx,
    address actor,
    bytes calldata actionData
  ) external view returns (PvpStepResult memory result) {
    IPvpLobbyLedgerV2 ledger = IPvpLobbyLedgerV2(msg.sender);
    (bool joined, uint256 index) = ledger.participantIndex(ctx.lobbyId, actor);
    if (!joined) revert NotParticipant();

    (uint256[] memory scores, bool[] memory submitted) = abi.decode(
      ctx.gameState,
      (uint256[], bool[])
    );
    if (submitted[index]) revert AlreadySubmitted();
    uint256 score = abi.decode(actionData, (uint256));
    if (score > MAX_SCORE) revert ScoreTooHigh();
    scores[index] = score;
    submitted[index] = true;

    for (uint256 i = 0; i < submitted.length; i++) {
      if (!submitted[i]) {
        result.newGameState = abi.encode(scores, submitted);
        result.nextPhase = LobbyPhase.IN_PROGRESS;
        return result;
      }
    }

    result.newGameState = abi.encode(scores, submitted);
    result.nextPhase = LobbyPhase.RESOLVED;
    // Positive scorers are the payout recipients; a lone scorer's proportional share is the whole
    // distributable pot, so the protocol pays them immediately. Otherwise shares settle via claims.
    result.recipients = _recipients(ledger, ctx.lobbyId, scores);
  }

  function onRandomness(
    LobbyContext calldata,
    bytes32
  ) external pure returns (PvpStepResult memory) {
    revert NoRandomness();
  }

  function canCancel(
    LobbyContext calldata ctx,
    address actor,
    bytes calldata
  ) external pure returns (bool) {
    (, address administrator) = abi.decode(ctx.config, (uint256, address));
    return actor == administrator;
  }

  /// @dev claimId is the participant's address left-padded to bytes32. Any high bits beyond the
  ///      address are rejected so distinct claim ids can never alias the same participant.
  function getClaim(
    LobbyContext calldata ctx,
    bytes32 claimId,
    bytes calldata
  ) external view returns (ClaimQuote memory quote) {
    if (uint256(claimId) > type(uint160).max) return quote;
    address participant = address(uint160(uint256(claimId)));
    (bool joined, uint256 index) = IPvpLobbyLedgerV2(msg.sender).participantIndex(
      ctx.lobbyId,
      participant
    );
    if (!joined) return quote;

    (uint256[] memory scores, ) = abi.decode(ctx.gameState, (uint256[], bool[]));
    uint256 distributable = ctx.pot - ((ctx.pot * ctx.protocolFeeBps) / BPS);
    return
      ClaimQuote({
        recipient: participant,
        amount: _shareOf(scores, index, distributable),
        valid: true
      });
  }

  function _recipients(
    IPvpLobbyLedgerV2 ledger,
    uint256 lobbyId,
    uint256[] memory scores
  ) private view returns (address[] memory recipients) {
    uint256 n = scores.length;
    uint256 total;
    uint256 positiveCount;
    for (uint256 i = 0; i < n; i++) {
      total += scores[i];
      if (scores[i] > 0) positiveCount++;
    }

    if (total == 0) {
      recipients = new address[](n);
      for (uint256 i = 0; i < n; i++) {
        recipients[i] = ledger.participantAt(lobbyId, i);
      }
      return recipients;
    }

    recipients = new address[](positiveCount);
    uint256 out;
    for (uint256 i = 0; i < n; i++) {
      if (scores[i] > 0) {
        recipients[out++] = ledger.participantAt(lobbyId, i);
      }
    }
  }

  function _shareOf(
    uint256[] memory scores,
    uint256 index,
    uint256 distributable
  ) private pure returns (uint256) {
    uint256 n = scores.length;
    uint256 total;
    uint256 best;
    for (uint256 i = 0; i < n; i++) {
      total += scores[i];
      if (scores[i] > scores[best]) best = i;
    }

    if (total == 0) {
      uint256 evenShare = distributable / n;
      // Rounding dust goes to the first participant.
      return index == 0 ? distributable - evenShare * (n - 1) : evenShare;
    }

    if (scores[index] == 0) return 0;
    uint256 share = (distributable * scores[index]) / total;
    if (index == best) {
      // Rounding dust goes to the highest scorer (v1 PointDuel behavior).
      uint256 assigned;
      for (uint256 i = 0; i < n; i++) {
        assigned += (distributable * scores[i]) / total;
      }
      share += distributable - assigned;
    }
    return share;
  }
}
