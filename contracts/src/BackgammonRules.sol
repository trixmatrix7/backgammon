// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BG} from "./BackgammonTypes.sol";

/// @title The rules of backgammon, as pure functions over a board.
/// @notice This is the Solidity twin of `src/engine/rules.ts`. The TypeScript engine is
///         the reference implementation and the client runs it to preview moves; this
///         contract is the authority. They must agree exactly, which is what the
///         differential test in `contracts/BUILD_BRIEF.md` §7 exists to prove.
library BackgammonRules {
  /// @notice A working board, unpacked so the move search can mutate it cheaply.
  struct Board {
    int8[24] points;
    uint8[2] bar;
    uint8[2] off;
  }

  // ── randomness ──────────────────────────────────────────────────────────────

  /// @notice The n-th word derived from a fulfilled randomness value.
  /// @dev Matches `rngWord` in `src/engine/rng.ts` exactly: `keccak256(abi.encode(bytes32, uint256))`.
  function rngWord(bytes32 word, uint256 n) internal pure returns (bytes32) {
    return keccak256(abi.encode(word, n));
  }

  /// @notice The n-th die, 1..6.
  /// @dev Taken modulo a full 256-bit word rather than a single byte. A byte walk needs
  ///      rejection sampling to stay unbiased (`byte < 252`); reducing a whole word has
  ///      a bias below 2^-253, which is the pattern the SDK permits for many dice per
  ///      fulfillment. Never `randomness[i] % 6`.
  function die(bytes32 word, uint256 n) internal pure returns (uint8) {
    return uint8(uint256(rngWord(word, n)) % 6) + 1;
  }

  /// @notice The opening throw: both sides throw one die and the higher moves first.
  /// @dev A tie is no throw at all, so it is thrown again — up to eight times, after
  ///      which we take a guaranteed-distinct pair rather than loop unbounded on chain.
  ///      `ties` is returned because the "official" table rule doubles the game value
  ///      once per tie before the re-throw.
  function openingThrow(
    bytes32 word,
    uint256 n
  ) internal pure returns (uint8 a, uint8 b, uint8 ties) {
    for (uint256 k = 0; k < 8; k++) {
      a = die(word, n + k * 2);
      b = die(word, n + k * 2 + 1);
      if (a != b) return (a, b, uint8(k));
    }
    // Forced distinct: derive one die, then an offset in 1..5 so the two cannot match.
    a = die(word, n + 64);
    uint8 delta = uint8(uint256(rngWord(word, n + 65)) % 5) + 1;
    b = ((a - 1 + delta) % 6) + 1;
    return (a, b, 8);
  }

  // ── legality ────────────────────────────────────────────────────────────────

  /// @notice May `seat` land on `to`? Empty, own, or exactly one enemy checker.
  function canLand(int8[24] memory points, uint8 to, uint8 seat) internal pure returns (bool) {
    return BG.countAt(points, to, BG.other(seat)) <= 1;
  }

  /// @notice Are all fifteen of `seat`'s checkers home, so it may start bearing off?
  function allHome(Board memory b, uint8 seat) internal pure returns (bool) {
    if (b.bar[seat] > 0) return false;
    uint8 lo = BG.homeLow(seat);
    uint8 hi = BG.homeHigh(seat);
    for (uint8 i = 0; i < BG.NUM_POINTS; i++) {
      if (i >= lo && i <= hi) continue;
      if (BG.countAt(b.points, i, seat) > 0) return false;
    }
    return true;
  }

  /// @notice Is there a checker of `seat` further from home than `point`?
  /// @dev Decides whether an oversized die may bear off from a lower point.
  function anyBehind(Board memory b, uint8 seat, uint8 point) internal pure returns (bool) {
    if (seat == 0) {
      // seat 0 bears off toward 0, so "behind" is a HIGHER index inside the home board
      for (uint8 i = point + 1; i <= BG.homeHigh(0); i++) {
        if (BG.countAt(b.points, i, 0) > 0) return true;
      }
      return false;
    }
    for (uint8 i = BG.homeLow(1); i < point; i++) {
      if (BG.countAt(b.points, i, 1) > 0) return true;
    }
    return false;
  }

  /// @notice May `seat` play `die` from `from` on this board?
  function isLegalMove(
    Board memory b,
    uint8 seat,
    uint8 from,
    uint8 die_
  ) internal pure returns (bool) {
    if (die_ < 1 || die_ > 6) return false;

    // While anything of yours sits on the bar, nothing else may move.
    if (b.bar[seat] > 0 && from != BG.BAR) return false;
    if (from == BG.BAR) {
      if (b.bar[seat] == 0) return false;
      uint8 entry = BG.moveDest(seat, BG.BAR, die_);
      return canLand(b.points, entry, seat);
    }

    if (from >= BG.NUM_POINTS) return false;
    if (BG.countAt(b.points, from, seat) == 0) return false;

    uint8 to = BG.moveDest(seat, from, die_);
    if (to != BG.OFF) return canLand(b.points, to, seat);

    // Bearing off. Only once everything is home, and an oversized die may only be used
    // when nothing of yours stands further back.
    if (!allHome(b, seat)) return false;
    uint8 pip = seat == 0 ? from + 1 : BG.NUM_POINTS - from;
    if (pip == die_) return true;
    if (pip > die_) return false;
    return !anyBehind(b, seat, from);
  }

  /// @notice Play one checker. Assumes `isLegalMove` already passed.
  /// @return hit True if an enemy blot was sent to the bar.
  function applyMove(
    Board memory b,
    uint8 seat,
    uint8 from,
    uint8 die_
  ) internal pure returns (bool hit) {
    int8 sign = seat == 0 ? int8(1) : int8(-1);

    if (from == BG.BAR) {
      b.bar[seat] -= 1;
    } else {
      b.points[from] -= sign;
    }

    uint8 to = BG.moveDest(seat, from, die_);
    if (to == BG.OFF) {
      b.off[seat] += 1;
      return false;
    }

    uint8 foe = BG.other(seat);
    if (BG.countAt(b.points, to, foe) == 1) {
      b.points[to] = 0;
      b.bar[foe] += 1;
      hit = true;
    }
    b.points[to] += sign;
  }

  // ── "use as many dice as you can" ───────────────────────────────────────────

  /// @notice The greatest number of dice `seat` can possibly play from this position.
  /// @dev The rule that new players never guess, and the one reason a turn has to be
  ///      validated as a whole: a sequence is only legal if no longer sequence exists.
  ///      Bounded by construction — at most four dice, at most 25 sources each.
  function maxPlayable(
    Board memory b,
    uint8 seat,
    uint8[4] memory dice,
    uint8 diceLeft
  ) internal pure returns (uint8 best) {
    if (diceLeft == 0) return 0;

    for (uint8 d = 0; d < diceLeft; d++) {
      uint8 face = dice[d];
      if (face == 0) continue;
      // Identical faces explored once — the remainder is the same subproblem.
      bool seen = false;
      for (uint8 e = 0; e < d; e++) {
        if (dice[e] == face) seen = true;
      }
      if (seen) continue;

      uint8[4] memory rest;
      uint8 n = 0;
      for (uint8 e = 0; e < diceLeft; e++) {
        if (e == d) continue;
        rest[n++] = dice[e];
      }

      for (uint8 from = 0; from <= BG.NUM_POINTS; from++) {
        uint8 src = from == BG.NUM_POINTS ? BG.BAR : from;
        if (!isLegalMove(b, seat, src, face)) continue;

        Board memory next = copyBoard(b);
        applyMove(next, seat, src, face);
        uint8 got = 1 + maxPlayable(next, seat, rest, n);
        if (got > best) best = got;
        if (best == diceLeft) return best; // cannot do better
      }
    }
  }

  /// @notice Validate a whole submitted turn and return the resulting board.
  /// @dev Checks four things, in the order they can fail: every move is legal in turn,
  ///      every move spends a die that was actually on the table, the sequence is as
  ///      long as any sequence could be, and — in the one-die case with two different
  ///      faces — that the HIGHER die was the one played.
  function playTurn(
    Board memory b,
    uint8 seat,
    uint8[2] memory rolled,
    uint8[4] memory moveFrom,
    uint8[4] memory moveDie,
    uint8 moveCount
  ) internal pure returns (Board memory out, bool[4] memory hits) {
    uint8[4] memory pool;
    uint8 poolLen;
    if (rolled[0] == rolled[1]) {
      pool = [rolled[0], rolled[0], rolled[0], rolled[0]];
      poolLen = 4;
    } else {
      pool[0] = rolled[0];
      pool[1] = rolled[1];
      poolLen = 2;
    }

    require(moveCount <= poolLen, "too many moves");
    require(moveCount == maxPlayable(b, seat, pool, poolLen), "must use as many dice as you can");

    out = copyBoard(b);
    uint8[4] memory left = pool;
    uint8 leftLen = poolLen;

    for (uint8 i = 0; i < moveCount; i++) {
      uint8 face = moveDie[i];
      uint8 idx = type(uint8).max;
      for (uint8 j = 0; j < leftLen; j++) {
        if (left[j] == face) {
          idx = j;
          break;
        }
      }
      require(idx != type(uint8).max, "die not available");
      require(isLegalMove(out, seat, moveFrom[i], face), "illegal move");

      hits[i] = applyMove(out, seat, moveFrom[i], face);

      for (uint8 j = idx; j + 1 < leftLen; j++) left[j] = left[j + 1];
      left[leftLen - 1] = 0;
      leftLen -= 1;
    }

    // Only one die playable and the two faces differ: it has to be the higher one.
    if (moveCount == 1 && rolled[0] != rolled[1]) {
      _requireHigherDie(b, seat, rolled, moveDie[0]);
    }
  }

  /// @dev When a throw leaves room for exactly one die and the faces differ, the rules
  ///      say it must be the higher one — unless the higher one has nowhere to go.
  /// @dev Split out of `playTurn` rather than inlined because the extra locals push
  ///      that function over the EVM's 16-slot stack window.
  function _requireHigherDie(
    Board memory b,
    uint8 seat,
    uint8[2] memory rolled,
    uint8 played
  ) private pure {
    uint8 high = rolled[0] > rolled[1] ? rolled[0] : rolled[1];
    if (played == high) return;
    uint8[4] memory onlyHigh;
    onlyHigh[0] = high;
    require(maxPlayable(b, seat, onlyHigh, 1) == 0, "must play the higher die");
  }

  function copyBoard(Board memory b) internal pure returns (Board memory c) {
    for (uint8 i = 0; i < BG.NUM_POINTS; i++) c.points[i] = b.points[i];
    c.bar[0] = b.bar[0];
    c.bar[1] = b.bar[1];
    c.off[0] = b.off[0];
    c.off[1] = b.off[1];
  }

  // ── scoring ─────────────────────────────────────────────────────────────────

  /// @notice What a finished game is worth, before the cube.
  /// @return points 1 single · 2 gammon · 3 backgammon
  /// @return flavor Same number, carried to the client for the banner.
  function gameValue(Board memory b, uint8 winner) internal pure returns (uint8 points, uint8 flavor) {
    uint8 loser = BG.other(winner);
    if (b.off[loser] > 0) return (1, 1);

    // None off at all is a gammon; still on the bar or inside the WINNER's home board
    // makes it a backgammon.
    if (b.bar[loser] > 0) return (3, 3);
    uint8 lo = BG.homeLow(winner);
    uint8 hi = BG.homeHigh(winner);
    for (uint8 i = lo; i <= hi; i++) {
      if (BG.countAt(b.points, i, loser) > 0) return (3, 3);
    }
    return (2, 2);
  }

  /// @notice The classic opening setup, in ABSOLUTE indices — each side has 2 on its
  ///         24-point, 5 on its 13-point, 3 on its 8-point and 5 on its 6-point.
  /// @dev Transcribed from `startingBoard()` in `src/engine/board.ts`. Seat 0 travels
  ///      23 → 0, so its N-point is index N-1; seat 1 travels 0 → 23, so its N-point is
  ///      index 24-N. Positive is seat 0, negative is seat 1.
  function openingPosition() internal pure returns (int8[24] memory p) {
    // seat 0
    p[23] = 2;
    p[12] = 5;
    p[7] = 3;
    p[5] = 5;
    // seat 1
    p[0] = -2;
    p[11] = -5;
    p[16] = -3;
    p[18] = -5;
  }
}
