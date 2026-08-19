// The thing a new player needs in the first ten seconds.
//
// Backgammon has a lot of near-relatives — acey-deucey, the narde family, tapa —
// and several of them start with the checkers OFF the board and bring them in.
// So somebody who has played one of those sits down here, sees fifteen checkers
// already placed, and reasonably wonders what they missed. The rules sheet does
// not answer that, because it explains the rules rather than the board in front
// of you.
//
// This does. It opens by itself the first time a board appears, closes with the X,
// and remembers that you closed it. It is deliberately about READING the position
// and taking a turn — not a rulebook. The rulebook is one button away and stays
// there.

import { Sound } from "../sound/sounds";

export const INTRO_KEY = "chain-backgammon-intro-seen";

export function IntroSheet({
  cubeOn,
  matchTo,
  onClose,
  onNeverAgain,
}: {
  cubeOn: boolean;
  matchTo: number;
  /** Close it for this match. It opens again at the next one. */
  onClose: () => void;
  /** Close it and never open it again. */
  onNeverAgain: () => void;
}) {
  const close = () => {
    Sound.play("click");
    onClose();
  };
  const never = () => {
    Sound.play("click");
    onNeverAgain();
  };

  return (
    <div className="neo-veil intro" onClick={close}>
      <div className="neo-sheet card intro-card" onClick={(e) => e.stopPropagation()}>
        <button className="intro-x" onClick={close} aria-label="Close">
          ✕
        </button>

        <div className="neo-eyebrow">Reading the board</div>
        <div className="neo-title">
          You are the light checkers<em>.</em>
        </div>

        <ol className="intro-list">
          <li>
            <b>Everything is already placed — that is correct.</b> Backgammon opens from a fixed
            starting position, not from an empty board. If you know a version where all fifteen come
            in from outside, that is a relative of this game (acey-deucey, or one of the narde
            family), not this one.
          </li>
          <li>
            <b>You move toward yourself.</b> Your checkers run around the board into the six points
            at the <b>bottom right</b> — your home. Your opponent runs the opposite way, into the
            top right. Both of you are always shown at the bottom of your own screen.
          </li>
          <li>
            <b>Roll, then play both numbers.</b> Each die is its own move. Two dice, two moves —
            unless you throw a pair, which is four. Click a checker and every point it can reach
            lights up; click one to move there, then <b>CONFIRM</b> to send the whole turn.
          </li>
          <li>
            <b>You must use as many dice as you can.</b> This is not optional, and it is why the
            board sometimes moves without you: when a throw leaves exactly one legal way to play, the
            table plays it out for you and tells you it did. Nothing is sent until you press{" "}
            <b>CONFIRM</b>, and <b>UNDO</b> takes it back.
          </li>
          <li>
            <b>Two checkers hold a point.</b> A point with two or more of your checkers is closed to
            your opponent. A point with exactly one is a <b>blot</b>: land on it and that checker
            goes to the <b>bar</b> — the strip down the middle — and has to start its lap again.
            While you have anything on the bar you may move nothing else.
          </li>
          <li>
            <b>Bearing off wins it.</b> Once all fifteen of your checkers are home you start taking
            them off the board, into the tray on the right. First side to take all fifteen off wins
            the game.
          </li>
          {cubeOn && (
            <li>
              <b>The cube is live at this table.</b> Before your roll you may double what the game is
              worth. Your opponent takes it — and then only they may double next — or drops, and the
              game ends there. The pot never changes; the cube only moves points.
            </li>
          )}
          <li>
            {matchTo > 1 ? (
              <>
                <b>This is a match to {matchTo} points.</b> Each game won is worth points, and the
                pot goes to whoever reaches {matchTo} first.
              </>
            ) : (
              <>
                <b>This is a single game.</b> Win it and the whole pot is yours.
              </>
            )}
          </li>
        </ol>

        <div className="intro-foot">
          <button className="intro-never" onClick={never}>
            Don't show this again
          </button>
          <button className="neo-btn" onClick={close}>
            <span>Got it — let me play</span>
          </button>
        </div>
      </div>
    </div>
  );
}
