// Dev-only opponent (used by the MockHost so the standalone build has someone to play). Pure and
// deterministic: it greedily maximises `evaluatePosition` over the distinct positions its roll can
// reach, and it turns/answers the cube off the same win-probability estimate the HUD shows you.
// Bots never ship into the real on-chain path — the host runs real opponents there.

import {
  MAX_CUBE,
  PHASE_CUBE,
  PHASE_GAME_OVER,
  PHASE_MOVE,
  PHASE_ROLL,
  other,
  type Action,
  type GameState,
  type TurnMove,
} from "./types.js";
import { compareTurns } from "./board.js";
import { boardOf, canDouble, distinctOutcomes, needToWin } from "./rules.js";
import { evaluatePosition, gammonChance, winProbability } from "./eval.js";

/** The bot's move for the dice on the table. Ties break to the lexicographically smallest sequence,
 *  so the same position always produces the same move. */
export function botTurn(s: GameState): TurnMove[] {
  const seat = s.current;
  const outcomes = distinctOutcomes(s);
  if (outcomes.length === 0) return [];
  let best = outcomes[0];
  let bestScore = evaluatePosition(best.board, seat);
  for (let i = 1; i < outcomes.length; i++) {
    const sc = evaluatePosition(outcomes[i].board, seat);
    const better = sc > bestScore + 1e-9;
    const tie = Math.abs(sc - bestScore) <= 1e-9 && compareTurns(outcomes[i].moves, best.moves) < 0;
    if (better || tie) {
      best = outcomes[i];
      bestScore = sc;
    }
  }
  return best.moves;
}

/** Turn the cube, or just roll? The window is deliberately narrow: too early and every take is a gift,
 *  too late and the opponent simply passes. */
export function botCubeDecision(s: GameState): "double" | "roll" {
  if (!canDouble(s, s.current)) return "roll";
  const me = s.current;
  const b = boardOf(s);
  const away = needToWin(s, me);
  const oppAway = needToWin(s, other(me));

  // Already carrying enough on the board to take the match — turning the cube buys nothing.
  if (s.cube >= away) return "roll";

  const wp = winProbability(b, me, true);
  // "Too good to double": a big gammon threat is worth more played out than cashed in.
  if (wp > 0.9 && gammonChance(b, me) > 0.25) return "roll";

  const trigger = oppAway <= 2 ? 0.6 : 0.68; // opponent close to the match → turn it earlier
  return wp >= trigger && wp <= 0.92 ? "double" : "roll";
}

/** Answer a double. The classic take point is around 25% game-winning chances; the match score bends
 *  it — and when a pass already loses the match outright, there is nothing to lose by taking. */
export function botCubeResponse(s: GameState): "take" | "pass" {
  const me = s.current;
  const b = boardOf(s);
  if (s.cube >= needToWin(s, other(me))) return "take"; // passing hands them the match anyway
  const newCube = Math.min(MAX_CUBE, s.cube * 2);
  const takePoint = newCube >= needToWin(s, me) ? 0.28 : 0.24;
  return winProbability(b, me, false) >= takePoint ? "take" : "pass";
}

/** One action for whatever the bot is being asked to do right now. */
export function botNextAction(s: GameState): Action {
  switch (s.phase) {
    case PHASE_GAME_OVER:
      return { type: "next" };
    case PHASE_CUBE:
      return { type: botCubeResponse(s) };
    case PHASE_MOVE:
      return { type: "move", moves: botTurn(s) };
    case PHASE_ROLL:
    default:
      return botCubeDecision(s) === "double" ? { type: "double" } : { type: "roll" };
  }
}
