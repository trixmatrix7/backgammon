
// Die Kurzregeln, wörtlich aus der Übergabe (preview-neo.html, Overlay "SO GEHT BACKGAMMON").
// Bewusst dieselbe Sprache und dieselbe Reihenfolge wie dort — die Regeln sind Teil des Designs,
// nicht eine Übersetzung davon.
// The short rules, in the same order and to the same content as the handover's rules overlay.
// Written out rather than linked, because a player who needs them needs them mid-match.
const RULES: Array<{ t: string; d: string }> = [
  {
    t: "What you are doing",
    d: "Each side has 15 checkers. You run in opposite directions over the 24 points. Yours always travel toward you, into your home board — the six points at the bottom right. Once all 15 are there you may take them off the board. First to bear all 15 off wins.",
  },
  {
    t: "A turn",
    d: "You throw two dice, and each number is its own move: a 5 means go five points on. Split them across two checkers or play both with one, but then one after the other, and the halfway point has to be open. Doubles count four times: on 3·3 you make four moves of 3. You must play both numbers if there is any way to. If only one will go, it has to be the higher. If nothing goes, your turn is over. When a throw leaves exactly one legal way to play, this table plays it out for you and says so — but nothing is sent until you confirm, and undo takes it back.",
  },
  {
    t: "Where you may land",
    d: "On any point that is empty, that already carries your own checkers (however many), or that carries exactly one enemy checker. A point is closed as soon as two or more enemy checkers stand on it — which is why stacking in pairs is strong: it builds a wall.",
  },
  {
    t: "Hitting",
    d: "Land on a single enemy checker and it is knocked off: it goes to the bar in the middle and starts all over again. If you have a checker on the bar you must bring it back in before you may move anything else. It enters in your opponent's home board: a 3 puts it on the third point from there. If that point is closed, the number is dead.",
  },
  {
    t: "Bearing off",
    d: "Only once all 15 are home. Then a thrown 4 takes a checker off the 4-point. If that point is empty and nothing stands further back, you may take from the highest occupied point instead. If you get hit while bearing off you have to bring that checker all the way home again — until then bearing off stops.",
  },
  {
    t: "What a win is worth",
    d: "Normal: the loser has at least one checker off → 1 point. Gammon: none off at all → double. Backgammon: none off AND still on the bar or in your home board → triple. In a single game the winner takes the whole pot and gammons are only a badge of honour. In a match they count as points; the pot stays fixed and goes to whoever takes the match.",
  },
  {
    t: "Doubling (match only, if the table turned it on)",
    d: "Before your throw you may offer that this game counts double. Your opponent takes — play goes on and THEY may double next — or drops, and the game ends at once with you scoring what it was worth before. Money never enters into it: the pot does not move.",
  },
  {
    t: "Provably thrown",
    d: "Every throw is fresh on-chain randomness delivered only after you have committed, so nobody can see their dice before deciding whether to double. The whole match replays to verify. No house — the winner takes the pot, minus the protocol fee.",
  },
];

export function RulesSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="neo-veil rules" onClick={onClose}>
      <div className="neo-sheet card rules-card" onClick={(e) => e.stopPropagation()}>
        <button className="intro-x" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <div className="neo-eyebrow">The short version</div>
        <div className="neo-title">
          How backgammon works<em>.</em>
        </div>

        <ol className="rules-list">
          {RULES.map((r, i) => (
            <li className="rules-item" key={i}>
              <span className="rules-num num">{i + 1}</span>
              <span className="rules-body">
                <b className="rules-item-title">{r.t}</b>
                <span className="rules-item-desc">{r.d}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="intro-foot">
          <span className="intro-hint">Open any time — the board keeps its position.</span>
          <button className="neo-btn" onClick={onClose}>
            <span>Got it</span>
          </button>
        </div>
      </div>
    </div>
  );
}
