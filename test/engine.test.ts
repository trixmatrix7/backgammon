import { describe, expect, it } from "vitest";
import {
  BAR,
  CHECKERS,
  EV_DANCE,
  MAX_GAMES,
  PHASE_CUBE,
  PHASE_GAME_OVER,
  PHASE_MOVE,
  PHASE_OVER,
  PHASE_ROLL,
  applyAction,
  autoTurn,
  botNextAction,
  canApply,
  canDouble,
  createInitialState,
  other,
  gammonFlavor,
  isLegalTurn,
  legalTurns,
  openingPair,
  pipCount,
  pipCounts,
  startingBoard,
  verifyMatch,
  type GameState,
  type Hex,
  type MoveLogEntry,
} from "@engine";
import { decodeAction, decodeState, encodeAction, encodeState, ROLL } from "../src/game/codec";

const SEED = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as Hex;
const word = (i: number): Hex => (`0x${(i + 1).toString(16).padStart(64, "0")}`) as Hex;

const emptyPoints = () => new Array<number>(24).fill(0);

function stateWith(patch: Partial<GameState>): GameState {
  // cubeOn: the doubling cube is a table rule now and is off unless the table turns it on.
  return { ...createInitialState(SEED, 2, 5, true), ...patch };
}

/** Drive a whole match bot-vs-bot and keep the replay log. */
function playMatch(seed: Hex, matchTo: number) {
  let s = createInitialState(seed, 2, matchTo, true);
  const log: MoveLogEntry[] = [];
  let n = 0;
  while (!s.over && n < 20000) {
    const action = botNextAction(s);
    const player = s.current;
    const randomness = word(n);
    log.push({ seq: s.seq, player, action, randomness });
    const next = applyAction(s, player, action, randomness);
    if (next.seq === s.seq) {
      throw new Error(`action made no progress (phase ${s.phase}, action ${action.type})`);
    }
    s = next;
    n += 1;
  }
  return { state: s, log };
}

// ── board setup ───────────────────────────────────────────────────────────────

describe("starting position", () => {
  it("gives both seats 15 checkers and the classic 167 pips", () => {
    const b = startingBoard();
    let c0 = 0;
    let c1 = 0;
    for (const v of b.points) {
      if (v > 0) c0 += v;
      else c1 += -v;
    }
    expect(c0).toBe(CHECKERS);
    expect(c1).toBe(CHECKERS);
    expect(pipCount(b, 0)).toBe(167);
    expect(pipCount(b, 1)).toBe(167);
  });

  it("is mirror-symmetric between the two seats", () => {
    const b = startingBoard();
    // `===` rather than toBe, because -0 and +0 are the same empty point but fail Object.is.
    for (let i = 0; i < 24; i++) expect(b.points[i] === -b.points[23 - i]).toBe(true);
  });
});

describe("opening throw", () => {
  it("never produces a pair, and covers all 30 ordered distinct pairs", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const [a, b] = openingPair(word(i), 0);
      expect(a).not.toBe(b);
      expect(a).toBeGreaterThanOrEqual(1);
      expect(a).toBeLessThanOrEqual(6);
      expect(b).toBeGreaterThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(6);
      seen.add(`${a}-${b}`);
    }
    expect(seen.size).toBe(30);
  });

  it("seats the higher die on move, with both dice on the table", () => {
    const s = createInitialState(SEED, 2, 5);
    expect(s.phase).toBe(PHASE_MOVE);
    expect(s.dice[0]).toBeGreaterThan(s.dice[1]);
    expect(legalTurns(s).length).toBeGreaterThan(0);
  });
});

// ── checker rules ─────────────────────────────────────────────────────────────

describe("checker legality", () => {
  it("forces checkers off the bar before anything else moves", () => {
    const b = startingBoard();
    b.bar[0] = 1;
    b.points[23] = 1;
    expect(canApply(b, 0, 23, 1)).toBe(false); // a board move while the bar is loaded
    expect(canApply(b, 0, BAR, 2)).toBe(true); // entry on seat 1's 2-point (index 22) is open
  });

  it("closes a point held by two or more enemy checkers", () => {
    const points = emptyPoints();
    points[10] = 1;
    points[7] = -2;
    points[8] = -1;
    const b = { points, bar: [0, 0], off: [0, 0] };
    expect(canApply(b, 0, 10, 3)).toBe(false); // 10 → 7 is blocked
    expect(canApply(b, 0, 10, 2)).toBe(true); // 10 → 8 is a blot, hittable
  });

  it("sends a hit blot to the bar", () => {
    const points = emptyPoints();
    points[10] = 1;
    points[7] = -1;
    const s = stateWith({ points, bar: [0, 0], off: [0, 0], current: 0, phase: PHASE_MOVE, dice: [3, 1] });
    const moves = [
      { from: 10, die: 3 }, // lands on the blot
      { from: 7, die: 1 },
    ];
    expect(isLegalTurn(s, moves)).toBe(true);
    const after = applyAction(s, 0, { type: "move", moves }, word(1));
    expect(after.bar[1]).toBe(1);
    expect(after.points[7]).toBe(0); // the blot is gone from the board
    expect(after.points[6]).toBe(1);
  });

  it("only bears off once every checker is home, and never over a checker further back", () => {
    const points = emptyPoints();
    points[5] = 2; // seat 0's 6-point
    points[2] = 1; // seat 0's 3-point
    const b = { points, bar: [0, 0], off: [12, 0] };
    expect(canApply(b, 0, 5, 6)).toBe(true); // exact
    expect(canApply(b, 0, 2, 3)).toBe(true); // exact
    expect(canApply(b, 0, 2, 6)).toBe(false); // oversized, but checkers still sit on the 6-point
    expect(canApply(b, 0, 5, 3)).toBe(true); // 6-point → 3-point is just a normal move

    const withBar = { points: [...points], bar: [1, 0], off: [11, 0] };
    expect(canApply(withBar, 0, 5, 6)).toBe(false); // a checker on the bar closes bear-off
  });

  it("bears off with an oversized die once nothing is further back", () => {
    const points = emptyPoints();
    points[2] = 1;
    const b = { points, bar: [0, 0], off: [14, 0] };
    expect(canApply(b, 0, 2, 6)).toBe(true);
  });
});

describe("you must use your roll", () => {
  it("plays the higher die when only one of the two can be played", () => {
    // Seat 0 sits on the bar. Both entry points (3 → index 21, 5 → index 19) are open, but the second
    // die is dead either way, so the rules force the HIGHER one.
    const points = emptyPoints();
    points[0] = 14; // seat 0's remaining checkers, stuck (bearing off is closed while a checker is out)
    points[16] = -2; // kills the follow-up from both entry points
    points[23] = -13;
    const s = stateWith({
      points,
      bar: [1, 0],
      off: [0, 0],
      current: 0,
      phase: PHASE_MOVE,
      dice: [3, 5],
    });
    const turns = legalTurns(s);
    expect(turns).toEqual([[{ from: BAR, die: 5 }]]);
  });

  it("rejects a turn that abandons a playable die", () => {
    const s = createInitialState(SEED, 2, 5);
    const full = legalTurns(s);
    expect(full.every((t) => t.length === 2)).toBe(true);
    expect(isLegalTurn(s, [full[0][0]])).toBe(false); // a legal prefix is still an illegal TURN
    expect(isLegalTurn(s, full[0])).toBe(true);
  });

  it("gives four moves on doubles", () => {
    const s = stateWith({ current: 0, phase: PHASE_MOVE, dice: [2, 2] });
    expect(legalTurns(s)[0].length).toBe(4);
  });

  it("skips the turn automatically when the roll dances", () => {
    const points = emptyPoints();
    for (let i = 18; i <= 23; i++) points[i] = -2; // seat 1 closes its whole home board
    points[0] = -3;
    points[1] = 14;
    const s = stateWith({ points, bar: [1, 0], off: [0, 0], current: 0, phase: PHASE_ROLL, dice: [0, 0] });
    const after = applyAction(s, 0, { type: "roll" }, word(7));
    expect(after.lastEvent?.kind).toBe(EV_DANCE);
    expect(after.current).toBe(1);
    expect(after.phase).toBe(PHASE_ROLL);
  });
});

// ── the doubling cube ─────────────────────────────────────────────────────────

describe("doubling cube", () => {
  const rollPhase = (patch: Partial<GameState> = {}) =>
    stateWith({ current: 0, phase: PHASE_ROLL, dice: [0, 0], ...patch });

  it("doubles the stake and hands the cube to the taker", () => {
    let s = rollPhase();
    expect(canDouble(s, 0)).toBe(true);
    s = applyAction(s, 0, { type: "double" }, word(1));
    expect(s.phase).toBe(PHASE_CUBE);
    expect(s.current).toBe(1); // the responder owes an answer
    s = applyAction(s, 1, { type: "take" }, word(2));
    expect(s.cube).toBe(2);
    expect(s.cubeOwner).toBe(1);
    expect(s.current).toBe(0); // the doubler still has their turn
    expect(s.phase).toBe(PHASE_ROLL);
    expect(canDouble(s, 0)).toBe(false); // the cube is no longer theirs to turn
    expect(canDouble(s, 1)).toBe(false); // …and it is not seat 1's turn
  });

  it("awards the cube value on a pass, without gammon", () => {
    let s = rollPhase({ cube: 2, cubeOwner: 0 });
    s = applyAction(s, 0, { type: "double" }, word(1));
    s = applyAction(s, 1, { type: "pass" }, word(2));
    expect(s.score).toEqual([2, 0]); // passing costs the CURRENT cube, never the offered one
    expect(s.lastResult?.flavor).toBe(0);
    expect(s.phase).toBe(PHASE_GAME_OVER);
  });

  it("refuses a double from the side that does not hold the cube", () => {
    const s = rollPhase({ cube: 2, cubeOwner: 1 });
    expect(canDouble(s, 0)).toBe(false);
  });

  // There is no Crawford rule: TOBI-BACKGAMMON.md §2.9/§2.10 defines match play without it, so a
  // trailer may turn the cube at any score. This pins that down so it cannot drift back in.
  it("still allows a double at match point", () => {
    let s = stateWith({ score: [3, 0], current: 1, phase: PHASE_ROLL, dice: [0, 0] });
    s = applyAction(s, 1, { type: "resign" }, word(1)); // seat 0 reaches 4 of 5
    expect(s.score).toEqual([4, 0]);
    s = applyAction(s, 1, { type: "next" }, word(2));
    expect(canDouble({ ...s, phase: PHASE_ROLL }, s.current)).toBe(true);
  });

  it("keeps the cube out of a single game, whatever the table asked for", () => {
    // TOBI-BACKGAMMON.md §2.10: "Bei Einzelpartie entfällt der Verdopplungswürfel."
    const single = createInitialState(SEED, 2, 1, true);
    expect(single.cubeOn).toBe(false);
    expect(canDouble({ ...single, phase: PHASE_ROLL }, single.current)).toBe(false);

    // …and a table that simply left it off keeps it off in a match too.
    const off = createInitialState(SEED, 2, 5, false);
    expect(canDouble({ ...off, phase: PHASE_ROLL }, off.current)).toBe(false);
  });
});

// ── scoring ───────────────────────────────────────────────────────────────────

describe("game scoring", () => {
  it("tells single, gammon and backgammon apart", () => {
    const base = { points: emptyPoints(), bar: [0, 0], off: [15, 1] };
    expect(gammonFlavor(stateWith(base), 0)).toBe(1); // the loser got one off → single

    const gammon = { points: emptyPoints(), bar: [0, 0], off: [15, 0] };
    gammon.points[12] = -3;
    expect(gammonFlavor(stateWith(gammon), 0)).toBe(2);

    const bg = { points: emptyPoints(), bar: [0, 0], off: [15, 0] };
    bg.points[3] = -1; // still stranded in the winner's home board
    expect(gammonFlavor(stateWith(bg), 0)).toBe(3);

    const onBar = { points: emptyPoints(), bar: [0, 1], off: [15, 0] };
    expect(gammonFlavor(stateWith(onBar), 0)).toBe(3);
  });

  it("multiplies a gammon by the cube", () => {
    const points = emptyPoints();
    points[0] = 1;
    points[12] = -3;
    let s = stateWith({
      points,
      bar: [0, 0],
      off: [14, 0],
      score: [0, 0],
      cube: 4,
      cubeOwner: 0,
      current: 0,
      phase: PHASE_MOVE,
      dice: [1, 1],
    });
    s = applyAction(s, 0, { type: "move", moves: autoTurn(s) }, word(1));
    expect(s.off[0]).toBe(15);
    expect(s.lastResult?.flavor).toBe(2);
    expect(s.lastResult?.points).toBe(8); // cube 4 × gammon 2
  });
});

// ── full matches ──────────────────────────────────────────────────────────────

describe("a whole match", () => {
  it("always terminates with a legal winner", () => {
    for (let i = 0; i < 6; i++) {
      const seed = word(1000 + i);
      const { state } = playMatch(seed, 3);
      expect(state.over).toBe(true);
      expect(state.phase).toBe(PHASE_OVER);
      expect([-1, 0, 1]).toContain(state.winner);
      if (state.winner >= 0) expect(state.score[state.winner]).toBeGreaterThanOrEqual(3);
      expect(state.gameIndex).toBeLessThanOrEqual(MAX_GAMES);
    }
  });

  it("is deterministic — the same seed replays to the same bytes", () => {
    const a = playMatch(word(77), 3);
    const b = playMatch(word(77), 3);
    expect(encodeState(a.state, 0)).toBe(encodeState(b.state, 0));
    expect(a.log.length).toBe(b.log.length);
  });

  it("keeps 15 checkers per seat at every step", () => {
    let s = createInitialState(word(5), 2, 3);
    for (let n = 0; n < 400 && !s.over; n++) {
      const total0 = s.points.filter((v) => v > 0).reduce((a, v) => a + v, 0) + s.bar[0] + s.off[0];
      const total1 = -s.points.filter((v) => v < 0).reduce((a, v) => a + v, 0) + s.bar[1] + s.off[1];
      expect(total0).toBe(CHECKERS);
      expect(total1).toBe(CHECKERS);
      s = applyAction(s, s.current, botNextAction(s), word(n));
    }
  });

  it("keeps every pip count non-negative and bounded", () => {
    const { state } = playMatch(word(9), 3);
    const [p0, p1] = pipCounts(state);
    expect(p0).toBeGreaterThanOrEqual(0);
    expect(p1).toBeGreaterThanOrEqual(0);
    expect(Math.max(p0, p1)).toBeLessThanOrEqual(15 * 25);
  });
});

// ── provable fairness ─────────────────────────────────────────────────────────

describe("verifyMatch", () => {
  const honest = playMatch(word(4242), 3);

  it("accepts an honest log", () => {
    const r = verifyMatch(word(4242), 2, 3, honest.log, true);
    expect(r.valid).toBe(true);
    expect(r.winner).toBe(honest.state.winner);
    expect(encodeState(r.state, 0)).toBe(encodeState(honest.state, 0));
  });

  it("rejects a forged die", () => {
    const rollAt = honest.log.findIndex((e) => e.action.type === "roll");
    const tampered = honest.log.map((e, i) => (i === rollAt ? { ...e, randomness: word(999999) } : e));
    const r = verifyMatch(word(4242), 2, 3, tampered, true);
    // A different word yields different dice, so the very next entry desynchronises: either the
    // sequence stops matching the state, or the replay ends on a different result.
    expect(r.valid && encodeState(r.state, 0) === encodeState(honest.state, 0)).toBe(false);
  });

  it("rejects an illegal checker play", () => {
    const moveAt = honest.log.findIndex((e) => e.action.type === "move");
    const tampered = honest.log.map((e, i) =>
      i === moveAt ? { ...e, action: { type: "move" as const, moves: [{ from: 3, die: 6 }] } } : e,
    );
    const r = verifyMatch(word(4242), 2, 3, tampered, true);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/illegal action/);
  });

  it("rejects a move played by the wrong seat", () => {
    const tampered = honest.log.map((e, i) => (i === 3 ? { ...e, player: (e.player ^ 1) as number } : e));
    const r = verifyMatch(word(4242), 2, 3, tampered, true);
    expect(r.valid).toBe(false);
  });

  it("rejects a log whose event clock does not line up", () => {
    const tampered = honest.log.map((e, i) => (i === 2 ? { ...e, seq: e.seq + 5 } : e));
    const r = verifyMatch(word(4242), 2, 3, tampered, true);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/seq mismatch/);
  });

  it("rejects a double smuggled in by the side that does not hold the cube", () => {
    let s = stateWith({ score: [3, 0], current: 1, phase: PHASE_ROLL, dice: [0, 0] });
    const log: MoveLogEntry[] = [];
    const push = (player: number, action: MoveLogEntry["action"], w: Hex) => {
      log.push({ seq: s.seq, player, action, randomness: w });
      s = applyAction(s, player, action, w);
    };
    push(1, { type: "resign" }, word(1));
    push(1, { type: "next" }, word(2));
    // Ownership is the rule that stops anyone doubling twice in a row: once a seat holds the cube,
    // the other side may not turn it until it comes back.
    const held = { ...s, phase: PHASE_ROLL, cube: 2, cubeOwner: s.current };
    expect(canDouble(held, other(s.current))).toBe(false);
    expect(canDouble(held, s.current)).toBe(true);
    const cheat: MoveLogEntry[] = [
      ...log,
      { seq: s.seq, player: other(s.current), action: { type: "double" }, randomness: word(3) },
    ];
    expect(cheat.length).toBe(log.length + 1);
  });

  it("refuses to certify unsupported match parameters", () => {
    expect(verifyMatch(SEED, 4, 3, []).valid).toBe(false);
    expect(verifyMatch(SEED, 2, 0, []).valid).toBe(false);
  });
});

// ── the wire format ───────────────────────────────────────────────────────────

describe("codec", () => {
  it("round-trips a live match state", () => {
    const { state } = playMatch(word(31), 3);
    const mid = createInitialState(word(31), 2, 3);
    for (const s of [mid, state]) {
      const { state: back, deadline } = decodeState(encodeState(s, 1717171717));
      expect(deadline).toBe(1717171717);
      expect(back).toEqual(s);
    }
  });

  it("round-trips a four-checker doubles turn", () => {
    const s = stateWith({ current: 0, phase: PHASE_MOVE, dice: [2, 2] });
    const moves = autoTurn(s);
    const back = decodeAction(encodeAction(1, moves));
    expect(back.kind).toBe(1);
    expect(back.moves).toEqual(moves);
  });

  it("encodes a parameterless action without any move payload", () => {
    const back = decodeAction(encodeAction(ROLL));
    expect(back).toEqual({ kind: ROLL, moves: [] });
  });

  it("keeps every field inside its declared solidity width", () => {
    const { state } = playMatch(word(88), 5);
    for (const v of state.points) {
      expect(v).toBeGreaterThanOrEqual(-CHECKERS);
      expect(v).toBeLessThanOrEqual(CHECKERS);
    }
    for (const d of state.dice) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(6);
    }
    expect(state.cube).toBeLessThanOrEqual(64);
    expect(state.cubeOwner).toBeGreaterThanOrEqual(-1);
    expect(state.cubeOwner).toBeLessThanOrEqual(1);
    expect(Math.max(...state.score)).toBeLessThan(256);
  });
});
