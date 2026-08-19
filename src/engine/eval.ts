// Position judgement. NOTHING here is part of the on-chain rules — no contract mirrors it and no
// state field stores it. It exists twice over: it drives the dev-only bot, and it powers the HUD's
// race read so a newcomer can see WHY the cube decision in front of them is hard.
//
// Everything is pure and deterministic (integer/float arithmetic on the board only), so the same
// position always reads the same number.

import { NUM_POINTS, homeHi, homeLo, other, pipsFrom } from "./types.js";
import { type Board, countAt, pipCount } from "./board.js";

/**
 * How many of the 36 dice combinations produce a total of exactly `d` — the classic shot table.
 * Direct shots (1–6) include the two-die combinations that reach the same distance; 7–12 and the
 * doubles-only distances (15, 16, 18, 20, 24) are the indirect ones.
 */
const SHOTS = [0, 11, 12, 14, 15, 15, 17, 6, 6, 5, 3, 2, 3, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1];

/** Where a checker on the bar conceptually stands, so bar-to-blot distances use one formula. */
function virtualStart(seat: number): number {
  return seat === 0 ? NUM_POINTS : -1;
}

/** Highest board index holding a checker of `seat` (−1 when it has none on the board). */
export function maxIndexOf(b: Board, seat: number): number {
  for (let i = NUM_POINTS - 1; i >= 0; i--) if (countAt(b, i, seat) > 0) return i;
  return -1;
}

/** Lowest board index holding a checker of `seat` (NUM_POINTS when it has none on the board). */
export function minIndexOf(b: Board, seat: number): number {
  for (let i = 0; i < NUM_POINTS; i++) if (countAt(b, i, seat) > 0) return i;
  return NUM_POINTS;
}

/**
 * Can the two sides still reach each other? Seat 0 runs 23→0 and seat 1 runs 0→23, so they are in
 * contact exactly while some seat-0 checker sits on a higher index than some seat-1 checker. Once
 * that stops being true the game is a pure race and the cube maths changes completely.
 */
export function hasContact(b: Board): boolean {
  const a = b.bar[0] > 0 ? NUM_POINTS : maxIndexOf(b, 0);
  const c = b.bar[1] > 0 ? -1 : minIndexOf(b, 1);
  if (a < 0 || c >= NUM_POINTS) return false;
  return a > c;
}

/** Rolls (out of 36) with which the opponent can reach index `i` to hit a blot of `seat` standing there. */
export function shotsAt(b: Board, i: number, seat: number): number {
  const opp = other(seat);
  const dir = opp === 0 ? -1 : 1;
  let shots = 0;
  if (b.bar[opp] > 0) {
    const d = (i - virtualStart(opp)) * dir;
    if (d >= 1 && d <= 24) shots += SHOTS[d];
  } else {
    for (let j = 0; j < NUM_POINTS; j++) {
      if (countAt(b, j, opp) === 0) continue;
      const d = (i - j) * dir;
      if (d >= 1 && d <= 24) shots += SHOTS[d];
    }
  }
  return Math.min(36, shots);
}

/**
 * Expected pips lost to blots, per seat. A blot costs (chance of being hit) × (pips it would have to
 * make up from the bar), which is exactly why leaving a blot deep in enemy territory is so much worse
 * than leaving one on your own 6-point.
 */
export function blotRisk(b: Board, seat: number): number {
  let risk = 0;
  for (let i = 0; i < NUM_POINTS; i++) {
    if (countAt(b, i, seat) !== 1) continue;
    const lost = NUM_POINTS + 1 - pipsFrom(seat, i); // pips surrendered when sent back to the bar
    risk += (shotsAt(b, i, seat) / 36) * lost;
  }
  return risk;
}

/** The longest run of consecutive points held by `seat` — the blockade an opponent has to jump. */
export function longestPrime(b: Board, seat: number): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < NUM_POINTS; i++) {
    if (countAt(b, i, seat) >= 2) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

/** Enemy checkers (bar included) still stuck behind the back edge of `seat`'s blockade. */
export function trappedBehind(b: Board, seat: number): number {
  const prime: number[] = [];
  for (let i = 0; i < NUM_POINTS; i++) if (countAt(b, i, seat) >= 2) prime.push(i);
  if (prime.length === 0) return 0;
  const opp = other(seat);
  // The opponent runs toward the far end; anything on the wrong side of our furthest-back point is
  // still facing the wall.
  const edge = seat === 0 ? Math.max(...prime) : Math.min(...prime);
  let stuck = b.bar[opp];
  for (let i = 0; i < NUM_POINTS; i++) {
    if (countAt(b, i, opp) === 0) continue;
    if (seat === 0 ? i > edge : i < edge) stuck += countAt(b, i, opp);
  }
  return stuck;
}

/** A single number for how good this position is for `seat`. Roughly denominated in pips. */
export function evaluatePosition(b: Board, seat: number): number {
  const opp = other(seat);
  let v = pipCount(b, opp) - pipCount(b, seat);

  v += (b.off[seat] - b.off[opp]) * 4;
  v -= b.bar[seat] * 16;
  v += b.bar[opp] * 16;

  v -= blotRisk(b, seat) * 2.0;
  v += blotRisk(b, opp) * 1.2; // the opponent's loose checkers are an opportunity, not a guarantee

  // Points made where they matter: your own home board closes the door, an anchor in theirs is the
  // single most valuable defensive asset in the game.
  for (let i = homeLo(seat); i <= homeHi(seat); i++) if (countAt(b, i, seat) >= 2) v += 6;
  for (let i = homeLo(opp); i <= homeHi(opp); i++) if (countAt(b, i, seat) >= 2) v += 9;

  const myPrime = longestPrime(b, seat);
  const oppPrime = longestPrime(b, opp);
  v += myPrime * myPrime * 1.1;
  v -= oppPrime * oppPrime * 1.1;

  v += trappedBehind(b, seat) * 3.5;
  v -= trappedBehind(b, opp) * 3.5;

  return v;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * A rough probability that `seat` wins this GAME, blending the race (a logistic on the pip lead,
 * with the ~4-pip value of being on roll) with the positional score once the sides are still in
 * contact. It is an estimate and is labelled as one wherever it is shown — its job is to make the
 * cube decision legible, not to be an oracle.
 */
export function winProbability(b: Board, seat: number, onRoll: boolean): number {
  const my = pipCount(b, seat);
  const th = pipCount(b, other(seat));
  if (my === 0) return 1;
  if (th === 0) return 0;

  const diff = th - my + (onRoll ? 4 : -4);
  const scale = 1.6 * Math.sqrt(Math.max(24, (my + th) / 2));
  let p = 1 / (1 + Math.exp(-diff / scale));

  if (hasContact(b)) {
    const positional = evaluatePosition(b, seat) - (th - my); // strip the pip term, keep the shape
    p = p + positional / 260;
  }
  return clamp(p, 0.02, 0.98);
}

/** Chance `seat` wins the game by a gammon or better — crudely, how far ahead they are in the race
 *  while the opponent still has nothing off. Used only to colour the cube advice. */
export function gammonChance(b: Board, seat: number): number {
  const opp = other(seat);
  if (b.off[opp] > 0) return 0;
  const lead = pipCount(b, opp) - pipCount(b, seat);
  if (lead <= 0) return 0;
  return clamp((lead - 20) / 120, 0, 0.45);
}
