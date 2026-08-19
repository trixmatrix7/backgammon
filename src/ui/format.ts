/** One number format everywhere: German grouping, but with a narrow no-break space instead of the
 *  full stop, so "1 600" can never be misread as "1.6" by anyone reading in English. */
export const fmt = (n: number): string => n.toLocaleString("de-DE").replace(/\./g, " ");

/** mm:ss for the move clock. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
