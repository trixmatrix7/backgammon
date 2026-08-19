import { fmt } from "./format";

/**
 * The pot, as the keystone above the board.
 *
 * It lives in the centre column on purpose. Hang it off either player's card and it shifts every
 * time you sit down opposite a different wallet name — the one thing on this screen that must never
 * move is the number telling you what is at stake.
 */
export function PotPlaque({
  pot,
  stake,
  cube,
}: {
  pot: number;
  stake: number;
  /** Shown beside the plaque only once the cube has actually been turned. */
  cube?: number;
}) {
  return (
    <div className="potbar">
      <span className="rail l" />
      {cube !== undefined && cube > 1 && (
        <div className="cubetag">
          <span>Partie zählt</span>
          <b className="mono">{cube}</b>
        </div>
      )}
      <div className="plaque">
        <div className="plaqueIn">
          <span className="plbl">Pot</span>
          <b className="pot mono">
            {fmt(pot)} <i>◆</i>
          </b>
          <span className="psub">
            Einsatz je Spieler <b className="mono">{fmt(stake)} ◆</b>
          </span>
        </div>
      </div>
      <span className="rail r" />
    </div>
  );
}
