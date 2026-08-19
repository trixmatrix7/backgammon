// Shared cinematic timings. The client's animator plays each event for exactly these durations, and
// the MockHost paces its bot off the same numbers so a bot turn can never outrun the animation queue.
// One module, so the two can never drift apart.

import { EV_DANCE, EV_DOUBLE, EV_MOVE, EV_OPEN, EV_PASS, EV_RESIGN, EV_ROLL, EV_TAKE, type TurnMove } from "@engine";

export const ROLL_MS = 1050; // dice tumble across the board and settle
/**
 * One HOP — a checker lifting off one point and landing on the next.
 *
 * A checker does not slide to its answer, it counts its way there, so a move of
 * six takes six of these and a move of one takes one. Giving every move the same
 * total would make a six six times faster per hop than a one, which is exactly
 * what made the long moves look like flying: the eye never got a frame where the
 * checker was standing still.
 */
export const HOP_MS = 165;

/**
 * How many hops a single checker move is worth.
 *
 * Entering from the bar counts exactly like any other move: a 4 comes in on the
 * fourth point and touches the three before it on the way, so it is four hops. This
 * used to be billed as one — which did not shorten the ANIMATION (the board builds
 * its own waypoints), it only cut the animation's time budget to a fifth. The
 * checker was yanked to its destination partway through its walk, which is why
 * coming in off the bar was the one move that still looked like flying.
 *
 * Bearing off stays one hop: there is nowhere in between to count.
 */
export function hopsIn(m: TurnMove): number {
  return m.die;
}

/** How long one checker's whole journey takes. */
export function moveDuration(m: TurnMove): number {
  return hopsIn(m) * HOP_MS;
}

/** The journey time of a whole turn, one checker after another. */
export function turnDuration(moves: TurnMove[]): number {
  return moves.reduce((t, m) => t + moveDuration(m), 0);
}

export const MOVE_TAIL_MS = 400; // the beat after the last checker lands
export const DANCE_MS = 1500; // dice land, then the DANCED stamp
export const CUBE_MS = 1600; // the cube slams over to its new face
export const CUBE_ANSWER_MS = 950; // TAKE / PASS
export const OPEN_MS = 900; // a fresh board is dealt with the opening throw already on it
export const RESULT_MS = 3200; // how long a finished GAME's scoreline holds before the next deal
export const WIN_REVEAL_MS = 2800; // hold on the final board before the match result screen

export function eventDuration(kind: number, moves: TurnMove[]): number {
  switch (kind) {
    case EV_ROLL:
      return ROLL_MS;
    case EV_MOVE:
      return Math.max(HOP_MS, turnDuration(moves)) + MOVE_TAIL_MS;
    case EV_DANCE:
      return DANCE_MS;
    case EV_DOUBLE:
      return CUBE_MS;
    case EV_TAKE:
    case EV_PASS:
    case EV_RESIGN:
      return CUBE_ANSWER_MS;
    case EV_OPEN:
      return OPEN_MS;
    default:
      return 260;
  }
}
