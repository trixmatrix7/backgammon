// What the throw still owes.
//
// The dice on the board are the THROW; these are the MOVES. Two of them, or four
// on a double, and each greys out as it is spent. Tapping a live one ARMS that
// value and the whole board narrows to what that die can reach.
//
// They deliberately sit on nothing. An earlier version laid them into holes drawn
// into a console plate, and they could never be made to line up — the art and the
// markup disagreed by a pixel or two at every size. With no holes there is
// nothing to disagree with.

import { PIPS } from "./neoGeom";

export function MoveMagazine({
  tokens,
  used,
  armed,
  onArm,
}: {
  tokens: number[];
  used: boolean[];
  armed: number | null;
  onArm: ((v: number | null) => void) | null;
}) {
  if (tokens.length === 0) return null;
  return (
    <div className="neo-toks" aria-label="Moves left">
      {tokens.map((v, i) => {
        const spent = used[i];
        const live = !spent && !!onArm;
        const isArmed = live && armed === v;
        return (
          <button
            key={i}
            type="button"
            className={`neo-tok${spent ? " used" : ""}${live ? " live" : ""}${isArmed ? " armed" : ""}`}
            title={spent ? `${v} — played` : `Show only the ${v}`}
            aria-pressed={isArmed}
            disabled={!live}
            onClick={() => onArm && onArm(isArmed ? null : v)}
          >
            {(PIPS[v] ?? PIPS[1]).map(([x, y], k) => (
              <i key={k} style={{ left: `${x}%`, top: `${y}%` }} />
            ))}
          </button>
        );
      })}
    </div>
  );
}
