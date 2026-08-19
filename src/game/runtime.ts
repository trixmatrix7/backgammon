// Mirrors a future GammonGame.sol lifecycle (deal → roll → move → cube → next game → resolve) in TS,
// reusing the tested @engine rule primitives. Used by the MockHost so the whole client runs locally.
//
// Randomness is per-action and cheat-safe: exactly two action kinds consume a word — ROLL (the dice)
// and NEXT (the following game's opening throw) — and the facet delivers each one AFTER the player
// has committed, so no decision in this game is ever made while already knowing the outcome it turns
// on. MOVE / DOUBLE / TAKE / PASS / RESIGN are fully deterministic and request nothing.
import {
  applyAction,
  botNextAction,
  createInitialState,
  type Action,
  type GameState,
  type Hex,
} from "@engine";

export interface MockMatch {
  matchTo: number;
  es: GameState;
  deadline: number; // ms epoch (client soft per-turn timer)
  turnMs: number; // configured per-turn time limit
  winner: number | null; // null = in progress; -1 = drawn match; else the winning seat
}

export function startMatch(
  matchTo: number,
  turnMs: number,
  seed: Hex,
  cubeOn = false,
  officialOpening = false,
): MockMatch {
  const es = createInitialState(seed, 2, matchTo, cubeOn, officialOpening);
  return {
    matchTo,
    es,
    deadline: Date.now() + turnMs,
    turnMs,
    winner: es.over ? es.winner : null,
  };
}

/** Apply one action for `player` with a fresh randomness word; refresh winner + per-turn deadline. */
export function step(m: MockMatch, player: number, action: Action, randomness: Hex): void {
  m.es = applyAction(m.es, player, action, randomness);
  if (m.es.over) m.winner = m.es.winner;
  m.deadline = Date.now() + m.turnMs;
}

/** The current player's next bot action (cube decision, move, cube answer, or "deal the next game"). */
export function botFor(m: MockMatch): Action {
  return botNextAction(m.es);
}

/** Which actions consume a randomness word — the exact set a contract sets `requestRandomnessNow` for. */
export function needsRandomness(action: Action): boolean {
  return action.type === "roll" || action.type === "next";
}

/** Convenience for the host's forfeit path: who is NOT this seat. */
export function opponentOf(seat: number): number {
  return seat ^ 1;
}

export type { GameState };
