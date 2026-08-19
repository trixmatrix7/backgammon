// Chain Gammon — the pure rules: the turn machine, the doubling cube, game scoring and the match
// layer. Every function is side-effect free; mutating helpers operate on a freshly cloned state and
// return it. This is the exact logic a `GammonGame.sol` mirrors byte-for-byte.

import {
  CHECKERS,
  DEFAULT_MATCH_TO,
  EV_DANCE,
  EV_DOUBLE,
  EV_MOVE,
  EV_OPEN,
  EV_PASS,
  EV_RESIGN,
  EV_ROLL,
  EV_TAKE,
  MAX_CUBE,
  MAX_GAMES,
  MAX_TURNS_PER_GAME,
  PHASE_CUBE,
  PHASE_GAME_OVER,
  PHASE_MOVE,
  PHASE_OVER,
  PHASE_ROLL,
  homeHi,
  homeLo,
  other,
  type Action,
  type GameState,
  type Hex,
  type TurnMove,
} from "./types.js";
import { die, openingThrow } from "./rng.js";
import {
  type Board,
  boardKey,
  compareTurns,
  cloneBoard,
  legalTurnsFor,
  pipCount,
  playTurn,
  startingBoard,
  countAt,
} from "./board.js";

// ── state <-> board ───────────────────────────────────────────────────────────

export function cloneState(s: GameState): GameState {
  return {
    ...s,
    points: [...s.points],
    bar: [...s.bar],
    off: [...s.off],
    score: [...s.score],
    dice: [...s.dice],
    lastEvent: s.lastEvent ? { ...s.lastEvent, moves: s.lastEvent.moves.map((m) => ({ ...m })) } : null,
    lastResult: s.lastResult ? { ...s.lastResult } : null,
  };
}

/** A `Board` view over the match state (shares nothing — safe to mutate). */
export function boardOf(s: GameState): Board {
  return { points: [...s.points], bar: [...s.bar], off: [...s.off] };
}

function writeBoard(s: GameState, b: Board): void {
  s.points = [...b.points];
  s.bar = [...b.bar];
  s.off = [...b.off];
}

/** Pips still owed by each seat — the race number both players read off the HUD. */
export function pipCounts(s: GameState): [number, number] {
  const b = boardOf(s);
  return [pipCount(b, 0), pipCount(b, 1)];
}

// ── setup ─────────────────────────────────────────────────────────────────────

/**
 * A fresh match. The opening throw for game 1 comes from the match seed: it is public, but it
 * precedes every decision in the match and is perfectly symmetric between the seats, so knowing it
 * early buys nobody anything. Every later roll uses fresh per-action randomness.
 */
export function createInitialState(
  seed: Hex,
  numPlayers = 2,
  matchTo: number = DEFAULT_MATCH_TO,
  cubeOn = false,
  officialOpening = false,
): GameState {
  const b = startingBoard();
  // A single game never carries the cube — the rules put it in the match column only.
  const cubeLive = cubeOn && matchTo > 1;
  const { a, b: c, ties } = openingThrow(seed, 0);
  const first = a > c ? 0 : 1;
  const hi = Math.max(a, c);
  const lo = Math.min(a, c);
  // "Offiziell": every tied opening throw doubles the value of the game before the re-throw.
  const opened = officialOpening ? Math.min(MAX_CUBE, 2 ** ties) : 1;
  return {
    numPlayers,
    matchTo,
    points: b.points,
    bar: b.bar,
    off: b.off,
    score: [0, 0],
    current: first,
    phase: PHASE_MOVE,
    dice: [hi, lo],
    cube: opened,
    cubeOwner: -1,
    cubeOn: cubeLive,
    officialOpening,
    gameIndex: 0,
    turnIndex: 0,
    seq: 0,
    seed,
    winner: -1,
    over: false,
    lastEvent: { kind: EV_OPEN, player: first, seq: 0, d1: hi, d2: lo, moves: [], cube: opened },
    lastResult: null,
  };
}

// ── legality ──────────────────────────────────────────────────────────────────

export function isYourTurn(s: GameState, seat: number): boolean {
  return !s.over && s.current === seat;
}

export function canRoll(s: GameState, seat: number = s.current): boolean {
  return !s.over && s.phase === PHASE_ROLL && s.current === seat;
}

export function canMove(s: GameState, seat: number = s.current): boolean {
  return !s.over && s.phase === PHASE_MOVE && s.current === seat;
}

/**
 * The cube may be turned only at the start of your turn, before you roll — that ordering is what
 * makes the cube a real decision instead of a free look at your dice. You also need the cube:
 * centred, or already yours.
 *
 * There is deliberately no Crawford rule: the handover spec (TOBI-BACKGAMMON.md §2.9/§2.10) defines
 * match play without it, so a trailer may double at any score including match point.
 */
export function canDouble(s: GameState, seat: number = s.current): boolean {
  return (
    !s.over &&
    s.cubeOn &&
    s.phase === PHASE_ROLL &&
    s.current === seat &&
    s.cube < MAX_CUBE &&
    (s.cubeOwner === -1 || s.cubeOwner === seat)
  );
}

export function canRespondCube(s: GameState, seat: number = s.current): boolean {
  return !s.over && s.phase === PHASE_CUBE && s.current === seat;
}

/** Conceding the current game outright, for the cube value. Legal on your own turn, before or after
 *  the dice land — the escape hatch when a position is hopeless and the opponent will not double. */
export function canResign(s: GameState, seat: number = s.current): boolean {
  return !s.over && s.current === seat && (s.phase === PHASE_ROLL || s.phase === PHASE_MOVE);
}

/** Setting up the next game. Either seat may submit it, so a sulking loser cannot stall the match. */
export function canNext(s: GameState): boolean {
  return !s.over && s.phase === PHASE_GAME_OVER;
}

/** Every legal complete turn for the dice currently on the table. `[[]]` means DANCE (no legal move). */
export function legalTurns(s: GameState): TurnMove[][] {
  if (s.phase !== PHASE_MOVE) return [[]];
  return legalTurnsFor(boardOf(s), s.current, s.dice);
}

/**
 * The forced/auto move: the lexicographically smallest legal maximal sequence. Deliberately dumb and
 * ordering-based rather than evaluation-based, so a Solidity `_autoTurn` reproduces it exactly — this
 * is what the contract plays when a player lets their clock run out.
 */
export function autoTurn(s: GameState): TurnMove[] {
  const turns = legalTurns(s);
  let best = turns[0];
  for (const t of turns) if (compareTurns(t, best) < 0) best = t;
  return best;
}

/** Is this exact sequence one of the legal complete turns? (Prefixes are rejected — you must play
 *  as many dice as the position allows.) */
export function isLegalTurn(s: GameState, moves: TurnMove[]): boolean {
  const key = moves.map((m) => `${m.from}:${m.die}`).join(",");
  return legalTurns(s).some((t) => t.map((m) => `${m.from}:${m.die}`).join(",") === key);
}

/**
 * The distinct next steps that can extend `played` toward SOME legal complete turn. This is what the
 * board UI highlights: it can never offer a move that would strand the player on an illegal turn.
 */
export function nextSteps(s: GameState, played: TurnMove[]): TurnMove[] {
  const prefix = played.map((m) => `${m.from}:${m.die}`).join(",");
  const seen = new Set<string>();
  const out: TurnMove[] = [];
  for (const t of legalTurns(s)) {
    if (t.length <= played.length) continue;
    const head = t
      .slice(0, played.length)
      .map((m) => `${m.from}:${m.die}`)
      .join(",");
    if (head !== prefix) continue;
    const step = t[played.length];
    const k = `${step.from}:${step.die}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ ...step });
    }
  }
  return out;
}

// ── scoring a finished game ───────────────────────────────────────────────────

/** 1 = single, 2 = gammon (loser bore off nothing), 3 = backgammon (…and is still on the bar or
 *  stuck in the winner's home board). */
export function gammonFlavor(s: GameState, winner: number): number {
  const loser = other(winner);
  if (s.off[loser] > 0) return 1;
  if (s.bar[loser] > 0) return 3;
  const lo = homeLo(winner);
  const hi = homeHi(winner);
  for (let i = lo; i <= hi; i++) if (countAt({ points: s.points, bar: s.bar, off: s.off }, i, loser) > 0) return 3;
  return 2;
}

/** Award the game, roll the match forward, and park in PHASE_GAME_OVER so both clients can watch the
 *  result land before the next board is dealt. `flavor` 0 marks a concession (pass / resign / cap). */
function endGame(s: GameState, winner: number, flavor: number): void {
  const points = s.cube * (flavor === 0 ? 1 : flavor);
  s.score[winner] += points;
  s.lastResult = {
    gameIndex: s.gameIndex,
    winner,
    points,
    flavor,
    cube: s.cube,
    seq: s.seq,
  };
  s.gameIndex += 1;

  if (s.score[winner] >= s.matchTo) {
    s.over = true;
    s.winner = winner;
    s.phase = PHASE_OVER;
    return;
  }
  if (s.gameIndex >= MAX_GAMES) {
    s.over = true;
    s.winner = decideMatch(s);
    s.phase = PHASE_OVER;
    return;
  }
  s.phase = PHASE_GAME_OVER;
  s.current = other(winner); // the loser sets the board up again (either seat may submit NEXT)
  s.dice = [0, 0];
}

/** Deal the next game off a fresh randomness word. The cube returns to the centre. */
function dealNextGame(s: GameState, word: Hex): void {
  const b = startingBoard();
  writeBoard(s, b);
  s.cube = 1;
  s.cubeOwner = -1;
  s.turnIndex = 0;

  const { a, b: c, ties } = openingThrow(word, 0);
  const first = a > c ? 0 : 1;
  if (s.officialOpening && ties > 0) s.cube = Math.min(MAX_CUBE, 2 ** ties);
  s.current = first;
  s.dice = [Math.max(a, c), Math.min(a, c)];
  s.phase = PHASE_MOVE;
  s.lastEvent = { kind: EV_OPEN, player: first, seq: s.seq, d1: s.dice[0], d2: s.dice[1], moves: [], cube: 1 };
}

/** Higher match score takes the pot; a dead-level match at the game cap is a genuine draw (-1). */
export function decideMatch(s: GameState): number {
  if (s.score[0] > s.score[1]) return 0;
  if (s.score[1] > s.score[0]) return 1;
  return -1;
}

/** Safety net: a game that will not end on its own is decided on the race, for the cube value. */
function capTurns(s: GameState): void {
  if (s.phase === PHASE_GAME_OVER || s.over) return;
  if (s.turnIndex < MAX_TURNS_PER_GAME) return;
  const [p0, p1] = pipCounts(s);
  endGame(s, p0 <= p1 ? 0 : 1, 0);
}

/** Finish the acting player's turn: hand over, or end the game if they just bore off their last checker. */
function endTurn(s: GameState): void {
  const p = s.current;
  s.turnIndex += 1;
  s.dice = [0, 0];
  if (s.off[p] === CHECKERS) {
    endGame(s, p, gammonFlavor(s, p));
    return;
  }
  s.current = other(p);
  s.phase = PHASE_ROLL;
  capTurns(s);
}

// ── transitions ───────────────────────────────────────────────────────────────

/**
 * ROLL. Consumes the per-action randomness word the facet delivers AFTER the commit, so the dice
 * cannot be known while the doubling decision is still open. A roll that leaves no legal move at all
 * (a DANCE) skips the turn inside the same action — there is nothing to submit, so charging the
 * player a second transaction for it would be pure waste.
 */
export function resolveRoll(state: GameState, randomness: Hex): GameState {
  const s = cloneState(state);
  const p = s.current;
  s.seq += 1;
  s.lastResult = null;

  const d1 = die(randomness, 0);
  const d2 = die(randomness, 1);
  s.dice = [d1, d2];
  s.phase = PHASE_MOVE;

  const turns = legalTurns(s);
  if (turns.length === 1 && turns[0].length === 0) {
    s.lastEvent = { kind: EV_DANCE, player: p, seq: s.seq, d1, d2, moves: [], cube: s.cube };
    endTurn(s);
    return s;
  }
  s.lastEvent = { kind: EV_ROLL, player: p, seq: s.seq, d1, d2, moves: [], cube: s.cube };
  return s;
}

/** MOVE. Plays a whole validated sequence and ends the turn. Deterministic — no randomness. */
export function resolveMove(state: GameState, moves: TurnMove[]): GameState {
  const s = cloneState(state);
  const p = s.current;
  const d1 = s.dice[0];
  const d2 = s.dice[1];
  s.seq += 1;
  s.lastResult = null;
  const { board } = playTurn(boardOf(s), p, moves);
  writeBoard(s, board);
  s.lastEvent = {
    kind: EV_MOVE,
    player: p,
    seq: s.seq,
    d1,
    d2,
    moves: moves.map((m) => ({ ...m })),
    cube: s.cube,
  };
  endTurn(s);
  return s;
}

/** DOUBLE. The cube is offered; the responder becomes `current` and owes a TAKE or a PASS. */
export function offerDouble(state: GameState): GameState {
  const s = cloneState(state);
  const p = s.current;
  s.seq += 1;
  s.lastResult = null;
  s.phase = PHASE_CUBE;
  s.current = other(p);
  s.lastEvent = { kind: EV_DOUBLE, player: p, seq: s.seq, d1: 0, d2: 0, moves: [], cube: s.cube * 2 };
  return s;
}

/** TAKE. The stake doubles and the cube changes hands — only its new owner may turn it again. */
export function takeCube(state: GameState): GameState {
  const s = cloneState(state);
  const taker = s.current;
  s.seq += 1;
  s.lastResult = null;
  s.cube = Math.min(MAX_CUBE, s.cube * 2);
  s.cubeOwner = taker;
  s.current = other(taker); // the doubler still has their turn to play
  s.phase = PHASE_ROLL;
  s.lastEvent = { kind: EV_TAKE, player: taker, seq: s.seq, d1: 0, d2: 0, moves: [], cube: s.cube };
  return s;
}

/** PASS. The game is conceded at the CURRENT cube value (the offered double is never paid). */
export function passCube(state: GameState): GameState {
  const s = cloneState(state);
  const passer = s.current;
  const winner = other(passer);
  s.seq += 1;
  s.lastEvent = { kind: EV_PASS, player: passer, seq: s.seq, d1: 0, d2: 0, moves: [], cube: s.cube };
  endGame(s, winner, 0);
  return s;
}

/** RESIGN. Concede the game in progress for a single game at the cube value. */
export function resignGame(state: GameState): GameState {
  const s = cloneState(state);
  const quitter = s.current;
  const winner = other(quitter);
  s.seq += 1;
  s.lastEvent = { kind: EV_RESIGN, player: quitter, seq: s.seq, d1: 0, d2: 0, moves: [], cube: s.cube };
  endGame(s, winner, 0);
  return s;
}

/** NEXT. Deal the following game of the match from a fresh randomness word. */
export function startNextGame(state: GameState, randomness: Hex): GameState {
  const s = cloneState(state);
  s.seq += 1;
  dealNextGame(s, randomness);
  return s;
}

/**
 * The single reducer used by the verifier, the runtime, the bot and the tests. Illegal input returns
 * the state unchanged (on-chain the contract reverts instead — either way the match cannot advance
 * on an illegal action).
 */
export function applyAction(s: GameState, player: number, action: Action, randomness: Hex): GameState {
  if (s.over) return cloneState(s);

  // NEXT is the one action either seat may submit, so a losing player cannot stall the match by
  // refusing to set the board up again.
  if (action.type === "next") {
    if (!canNext(s) || (player !== 0 && player !== 1)) return cloneState(s);
    return startNextGame(s, randomness);
  }

  if (player !== s.current) return cloneState(s);

  switch (action.type) {
    case "roll":
      return canRoll(s, player) ? resolveRoll(s, randomness) : cloneState(s);
    case "move":
      return canMove(s, player) && isLegalTurn(s, action.moves) ? resolveMove(s, action.moves) : cloneState(s);
    case "double":
      return canDouble(s, player) ? offerDouble(s) : cloneState(s);
    case "take":
      return canRespondCube(s, player) ? takeCube(s) : cloneState(s);
    case "pass":
      return canRespondCube(s, player) ? passCube(s) : cloneState(s);
    case "resign":
      return canResign(s, player) ? resignGame(s) : cloneState(s);
  }
}

// ── ranking ───────────────────────────────────────────────────────────────────

export interface RankEntry {
  seat: number;
  score: number;
}

export function getRanking(s: GameState): RankEntry[] {
  return s.score
    .map((score, seat) => ({ seat, score }))
    .sort((a, b) => b.score - a.score || a.seat - b.seat);
}

// ── small helpers the UI + bot share ──────────────────────────────────────────

/** Distinct board positions reachable from the dice on the table (move ORDER collapsed away). */
export function distinctOutcomes(s: GameState): Array<{ moves: TurnMove[]; board: Board }> {
  const seen = new Set<string>();
  const out: Array<{ moves: TurnMove[]; board: Board }> = [];
  for (const moves of legalTurns(s)) {
    const { board } = playTurn(boardOf(s), s.current, moves);
    const k = boardKey(board);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ moves, board: cloneBoard(board) });
  }
  return out;
}

/** Checkers a seat currently has on a point — re-exported so UI code needs only `@engine`. */
export function checkersAt(s: GameState, i: number, seat: number): number {
  return countAt({ points: s.points, bar: s.bar, off: s.off }, i, seat);
}

/** How many match points the current game is worth to each side if it simply ends now (cube × 1). */
export function stakeNow(s: GameState): number {
  return s.cube;
}

/** Points a seat still needs to take the match. */
export function needToWin(s: GameState, seat: number): number {
  return Math.max(0, s.matchTo - s.score[seat]);
}
