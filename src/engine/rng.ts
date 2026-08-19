import { keccak256, encodeAbiParameters } from "viem";
import type { Hex } from "./types.js";

/**
 * The ONE randomness primitive. Every random value in the game is
 * `keccak256(abi.encode(bytes32 word, uint256 n)) % N`, drawn from a monotonically increasing counter
 * `n`. A Solidity port computes the identical hash, so the chain can re-derive and verify every roll.
 *
 *   - `word` for a ROLL is the per-action randomness the PvP facet delivers AFTER the player commits
 *     to roll. That ordering is the whole cheat-safety argument: the doubling decision happens in
 *     PHASE_ROLL, strictly before the word exists, so nobody can double (or decline to) while already
 *     knowing what they are about to throw.
 *   - `word` for the OPENING ROLL of game 1 is the match seed (public, but symmetric and preceded by
 *     no decision). For games 2..N it is the fresh word delivered with the action that ended the
 *     previous game — so a take/pass decision can never be made while knowing the next opening roll.
 */
export function rngWord(word: Hex, n: number): bigint {
  return BigInt(
    keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [word, BigInt(n)])),
  );
}

/** A die face 1..6 from draw `n`. Mirrors Solidity `uint8(rngWord % 6) + 1`. */
export function die(word: Hex, n: number): number {
  return Number(rngWord(word, n) % 6n) + 1;
}

/** A uniform integer in [0, bound) from draw `n` (bound > 0). */
export function rngBelow(word: Hex, n: number, bound: number): number {
  return Number(rngWord(word, n) % BigInt(bound));
}

/**
 * The opening throw: each side rolls ONE die and the higher goes first, playing both dice. The two
 * dice must differ, so instead of a rejection loop (unbounded gas) we draw uniformly from the 30
 * ORDERED distinct pairs and decode — one hash, always. `[a, b]` = seat 0's die, seat 1's die.
 *
 *   r = word % 30 ;  a = r / 5 + 1 ;  t = r % 5 ;  b = t < a-1 ? t+1 : t+2
 *
 * `b` walks the 5 faces other than `a` in ascending order, so every ordered distinct pair is hit
 * exactly once and both seats are perfectly symmetric.
 */
export function openingPair(word: Hex, n: number): [number, number] {
  const r = rngBelow(word, n, 30);
  const a = Math.floor(r / 5) + 1;
  const t = r % 5;
  const b = t < a - 1 ? t + 1 : t + 2;
  return [a, b];
}

/**
 * The opening throw, exactly as the table rules describe it: BOTH players throw one die and the
 * higher number starts, playing both dice as their first turn. A tie is thrown again — and under the
 * "offiziell" table rule each tie also doubles the value of the game before the re-throw (the
 * automatic double).
 *
 * Ties therefore have to be *possible*, which rules out drawing from the 30 distinct pairs. The loop
 * is bounded instead: eight ties in a row is a one-in-1.7-million event, and past that we fall back
 * to a guaranteed distinct pair so an on-chain match can never hang on a run of doubles.
 *
 * `ties` is the number of re-throws, i.e. how many automatic doubles the "offiziell" rule awards.
 */
export function openingThrow(word: Hex, n: number): { a: number; b: number; ties: number } {
  for (let k = 0; k < 8; k++) {
    const a = die(word, n + k * 2);
    const b = die(word, n + k * 2 + 1);
    if (a !== b) return { a, b, ties: k };
  }
  const [a, b] = openingPair(word, n + 64);
  return { a, b, ties: 8 };
}
