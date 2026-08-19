// A player, as a drawn card.
//
// ONE card asset serves both seats — the opponent's is the same picture mirrored,
// which is what makes the pair read as designed rather than as two panels that
// happen to sit near each other. A separately generated twin was tried and looked
// like it came from a different game.
//
// The seat is told apart by the accent stripe, the checker dot and the ladder —
// never by the panel itself.
//
// Information order is deliberate: the pip count is the instrument number,
// because it is the one figure a serious player reads constantly. Below it the
// bear-off ladder — fifteen rungs rather than a bare "6/15", because filling a
// ladder is visible progress, and progress is where the tension lives.

import { useCountUp } from "./useCountUp";
import { clock } from "./format";

export function PlayerCard({
  side,
  name,
  active,
  status,
  pips,
  borneOff,
  score,
  matchTo,
  secondsLeft,
  holdsCube,
  cube,
}: {
  side: "you" | "foe";
  name: string;
  active: boolean;
  status: string;
  pips: number;
  borneOff: number;
  score: number;
  matchTo: number;
  secondsLeft: number | null;
  holdsCube: boolean;
  cube: number;
}) {
  const shown = useCountUp(pips, 520);
  return (
    <aside className={`neo-card ${side}${active ? " on" : ""}`} aria-label={`Player ${name}`}>
      <div className="band b1">
        <div className="nm">
          <span className="d" />
          {name}
        </div>
        <div className="sub">{status}</div>
      </div>

      <div className="band b2">
        <div className="row">
          <span className="big num">{shown}</span>
          <span className="u">pips</span>
        </div>
        <div className="bar" aria-hidden>
          {Array.from({ length: 15 }, (_, i) => (
            <i key={i} className={i < borneOff ? "on" : undefined} />
          ))}
        </div>
      </div>

      <div className="band b3">
        <div className="ft">
          <span>Off</span>
          <b className="num">{borneOff}/15</b>
        </div>
        <div className="ft">
          <span>Match</span>
          <b className="num">
            {score}/{matchTo}
          </b>
        </div>
        {secondsLeft !== null && (
          <div className="ft">
            <span>Clock</span>
            <b className="num">{clock(secondsLeft)}</b>
          </div>
        )}
      </div>

      {holdsCube && (
        <span className="neo-cube-chip" title="Only the owner may double next">
          CUBE <b className="num">{cube <= 1 ? 64 : cube}</b>
        </span>
      )}
    </aside>
  );
}
