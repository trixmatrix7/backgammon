// The test that actually matters.
//
// The TypeScript engine and `Backgammon.sol` are two independent implementations of the
// same rules. Unit tests on either side prove nothing about the other — a shared
// misreading of the rules passes both. What catches divergence is playing the SAME
// matches through both and comparing the encoded state, byte for byte, at every single
// step. Any disagreement about a legal move, a die, a score or a field's position in
// the tuple shows up here as a mismatched hex string.
//
// Both sides consume identical randomness words, so the dice are not merely
// statistically similar — they are the same dice.

import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import {
  ACTION_DOUBLE,
  ACTION_MOVE,
  ACTION_NEXT,
  ACTION_PASS,
  ACTION_ROLL,
  ACTION_TAKE,
  PHASE_CUBE,
  canDouble,
  PHASE_GAME_OVER,
  PHASE_MOVE,
  PHASE_ROLL,
  applyAction,
  createInitialState,
  legalTurns,
  type GameState,
} from "../src/engine/index.js";
import { encodeAction, encodeState } from "../src/game/codec.js";
import { deployBackgammon, type Deployed } from "./evm";

const A = `0x${"aa".repeat(20)}` as const;
const B = `0x${"bb".repeat(20)}` as const;

const CONFIG = (turnSec: number, matchTo: number, cubeOn: boolean, official: boolean): Hex =>
  encodeAbiParameters(
    [{ type: "uint16" }, { type: "uint8" }, { type: "bool" }, { type: "bool" }],
    [turnSec, matchTo, cubeOn, official] as never,
  );

const slot = (addr: string) => ({ player: addr, vault: addr, buyIn: 1n, joinedAt: 0n });

function ctxOf(config: Hex, gameState: Hex) {
  return {
    lobbyId: 1n,
    creator: A,
    buyIn: 1n,
    pot: 2n,
    maxPlayers: 2,
    step: 0,
    config,
    gameState,
    players: [slot(A), slot(B)],
  };
}

interface Step {
  newGameState: Hex;
  nextPhase: number;
  requestRandomnessNow: boolean;
  payout: { players: readonly string[]; shareBps: readonly bigint[] };
}

const asStep = (r: unknown): Step => r as Step;

/** A deterministic word per step, so a failure is reproducible from its seed alone. */
const wordAt = (seed: number, n: number): Hex =>
  keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [BigInt(seed), BigInt(n)] as never));

/**
 * The contract stamps `deadline` from `block.timestamp`, which the engine has no notion
 * of. That one field is the only legitimate difference between the two encodings, so it
 * is zeroed on both sides before comparing — everything else must match exactly.
 */
function blankDeadline(encoded: Hex): Hex {
  // Every member of the tuple is a static type, so the tuple itself is static and there
  // is NO offset word in front of it — `deadline` is word 14 counting from zero:
  // numPlayers, matchTo, current, phase, cube, cubeOwner, cubeOn, officialOpening,
  // gameIndex, turnIndex, seq, winner, over, seed, deadline.
  const words = (encoded.slice(2).match(/.{64}/g) ?? []).slice();
  words[14] = "0".repeat(64);
  return `0x${words.join("")}` as Hex;
}

/** Word index → field name, so a failure says WHICH rule the two disagree about. */
const FIELDS: string[] = (() => {
  const f = [
    "numPlayers", "matchTo", "current", "phase", "cube", "cubeOwner", "cubeOn",
    "officialOpening", "gameIndex", "turnIndex", "seq", "winner", "over", "seed", "deadline",
  ];
  for (let i = 0; i < 24; i++) f.push(`point[${i}]`);
  f.push("bar[0]", "bar[1]", "off[0]", "off[1]", "score[0]", "score[1]", "dice[0]", "dice[1]");
  f.push("ev.valid", "ev.kind", "ev.player", "ev.seq", "ev.d1", "ev.d2", "ev.cube", "ev.moveCount");
  for (let i = 0; i < 4; i++) f.push(`ev.moveFrom[${i}]`);
  for (let i = 0; i < 4; i++) f.push(`ev.moveDie[${i}]`);
  f.push("res.valid", "res.gameIndex", "res.winner", "res.points", "res.flavor", "res.cube", "res.seq");
  return f;
})();

/** Empty when the two agree; otherwise every field that differs, named. */
function diff(chain: Hex, engine: Hex): string {
  const a = blankDeadline(chain).slice(2).match(/.{64}/g) ?? [];
  const b = blankDeadline(engine).slice(2).match(/.{64}/g) ?? [];
  const out: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      const sa = a[i] === undefined ? "—" : BigInt(`0x${a[i]}`).toString();
      const sb = b[i] === undefined ? "—" : BigInt(`0x${b[i]}`).toString();
      out.push(`${FIELDS[i] ?? `word${i}`}: chain=${sa} engine=${sb}`);
    }
  }
  return out.join("; ");
}

describe("engine ⇄ contract", () => {
  let bg: Deployed;

  it("agrees on the opening deal", async () => {
    bg = await deployBackgammon();
    for (let seed = 0; seed < 12; seed++) {
      const word = wordAt(seed, 0);
      const config = CONFIG(60, 3, false, false);

      const start = asStep(await bg.call("onLobbyStart", [ctxOf(config, "0x")]));
      expect(start.requestRandomnessNow).toBe(true);
      expect(start.nextPhase).toBe(3); // WAITING_RANDOMNESS

      const dealt = asStep(await bg.call("onRandomness", [ctxOf(config, "0x"), word]));
      const engine = createInitialState(word, 2, 3, false, false);

      expect(diff(dealt.newGameState, encodeState(engine, 0)), `seed ${seed}`).toBe("");
    }
  }, 600000);

  it("agrees on every step of a played-out match", async () => {
    bg = bg ?? (await deployBackgammon());

    for (let seed = 100; seed < 108; seed++) {
      const config = CONFIG(60, 3, false, false);
      let word = wordAt(seed, 0);

      let engine: GameState = createInitialState(word, 2, 3, false, false);
      let chain = asStep(await bg.call("onRandomness", [ctxOf(config, "0x"), word])).newGameState;
      expect(diff(chain, encodeState(engine, 0)), `seed ${seed}, deal`).toBe("");

      for (let step = 1; step < 600 && !engine.over; step++) {
        word = wordAt(seed, step);
        const seat = engine.current;
        const from = seat === 0 ? A : B;

        if (engine.phase === PHASE_ROLL) {
          // ROLL is two calls on chain — the action commits, the word lands after.
          const committed = asStep(
            await bg.call("onPlayerAction", [ctxOf(config, chain), from, encodeAction(ACTION_ROLL)]),
          );
          expect(committed.requestRandomnessNow).toBe(true);
          chain = asStep(await bg.call("onRandomness", [ctxOf(config, committed.newGameState), word]))
            .newGameState;
          engine = applyAction(engine, seat, { type: "roll" }, word);
        } else if (engine.phase === PHASE_MOVE) {
          const turns = legalTurns(engine);
          const pick = turns[step % turns.length] ?? [];
          const data = encodeAction(ACTION_MOVE, pick);
          chain = asStep(await bg.call("onPlayerAction", [ctxOf(config, chain), from, data])).newGameState;
          engine = applyAction(engine, seat, { type: "move", moves: pick }, word);
        } else if (engine.phase === PHASE_GAME_OVER) {
          const committed = asStep(
            await bg.call("onPlayerAction", [ctxOf(config, chain), from, encodeAction(ACTION_NEXT)]),
          );
          chain = asStep(await bg.call("onRandomness", [ctxOf(config, committed.newGameState), word]))
            .newGameState;
          engine = applyAction(engine, seat, { type: "next" }, word);
        } else {
          break;
        }

        const d = diff(chain, encodeState(engine, 0));
        if (d) {
          const w = (h: Hex, i: number) => BigInt("0x" + (h.slice(2).match(/.{64}/g) ?? [])[i]).toString();
          const eh = encodeState(engine, 0);
          const ctxLine = ["phase", "gameIndex", "seq", "turnIndex", "cube", "current", "over"]
            .map((n, k) => { const idx = [3, 8, 10, 9, 4, 2, 12][k]; return n + "=" + w(chain, idx) + "/" + w(eh, idx); })
            .join(" ") + " off=" + w(chain, 41) + "," + w(chain, 42) + "/" + w(eh, 41) + "," + w(eh, 42);
          throw new Error("seed " + seed + ", step " + step + " [chain/engine] " + ctxLine + " || " + d);
        }
      }
    }
  }, 900000);

  /**
   * The same walk, but on tables the first test never visits: a single game (no cube at
   * all, one game decides the pot) and a match with the doubling cube live, where the
   * walk offers and answers the cube whenever the rules allow it.
   */
  it("agrees across table rules, including the cube", async () => {
    bg = bg ?? (await deployBackgammon());

    const tables: Array<{ matchTo: number; cubeOn: boolean; official: boolean }> = [
      { matchTo: 1, cubeOn: false, official: false },
      { matchTo: 3, cubeOn: true, official: false },
      { matchTo: 3, cubeOn: true, official: true },
    ];

    for (const t of tables) {
      for (let seed = 200; seed < 203; seed++) {
        const config = CONFIG(60, t.matchTo, t.cubeOn, t.official);
        let word = wordAt(seed, 0);

        let engine: GameState = createInitialState(word, 2, t.matchTo, t.cubeOn, t.official);
        let chain = asStep(await bg.call("onRandomness", [ctxOf(config, "0x"), word])).newGameState;
        expect(diff(chain, encodeState(engine, 0)), `table ${t.matchTo}/${t.cubeOn}, deal`).toBe("");

        for (let step = 1; step < 700 && !engine.over; step++) {
          word = wordAt(seed, step);
          const seat = engine.current;
          const from = seat === 0 ? A : B;
          const send = async (data: Hex, thenRandom: boolean) => {
            const res = asStep(await bg.call("onPlayerAction", [ctxOf(config, chain), from, data]));
            chain = thenRandom
              ? asStep(await bg.call("onRandomness", [ctxOf(config, res.newGameState), word])).newGameState
              : res.newGameState;
          };

          if (engine.phase === PHASE_CUBE) {
            // Alternate take and pass so both answers are exercised.
            const takes = step % 3 !== 0;
            await send(encodeAction(takes ? ACTION_TAKE : ACTION_PASS), false);
            engine = applyAction(engine, seat, { type: takes ? "take" : "pass" }, word);
          } else if (engine.phase === PHASE_ROLL && canDouble(engine, seat) && step % 7 === 0) {
            await send(encodeAction(ACTION_DOUBLE), false);
            engine = applyAction(engine, seat, { type: "double" }, word);
          } else if (engine.phase === PHASE_ROLL) {
            await send(encodeAction(ACTION_ROLL), true);
            engine = applyAction(engine, seat, { type: "roll" }, word);
          } else if (engine.phase === PHASE_MOVE) {
            const turns = legalTurns(engine);
            const pick = turns[step % turns.length] ?? [];
            await send(encodeAction(ACTION_MOVE, pick), false);
            engine = applyAction(engine, seat, { type: "move", moves: pick }, word);
          } else if (engine.phase === PHASE_GAME_OVER) {
            await send(encodeAction(ACTION_NEXT), true);
            engine = applyAction(engine, seat, { type: "next" }, word);
          } else {
            break;
          }

          const d = diff(chain, encodeState(engine, 0));
          if (d) {
            throw new Error(
              "table matchTo=" + t.matchTo + " cube=" + t.cubeOn + " official=" + t.official +
                ", seed " + seed + ", step " + step + " || " + d,
            );
          }
        }
      }
    }
  }, 900000);

  /**
   * What the contract must REFUSE. The engine answers an illegal action by returning the
   * state unchanged; on chain the equivalent is a revert, so these are the cases where
   * the two are deliberately not mirror images and have to be checked directly.
   */
  it("refuses what the rules forbid", async () => {
    bg = bg ?? (await deployBackgammon());
    const config = CONFIG(60, 3, false, false);
    const word = wordAt(300, 0);
    const dealt = asStep(await bg.call("onRandomness", [ctxOf(config, "0x"), word])).newGameState;
    const engine = createInitialState(word, 2, 3, false, false);
    const onRoll = engine.current === 0 ? A : B;
    const idle = engine.current === 0 ? B : A;

    // the opponent cannot move on your turn
    await expect(
      bg.call("onPlayerAction", [ctxOf(config, dealt), idle, encodeAction(ACTION_MOVE, [])]),
    ).rejects.toThrow();

    // a stranger cannot act at all
    await expect(
      bg.call("onPlayerAction", [ctxOf(config, dealt), `0x${"cd".repeat(20)}`, encodeAction(ACTION_ROLL)]),
    ).rejects.toThrow();

    // an empty turn is illegal while dice remain playable
    await expect(
      bg.call("onPlayerAction", [ctxOf(config, dealt), onRoll, encodeAction(ACTION_MOVE, [])]),
    ).rejects.toThrow();

    // a checker that is not yours, from a point you do not hold
    await expect(
      bg.call("onPlayerAction", [
        ctxOf(config, dealt),
        onRoll,
        encodeAction(ACTION_MOVE, [{ from: 3, die: engine.dice[0] }]),
      ]),
    ).rejects.toThrow();

    // rolling is not allowed while there are still dice on the table
    await expect(
      bg.call("onPlayerAction", [ctxOf(config, dealt), onRoll, encodeAction(ACTION_ROLL)]),
    ).rejects.toThrow();

    // the cube is off at this table
    await expect(
      bg.call("onPlayerAction", [ctxOf(config, dealt), onRoll, encodeAction(ACTION_DOUBLE)]),
    ).rejects.toThrow();

    // and the timeout path stays shut until the deadline has actually passed
    await expect(
      bg.call("onPlayerAction", [ctxOf(config, dealt), idle, encodeAction(7 /* SKIP */)]),
    ).rejects.toThrow();
  }, 600000);
});