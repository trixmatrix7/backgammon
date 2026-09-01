// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {
  ClaimQuote,
  ContributionRecord,
  EntryResult,
  IPvpGameV2,
  IPvpLobbyLedgerV2,
  LobbyContext,
  LobbyOpenResult,
  LobbyPhase,
  ParticipantContext,
  PvpStepResult
} from '../IPvpGameV2.sol';

/// @title JackpotGame
/// @notice Public scheduled jackpot: many players deposit caller-selected (variable) stakes into one
///         shared pot during an open window, and a single winner is drawn PROPORTIONALLY to contributed
///         stake (chance = your stake / pot). The winner takes the whole distributable pot (pot minus
///         the protocol fee): the game resolves with a single recipient and the facet derives an
///         immediate winner-take-all settlement from that. Repeated entries by the same address
///         aggregate into that address's one position.
///
///         One `JackpotGame` lobby is ONE scheduled round. A looping global jackpot is a keeper opening
///         a fresh lobby per round with a rolling `opensAt`/`closesAt` window; anyone may start the draw
///         once the window has closed (the start hook is permissionless).
///
///         Built on `IPvpGameV2`: the protocol owns escrow + a dense contribution ledger. Admission is
///         `onEntry` (window + minimum-stake gated, variable stake, repeatable). There are no in-game
///         actions (`onPlayerAction` reverts). `onLobbyStart` closes entries and requests randomness;
///         `onRandomness` maps the random word to a uniform ticket in `[0, pot)` and binary-searches the
///         ledger's `cumulativePot` to find the stake-weighted winner. There is no pull claim
///         (`getClaim` is invalid). A single-entrant round is never drawn (no contest, and resolving it
///         would skim the protocol fee off an uncontested pot), it is instead cancellable by anyone for
///         a full, fee-free refund once closed. Cancellation refunds in full: admin-only before the
///         draw is armed (or anyone once a closed round has < 2 entrants), then timeout-gated +
///         permissionless once armed (stuck-randomness recovery). Funds never touch this contract and
///         it never sees the fee.
///
///         config    = abi.encode(uint64 opensAt, uint64 closesAt, uint256 minimumStake, address admin)
///         gameState = abi.encode(uint256 armedAt)                  // while WAITING_RANDOMNESS
///                     abi.encode(address winner, uint256 ticket)   // once RESOLVED
contract JackpotGame is IPvpGameV2 {
  error Jackpot__InvalidConfig();
  error Jackpot__EntryClosed();
  error Jackpot__StakeTooSmall();
  error Jackpot__EmptyJackpot();
  error Jackpot__NoContest();
  error Jackpot__NoActions();
  error Jackpot__NotAwaitingRandomness();
  error Jackpot__NoWinner();

  /// @dev A draw is "armed" (WAITING_RANDOMNESS) between `onLobbyStart` and the VRF fulfillment. Within
  ///      that window nobody may cancel: an instant cancel would let the administrator abort, or worse
  ///      EV-select, a live draw. Only after `armedAt + RANDOMNESS_TIMEOUT` is the draw treated as
  ///      genuinely stuck, at which point cancellation opens up PERMISSIONLESSLY so a hung oracle can be
  ///      recovered even if the admin key is lost. The timeout is measured from the ARM time (recorded in
  ///      `gameState` by `onLobbyStart`), not from `closesAt`: the start hook is permissionless and can
  ///      fire well after close, and measuring from `closesAt` would mark a freshly-armed draw instantly
  ///      stuck. Conservative (well above any realistic VRF SLA) so a normal round always resolves before
  ///      it; tune to the randomness provider.
  uint256 private constant RANDOMNESS_TIMEOUT = 1 hours;

  struct Config {
    uint64 opensAt;
    uint64 closesAt;
    uint256 minimumStake;
    address administrator;
  }

  function onLobbyOpen(
    LobbyContext calldata ctx,
    address,
    bytes calldata
  ) external pure returns (LobbyOpenResult memory result) {
    Config memory config = abi.decode(ctx.config, (Config));
    if (
      config.closesAt <= config.opensAt ||
      config.minimumStake == 0 ||
      config.administrator == address(0)
    ) revert Jackpot__InvalidConfig();

    // Unique per asset + full config so distinct jackpots cannot collide and a different
    // administrator/schedule/stake floor cannot squat another organizer's key.
    result.lobbyKey = keccak256(abi.encode(ctx.token, ctx.config));
    result.newGameState = '';
  }

  function onEntry(
    LobbyContext calldata ctx,
    ParticipantContext calldata,
    address entrant,
    uint256 stake,
    bytes calldata
  ) external view returns (EntryResult memory result) {
    Config memory config = abi.decode(ctx.config, (Config));
    if (block.timestamp < config.opensAt || block.timestamp >= config.closesAt) {
      revert Jackpot__EntryClosed();
    }
    if (stake < config.minimumStake) revert Jackpot__StakeTooSmall();

    // Repeated contributions aggregate into the entrant's one Jackpot position.
    result.positionId = bytes32(uint256(uint160(entrant)));
    result.newGameState = ctx.gameState;
  }

  function onLobbyStart(
    LobbyContext calldata ctx,
    address,
    bytes calldata
  ) external view returns (PvpStepResult memory result) {
    // Defense-in-depth (mirrors onEntry's window gate): the game must enforce that
    // the draw is only armed while the lobby is still open, so a facet that
    // re-invoked onLobbyStart on an already-resolving/resolved lobby can never
    // fire a second, discarded VRF request. (onRandomness's phase guard is the
    // real double-pay backstop; this closes the wasted-request path.)
    if (ctx.phase != LobbyPhase.WAITING_FOR_PLAYERS) revert Jackpot__EntryClosed();
    Config memory config = abi.decode(ctx.config, (Config));
    if (block.timestamp < config.closesAt) revert Jackpot__EntryClosed();
    if (ctx.pot == 0) revert Jackpot__EmptyJackpot();
    // A round that closed with a single entrant has no contest: resolving it would only skim the
    // protocol fee off an uncontested pot. So refuse to arm it — `canCancel` then lets ANYONE cancel
    // it for a full, fee-free refund of the sole entrant.
    if (ctx.participantCount < 2) revert Jackpot__NoContest();
    // Record the arm time so `canCancel` measures the stuck-randomness timeout from when the draw actually
    // armed. `LobbyContext` carries no randomness-request timing and `onLobbyStart` is permissionless, so
    // it can fire well after `closesAt`; measuring from `closesAt` could mark a fresh draw instantly stuck.
    result.newGameState = abi.encode(block.timestamp);
    result.nextPhase = LobbyPhase.WAITING_RANDOMNESS;
    result.requestRandomnessNow = true;
  }

  function onPlayerAction(
    LobbyContext calldata,
    address,
    bytes calldata
  ) external pure returns (PvpStepResult memory) {
    revert Jackpot__NoActions();
  }

  function onRandomness(
    LobbyContext calldata ctx,
    bytes32 randomness
  ) external view returns (PvpStepResult memory result) {
    // Defense-in-depth: a replayed fulfillment on an already RESOLVED/terminal lobby must not
    // recompute a second payout. A correct facet only invokes this in WAITING_RANDOMNESS; reject
    // anything else.
    if (ctx.phase != LobbyPhase.WAITING_RANDOMNESS) revert Jackpot__NotAwaitingRandomness();

    uint256 ticket = _uniform(randomness, ctx.pot);
    address winner = _contributionAtTicket(
      IPvpLobbyLedgerV2(msg.sender),
      ctx.lobbyId,
      ctx.contributionCount,
      ticket
    );
    // Fail closed rather than resolve to address(0) if the ledger's cumulativePot ever drifts
    // below `ctx.pot` (should be impossible: the last band's cumulativePot == pot).
    if (winner == address(0)) revert Jackpot__NoWinner();

    result.newGameState = abi.encode(winner, ticket);
    result.nextPhase = LobbyPhase.RESOLVED;
    // A single recipient settles IMMEDIATE: the facet pays the whole distributable pot to it.
    result.recipients = new address[](1);
    result.recipients[0] = winner;
  }

  function canCancel(
    LobbyContext calldata ctx,
    address actor,
    bytes calldata
  ) external view returns (bool) {
    // Games own the cancel policy (refunds are always full). Never cancellable once RESOLVED/terminal
    // (would double-pay).
    if (ctx.phase == LobbyPhase.WAITING_FOR_PLAYERS) {
      Config memory config = abi.decode(ctx.config, (Config));
      // Once the window has closed with fewer than two entrants the round can never be drawn
      // (`onLobbyStart` reverts `Jackpot__NoContest`), so open cancellation to ANYONE for a full refund of
      // the sole entrant. Otherwise only the administrator may cancel — normal organizer control, available
      // pre-draw whether the window is still open OR closed-but-not-yet-armed; anyone can arm a closed,
      // contested round via the permissionless start, which then locks out this admin cancel.
      if (block.timestamp >= config.closesAt && ctx.participantCount < 2) return true;
      return actor == config.administrator;
    }
    if (ctx.phase == LobbyPhase.WAITING_RANDOMNESS) {
      // Armed: an instant cancel would let the admin abort or EV-select a live draw, so lock cancellation
      // until the draw is provably stuck (`armedAt + RANDOMNESS_TIMEOUT`, armedAt being the timestamp
      // `onLobbyStart` wrote into gameState), then open it PERMISSIONLESSLY so a hung oracle is recoverable
      // even without the admin key. Fail closed if the arm time is somehow missing (never cancel blind).
      if (ctx.gameState.length < 32) return false;
      uint256 armedAt = abi.decode(ctx.gameState, (uint256));
      return block.timestamp >= armedAt + RANDOMNESS_TIMEOUT;
    }
    return false;
  }

  function getClaim(
    LobbyContext calldata,
    bytes32,
    bytes calldata
  ) external pure returns (ClaimQuote memory) {
    return ClaimQuote({ recipient: address(0), amount: 0, valid: false });
  }

  /// @notice Decode a resolved jackpot `gameState`. Reverts on empty/short input (only valid after
  ///         `onRandomness`). Exposed so clients and tests reproduce the resolved state.
  function decodeGameState(
    bytes calldata gameState
  ) external pure returns (address winner, uint256 ticket) {
    (winner, ticket) = abi.decode(gameState, (address, uint256));
  }

  /// @dev Binary search over dense per-lobby contribution ids `0 .. count-1` ordered by append.
  ///      Finds the lowest-index contribution whose `cumulativePot > ticket`. `ticket` is in
  ///      `[0, pot)` and the last contribution's `cumulativePot == pot`, so a winner is always set.
  ///      Selection is weighted by each contribution's `amount` (the width of its cumulative band).
  function _contributionAtTicket(
    IPvpLobbyLedgerV2 ledger,
    uint256 lobbyId,
    uint256 count,
    uint256 ticket
  ) private view returns (address winner) {
    uint256 low;
    uint256 high = count;
    while (low < high) {
      uint256 mid = (low + high) / 2;
      ContributionRecord memory contribution = ledger.getContribution(lobbyId, mid);
      if (contribution.cumulativePot <= ticket) {
        low = mid + 1;
      } else {
        winner = contribution.participant;
        high = mid;
      }
    }
  }

  /// @dev Uniform integer in `[0, upperBound)` via rejection sampling to remove modulo bias. Rerolls by
  ///      hashing `(randomness, ++nonce)` while the word lands in the biased tail above `limit`.
  function _uniform(bytes32 randomness, uint256 upperBound) private pure returns (uint256) {
    uint256 word = uint256(randomness);
    uint256 limit = type(uint256).max - (type(uint256).max % upperBound);
    uint256 nonce;
    while (word >= limit) {
      word = uint256(keccak256(abi.encode(randomness, ++nonce)));
    }
    return word % upperBound;
  }
}
