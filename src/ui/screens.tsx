import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import type { PvpHostApiV1, PvpHostSnapshotV1, LobbySnapshot, LobbyPlayer } from "@pvp-sdk";
import { SINGLE_GAME } from "@engine";

/** The one match length on offer. */
const BEST_OF_3_POINTS = 3;
import { encodeConfig, decodeConfig, DEFAULT_TURN_SEC } from "../game/codec";
import { Sound } from "../sound/sounds";
import { Coin } from "./Coin";
import { playerName, seatColor } from "./names";
import { useSound } from "./useSound";
import { SoundPanel } from "./SoundPanel";

function fmt(v?: string, decimals = 6): string {
  if (!v) return "0";
  const n = Number(formatUnits(BigInt(v), decimals));
  return n % 1 === 0 ? n.toLocaleString("en-US") : n.toFixed(2);
}

// ── Create a table ────────────────────────────────────────────────────────────
//
// There is no table browser and no filter here, by design: matchmaking belongs to the chain.wtf
// host, which seats the player and pushes the lobby down to us. This client can therefore only ever
// be in one of two states before a match — it has no table (offer to create one) or it has one that
// has not filled yet (wait for the opponent). Anything that searched, filtered or joined by code
// would be second-guessing the host.
//
// The four table rules are exactly the handover's list (TOBI-BACKGAMMON.md §2.11).

export function CreateTable({
  hostApi,
  snapshot,
}: {
  hostApi: PvpHostApiV1;
  snapshot: PvpHostSnapshotV1;
}) {
  const decimals = snapshot.token.decimals ?? 6;
  const { muted } = useSound();
  const [soundOpen, setSoundOpen] = useState(false);
  const [match, setMatch] = useState(false); // single game is the default
  const [cubeOn, setCubeOn] = useState(false); // doubling off is the default
  const [offiziell, setOffiziell] = useState(false); // loose opening is the default
  const [einsatz, setEinsatz] = useState(200);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const balNum = Number(formatUnits(BigInt(snapshot.balances.smartVaultBalance ?? "0"), decimals));
  // Two shapes only, because those are the two the platform offers: a single game, or
  // a short match. "Best of 3" is played as a match to 3 POINTS rather than to two
  // games won — that is how backgammon counts, and it is what keeps gammons meaning
  // something. A gammon can therefore end it in two games, which is the intended
  // behaviour of the scoring, not a shortcut.
  const matchTo = match ? BEST_OF_3_POINTS : SINGLE_GAME;
  // The cube is a match-only rule; a single game switches the whole column off.
  const cubeLive = cubeOn && match;
  const valid = einsatz > 0 && einsatz <= balNum && snapshot.wallet.status === "ready";

  const create = async () => {
    if (!valid || busy) return;
    Sound.unlock();
    Sound.preload();
    Sound.play("click");
    setBusy(true);
    setErr(null);
    try {
      await hostApi.createLobby({
        buyIn: String(Math.round(einsatz * 10 ** decimals)),
        maxPlayers: 2,
        config: encodeConfig(DEFAULT_TURN_SEC, matchTo, cubeLive, offiziell),
      });
    } catch {
      setErr("Could not open the table — try again.");
      setBusy(false);
    }
  };

  const STUFEN = [50, 100, 200, 400, 800, 1200, 2000, 5000];
  const step = (d: number) => {
    const i = STUFEN.indexOf(einsatz);
    const from = i < 0 ? STUFEN.findIndex((v) => v >= einsatz) : i;
    const at = from < 0 ? STUFEN.length - 1 : from;
    setEinsatz(STUFEN[Math.max(0, Math.min(STUFEN.length - 1, at + d))]);
    Sound.play("select");
  };

  const hinweis = match
    ? `First to ${BEST_OF_3_POINTS} points${cubeLive ? " · doubling cube on" : ""} — the pot settles to whoever takes the match.`
    : "One game — the winner takes the whole pot.";

  return (
    <div className="neo-page">
      <div className="neo-lkopf">
        <h2>
          TABLE<em>.</em>
        </h2>
        <div className="neo-bal">
          <span>BALANCE</span>
          <b className="mono">
            {fmt(snapshot.balances.smartVaultBalance, decimals)} <Coin />
          </b>
          <span className="snd-anchor">
            <button className="neo-btn sm" onClick={() => setSoundOpen((o) => !o)}>
              {muted ? "MUTED" : "SOUND"}
            </button>
            {soundOpen && <SoundPanel onClose={() => setSoundOpen(false)} />}
          </span>
        </div>
      </div>

      <div className="neo-cpanel">
        <h3>OPEN YOUR OWN TABLE</h3>
        <div className="neo-cprow">
          <div className="neo-cpg">
            <span className="neo-cplbl">Stake</span>
            <div className="neo-stake">
              <button className="neo-stbtn" onClick={() => step(-1)} aria-label="Lower the stake">
                −
              </button>
              <div className="neo-stwrap">
                <input
                  className="mono"
                  inputMode="numeric"
                  value={einsatz}
                  aria-label="Type any stake"
                  onChange={(e) => setEinsatz(Math.max(0, Number(e.target.value.replace(/[^0-9]/g, "")) || 0))}
                />
                <span className="neo-stcur">
                  <Coin />
                </span>
              </div>
              <button className="neo-stbtn" onClick={() => step(1)} aria-label="Raise the stake">
                +
              </button>
            </div>
            <div className="neo-stpre">
              {[50, 200, 800, 2000].map((v) => (
                <button
                  key={v}
                  className="mono"
                  onClick={() => {
                    setEinsatz(v);
                    Sound.play("select");
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="neo-cpg">
            <span className="neo-cplbl">Mode</span>
            <div className="neo-seg">
              <button
                aria-pressed={!match}
                onClick={() => {
                  setMatch(false);
                  Sound.play("select");
                }}
              >
                1 game
              </button>
              <button
                aria-pressed={match}
                onClick={() => {
                  setMatch(true);
                  Sound.play("select");
                }}
              >
                Best of 3
              </button>
            </div>
          </div>

          <div className={`neo-cpg${match ? "" : " aus"}`}>
            <span
              className="neo-cplbl"
              title="Doubling cube: doubles what the running game is worth in match points — match only"
            >
              Doubling
            </span>
            <div className="neo-seg">
              <button
                aria-pressed={!cubeOn}
                onClick={() => {
                  setCubeOn(false);
                  Sound.play("select");
                }}
              >
                Off
              </button>
              <button
                aria-pressed={cubeOn}
                onClick={() => {
                  setCubeOn(true);
                  Sound.play("select");
                }}
              >
                On
              </button>
            </div>
          </div>

          <div className="neo-cpg">
            <span className="neo-cplbl">Opening</span>
            <div className="neo-seg">
              <button
                aria-pressed={!offiziell}
                title="A tie is simply thrown again."
                onClick={() => {
                  setOffiziell(false);
                  Sound.play("select");
                }}
              >
                Loose
              </button>
              <button
                aria-pressed={offiziell}
                title="A tie also doubles the value of the game before the re-throw."
                onClick={() => {
                  setOffiziell(true);
                  Sound.play("select");
                }}
              >
                Official
              </button>
            </div>
          </div>
        </div>

        {err && <div className="neo-err">{err}</div>}

        <div className="neo-cpfuss">
          <span className="neo-cphint">{hinweis}</span>
          <button className="neo-cta" disabled={!valid || busy} onClick={create}>
            <span>
              {busy ? "OPENING…" : "OPEN TABLE"}
              <br />
              <b className="mono">
                {einsatz} <Coin />
              </b>
            </span>
          </button>
        </div>
      </div>

      <p className="neo-foot">Both players pay the same stake into the pot. The winner takes all of it.</p>
    </div>
  );
}

// ── Waiting for player ────────────────────────────────────────────────────────

export function WaitingRoom({
  hostApi,
  snapshot,
  lobby,
}: {
  hostApi: PvpHostApiV1;
  snapshot: PvpHostSnapshotV1;
  lobby: LobbySnapshot;
}) {
  const decimals = snapshot.token.decimals ?? 6;
  const cfg = decodeConfig(lobby.raw.config);
  const seats: Array<LobbyPlayer | null> = [lobby.players[0] ?? null, lobby.players[1] ?? null];
  const [seit, setSeit] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setSeit((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const uhr = `${Math.floor(seit / 60)}:${String(seit % 60).padStart(2, "0")}`;

  const regeln = [
    cfg.matchTo > 1 ? "Best of 3" : "1 game",
    cfg.cubeOn ? "Doubling on" : "Doubling off",
    cfg.officialOpening ? "Official opening" : "Loose opening",
  ].join(" · ");

  return (
    <div className="neo-page center">
      <div className="neo-wait">
        <div className="neo-eyebrow">Table open · {regeln}</div>
        <h2>
          WAITING FOR A PLAYER<em>.</em>
        </h2>

        <div className="neo-waitseats">
          {seats.map((p, i) => (
            <div className={`neo-seat${p ? "" : " leer"}${i === 1 ? " foe" : ""}`} key={i}>
              <span className="neo-ava">{p ? playerName(p).slice(0, 1).toUpperCase() : "?"}</span>
              <div className="neo-seatname">{p ? playerName(p) : "Open seat"}</div>
              <div className="neo-seatstate">{p ? (p.isYou ? "you" : "ready") : "waiting…"}</div>
            </div>
          ))}
        </div>

        <div className="neo-waitpot">
          <span>POT</span>
          <b className="mono">
            {fmt(lobby.pot, decimals)} <Coin />
          </b>
          <i className="mono">Stake each {fmt(lobby.buyIn, decimals)}</i>
        </div>

        <p className="neo-waittxt">
          As soon as an opponent sits down, the opening throw is made.
          <b className="mono"> {uhr}</b>
        </p>

        <div className="neo-waitrow">
          <button
            className="neo-btn"
            onClick={() => {
              Sound.play("click");
              void hostApi.leaveLobby({ lobbyId: lobby.lobbyId });
            }}
          >
            Close the table
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Match result ──────────────────────────────────────────────────────────────

export function ResultScreen({
  hostApi,
  snapshot,
  lobby,
}: {
  hostApi: PvpHostApiV1;
  snapshot: PvpHostSnapshotV1;
  lobby: LobbySnapshot;
}) {
  const decimals = snapshot.token.decimals ?? 6;
  const payout = lobby.payout;
  const cancelled = lobby.phaseName === "CANCELLED" || !payout;
  const youIndex = Math.max(
    0,
    lobby.players.findIndex((p) => p.isYou),
  );
  const draw = !cancelled && !!payout && payout.shareBps[youIndex] === 5000;
  const youWon = !cancelled && !!payout && payout.shareBps[youIndex] === 10000;

  useEffect(() => {
    Sound.play(youWon ? "victory" : draw ? "turn" : "defeat");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buyIn = BigInt(lobby.buyIn ?? "0");
  const youGross = !cancelled && payout?.amounts ? BigInt(payout.amounts[youIndex] ?? "0") : 0n;
  const net = cancelled ? 0n : youGross - buyIn;
  const netNum = Number(formatUnits(net < 0n ? -net : net, decimals));

  const back = () => {
    Sound.play("click");
    void hostApi.cancelLobby({ lobbyId: lobby.lobbyId });
  };
  const kicker = cancelled
    ? "Match cancelled"
    : draw
      ? "Level on points"
      : youWon
        ? "You take the pot"
        : "Pot lost";
  const title = cancelled ? "REFUNDED" : draw ? "DRAW" : youWon ? "VICTORY" : "DEFEAT";
  const cls = cancelled || draw ? "draw" : youWon ? "win" : "lose";

  return (
    <div className="neo">
      <img className="neo-bg" src="/assets/neo/neo-hintergrund.png" alt="" />
      <div className="neo-speed" />
      <div className="neo-page center">
        <div className="neo-sheet card result-card">
          <div className="neo-eyebrow">{kicker}</div>
          <div className={`result-title ${cls}`}>{title}</div>

          {!cancelled && (
            <div className="result-board">
              {lobby.players.map((p, i) => (
                <div className={`result-row${p.isYou ? " you" : ""}`} key={i}>
                  <span className="result-swatch" style={{ background: seatColor(i) }} />
                  <span className="result-name">
                    {playerName(p)}
                    {p.isYou ? " (you)" : ""}
                  </span>
                  <span className="result-share num">
                    {payout && payout.shareBps[i] > 0 ? (
                      <>
                        {fmt(payout.amounts?.[i], decimals)} <Coin />
                      </>
                    ) : (
                      "—"
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          {!cancelled && !draw && (
            <div className={`result-net num ${net >= 0n ? "up" : "down"}`}>
              {net >= 0n ? "+" : "−"}
              {netNum.toLocaleString("en-US", { maximumFractionDigits: 2 })} <Coin />
            </div>
          )}

          <div className="result-actions">
            {/* The way out. Without it the only exit was a rematch or the browser
                back button, which is not an exit. */}
            <button className="neo-btn" onClick={back}>
              <span>Back to game creation</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
