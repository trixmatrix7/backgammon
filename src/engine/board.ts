// Chain Gammon — the raw board primitives. Everything here operates on a plain `Board` (the three
// arrays that a Solidity `int8[24] points; uint8[2] bar; uint8[2] off;` mirrors byte-for-byte) and is
// free of any match/cube/turn concepts, so it can be unit-tested and ported in isolation.

import {
  BAR,
  CHECKERS,
  NUM_POINTS,
  OFF,
  type TurnMove,
  dirOf,
  homeHi,
  homeLo,
  entryIndex,
  pipsFrom,
  other,
} from "./types.js";

export interface Board {
  points: number[]; // 24 signed slots: +n = n seat-0 checkers, −n = n seat-1 checkers
  bar: number[]; // [seat0, seat1]
  off: number[]; // [seat0, seat1]
}

/** The classic opening setup, written in ABSOLUTE indices (see the geometry note in types.ts):
 *  each side has 2 on its 24-point, 5 on its 13-point, 3 on its 8-point and 5 on its 6-point. */
export function startingBoard(): Board {
  const points = new Array<number>(NUM_POINTS).fill(0);
  // seat 0 (travels 23 → 0): its N-point is index N-1
  points[23] = 2;
  points[12] = 5;
  points[7] = 3;
  points[5] = 5;
  // seat 1 (travels 0 → 23): its N-point is index 24-N
  points[0] = -2;
  points[11] = -5;
  points[16] = -3;
  points[18] = -5;
  return { points, bar: [0, 0], off: [0, 0] };
}

export function cloneBoard(b: Board): Board {
  return { points: [...b.points], bar: [...b.bar], off: [...b.off] };
}

/** How many checkers `seat` has standing on index `i`. */
export function countAt(b: Board, i: number, seat: number): number {
  const v = b.points[i];
  return seat === 0 ? Math.max(0, v) : Math.max(0, -v);
}

/** A point is blocked for `seat` when the opponent has TWO OR MORE checkers on it. */
export function isBlocked(b: Board, i: number, seat: number): boolean {
  return countAt(b, i, other(seat)) >= 2;
}

/** A lone enemy checker sitting on `i` — hittable. */
export function isBlot(b: Board, i: number, seat: number): boolean {
  return countAt(b, i, other(seat)) === 1;
}

/** Every one of a seat's 15 checkers is in its home board (and none on the bar) → bear-off is open. */
export function allHome(b: Board, seat: number): boolean {
  if (b.bar[seat] > 0) return false;
  const lo = homeLo(seat);
  const hi = homeHi(seat);
  let inHome = b.off[seat];
  for (let i = lo; i <= hi; i++) inHome += countAt(b, i, seat);
  return inHome === CHECKERS;
}

/** Total pips `seat` still has to travel (bar checkers owe the full 25). Lower is better. */
export function pipCount(b: Board, seat: number): number {
  let pips = b.bar[seat] * (NUM_POINTS + 1);
  for (let i = 0; i < NUM_POINTS; i++) pips += countAt(b, i, seat) * pipsFrom(seat, i);
  return pips;
}

/** Where a move lands: an index 0..23, or OFF when it runs past the edge of the board. */
export function moveDest(seat: number, from: number, d: number): number {
  if (from === BAR) return entryIndex(seat, d);
  const t = from + dirOf(seat) * d;
  return t < 0 || t >= NUM_POINTS ? OFF : t;
}

/**
 * Is this single step legal on this board right now? Encodes all four checker rules:
 *  1. checkers on the bar must re-enter before anything else moves;
 *  2. a point held by 2+ enemy checkers is closed;
 *  3. bearing off needs every checker home, and an oversized die only bears off from the
 *     furthest-back occupied point;
 *  4. you cannot move a checker you do not have.
 */
export function canApply(b: Board, seat: number, from: number, d: number): boolean {
  if (d < 1 || d > 6) return false;

  if (b.bar[seat] > 0) {
    if (from !== BAR) return false;
  } else {
    if (from === BAR) return false;
    if (from < 0 || from >= NUM_POINTS) return false;
    if (countAt(b, from, seat) === 0) return false;
  }

  const dest = moveDest(seat, from, d);
  if (dest === OFF) {
    // A bear-off (never possible straight off the bar — moveDest keeps bar entries on the board).
    if (!allHome(b, seat)) return false;
    const need = pipsFrom(seat, from);
    if (d === need) return true;
    if (d < need) return false; // not actually a bear-off; the destination would still be on the board
    // Oversized die: only legal from the furthest-back checker, i.e. nothing behind `from`.
    const step = -dirOf(seat); // "further from home" direction
    for (let i = from + step; i >= homeLo(seat) && i <= homeHi(seat); i += step) {
      if (countAt(b, i, seat) > 0) return false;
    }
    return true;
  }

  return !isBlocked(b, dest, seat);
}

/** Apply a legal step IN PLACE. Returns true when it hit a blot (the enemy checker goes to the bar). */
export function applyMove(b: Board, seat: number, from: number, d: number): boolean {
  const sign = seat === 0 ? 1 : -1;
  if (from === BAR) b.bar[seat] -= 1;
  else b.points[from] -= sign;

  const dest = moveDest(seat, from, d);
  if (dest === OFF) {
    b.off[seat] += 1;
    return false;
  }
  let hit = false;
  if (isBlot(b, dest, seat)) {
    hit = true;
    b.points[dest] = 0;
    b.bar[other(seat)] += 1;
  }
  b.points[dest] += sign;
  return hit;
}

/** Candidate source points, in canonical ascending order (BAR first when forced). */
function sourcesFor(b: Board, seat: number): number[] {
  if (b.bar[seat] > 0) return [BAR];
  const s: number[] = [];
  for (let i = 0; i < NUM_POINTS; i++) if (countAt(b, i, seat) > 0) s.push(i);
  return s;
}

/** Belt-and-braces guard: a real backgammon position never comes close, but a runaway search must
 *  not be able to hang a browser (or a node). */
const MAX_SEQUENCES = 40000;

/**
 * Every LEGAL COMPLETE turn for `dice`, already filtered by backgammon's two "you must use your
 * roll" rules:
 *   • play as many dice as you legally can, and
 *   • if you can play exactly one die but not both, you must play the higher one if that is possible.
 * Doubles yield four dice. An empty result array means the player is DANCING (no legal move at all),
 * which is returned as a single empty sequence rather than "no sequences".
 */
export function legalTurnsFor(b: Board, seat: number, dice: number[]): TurnMove[][] {
  const pool = dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : [dice[0], dice[1]];
  const seen = new Set<string>();
  const out: TurnMove[][] = [];
  let best = 0;

  const rec = (bb: Board, remaining: number[], path: TurnMove[]) => {
    if (out.length >= MAX_SEQUENCES) return;
    let any = false;
    const tried = new Set<number>();
    for (let k = 0; k < remaining.length; k++) {
      const d = remaining[k];
      if (tried.has(d)) continue; // identical die values are interchangeable
      tried.add(d);
      const rest = remaining.slice(0, k).concat(remaining.slice(k + 1));
      for (const from of sourcesFor(bb, seat)) {
        if (!canApply(bb, seat, from, d)) continue;
        any = true;
        const nb = cloneBoard(bb);
        applyMove(nb, seat, from, d);
        path.push({ from, die: d });
        rec(nb, rest, path);
        path.pop();
      }
    }
    if (!any) {
      if (path.length > best) best = path.length;
      const key = path.map((m) => `${m.from}:${m.die}`).join(",");
      if (!seen.has(key)) {
        seen.add(key);
        out.push(path.slice());
      }
    }
  };

  rec(b, pool, []);

  let kept = out.filter((p) => p.length === best);

  // "Play the higher die when only one is playable" — only ever bites on a non-double roll where the
  // maximum usable count is exactly 1.
  if (best === 1 && dice[0] !== dice[1]) {
    const hi = Math.max(dice[0], dice[1]);
    const withHi = kept.filter((p) => p[0].die === hi);
    if (withHi.length > 0) kept = withHi;
  }

  return kept.length > 0 ? kept : [[]];
}

/** Lexicographic order over move sequences: (from, die) pairs ascending, shorter first on a prefix
 *  tie. `autoTurn` picks the smallest under this order, which a Solidity port can reproduce exactly. */
export function compareTurns(a: TurnMove[], b: TurnMove[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i].from !== b[i].from) return a[i].from - b[i].from;
    if (a[i].die !== b[i].die) return a[i].die - b[i].die;
  }
  return a.length - b.length;
}

/** A stable signature of a position — used to collapse move orderings that reach the same board. */
export function boardKey(b: Board): string {
  return `${b.points.join(",")}|${b.bar.join(",")}|${b.off.join(",")}`;
}

/** Play a whole sequence onto a clone. Returns the new board and which steps hit a blot. */
export function playTurn(b: Board, seat: number, moves: TurnMove[]): { board: Board; hits: boolean[] } {
  const nb = cloneBoard(b);
  const hits: boolean[] = [];
  for (const m of moves) hits.push(applyMove(nb, seat, m.from, m.die));
  return { board: nb, hits };
}
