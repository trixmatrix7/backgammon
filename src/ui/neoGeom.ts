// Where everything sits on the Neo board.
//
// Every number here is measured off `board-neo.png` and comes verbatim from the
// design handover (TOBI-BACKGAMMON.md §5/§6). They are fractions of the picture,
// never pixels, so the whole layer scales with the art and there is nothing to
// keep in sync at any size.
//
// The board is drawn once and never re-derived at runtime: a scan of the plate
// was tried and abandoned, because the screentone merges neighbouring points
// into six runs instead of twelve columns. Measuring once beats a detector that
// is wrong in a way nobody notices until a checker sits half a column off.

export const BOARD_SRC = "/assets/neo/board-neo.png";
export const BACKDROP_SRC = "/assets/neo/neo-hintergrund.png";
export const CHIP_SRC = { w: "/assets/neo/neo-stein-w.png", b: "/assets/neo/neo-stein-b.png" };
export const EDGE_SRC = { w: "/assets/neo/neo-kante-w.png", b: "/assets/neo/neo-kante-b.png" };
export const TRAY_SRC = "/assets/neo/neo-schale.png";
export const BUTTON_SRC = "/assets/neo/neo-knopf.png";
export const CARD_SRC = { you: "/assets/neo/karte-du.png", foe: "/assets/neo/karte-foe.png" };

export const GEOM = {
  /** Natural size of the plate, and the ratio every width→height conversion uses. */
  px: { w: 2528, h: 1696 },
  aspect: 2528 / 1696, // 1.4906
  /** Column axes, left → right: six on the left half, six on the right. */
  cols: [
    0.0529, 0.1284, 0.2038, 0.2793, 0.3547, 0.4302,
    0.5698, 0.6453, 0.7207, 0.7962, 0.8716, 0.9471,
  ],
  /** Point width, and where the two rows of points start. */
  pointW: 0.07546,
  topBase: 0.0078,
  botBase: 0.9922,
  /** How far a point reaches into the board. */
  pointLen: 0.43,
} as const;

/** Checker width — one point width plus a hair, as a fraction of board width. */
export const chipW = GEOM.pointW * 1.04 * 100;
/** The same width expressed against board HEIGHT, the unit vertical offsets use. */
export const chipH = GEOM.pointW * 1.04 * GEOM.aspect * 100;

/**
 * Engine index (0..23, seat 0's absolute numbering) → the point number the art is
 * measured against. Both players read their own board as 1–24 with their home at
 * the bottom right, so seat 1 sees the mirror: the classic `25 − n`.
 */
export const markNo = (index: number, flip: boolean): number => (flip ? 24 - index : index + 1);

/** True for the twelve points that hang from the top edge. */
export const isTopPoint = (no: number) => no >= 13;

/**
 * Point number → its column axis, in % of board width. 13 sits on column 0 top,
 * 12 on column 0 bottom, 24 on column 11 top, 1 on column 11 bottom.
 */
export function colX(no: number): number {
  const i = no >= 13 ? no - 13 : 12 - no;
  return GEOM.cols[i] * 100;
}

/** Centre of the bar — the pink spine down the middle of the plate. */
export const barX = 50;

/**
 * Spacing between two checkers on the same point, in % of board height. Fixed up
 * to five; from six on they close up automatically so a tower never grows past
 * the tip of the point it stands on.
 */
export function stackStep(_no: number, count: number): number {
  return Math.min(GEOM.pointLen / 5.4, GEOM.pointLen / (count + 0.4)) * 100;
}

/** Vertical centre of the i-th checker on a point, in % of board height. */
export function checkerY(no: number, i: number, count: number): number {
  const step = stackStep(no, count);
  return isTopPoint(no)
    ? GEOM.topBase * 100 + step * (i + 0.55)
    : GEOM.botBase * 100 - step * (i + 0.55);
}

/** Hit checkers wait on the bar, on their owner's side of the centre line. */
export function barY(onBottom: boolean, i: number): number {
  return onBottom ? 60 + i * chipH * 0.82 : 40 - i * chipH * 0.82;
}

/** Borne-off checkers stack in the tray beside the board, not on it. */
export function offY(onBottom: boolean, i: number): number {
  return onBottom ? 96 - i * 1.6 : 4 + i * 1.6;
}

/**
 * Where a throw lands. Backgammon convention: you roll into the right-hand half,
 * and both dice lie together in the empty band across the middle of the board.
 */
export function diceAnchor(k: number): { x: number; y: number } {
  return { x: k ? 76 : 65, y: k ? 52 : 48.5 };
}

/** Pip coordinates as percentages of a die face, so a face is right at any size. */
export const PIPS: Record<number, Array<[number, number]>> = {
  1: [[50, 50]],
  2: [
    [30, 30],
    [70, 70],
  ],
  3: [
    [27, 27],
    [50, 50],
    [73, 73],
  ],
  4: [
    [30, 30],
    [70, 30],
    [30, 70],
    [70, 70],
  ],
  5: [
    [28, 28],
    [72, 28],
    [50, 50],
    [28, 72],
    [72, 72],
  ],
  6: [
    [30, 24],
    [70, 24],
    [30, 50],
    [70, 50],
    [30, 76],
    [70, 76],
  ],
};
