// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title The wire format of a Chain Backgammon match.
/// @notice These structs exist so `abi.encode(State)` produces exactly the bytes that
///         `src/game/codec.ts` produces, and vice versa. The guest decodes `gameState`
///         with that codec, so a single field out of order breaks the client silently
///         rather than loudly — keep the two in lockstep.
library BG {
  // ── board geometry ─────────────────────────────────────────────────────────
  uint8 internal constant NUM_POINTS = 24;
  uint8 internal constant CHECKERS = 15;
  /// @dev Sentinel used in `moveFrom`: the checker is coming in off the bar.
  uint8 internal constant BAR = 24;
  /// @dev Sentinel destination: the checker leaves the board.
  uint8 internal constant OFF = 25;
  uint8 internal constant MAX_CUBE = 64;

  // ── phases ─────────────────────────────────────────────────────────────────
  uint8 internal constant PHASE_ROLL = 0;
  uint8 internal constant PHASE_MOVE = 1;
  uint8 internal constant PHASE_CUBE = 2;
  uint8 internal constant PHASE_OVER = 3;
  uint8 internal constant PHASE_GAME_OVER = 4;

  // ── actions ────────────────────────────────────────────────────────────────
  uint8 internal constant ACTION_ROLL = 0;
  uint8 internal constant ACTION_MOVE = 1;
  uint8 internal constant ACTION_DOUBLE = 2;
  uint8 internal constant ACTION_TAKE = 3;
  uint8 internal constant ACTION_PASS = 4;
  uint8 internal constant ACTION_RESIGN = 5;
  uint8 internal constant ACTION_NEXT = 6;
  /// @dev Not in the engine's action set: the permissionless timeout path. The facet
  ///      forwards every caller to `onPlayerAction`, so anyone may send this once the
  ///      deadline has passed and a stalling player cannot freeze the pot.
  uint8 internal constant ACTION_SKIP = 7;

  // ── events (mirrored to the client so it can animate what just happened) ───
  uint8 internal constant EV_NONE = 0;
  uint8 internal constant EV_ROLL = 1;
  uint8 internal constant EV_MOVE = 2;
  uint8 internal constant EV_DANCE = 3;
  uint8 internal constant EV_DOUBLE = 4;
  uint8 internal constant EV_TAKE = 5;
  uint8 internal constant EV_PASS = 6;
  uint8 internal constant EV_RESIGN = 7;
  uint8 internal constant EV_OPEN = 8;

  // ── bounds ─────────────────────────────────────────────────────────────────
  uint16 internal constant MAX_TURNS_PER_GAME = 400;
  uint8 internal constant MAX_GAMES = 32;

  /// @notice The move sequence that produced the current position, carried so the
  ///         OPPONENT's client can animate it — it has no other way to know which
  ///         checkers moved. Four slots because a double is at most four moves.
  struct Event {
    bool valid;
    uint8 kind;
    uint8 player;
    uint32 seq;
    uint8 d1;
    uint8 d2;
    uint8 cube;
    uint8 moveCount;
    uint8[4] moveFrom;
    uint8[4] moveDie;
  }

  /// @notice How the previous GAME was decided, so both clients show the same banner.
  /// @dev `flavor`: 1 single · 2 gammon · 3 backgammon · 0 conceded.
  struct Result {
    bool valid;
    uint8 gameIndex;
    uint8 winner;
    uint8 points;
    uint8 flavor;
    uint8 cube;
    uint32 seq;
  }

  /// @notice The whole match. Public by construction: backgammon is a perfect-
  ///         information game, so there is nothing here to hide and no commit/reveal
  ///         machinery anywhere.
  struct State {
    uint8 numPlayers;
    uint8 matchTo;
    uint8 current;
    uint8 phase;
    uint8 cube;
    /// @dev -1 = centred.
    int8 cubeOwner;
    /// @dev Table rule: is the cube in play at all? Never true in a single game.
    bool cubeOn;
    /// @dev Table rule: a tied opening throw doubles the game value before the re-throw.
    bool officialOpening;
    uint8 gameIndex;
    uint16 turnIndex;
    uint32 seq;
    /// @dev -1 = in progress or drawn.
    int8 winner;
    bool over;
    bytes32 seed;
    uint64 deadline;
    /// @dev Absolute 24-slot board. Positive = seat 0's checkers, negative = seat 1's.
    ///      Seat 0 travels 23 → 0; seat 1 travels 0 → 23.
    int8[24] points;
    uint8[2] bar;
    uint8[2] off;
    uint8[2] score;
    uint8[2] dice;
    Event lastEvent;
    Result lastResult;
  }

  /// @notice Lobby setup, chosen by the creator and fixed for the match.
  struct Config {
    uint16 turnSec;
    uint8 matchTo;
    bool cubeOn;
    bool officialOpening;
  }

  /// @notice One submitted action. A MOVE carries the WHOLE turn at once, because
  ///         "use as many dice as you can" is a property of the finished sequence, not
  ///         of any single move — validating them one at a time cannot express it.
  struct Action {
    uint8 kind;
    uint8 moveCount;
    uint8[4] moveFrom;
    uint8[4] moveDie;
  }

  /// @notice The other seat.
  function other(uint8 p) internal pure returns (uint8) {
    return p ^ 1;
  }

  /// @notice Where a checker ends up, or `OFF` if it leaves the board.
  /// @dev Seat 0 counts down (23 → 0) and enters from the bar high; seat 1 counts up.
  function moveDest(uint8 seat, uint8 from, uint8 die) internal pure returns (uint8) {
    if (from == BAR) {
      return seat == 0 ? uint8(NUM_POINTS - die) : uint8(die - 1);
    }
    if (seat == 0) {
      return from >= die ? uint8(from - die) : OFF;
    }
    uint8 to = from + die;
    return to < NUM_POINTS ? to : OFF;
  }

  /// @notice How many of `seat`'s checkers stand on `point`.
  function countAt(int8[24] memory points, uint8 point, uint8 seat) internal pure returns (uint8) {
    int8 v = points[point];
    if (seat == 0) return v > 0 ? uint8(uint8(int8(v))) : 0;
    return v < 0 ? uint8(uint8(int8(-v))) : 0;
  }

  /// @notice Is `seat`'s home board the six points it bears off from?
  /// @dev Seat 0's home is 0..5, seat 1's is 18..23.
  function homeLow(uint8 seat) internal pure returns (uint8) {
    return seat == 0 ? 0 : 18;
  }

  function homeHigh(uint8 seat) internal pure returns (uint8) {
    return seat == 0 ? 5 : 23;
  }
}
