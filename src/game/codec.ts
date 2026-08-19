import { encodeAbiParameters, decodeAbiParameters, type Hex } from "viem";
import {
  ACTION_DOUBLE,
  ACTION_MOVE,
  ACTION_NEXT,
  ACTION_PASS,
  ACTION_RESIGN,
  ACTION_ROLL,
  ACTION_TAKE,
  DEFAULT_MATCH_TO,
  type Action,
  type GameResult,
  type GameState,
  type LastEvent,
  type TurnMove,
} from "@engine";

/**
 * The wire/contract view of a Chain Gammon match. This is exactly what the host puts in
 * `raw.gameState` and the client decodes, and it mirrors byte-for-byte what a `GammonGame.sol`
 * `GameState` struct would `abi.encode` (see contracts/README.md for the Solidity-side layout).
 *
 * NOTHING here is hidden. Backgammon is a perfect-information game — the board, the cube, the match
 * score and the dice on the table are all public by the rules themselves — so this encoding is safe
 * to ship on a public chain as-is, with no commit/reveal machinery anywhere.
 *
 * `lastEvent` carries the exact checker sequence that was just played so the OPPONENT's client can
 * animate it (it has no other way to know which checkers moved), and `lastResult` carries how the
 * previous game was decided so both clients show the same GAMMON / BACKGAMMON banner.
 */
export const STATE_TUPLE = [
  {
    type: "tuple",
    components: [
      { name: "numPlayers", type: "uint8" },
      { name: "matchTo", type: "uint8" },
      { name: "current", type: "uint8" },
      { name: "phase", type: "uint8" },
      { name: "cube", type: "uint8" },
      { name: "cubeOwner", type: "int8" }, // -1 = centred
      { name: "cubeOn", type: "bool" }, // table rule: is the cube in play at all?
      { name: "officialOpening", type: "bool" }, // table rule: automatic double on a tied opening
      { name: "gameIndex", type: "uint8" },
      { name: "turnIndex", type: "uint16" },
      { name: "seq", type: "uint32" },
      { name: "winner", type: "int8" }, // -1 = in progress or drawn
      { name: "over", type: "bool" },
      { name: "seed", type: "bytes32" },
      { name: "deadline", type: "uint64" },
      { name: "points", type: "int8[24]" }, // + = seat 0 checkers, − = seat 1 checkers
      { name: "bar", type: "uint8[2]" },
      { name: "off", type: "uint8[2]" },
      { name: "score", type: "uint8[2]" },
      { name: "dice", type: "uint8[2]" },
      {
        name: "lastEvent",
        type: "tuple",
        components: [
          { name: "valid", type: "bool" },
          { name: "kind", type: "uint8" },
          { name: "player", type: "uint8" },
          { name: "seq", type: "uint32" },
          { name: "d1", type: "uint8" },
          { name: "d2", type: "uint8" },
          { name: "cube", type: "uint8" },
          { name: "moveCount", type: "uint8" },
          { name: "moveFrom", type: "uint8[4]" }, // 24 = the bar
          { name: "moveDie", type: "uint8[4]" },
        ],
      },
      {
        name: "lastResult",
        type: "tuple",
        components: [
          { name: "valid", type: "bool" },
          { name: "gameIndex", type: "uint8" },
          { name: "winner", type: "uint8" },
          { name: "points", type: "uint8" },
          { name: "flavor", type: "uint8" }, // 1 single · 2 gammon · 3 backgammon · 0 conceded
          { name: "cube", type: "uint8" },
          { name: "seq", type: "uint32" },
        ],
      },
    ],
  },
] as const;

const pad4 = (xs: number[]): [number, number, number, number] => [xs[0] ?? 0, xs[1] ?? 0, xs[2] ?? 0, xs[3] ?? 0];

export function encodeState(s: GameState, deadlineSec: number): Hex {
  const e = s.lastEvent;
  const r = s.lastResult;
  return encodeAbiParameters(STATE_TUPLE, [
    {
      numPlayers: s.numPlayers,
      matchTo: s.matchTo,
      current: s.current,
      phase: s.phase,
      cube: s.cube,
      cubeOwner: s.cubeOwner,
      cubeOn: s.cubeOn,
      officialOpening: s.officialOpening,
      gameIndex: s.gameIndex,
      turnIndex: s.turnIndex,
      seq: s.seq,
      winner: s.winner,
      over: s.over,
      seed: s.seed,
      deadline: BigInt(deadlineSec),
      points: s.points,
      bar: s.bar,
      off: s.off,
      score: s.score,
      dice: s.dice,
      lastEvent: {
        valid: !!e,
        kind: e?.kind ?? 0,
        player: e?.player ?? 0,
        seq: e?.seq ?? 0,
        d1: e?.d1 ?? 0,
        d2: e?.d2 ?? 0,
        cube: e?.cube ?? 1,
        moveCount: e?.moves.length ?? 0,
        moveFrom: pad4((e?.moves ?? []).map((m) => m.from)),
        moveDie: pad4((e?.moves ?? []).map((m) => m.die)),
      },
      lastResult: {
        valid: !!r,
        gameIndex: r?.gameIndex ?? 0,
        winner: r?.winner ?? 0,
        points: r?.points ?? 0,
        flavor: r?.flavor ?? 0,
        cube: r?.cube ?? 1,
        seq: r?.seq ?? 0,
      },
    },
  ] as never);
}

type Num = number | bigint;

interface WireTuple {
  numPlayers: Num;
  matchTo: Num;
  current: Num;
  phase: Num;
  cube: Num;
  cubeOwner: Num;
  cubeOn: boolean;
  officialOpening: boolean;
  gameIndex: Num;
  turnIndex: Num;
  seq: Num;
  winner: Num;
  over: boolean;
  seed: Hex;
  deadline: bigint;
  points: readonly Num[];
  bar: readonly Num[];
  off: readonly Num[];
  score: readonly Num[];
  dice: readonly Num[];
  lastEvent: {
    valid: boolean;
    kind: Num;
    player: Num;
    seq: Num;
    d1: Num;
    d2: Num;
    cube: Num;
    moveCount: Num;
    moveFrom: readonly Num[];
    moveDie: readonly Num[];
  };
  lastResult: {
    valid: boolean;
    gameIndex: Num;
    winner: Num;
    points: Num;
    flavor: Num;
    cube: Num;
    seq: Num;
  };
}

export function decodeState(data: Hex): { state: GameState; deadline: number } {
  const [t] = decodeAbiParameters(STATE_TUPLE, data) as unknown as [WireTuple];

  const ev = t.lastEvent;
  const moves: TurnMove[] = [];
  for (let i = 0; i < Number(ev.moveCount); i++) {
    moves.push({ from: Number(ev.moveFrom[i]), die: Number(ev.moveDie[i]) });
  }
  const lastEvent: LastEvent | null = ev.valid
    ? {
        kind: Number(ev.kind),
        player: Number(ev.player),
        seq: Number(ev.seq),
        d1: Number(ev.d1),
        d2: Number(ev.d2),
        cube: Number(ev.cube),
        moves,
      }
    : null;

  const rs = t.lastResult;
  const lastResult: GameResult | null = rs.valid
    ? {
        gameIndex: Number(rs.gameIndex),
        winner: Number(rs.winner),
        points: Number(rs.points),
        flavor: Number(rs.flavor),
        cube: Number(rs.cube),
        seq: Number(rs.seq),
      }
    : null;

  return {
    state: {
      numPlayers: Number(t.numPlayers),
      matchTo: Number(t.matchTo),
      points: t.points.map(Number),
      bar: t.bar.map(Number),
      off: t.off.map(Number),
      score: t.score.map(Number),
      current: Number(t.current),
      phase: Number(t.phase),
      dice: t.dice.map(Number),
      cube: Number(t.cube),
      cubeOwner: Number(t.cubeOwner),
      cubeOn: t.cubeOn,
      officialOpening: t.officialOpening,
      gameIndex: Number(t.gameIndex),
      turnIndex: Number(t.turnIndex),
      seq: Number(t.seq),
      seed: t.seed,
      winner: Number(t.winner),
      over: t.over,
      lastEvent,
      lastResult,
    },
    deadline: Number(t.deadline),
  };
}

// ── actions ──────────────────────────────────────────────────────────────────

/**
 * actionData = abi.encode(uint8 kind, uint8 moveCount, uint8[4] moveFrom, uint8[4] moveDie).
 *
 * A whole turn travels in ONE action. Backgammon's "you must play as many dice as you legally can"
 * rule is a property of the COMPLETE sequence, so a per-checker action could not be validated at all
 * — and four transactions per turn would be absurd. Four slots is the hard maximum (doubles).
 * Non-move actions leave the move fields zeroed.
 */
export const ACTION_TUPLE = [
  { type: "uint8" },
  { type: "uint8" },
  { type: "uint8[4]" },
  { type: "uint8[4]" },
] as const;

export function encodeAction(kind: number, moves: TurnMove[] = []): Hex {
  return encodeAbiParameters(ACTION_TUPLE, [
    kind,
    moves.length,
    pad4(moves.map((m) => m.from)),
    pad4(moves.map((m) => m.die)),
  ] as never);
}

export function decodeAction(data: Hex): { kind: number; moves: TurnMove[] } {
  const [kind, count, from, dice] = decodeAbiParameters(ACTION_TUPLE, data) as unknown as [
    Num,
    Num,
    readonly Num[],
    readonly Num[],
  ];
  const moves: TurnMove[] = [];
  for (let i = 0; i < Number(count); i++) moves.push({ from: Number(from[i]), die: Number(dice[i]) });
  return { kind: Number(kind), moves };
}

/** Turn an encoded action back into the engine's `Action` union. */
export function toEngineAction(kind: number, moves: TurnMove[]): Action {
  switch (kind) {
    case ACTION_MOVE:
      return { type: "move", moves };
    case ACTION_DOUBLE:
      return { type: "double" };
    case ACTION_TAKE:
      return { type: "take" };
    case ACTION_PASS:
      return { type: "pass" };
    case ACTION_RESIGN:
      return { type: "resign" };
    case ACTION_NEXT:
      return { type: "next" };
    case ACTION_ROLL:
    default:
      return { type: "roll" };
  }
}

export const ROLL = ACTION_ROLL;
export const MOVE = ACTION_MOVE;
export const DOUBLE = ACTION_DOUBLE;
export const TAKE = ACTION_TAKE;
export const PASS = ACTION_PASS;
export const RESIGN = ACTION_RESIGN;
export const NEXT = ACTION_NEXT;

// ── lobby config ──────────────────────────────────────────────────────────────

/**
 * config = abi.encode(uint16 turnSeconds, uint8 matchTo, bool cubeOn, bool officialOpening)
 *
 * The four table rules the creator picks, exactly as the handover lists them (TOBI-BACKGAMMON.md
 * §2.11). `matchTo === 1` is the single game — there the doubling cube is off by the rules
 * themselves, whatever the flag says. The stake is not in here: it is the lobby's `buyIn`, which the
 * host escrows.
 */
export const DEFAULT_TURN_SEC = 45;

export interface TableRules {
  turnSec: number;
  matchTo: number;
  cubeOn: boolean;
  officialOpening: boolean;
}

const CONFIG_TUPLE = [{ type: "uint16" }, { type: "uint8" }, { type: "bool" }, { type: "bool" }] as const;

export function encodeConfig(
  turnSec: number,
  matchTo: number = DEFAULT_MATCH_TO,
  cubeOn = false,
  officialOpening = false,
): Hex {
  return encodeAbiParameters(CONFIG_TUPLE, [turnSec, matchTo, cubeOn, officialOpening] as never);
}

const FALLBACK: TableRules = {
  turnSec: DEFAULT_TURN_SEC,
  matchTo: DEFAULT_MATCH_TO,
  cubeOn: false,
  officialOpening: false,
};

export function decodeConfig(data?: Hex): TableRules {
  if (!data || data === "0x") return { ...FALLBACK };
  try {
    const [turnSec, matchTo, cubeOn, officialOpening] = decodeAbiParameters(
      CONFIG_TUPLE,
      data,
    ) as unknown as [Num, Num, boolean, boolean];
    const to = Number(matchTo) || DEFAULT_MATCH_TO;
    return {
      turnSec: Number(turnSec) || DEFAULT_TURN_SEC,
      matchTo: to,
      // a single game never carries the cube, whatever the table said
      cubeOn: !!cubeOn && to > 1,
      officialOpening: !!officialOpening,
    };
  } catch {
    return { ...FALLBACK };
  }
}
