import { useHost } from "./sdk/useHost";
import { MatchScreen } from "./ui/MatchScreen";
import { CreateTable, ResultScreen, WaitingRoom } from "./ui/screens";
import { Sound, loadManifest } from "./sound/sounds";

/**
 * The whole app is the table.
 *
 * Matchmaking belongs to the chain.wtf host: it owns the list of open tables and
 * it seats the player, then pushes the lobby down to us. So this guest has no
 * browser and no filter — it only ever needs the two states either side of a
 * board: no table yet (offer to create one) and a table that has not filled yet
 * (wait for the opponent). Searching for tables here would be second-guessing
 * the host and would give players two places to look for the same thing.
 */
export function App() {
  const { snapshot, hostApi, debug, notice } = useHost();
  const mine = snapshot?.lobbies.items.find((l) => l.players.some((p) => p.isYou));

  // Standalone / dev only: the host is what normally seats you.
  if (!snapshot || !hostApi) {
    return (
      <div className="shell">
        <div className="neo neo-entry">
          <img className="neo-bg" src="/assets/neo/backdrop.png" alt="" />
          <div className="neo-speed" />
          {debug && !debug.active ? (
            <div className="neo-veil" style={{ background: "transparent" }}>
              <div className="neo-sheet">
                <div className="neo-eyebrow">ネオ・ギャモン</div>
                <div className="neo-title">Neo Gammon</div>
                <p className="neo-note">
                  Fifteen checkers home, theirs onto the bar, and turn the cube when you smell
                  blood.
                  <br />
                  First to the match target takes the pot.
                </p>
                <div className="neo-row">
                  <button
                    className="neo-btn"
                    onClick={() => {
                      Sound.unlock();
                      Sound.preload();
                      // the room: a real ambient track from the library, quiet
                      void loadManifest().then((m) => {
                        if (m?.ambient.length) Sound.setBed(`${m.base}/ambient/${m.ambient[0]}`, 0.28);
                      });
                      Sound.play("click");
                      debug.startMock();
                    }}
                  >
                    <span>Play</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="neo-veil" style={{ background: "transparent" }}>
              <div className="neo-sheet">
                <div className="neo-eyebrow">Loading…</div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const phase = mine?.phaseName ?? "NONE";

  let screen;
  if (!mine) {
    // The host seats you; until it does, the one thing this guest can offer is a table of its own.
    screen = (
      <div className="neo">
        <img className="neo-bg" src="/assets/neo/neo-hintergrund.png" alt="" />
        <div className="neo-speed" />
        <CreateTable hostApi={hostApi} snapshot={snapshot} />
      </div>
    );
  } else if (phase === "RESOLVED" || phase === "CANCELLED") {
    screen = <ResultScreen hostApi={hostApi} snapshot={snapshot} lobby={mine} />;
  } else if (mine.raw.gameState) {
    screen = <MatchScreen hostApi={hostApi} snapshot={snapshot} lobby={mine} />;
  } else if (phase === "WAITING_FOR_PLAYERS") {
    screen = (
      <div className="neo">
        <img className="neo-bg" src="/assets/neo/neo-hintergrund.png" alt="" />
        <div className="neo-speed" />
        <WaitingRoom hostApi={hostApi} snapshot={snapshot} lobby={mine} />
      </div>
    );
  } else {
    screen = (
      <div className="neo">
        <img className="neo-bg" src="/assets/neo/backdrop.png" alt="" />
        <div className="neo-speed" />
        <div className="neo-veil" style={{ background: "transparent" }}>
          <div className="neo-sheet">
            <div className="neo-eyebrow">Opening throw</div>
            <div className="neo-title">Dealing</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      {screen}
      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}
