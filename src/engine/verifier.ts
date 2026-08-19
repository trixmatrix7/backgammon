// Provable fairness: replay an entire match from (seed, numPlayers, matchTo) + the ordered log of
// (action, randomness) and confirm every step is legitimate. Anyone can run this offline to verify the
// host never forged a die, never accepted an illegal checker play, and never let a player double out
// of turn — without trusting the server.
//
// Trust boundary: the AUTHENTICITY of each randomness word is the chain's job (VRF attests it). This
// verifier proves the rest — correct turn order, only-legal actions, and that the final state is the
// deterministic result of those actions under that randomness. Because every outcome is a pure
// function of (state, action, randomness), a replay that diverges from the host's reported state is
// by definition a cheat.

import {
  DEFAULT_MATCH_TO,
  type GameState,
  type Hex,
  type MoveLogEntry,
} from "./types.js";
import {
  applyAction,
  canDouble,
  canMove,
  canNext,
  canRespondCube,
  canResign,
  canRoll,
  createInitialState,
  isLegalTurn,
} from "./rules.js";

export interface VerifyResult {
  valid: boolean;
  /** Final reconstructed state (best-effort, even if invalid). */
  state: GameState;
  winner: number;
  /** First failure reason, if any. */
  error?: string;
}

export function verifyMatch(
  seed: Hex,
  numPlayers: number,
  matchTo: number,
  log: MoveLogEntry[],
  /** The table rules the match was created with. They change what is legal (the cube) and how a game
   *  opens (automatic doubles), so a replay under different rules is not the same match. */
  cubeOn = false,
  officialOpening = false,
): VerifyResult {
  // The engine is hard-wired for a 2-player match (other(p) = p^1, the cube has exactly one owner).
  // Refuse to certify a match it could not faithfully replay — the verifier is the trust anchor, so
  // unsupported parameters are a rejection, not a silent best-effort.
  if (numPlayers !== 2 || !(matchTo > 0)) {
    const state = createInitialState(seed, 2, matchTo > 0 ? matchTo : DEFAULT_MATCH_TO, cubeOn, officialOpening);
    return {
      valid: false,
      state,
      winner: -1,
      error: `unsupported match params (numPlayers=${numPlayers}, matchTo=${matchTo}); engine supports exactly 2 players and a positive match target`,
    };
  }

  let state = createInitialState(seed, numPlayers, matchTo, cubeOn, officialOpening);

  for (let i = 0; i < log.length; i++) {
    const e = log[i];

    if (state.over) return fail(state, `log continues after the match ended, at log[${i}]`);
    if (e.seq !== state.seq) {
      return fail(state, `seq mismatch at log[${i}]: expected ${state.seq}, got ${e.seq}`);
    }

    // NEXT is the only action either seat may submit; everything else must come from `current`.
    if (e.action.type !== "next" && e.player !== state.current) {
      return fail(state, `wrong actor at log[${i}]: expected ${state.current}, got ${e.player}`);
    }

    const why = illegalReason(state, e);
    if (why) return fail(state, `illegal action at log[${i}]: ${why}`);

    // Re-derives every die from the logged randomness — a forged face cannot survive this.
    state = applyAction(state, e.player, e.action, e.randomness);
  }

  return { valid: true, state, winner: state.winner };
}

/** `null` when the action is legal in this state, else a human-readable reason. */
function illegalReason(s: GameState, e: MoveLogEntry): string | null {
  switch (e.action.type) {
    case "roll":
      return canRoll(s, e.player) ? null : "cannot roll in this phase";
    case "move":
      if (!canMove(s, e.player)) return "no dice on the table";
      return isLegalTurn(s, e.action.moves)
        ? null
        : "move sequence is not a legal complete turn for those dice";
    case "double":
      return canDouble(s, e.player) ? null : "cannot double (phase, cube ownership, or cube at 64)";
    case "take":
    case "pass":
      return canRespondCube(s, e.player) ? null : "no double is pending";
    case "resign":
      return canResign(s, e.player) ? null : "cannot resign in this phase";
    case "next":
      return canNext(s) ? null : "no finished game to advance from";
  }
}

function fail(state: GameState, error: string): VerifyResult {
  return { valid: false, state, winner: state.winner, error };
}
