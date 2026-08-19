import { Wordmark } from "./Wordmark";

/** Pre-match curtain — covers the board while the opening beat plays, so the position is revealed
 *  already set up rather than popping in. Assets here are vector + synth, so this is the dramatic
 *  curtain rather than a real asset gate; it still snaps to 100% before it lifts. */
export function MatchLoading({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="match-loading">
      <div className="match-loading-inner">
        <span className="match-loading-mark">
          <Wordmark />
        </span>
        <div className="match-loading-track">
          <div className="match-loading-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="match-loading-label">{label}</span>
      </div>
    </div>
  );
}
