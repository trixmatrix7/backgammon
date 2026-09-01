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
  ACTION_RESIGN,
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

const STAKE = 1_000_000n;

const CONFIG = (turnSec: number, matchTo: number, cubeOn: boolean, official: boolean): Hex =>
  encodeAbiParameters(
    [{ type: "uint16" }, { type: "uint8" }, { type: "bool" }, { type: "bool" }, { type: "uint256" }],
    [turnSec, matchTo, cubeOn, official, STAKE] as never,
  );

/**
 * The V2 lobby context. The roster is deliberately NOT in here — a game reads it from
 * the protocol ledger, which the harness stands in for (see `contracts/test/MockLedger.sol`).
 */
function ctxOf(config: Hex, gameState: Hex, phase = 4 /* WAITING_PLAYER_ACTION */) {
  return {
    lobbyId: 1n,
    lobbyKey: `0x${"00".repeat(32)}` as Hex,
    opener: A,
    token: `0x${"05".repeat(20)}` as Hex,
    pot: STAKE * 2n,
    participantCount: 2n,
    contributionCount: 2n,
    protocolFeeBps: 500,
    step: 0,
    phase,
    config,
    gameState,
  };
}

interface Step {
  newGameState: Hex;
  nextPhase: number;
  requestRandomnessNow: boolean;
  /** V2 settles by recipient; the protocol reads the mode off the length. */
  recipients: readonly string[];
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

      const start = asStep(await bg.call("onLobbyStart", [ctxOf(config, "0x"), A, "0x"]));
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

  /**
   * The V2 lifecycle hooks, which are new surface and carry the money rules.
   *
   * The protocol stopped enforcing a per-lobby buy-in when it moved to explicit
   * per-entry stakes, so "both sides risk the same amount", "two seats and no more" and
   * "you cannot cancel your way out of a losing position" are now this contract's job.
   * Nothing else checks them.
   */
  describe("V2 lifecycle", () => {
    const WAITING = 1;
    const IN_PROGRESS = 2;
    const good = CONFIG(60, 3, false, false);

    it("accepts a well-formed table and rejects malformed ones", async () => {
      bg = bg ?? (await deployBackgammon());
      await bg.call("onLobbyOpen", [ctxOf(good, "0x", WAITING), A, "0x"]);

      const bad: Array<[string, Hex]> = [
        ["turn bank too short", CONFIG(1, 3, false, false)],
        ["turn bank too long", CONFIG(9999, 3, false, false)],
        ["match length off the menu", CONFIG(60, 5, false, false)],
        [
          "no stake",
          encodeAbiParameters(
            [{ type: "uint16" }, { type: "uint8" }, { type: "bool" }, { type: "bool" }, { type: "uint256" }],
            [60, 3, false, false, 0n] as never,
          ),
        ],
      ];
      for (const [why, cfg] of bad) {
        await expect(
          bg.call("onLobbyOpen", [ctxOf(cfg, "0x", WAITING), A, "0x"]),
          why,
        ).rejects.toThrow();
      }

      // A single game asking for the cube is NOT rejected — it is normalised, the same
      // way the client's `decodeConfig` normalises it, so the table simply plays without
      // one. Asserted here so the leniency is a decision on the record.
      await bg.call("onLobbyOpen", [ctxOf(CONFIG(60, 1, true, false), "0x", WAITING), A, "0x"]);
    }, 600000);

    it("takes the exact stake, once, from at most two seats", async () => {
      bg = bg ?? (await deployBackgammon());
      const fresh = { joined: false, totalStake: 0n, contributionCount: 0n };
      const ctx = (phase = WAITING, participants = 0n) => ({
        ...ctxOf(good, "0x", phase),
        participantCount: participants,
      });

      // the good case
      const entry = (await bg.call("onEntry", [ctx(), fresh, A, STAKE, "0x"])) as {
        positionId: Hex;
      };
      expect(BigInt(entry.positionId)).toBe(BigInt(A));

      // an unequal stake is not a wager
      await expect(bg.call("onEntry", [ctx(), fresh, A, STAKE - 1n, "0x"])).rejects.toThrow();
      await expect(bg.call("onEntry", [ctx(), fresh, A, STAKE + 1n, "0x"])).rejects.toThrow();
      await expect(bg.call("onEntry", [ctx(), fresh, A, 0n, "0x"])).rejects.toThrow();

      // one seat each, and only two of them
      await expect(
        bg.call("onEntry", [ctx(), { ...fresh, joined: true }, A, STAKE, "0x"]),
      ).rejects.toThrow();
      await expect(bg.call("onEntry", [ctx(WAITING, 2n), fresh, A, STAKE, "0x"])).rejects.toThrow();

      // and not once the dice are in the air
      await expect(bg.call("onEntry", [ctx(IN_PROGRESS), fresh, A, STAKE, "0x"])).rejects.toThrow();
    }, 600000);

    it("will not let a player cancel out of a running match", async () => {
      bg = bg ?? (await deployBackgammon());
      expect(await bg.call("canCancel", [ctxOf(good, "0x", WAITING), A, "0x"])).toBe(true);
      expect(await bg.call("canCancel", [ctxOf(good, "0x", WAITING), B, "0x"])).toBe(true);
      // Cancellation refunds in full, so allowing it mid-match is an exit from a bad
      // position at no cost. This is the check that stops that.
      expect(await bg.call("canCancel", [ctxOf(good, "0x", IN_PROGRESS), A, "0x"])).toBe(false);
      const stranger = `0x${"cd".repeat(20)}` as Hex;
      expect(await bg.call("canCancel", [ctxOf(good, "0x", WAITING), stranger, "0x"])).toBe(false);
    }, 600000);

    it("pays a win to one recipient and a draw to both", async () => {
      bg = bg ?? (await deployBackgammon());
      const config = CONFIG(60, 1, false, false);
      const word = wordAt(900, 0);
      let chain = asStep(await bg.call("onRandomness", [ctxOf(config, "0x"), word])).newGameState;
      let engine = createInitialState(word, 2, 1, false, false);

      // resign, which ends a single game and therefore the match
      const seat = engine.current;
      const res = asStep(
        await bg.call("onPlayerAction", [
          ctxOf(config, chain),
          seat === 0 ? A : B,
          encodeAction(ACTION_RESIGN),
        ]),
      );
      expect(res.nextPhase).toBe(5); // RESOLVED
      expect(res.recipients.length, "a decided match pays exactly one address").toBe(1);
      expect(res.recipients[0].toLowerCase()).toBe((seat === 0 ? B : A).toLowerCase());

      // and a claim against a decided match is refused — that pot has already moved
      const quote = (await bg.call("getClaim", [
        ctxOf(config, res.newGameState),
        `0x${A.slice(2).padStart(64, "0")}` as Hex,
        "0x",
      ])) as { valid: boolean };
      expect(quote.valid, "a won match has nothing to claim").toBe(false);
      void engine;
      void chain;
    }, 600000);
  });
});