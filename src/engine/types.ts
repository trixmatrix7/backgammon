// Chain Gammon — pure, deterministic engine types.
// No I/O, no Date, no Math.random. (seed, matchTo) + the ordered list of (action, randomness) fully
// determines a match — which is what makes it replay-verifiable and contract-portable.

export type Hex = `0x${string}`;

// ── board geometry ────────────────────────────────────────────────────────────
//
// The board is ONE absolute array of 24 slots, index 0..23. `points[i]` is signed:
//   > 0  → that many seat-0 checkers stand there
//   < 0  → that many seat-1 checkers stand there
//   = 0  → empty
//
// Seat 0 travels DOWNWARD (index 23 → 0) and bears off past index 0; its home board is 0..5.
// Seat 1 travels UPWARD (index 0 → 23) and bears off past index 23; its home board is 18..23.
// So index 0 is simultaneously seat 0's 1-point and seat 1's 24-point — the classic mirrored board.
// One absolute array (rather than two per-seat views) is what lets a Solidity port mirror the state
// byte-for-byte with a single `int8[24]`.

export const NUM_POINTS = 24;
export const CHECKERS = 15;

/** Sentinel `from` value meaning "a checker on the bar" (both seats share it — context is the seat). */
export const BAR = 24;
/** Sentinel destination meaning "borne off". Never appears in an action; it is derived. */
export const OFF = 25;

/** Direction of travel for a seat: seat 0 counts down, seat 1 counts up. */
export function dirOf(seat: number): number {
  return seat === 0 ? -1 : 1;
}
/** Lowest index of a seat's home board (seat 0 → 0, seat 1 → 18). */
export function homeLo(seat: number): number {
  return seat === 0 ? 0 : 18;
}
/** Highest index of a seat's home board (seat 0 → 5, seat 1 → 23). */
export function homeHi(seat: number): number {
  return seat === 0 ? 5 : 23;
}
/** Where a checker coming off the bar lands for die `d` (seat 0 enters high, seat 1 enters low). */
export function entryIndex(seat: number, d: number): number {
  return seat === 0 ? NUM_POINTS - d : d - 1;
}
/** Pips a seat still owes from index `i` (i.e. the die needed to bear that checker off exactly). */
export function pipsFrom(seat: number, i: number): number {
  return seat === 0 ? i + 1 : NUM_POINTS - i;
}
export const other = (p: number): number => p ^ 1;

// ── match settings ────────────────────────────────────────────────────────────

/** Match lengths the lobby can pick. A match is first-to-N POINTS, not first-to-N games. */
/** Match lengths the table offers. A single game is `matchTo = 1` and is listed separately in the
 *  lobby as "Einzelpartie" — there the doubling cube is off by the rules themselves. */
export const MATCH_TARGETS = [3, 5, 7, 11, 15] as const;
export const SINGLE_GAME = 1;
export const DEFAULT_MATCH_TO = 5;

/** The doubling cube tops out here; `canDouble` refuses beyond it (keeps `uint8` cube safe). */
export const MAX_CUBE = 64;

/** Hard bounds so an on-chain match always terminates (both are far beyond any real game). */
export const MAX_TURNS_PER_GAME = 400;
export const MAX_GAMES = 32;

// ── phases ────────────────────────────────────────────────────────────────────

/** `current` must ROLL. They may DOUBLE or RESIGN instead. */
export const PHASE_ROLL = 0;
/** Dice are on the table; `current` must submit their whole move sequence (or RESIGN). */
export const PHASE_MOVE = 1;
/** A double is on offer; `current` is the RESPONDER and must TAKE or PASS. */
export const PHASE_CUBE = 2;
/** The match is decided. */
export const PHASE_OVER = 3;
/**
 * A GAME inside the match has just finished and the board still shows how it ended. The next board is
 * dealt by an explicit NEXT action. Keeping this beat costs one cheap transaction per game and buys
 * two things nothing else can: both clients get to animate the finishing move against the position it
 * actually happened on, and the fresh randomness for the next opening throw is drawn strictly after
 * the take/pass decisions of the game that just ended.
 */
export const PHASE_GAME_OVER = 4;

// ── actions ───────────────────────────────────────────────────────────────────

export const ACTION_ROLL = 0;
export const ACTION_MOVE = 1;
export const ACTION_DOUBLE = 2;
export const ACTION_TAKE = 3;
export const ACTION_PASS = 4;
export const ACTION_RESIGN = 5;
export const ACTION_NEXT = 6;

/** One checker step: lift from `from` (0..23, or BAR) and travel `die` pips in the seat's direction. */
export interface TurnMove {
  from: number;
  die: number;
}

/**
 * A whole turn is ONE action. Backgammon's "use as many dice as legally possible" rule is a property
 * of the complete sequence, not of any single step, so submitting the sequence atomically is both the
 * only way to validate it correctly and the only way to keep a turn to a single transaction.
 */
export type Action =
  | { type: "roll" }
  | { type: "move"; moves: TurnMove[] }
  | { type: "double" }
  | { type: "take" }
  | { type: "pass" }
  | { type: "resign" }
  | { type: "next" };

// ── events (rendered, never authoritative) ─────────────────────────────────────

export const EV_NONE = 0;
export const EV_ROLL = 1; // dice hit the board
export const EV_MOVE = 2; // a move sequence was played
export const EV_DANCE = 3; // rolled, but no legal move exists — the turn is skipped automatically
export const EV_DOUBLE = 4; // the cube was offered
export const EV_TAKE = 5;
export const EV_PASS = 6;
export const EV_RESIGN = 7;
export const EV_OPEN = 8; // a fresh game was dealt (opening roll already on the table)

/**
 * The most recent event, stored in state so EVERY client renders the identical animation — including
 * the opponent, who otherwise could not know which checkers moved. `moves` lets a client replay the
 * sequence step-by-step against the previous board and derive the hits itself.
 */
export interface LastEvent {
  kind: number;
  player: number;
  seq: number;
  d1: number;
  d2: number;
  moves: TurnMove[];
  cube: number;
}

/** The outcome of a single GAME inside the match (the match is a series of games). */
export interface GameResult {
  gameIndex: number;
  winner: number; // seat that won the game
  points: number; // match points awarded (cube × gammon multiplier)
  /** 1 = single, 2 = gammon, 3 = backgammon, 0 = conceded (pass / resign / turn-cap). */
  flavor: number;
  cube: number; // cube value the game was played for
  seq: number; // event clock when the game ended (clients use it to detect a NEW result)
}

/** The full match state — a plain, serializable object. Every transition returns a NEW state. */
export interface GameState {
  numPlayers: number; // always 2
  matchTo: number; // match points needed to win the pot

  points: number[]; // 24 signed slots (see "board geometry" above)
  bar: number[]; // [seat0, seat1] checkers waiting to re-enter
  off: number[]; // [seat0, seat1] checkers borne off in the CURRENT game
  score: number[]; // [seat0, seat1] match points won so far

  current: number; // seat to act
  phase: number; // PHASE_*
  dice: number[]; // [d1, d2] — live only in PHASE_MOVE; [0,0] otherwise

  cube: number; // 1, 2, 4, … MAX_CUBE
  cubeOwner: number; // -1 = centred (either side may double), else the seat that owns it
  /** Table rule: is the doubling cube in play at all? Off by default, and never on in a single game. */
  cubeOn: boolean;
  /** Table rule "Eröffnung": official scoring turns every tied opening throw into an automatic
   *  double of the game value before the re-throw. Loose scoring just throws again. */
  officialOpening: boolean;
  // NB: no Crawford rule. TOBI-BACKGAMMON.md §2.9/§2.10 defines match play without it, so the
  // trailer may double at any score, match point included.

  gameIndex: number; // games completed so far
  turnIndex: number; // turns completed in the CURRENT game (drives the per-game cap)
  seq: number; // event clock — increments on EVERY action
  seed: Hex; // recorded for verification (rolls use per-action randomness, not this seed)

  winner: number; // -1 in progress OR a drawn match at game-over; else the winning seat
  over: boolean;
  lastEvent: LastEvent | null;
  lastResult: GameResult | null;
}

/** One entry in a replay log: who acted, what they did, and the randomness the facet delivered.
 *  Only ROLL always consumes randomness; MOVE/PASS/RESIGN consume it ONLY when the action ends a
 *  game and the match continues (the word then deals the next game's opening roll). */
export interface MoveLogEntry {
  seq: number;
  player: number;
  action: Action;
  randomness: Hex;
}
