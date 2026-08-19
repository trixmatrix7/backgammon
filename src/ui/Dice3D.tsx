// Real CSS-3D solids. The board is a photograph taken from above, so a flat pip square reads as a
// sticker printed on the leather; an actual six-faced cube standing on it reads as an object you
// could pick up.
//
// Both solids are built the same way and only the material differs, which is the handover's rule:
// ONE die design for every board — black piano lacquer with silver pips — and a doubling cube of
// solid polished silver with the number engraved dark into the top face, the same metal as the rim
// of the checkers. Neither ever glows. The cube's owner is shown by where it lies, nothing else.

const PIPS: Record<number, Array<[number, number]>> = {
  1: [[50, 50]],
  2: [
    [28, 28],
    [72, 72],
  ],
  3: [
    [26, 26],
    [50, 50],
    [74, 74],
  ],
  4: [
    [28, 28],
    [72, 28],
    [28, 72],
    [72, 72],
  ],
  5: [
    [26, 26],
    [74, 26],
    [50, 50],
    [26, 74],
    [74, 74],
  ],
  6: [
    [30, 24],
    [70, 24],
    [30, 50],
    [70, 50],
    [30, 76],
    [70, 76]],
};

/** For a die showing `n` upward, the two faces you can actually see beside it. Taken from a real die
 *  (opposite faces sum to seven), so the thing survives being looked at closely. */
const ADJACENT: Record<number, [number, number]> = {
  1: [2, 3],
  2: [6, 3],
  3: [1, 5],
  4: [2, 6],
  5: [4, 1],
  6: [4, 5],
};

function Face({ cls, value }: { cls: string; value?: number }) {
  return (
    <span className={`f ${cls}`}>
      {value !== undefined &&
        PIPS[value].map(([x, y], i) => <i key={i} style={{ left: `${x}%`, top: `${y}%` }} />)}
    </span>
  );
}

/**
 * A die lying on the board. `size` is its edge length in px — a 3D solid needs a real length for
 * `translateZ`, which has no percentage form. `yaw` turns it on the spot so a pair never looks like
 * it was stamped twice.
 */
export function Die3({
  value,
  size,
  yaw = 22,
  spent = false,
  tumbling = false,
}: {
  value: number;
  size: number;
  yaw?: number;
  spent?: boolean;
  tumbling?: boolean;
}) {
  const [front, side] = ADJACENT[value] ?? ADJACENT[1];
  return (
    <span
      className={`d3${spent ? " spent" : ""}${tumbling ? " tumbling" : ""}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        ["--h" as string]: `${size / 2}px`,
        ["--ry" as string]: `${yaw}deg`,
      }}
    >
      <span className="d3-cube">
        <Face cls="top" value={value} />
        <Face cls="fr" value={front} />
        <Face cls="sd" value={side} />
        <Face cls="bk" />
        <Face cls="rt" />
        <Face cls="bt" />
      </span>
    </span>
  );
}

/**
 * The doubling cube. A centred cube shows 64 upward, exactly like a real set — it *reads* 64 until
 * somebody turns it, which is why an unclaimed cube is drawn no differently from a live one.
 */
export function CubeDie({ value, size }: { value: number; size: number }) {
  const shown = value <= 1 ? 64 : value;
  return (
    <span
      className="d3 cubedie"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        ["--h" as string]: `${size / 2}px`,
      }}
    >
      <span className="d3-cube">
        <span className="f top">
          <b style={{ fontSize: `${size * 0.62}px` }}>{shown}</b>
        </span>
        <span className="f fr" />
        <span className="f sd" />
        <span className="f bk" />
        <span className="f rt" />
        <span className="f bt" />
      </span>
    </span>
  );
}

/** The cube shown away from the board — in the double offer, or as the entry-screen ornament. */
export function DoublingCube({ value, giant = false }: { value: number; giant?: boolean }) {
  const size = giant ? 108 : 44;
  return (
    <span className={`cube-mount${giant ? " giant" : ""}`}>
      <CubeDie value={value} size={size} />
    </span>
  );
}
