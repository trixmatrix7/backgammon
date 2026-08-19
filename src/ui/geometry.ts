// Board coordinates. Everything the board draws — points, checkers, the bar, the trays, the cube and
// the dice — is positioned from this one module in "board units", then converted to percentages of
// the board frame. That keeps the layout resolution-independent and means the flight animation of a
// moving checker uses the exact same maths as the checker it lands on.
//
//   ┌──────┬────────────────────┬─────┬────────────────────┬──────┐
//   │ rail │  outer half (6)    │ bar │  home half (6)     │ tray │   15 units wide
//   └──────┴────────────────────┴─────┴────────────────────┴──────┘   11 units tall
//
// The rail carries the doubling cube, the tray carries borne-off checkers. A checker is 1 unit
// across, which makes it a perfect circle at the frame's 15:11 aspect ratio.

import { BAR, NUM_POINTS, OFF } from "@engine";

export const UW = 15; // board width in units
export const UH = 11; // board height in units
export const POINT_H = 4.55; // how far a point triangle reaches into the board
export const CHECKER_W_PCT = (1 / UW) * 100;

/** Left edge of a column, in units. Columns 0–5 are the outer half, 6–11 the home half. */
export function colUnit(col: number): number {
  return col < 6 ? col + 1 : col + 2;
}

export const BAR_UNIT = 7.5;
export const TRAY_UNIT = 14.5;
export const RAIL_UNIT = 0.5;

export interface Slot {
  col: number; // 0..11, left to right
  top: boolean; // which row the point hangs from
}

/**
 * Where a board index sits on screen. Seat 0 runs 23→0, so its home (0..5) is the bottom-right
 * quadrant and its checkers travel top-right → top-left → bottom-left → bottom-right: the classic
 * horseshoe. `flip` mirrors only the vertical axis, which is exactly what turns the same board into
 * seat 1's view — their home lands bottom-right too, so both players always play "toward themselves".
 */
export function slotOf(index: number, flip: boolean): Slot {
  const top = index >= 12;
  const col = top ? index - 12 : 11 - index;
  return { col, top: flip ? !top : top };
}

export const pctX = (u: number) => (u / UW) * 100;
export const pctY = (u: number) => (u / UH) * 100;

/** Horizontal centre of a point, in % of the board width. */
export function pointX(index: number, flip: boolean): number {
  return pctX(colUnit(slotOf(index, flip).col) + 0.5);
}

/** Checkers overlap once a point is crowded, so even a 15-stack stays inside its own quadrant rather
 *  than spilling across the middle of the board. */
function stackSpacing(count: number): number {
  if (count <= 5) return 0.95;
  return 3.9 / (count - 1);
}

/** Vertical centre of the `i`-th checker on a point, in % of the board height. */
export function checkerY(index: number, i: number, count: number, flip: boolean): number {
  const { top } = slotOf(index, flip);
  const gap = stackSpacing(count);
  const u = top ? 0.58 + i * gap : UH - 0.58 - i * gap;
  return pctY(u);
}

/** The bar. Each seat's hit checkers wait on its own side of the centre line. */
export function barX(): number {
  return pctX(BAR_UNIT);
}
export function barY(onBottom: boolean, i: number): number {
  const u = onBottom ? 6.45 + i * 0.85 : UH - 6.45 - i * 0.85;
  return pctY(u);
}

/** The bear-off tray. Borne-off checkers stack as thin slabs from the owner's edge inward. */
export function trayX(): number {
  return pctX(TRAY_UNIT);
}
export function trayY(onBottom: boolean, i: number): number {
  const slab = 0.3;
  const u = onBottom ? UH - 0.4 - i * slab : 0.4 + i * slab;
  return pctY(u);
}

export function railX(): number {
  return pctX(RAIL_UNIT);
}
/** The cube rides the rail: centred while nobody owns it, parked by its owner's edge once claimed. */
export function cubeY(cubeOwner: number, bottomSeat: number): number {
  if (cubeOwner < 0) return pctY(UH / 2);
  return cubeOwner === bottomSeat ? pctY(UH - 1.1) : pctY(1.1);
}

/**
 * The screen position a checker occupies for animation purposes. `BAR` and `OFF` are handled here so
 * a flight can start on the bar and end in the tray without the caller special-casing anything.
 */
export function anchorOf(
  place: number,
  seat: number,
  stackIdx: number,
  count: number,
  flip: boolean,
): { x: number; y: number } {
  const bottomSeat = flip ? 1 : 0;
  if (place === BAR) return { x: barX(), y: barY(seat === bottomSeat, stackIdx) };
  if (place === OFF) return { x: trayX(), y: trayY(seat === bottomSeat, stackIdx) };
  if (place < 0 || place >= NUM_POINTS) return { x: 50, y: 50 };
  return { x: pointX(place, flip), y: checkerY(place, stackIdx, count, flip) };
}

/**
 * Where the dice land. Each player throws into their own right-hand half — which is the home half for
 * whoever is sitting at the bottom and the outer half for their opponent — and they lie in the clear
 * band across the middle of the board, so they never end up buried under a stack of checkers.
 */
export function diceAnchor(roller: number, flip: boolean): { x: number; y: number } {
  const bottomSeat = flip ? 1 : 0;
  return { x: pctX(roller === bottomSeat ? 11 : 4), y: pctY(UH / 2) };
}
