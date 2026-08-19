// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPvpGameV1, LobbyContext, LobbyPhase, PayoutSplit, PvpStepResult} from "./IPvpGameV1.sol";
import {BG} from "./BackgammonTypes.sol";
import {BackgammonRules as R} from "./BackgammonRules.sol";

/// @title Chain Backgammon — the on-chain authority for a 1v1 match.
///
/// @notice Two players wager into a shared pot and play a match of backgammon. The
///         facet owns escrow and distribution; everything about the GAME lives here.
///
///         Three properties are worth stating plainly, because they are what make this
///         worth putting on a chain at all:
///
///         **Nothing is hidden.** Backgammon is a perfect-information game — the board,
///         the cube, the score and the dice on the table are public by the rules
///         themselves. So `gameState` is the whole truth, plainly encoded, with no
///         commit/reveal machinery anywhere.
///
///         **Dice cannot be seen before they are committed to.** Only ROLL and NEXT
///         consume randomness, and the facet delivers it strictly AFTER the action is
///         on chain. Nobody — player, opponent, or operator — learns a throw before
///         deciding whether to double.
///
///         **The cube moves points, never money.** A doubling cube multiplies MATCH
///         POINTS. The escrow stays winner-takes-all, so no player can ever be exposed
///         to more than the buy-in they agreed to.
contract Backgammon is IPvpGameV1 {
  error NotTwoPlayers();
  error BadConfig();
  error NotYourTurn();
  error WrongPhase();
  error UnknownAction();
  error NotExpired();
  error MatchOver();

  /// @dev A turn bank floor and ceiling, so a creator cannot set a table nobody can
  ///      play at — or one that can never be unstuck.
  uint16 internal constant MIN_TURN_SEC = 15;
  uint16 internal constant MAX_TURN_SEC = 600;

  // ── lobby validation ────────────────────────────────────────────────────────

  /// @inheritdoc IPvpGameV1
  function canStart(LobbyContext calldata ctx) external pure override returns (bool) {
    if (ctx.players.length != 2) return false;
    BG.Config memory cfg = _config(ctx.config);
    if (cfg.turnSec < MIN_TURN_SEC || cfg.turnSec > MAX_TURN_SEC) return false;
    // The client offers exactly two lengths. Anything else is a malformed lobby.
    if (cfg.matchTo != 1 && cfg.matchTo != 3) return false;
    // The cube is a match-only rule; a single game never carries one.
    if (cfg.cubeOn && cfg.matchTo == 1) return false;
    return true;
  }

  /// @inheritdoc IPvpGameV1
  /// @dev Returns no state at all — the opening throw needs randomness, so the match
  ///      begins by asking for it. `onRandomness` recognises the start by the empty
  ///      `gameState` and deals the first game.
  function onLobbyStart(LobbyContext calldata ctx) external pure override returns (PvpStepResult memory r) {
    if (ctx.players.length != 2) revert NotTwoPlayers();
    BG.Config memory cfg = _config(ctx.config);
    if (cfg.turnSec < MIN_TURN_SEC || cfg.turnSec > MAX_TURN_SEC) revert BadConfig();
    if (cfg.matchTo != 1 && cfg.matchTo != 3) revert BadConfig();

    r.newGameState = "";
    r.nextPhase = LobbyPhase.WAITING_RANDOMNESS;
    r.requestRandomnessNow = true;
  }

  // ── randomness ──────────────────────────────────────────────────────────────

  /// @inheritdoc IPvpGameV1
  /// @dev Three things can be waiting on a word, and the phase says which:
  ///      an empty state means the match is being dealt; `PHASE_GAME_OVER` means the
  ///      next GAME of the match is being dealt; `PHASE_ROLL` means a player has just
  ///      pressed ROLL and is owed their dice.
  function onRandomness(
    LobbyContext calldata ctx,
    bytes32 randomness
  ) external view override returns (PvpStepResult memory r) {
    BG.Config memory cfg = _config(ctx.config);

    if (ctx.gameState.length == 0) {
      BG.State memory s = _deal(cfg, randomness, 0, [uint8(0), uint8(0)], 1);
      return _step(s, cfg, ctx);
    }

    BG.State memory st = abi.decode(ctx.gameState, (BG.State));

    if (st.phase == BG.PHASE_GAME_OVER) {
      return _step(_dealNext(st, randomness), cfg, ctx);
    }

    if (st.phase != BG.PHASE_ROLL) revert WrongPhase();
    return _step(_roll(st, randomness), cfg, ctx);
  }

  // ── actions ─────────────────────────────────────────────────────────────────

  /// @inheritdoc IPvpGameV1
  /// @dev The facet forwards EVERY caller here — it has no notion of turn order — so
  ///      the ownership check is ours to make. It is deliberately made per action
  ///      rather than once up front, because SKIP is the one action whose whole point
  ///      is that a stranger may send it.
  function onPlayerAction(
    LobbyContext calldata ctx,
    address player,
    bytes calldata actionData
  ) external view override returns (PvpStepResult memory) {
    BG.Config memory cfg = _config(ctx.config);
    BG.State memory s = abi.decode(ctx.gameState, (BG.State));
    if (s.over) revert MatchOver();

    BG.Action memory a = _action(actionData);
    uint8 seat = _seatOf(ctx, player);

    // ── the permissionless timeout path ──────────────────────────────────────
    // Anyone may send this once the deadline has passed, including a keeper. Without
    // it a player who walks away freezes the pot for both of them.
    if (a.kind == BG.ACTION_SKIP) {
      if (block.timestamp <= s.deadline) revert NotExpired();
      s.over = true;
      s.winner = int8(uint8(BG.other(s.current)));
      s.phase = BG.PHASE_OVER;
      s.seq += 1;
      return _resolve(s, ctx);
    }

    if (seat == type(uint8).max) revert NotYourTurn();
    if (seat != s.current) revert NotYourTurn();

    if (a.kind == BG.ACTION_ROLL) {
      if (s.phase != BG.PHASE_ROLL) revert WrongPhase();
      // The word arrives after this is committed — that is the whole cheat-safety
      // argument, so the dice are NOT derived here.
      PvpStepResult memory r;
      r.newGameState = abi.encode(s);
      r.nextPhase = LobbyPhase.WAITING_RANDOMNESS;
      r.requestRandomnessNow = true;
      return r;
    }

    if (a.kind == BG.ACTION_NEXT) {
      if (s.phase != BG.PHASE_GAME_OVER) revert WrongPhase();
      PvpStepResult memory r;
      r.newGameState = abi.encode(s);
      r.nextPhase = LobbyPhase.WAITING_RANDOMNESS;
      r.requestRandomnessNow = true;
      return r;
    }

    if (a.kind == BG.ACTION_MOVE) return _step(_move(s, a), cfg, ctx);
    if (a.kind == BG.ACTION_DOUBLE) return _step(_double(s), cfg, ctx);
    if (a.kind == BG.ACTION_TAKE) return _step(_take(s), cfg, ctx);
    if (a.kind == BG.ACTION_PASS) return _step(_pass(s), cfg, ctx);
    if (a.kind == BG.ACTION_RESIGN) return _step(_resign(s), cfg, ctx);

    revert UnknownAction();
  }

  // ── game steps ──────────────────────────────────────────────────────────────

  /// @dev Deal a fresh game: opening position, opening throw, higher number moves first.
  function _deal(
    BG.Config memory cfg,
    bytes32 word,
    uint8 gameIndex,
    uint8[2] memory score,
    uint8 carryCube
  ) internal pure returns (BG.State memory s) {
    (uint8 a, uint8 b, uint8 ties) = R.openingThrow(word, 0);

    s.numPlayers = 2;
    s.matchTo = cfg.matchTo;
    s.cubeOn = cfg.cubeOn && cfg.matchTo > 1;
    s.officialOpening = cfg.officialOpening;
    s.seed = word;
    s.points = R.openingPosition();
    s.score = score;
    s.gameIndex = gameIndex;
    s.winner = -1;
    s.cubeOwner = -1;

    // The "official" table rule: every tied opening throw doubles the game value before
    // the re-throw. Off by default, and capped so a freak run cannot overflow the cube.
    uint8 opened = 1;
    if (s.officialOpening) {
      opened = 1;
      for (uint8 k = 0; k < ties; k++) {
        if (opened >= BG.MAX_CUBE) break;
        opened *= 2;
      }
    }
    s.cube = opened > 0 ? opened : 1;
    carryCube; // the cube does not carry between games; the parameter documents that

    s.current = a > b ? 0 : 1;
    s.dice = [a > b ? a : b, a > b ? b : a];
    s.phase = BG.PHASE_MOVE;

    s.lastResult = _noResult();

    // No game has finished yet, but the cube field still reads 1 rather than 0: an
    // absent result is a result "worth a single game", and the client's codec writes it
    // that way. A zero here is the one difference the differential test caught on the
    // very first deal.
    s.lastEvent = BG.Event({
      valid: true,
      kind: BG.EV_OPEN,
      player: s.current,
      seq: s.seq,
      d1: s.dice[0],
      d2: s.dice[1],
      cube: s.cube,
      moveCount: 0,
      moveFrom: [uint8(0), 0, 0, 0],
      moveDie: [uint8(0), 0, 0, 0]
    });
  }

  /// @dev Put the dice on the table. If nothing can be played the turn is over at once
  ///      — the "dance", which the client shows rather than leaving the player to work
  ///      out that they have no move.
  function _roll(BG.State memory s, bytes32 word) internal pure returns (BG.State memory) {
    // The scoreline belongs to the moment BETWEEN games. As soon as play resumes it is
    // stale, so every ordinary transition drops it — otherwise the client would keep
    // showing "GAMMON" over a board that has already moved on.
    s.lastResult = _noResult();

    uint8 d1 = R.die(word, 0);
    uint8 d2 = R.die(word, 1);
    s.dice = [d1, d2];
    s.seq += 1;
    // `seed` is the MATCH seed and stays put. It is only rewritten when a new game is
    // dealt; overwriting it on every throw made the state diverge from the engine's on
    // the very first roll, which is exactly the kind of thing the differential test is
    // for — nothing about the game would have looked wrong.

    R.Board memory b = _board(s);
    uint8[4] memory pool;
    uint8 poolLen;
    if (d1 == d2) {
      pool = [d1, d1, d1, d1];
      poolLen = 4;
    } else {
      pool[0] = d1;
      pool[1] = d2;
      poolLen = 2;
    }

    bool stuck = R.maxPlayable(b, s.current, pool, poolLen) == 0;

    s.lastEvent = BG.Event({
      valid: true,
      kind: stuck ? BG.EV_DANCE : BG.EV_ROLL,
      player: s.current,
      seq: s.seq,
      d1: d1,
      d2: d2,
      cube: s.cube,
      moveCount: 0,
      moveFrom: [uint8(0), 0, 0, 0],
      moveDie: [uint8(0), 0, 0, 0]
    });

    if (stuck) return _endTurn(s);
    s.phase = BG.PHASE_MOVE;
    return s;
  }

  /// @dev Play a whole turn. The sequence is validated as a unit, because "use as many
  ///      dice as you can" cannot be checked one move at a time.
  function _move(BG.State memory s, BG.Action memory a) internal pure returns (BG.State memory) {
    if (s.phase != BG.PHASE_MOVE) revert WrongPhase();
    s.lastResult = _noResult();

    R.Board memory b = _board(s);
    (R.Board memory out, ) = R.playTurn(b, s.current, s.dice, a.moveFrom, a.moveDie, a.moveCount);

    s.points = out.points;
    s.bar = out.bar;
    s.off = out.off;
    s.seq += 1;
    s.lastEvent = BG.Event({
      valid: true,
      kind: BG.EV_MOVE,
      player: s.current,
      seq: s.seq,
      d1: s.dice[0],
      d2: s.dice[1],
      cube: s.cube,
      moveCount: a.moveCount,
      moveFrom: a.moveFrom,
      moveDie: a.moveDie
    });

    return _endTurn(s);
  }

  /// @dev Offer the cube. Only before your own roll, only when the table plays with one,
  ///      and only if you own it or it is still centred.
  function _double(BG.State memory s) internal pure returns (BG.State memory) {
    if (!s.cubeOn) revert WrongPhase();
    if (s.phase != BG.PHASE_ROLL) revert WrongPhase();
    if (s.cube >= BG.MAX_CUBE) revert WrongPhase();
    if (s.cubeOwner >= 0 && uint8(s.cubeOwner) != s.current) revert NotYourTurn();
    s.lastResult = _noResult();

    s.seq += 1;
    s.phase = BG.PHASE_CUBE;
    s.current = BG.other(s.current);
    s.lastEvent = BG.Event({
      valid: true,
      kind: BG.EV_DOUBLE,
      player: BG.other(s.current),
      seq: s.seq,
      d1: 0,
      d2: 0,
      cube: s.cube * 2,
      moveCount: 0,
      moveFrom: [uint8(0), 0, 0, 0],
      moveDie: [uint8(0), 0, 0, 0]
    });
    return s;
  }

  /// @dev Accept the double. The cube doubles and passes to the taker — from here only
  ///      they may double next.
  function _take(BG.State memory s) internal pure returns (BG.State memory) {
    if (s.phase != BG.PHASE_CUBE) revert WrongPhase();
    s.lastResult = _noResult();
    s.cube *= 2;
    s.cubeOwner = int8(uint8(s.current));
    s.seq += 1;
    s.phase = BG.PHASE_ROLL;
    s.current = BG.other(s.current);
    s.lastEvent = BG.Event({
      valid: true,
      kind: BG.EV_TAKE,
      player: BG.other(s.current),
      seq: s.seq,
      d1: 0,
      d2: 0,
      cube: s.cube,
      moveCount: 0,
      moveFrom: [uint8(0), 0, 0, 0],
      moveDie: [uint8(0), 0, 0, 0]
    });
    return s;
  }

  /// @dev Drop it. The game ends now, at what it was worth BEFORE the double.
  function _pass(BG.State memory s) internal pure returns (BG.State memory) {
    if (s.phase != BG.PHASE_CUBE) revert WrongPhase();
    uint8 winner = BG.other(s.current);
    s.seq += 1;
    s.lastEvent = BG.Event({
      valid: true,
      kind: BG.EV_PASS,
      player: s.current,
      seq: s.seq,
      d1: 0,
      d2: 0,
      cube: s.cube,
      moveCount: 0,
      moveFrom: [uint8(0), 0, 0, 0],
      moveDie: [uint8(0), 0, 0, 0]
    });
    return _finishGame(s, winner, 0);
  }

  /// @dev Give up the current game. Concedes a single, times the cube.
  function _resign(BG.State memory s) internal pure returns (BG.State memory) {
    uint8 winner = BG.other(s.current);
    s.seq += 1;
    s.lastEvent = BG.Event({
      valid: true,
      kind: BG.EV_RESIGN,
      player: s.current,
      seq: s.seq,
      d1: 0,
      d2: 0,
      cube: s.cube,
      moveCount: 0,
      moveFrom: [uint8(0), 0, 0, 0],
      moveDie: [uint8(0), 0, 0, 0]
    });
    return _finishGame(s, winner, 0);
  }

  /// @dev Finish the acting player's turn: hand over, or end the game if they just bore
  ///      off their last checker.
  /// @dev The order matters and mirrors `endTurn` in `src/engine/rules.ts`: the turn
  ///      counter advances and the dice come off the table BEFORE the win is checked, so
  ///      a winning move leaves the same `turnIndex` and empty `dice` as any other.
  function _endTurn(BG.State memory s) internal pure returns (BG.State memory) {
    uint8 p = s.current;
    s.turnIndex += 1;
    s.dice = [uint8(0), uint8(0)];

    if (s.off[p] == BG.CHECKERS) {
      R.Board memory b = _board(s);
      return _finishGame(s, p, _flavor(b, p));
    }

    s.current = BG.other(p);
    s.phase = BG.PHASE_ROLL;
    return _capTurns(s);
  }

  /// @dev Safety net: a game that will not end on its own is decided on the race.
  /// @dev Two sides shuffling checkers back and forth can keep a position alive
  ///      indefinitely, and on chain "indefinitely" means a pot nobody can claim. At the
  ///      cap the game goes to whoever is ahead on pips, scored as a concession.
  ///      Mirrors `capTurns` in `src/engine/rules.ts`.
  function _capTurns(BG.State memory s) internal pure returns (BG.State memory) {
    if (s.phase == BG.PHASE_GAME_OVER || s.over) return s;
    if (s.turnIndex < BG.MAX_TURNS_PER_GAME) return s;
    R.Board memory b = _board(s);
    uint16 p0 = _pips(b, 0);
    uint16 p1 = _pips(b, 1);
    return _finishGame(s, p0 <= p1 ? 0 : 1, 0);
  }

  /// @dev How far `seat` still has to travel. A checker on the bar counts a full lap
  ///      plus one, which is what makes being hit expensive in the race.
  function _pips(R.Board memory b, uint8 seat) internal pure returns (uint16 pips) {
    pips = uint16(b.bar[seat]) * (uint16(BG.NUM_POINTS) + 1);
    for (uint8 i = 0; i < BG.NUM_POINTS; i++) {
      uint8 n = BG.countAt(b.points, i, seat);
      if (n == 0) continue;
      pips += uint16(n) * (seat == 0 ? uint16(i) + 1 : uint16(BG.NUM_POINTS) - i);
    }
  }

  /// @dev Score a finished GAME and decide whether the MATCH is over with it.
  /// @dev Mirrors `endGame` in `src/engine/rules.ts` field for field. Three things here
  ///      are easy to get subtly wrong and all three were: `gameIndex` advances HERE
  ///      rather than when the next game is dealt, `lastResult.points` is the total
  ///      already multiplied by the cube, and the LOSER is left on turn because either
  ///      seat may submit NEXT and the loser is the one who has to set the board up.
  /// @param flavor 0 = conceded (worth a single), else 1 single · 2 gammon · 3 backgammon.
  function _finishGame(
    BG.State memory s,
    uint8 winner,
    uint8 flavor
  ) internal pure returns (BG.State memory) {
    uint32 pts = uint32(s.cube) * uint32(flavor == 0 ? 1 : flavor);
    uint32 newScore = uint32(s.score[winner]) + pts;
    s.score[winner] = newScore > 255 ? 255 : uint8(newScore);

    s.lastResult = BG.Result({
      valid: true,
      gameIndex: s.gameIndex,
      winner: winner,
      points: pts > 255 ? 255 : uint8(pts),
      flavor: flavor,
      cube: s.cube,
      seq: s.seq
    });
    s.gameIndex += 1;

    if (s.score[winner] >= s.matchTo) {
      s.over = true;
      s.winner = int8(winner);
      s.phase = BG.PHASE_OVER;
      return s;
    }
    if (s.gameIndex >= BG.MAX_GAMES) {
      s.over = true;
      s.winner = _decideMatch(s);
      s.phase = BG.PHASE_OVER;
      return s;
    }

    s.phase = BG.PHASE_GAME_OVER;
    s.current = BG.other(winner);
    s.dice = [uint8(0), uint8(0)];
    return s;
  }

  /// @dev What a played-out win is worth before the cube: 1 single · 2 gammon ·
  ///      3 backgammon. A concession is 0 and scores as a single.
  function _flavor(R.Board memory b, uint8 winner) internal pure returns (uint8) {
    (, uint8 flavor) = R.gameValue(b, winner);
    return flavor;
  }

  /// @dev "No result yet". Note `cube: 1`, not 0 — the client's codec writes an absent
  ///      result that way, and the two encodings have to agree bit for bit.
  function _noResult() internal pure returns (BG.Result memory) {
    return BG.Result({
      valid: false,
      gameIndex: 0,
      winner: 0,
      points: 0,
      flavor: 0,
      cube: 1,
      seq: 0
    });
  }

  /// @dev Higher match score takes the pot; dead level at the game cap is a real draw.
  function _decideMatch(BG.State memory s) internal pure returns (int8) {
    if (s.score[0] > s.score[1]) return 0;
    if (s.score[1] > s.score[0]) return 1;
    return -1;
  }

  /// @dev Set the board up for the next game of the match, off a fresh word. The cube
  ///      goes back to the centre; the match score, the game index and the previous
  ///      result all carry over untouched.
  function _dealNext(BG.State memory s, bytes32 word) internal pure returns (BG.State memory) {
    s.seq += 1;

    s.points = R.openingPosition();
    s.bar = [uint8(0), uint8(0)];
    s.off = [uint8(0), uint8(0)];
    s.cube = 1;
    s.cubeOwner = -1;
    s.turnIndex = 0;

    (uint8 a, uint8 b, uint8 ties) = R.openingThrow(word, 0);
    uint8 first = a > b ? 0 : 1;
    if (s.officialOpening && ties > 0) {
      uint8 opened = 1;
      for (uint8 k = 0; k < ties; k++) {
        if (opened >= BG.MAX_CUBE) break;
        opened *= 2;
      }
      s.cube = opened;
    }
    s.current = first;
    s.dice = [a > b ? a : b, a > b ? b : a];
    s.phase = BG.PHASE_MOVE;

    s.lastEvent = BG.Event({
      valid: true,
      kind: BG.EV_OPEN,
      player: first,
      seq: s.seq,
      d1: s.dice[0],
      d2: s.dice[1],
      // Always 1 — the OPEN event reports the cube a game starts under, and a fresh
      // game starts at one even when the official-opening rule has already raised it.
      cube: 1,
      moveCount: 0,
      moveFrom: [uint8(0), 0, 0, 0],
      moveDie: [uint8(0), 0, 0, 0]
    });
    return s;
  }

  // ── plumbing ────────────────────────────────────────────────────────────────

  /// @dev Wrap a step: stamp the turn deadline and either continue or resolve.
  function _step(
    BG.State memory s,
    BG.Config memory cfg,
    LobbyContext calldata ctx
  ) internal view returns (PvpStepResult memory r) {
    if (s.over) return _resolve(s, ctx);

    // The one place a timestamp is read. Everything else must stay deterministic for a
    // given context, because the facet may replay `onLobbyStart` as a simulation.
    s.deadline = uint64(block.timestamp) + cfg.turnSec;
    r.newGameState = abi.encode(s);
    r.nextPhase = LobbyPhase.WAITING_PLAYER_ACTION;
  }

  /// @dev Winner takes the distributable pot. Points and the cube decided WHO won; they
  ///      never touched how much is at stake.
  function _resolve(
    BG.State memory s,
    LobbyContext calldata ctx
  ) internal pure returns (PvpStepResult memory r) {
    s.deadline = 0;
    r.newGameState = abi.encode(s);
    r.nextPhase = LobbyPhase.RESOLVED;

    address[] memory who = new address[](2);
    uint256[] memory bps = new uint256[](2);
    who[0] = ctx.players[0].player;
    who[1] = ctx.players[1].player;

    if (s.winner < 0) {
      // No winner: split it back down the middle rather than stranding the pot.
      bps[0] = 5000;
      bps[1] = 5000;
    } else {
      uint8 w = uint8(s.winner);
      bps[w] = 10000;
      bps[BG.other(w)] = 0;
    }

    r.payout = PayoutSplit({players: who, shareBps: bps});
  }

  function _board(BG.State memory s) internal pure returns (R.Board memory b) {
    b.points = s.points;
    b.bar = s.bar;
    b.off = s.off;
  }

  function _config(bytes calldata data) internal pure returns (BG.Config memory c) {
    (uint16 turnSec, uint8 matchTo, bool cubeOn, bool officialOpening) = abi.decode(
      data,
      (uint16, uint8, bool, bool)
    );
    c = BG.Config({
      turnSec: turnSec,
      matchTo: matchTo,
      cubeOn: cubeOn && matchTo > 1,
      officialOpening: officialOpening
    });
  }

  function _action(bytes calldata data) internal pure returns (BG.Action memory a) {
    (uint8 kind, uint8 moveCount, uint8[4] memory from, uint8[4] memory dice) = abi.decode(
      data,
      (uint8, uint8, uint8[4], uint8[4])
    );
    a = BG.Action({kind: kind, moveCount: moveCount, moveFrom: from, moveDie: dice});
  }

  /// @dev Which seat this address holds, or `type(uint8).max` for a stranger.
  function _seatOf(LobbyContext calldata ctx, address player) internal pure returns (uint8) {
    for (uint8 i = 0; i < ctx.players.length; i++) {
      if (ctx.players[i].player == player) return i;
    }
    return type(uint8).max;
  }
}
