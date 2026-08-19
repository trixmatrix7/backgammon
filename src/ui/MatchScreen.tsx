import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits } from "viem";
import type { PvpHostApiV1, PvpHostSnapshotV1, LobbySnapshot } from "@pvp-sdk";
import {
  BAR,
  EV_DANCE,
  EV_DOUBLE,
  EV_MOVE,
  EV_OPEN,
  EV_PASS,
  EV_RESIGN,
  EV_ROLL,
  EV_TAKE,
  MAX_CUBE,
  OFF,
  PHASE_CUBE,
  PHASE_GAME_OVER,
  PHASE_MOVE,
  PHASE_ROLL,
  boardKey,
  boardOf,
  canDouble,
  canResign,
  countAt,
  legalTurns,
  moveDest,

  other,
  pipCount,
  playTurn,
  winProbability,
  type TurnMove,
} from "@engine";
import { DOUBLE, MOVE, NEXT, PASS, RESIGN, ROLL, TAKE, decodeState, encodeAction } from "../game/codec";
import { moveDuration } from "../game/pacing";
import { Sound } from "../sound/sounds";
import { Board, type Flight } from "./Board";
import { MoveMagazine } from "./MoveMagazine";
import { PlayerCard } from "./PlayerCard";
import { RulesSheet } from "./RulesModal";
import { INTRO_KEY, IntroSheet } from "./IntroSheet";
import { playerName } from "./names";
import { fmt } from "./format";
import { useMatchAnimator } from "./useMatchAnimator";
import { useSound } from "./useSound";
import { SoundPanel } from "./SoundPanel";

const FLAVOR_WORD: Record<number, string> = { 1: "Einfach", 2: "Gammon", 3: "Backgammon" };

/** Canonical string for a move sequence — used for prefix matching against the legal turns. */
const movesKey = (ms: TurnMove[]): string => ms.map((m) => `${m.from}:${m.die}`).join(",");

export function MatchScreen({
  hostApi,
  snapshot,
  lobby,
}: {
  hostApi: PvpHostApiV1;
  snapshot: PvpHostSnapshotV1;
  lobby: LobbySnapshot;
}) {
  const decimals = snapshot.token.decimals ?? 6;
  const decoded = useMemo(() => decodeState(lobby.raw.gameState!), [lobby.raw.gameState]);
  const auth = decoded.state;
  const deadline = decoded.deadline;

  const { view, anim, animating } = useMatchAnimator(auth);
  const yourSeat = Math.max(0, lobby.players.findIndex((p) => p.isYou));
  const seated = lobby.players.some((p) => p.isYou);
  const flip = yourSeat === 1;
  const names = useMemo(() => lobby.players.map(playerName), [lobby.players]);

  const { muted } = useSound();
  const [soundOpen, setSoundOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  // Opens by itself the first time a player ever reaches a board, and remembers that
  // they closed it. A returning player is not told twice what a blot is.
  const [introOpen, setIntroOpen] = useState(() => {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(INTRO_KEY) !== "1";
  });
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);
  const [acting, setActing] = useState(false);
  const [pending, setPending] = useState<TurnMove[]>([]);
  /** The move the player has JUST staged, while its checker is still hopping across
   *  the board. The opponent's moves arrive as events and get animated by the
   *  animator; your own never did — they were applied straight to the board, so your
   *  checker teleported while theirs walked. This is the missing half. */
  const [localFly, setLocalFly] = useState<TurnMove | null>(null);
  const flyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set when the engine left exactly one playable position and we staged it FOR the
   *  player, so we can say so instead of moving a checker unannounced. */
  const [forced, setForced] = useState(0);
  /** Stamped when the turn comes back to you, so the table can SAY so. The player
   *  cards carry an "on roll" marker, but that is a status in the corner of the
   *  screen — it tells you if you go looking, which is no use to somebody who has
   *  looked away waiting for an opponent. */
  const [myTurn, setMyTurn] = useState(0);
  /** The id of the beat the player has clicked away. A message is an interruption; if
   *  they have read it, waiting out the rest of its three seconds is just a delay. */
  const [beatSkip, setBeatSkip] = useState("");
  const turnRef = useRef(false);
  const [selected, setSelected] = useState<number | null>(null);
  // Hovering a movable checker previews where it can land; arming a die from the move rail narrows
  // every option on the board to that value.
  const [hover, setHover] = useState<number | null>(null);
  const [armedDie, setArmedDie] = useState<number | null>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  // Your own move is staged instantly rather than replayed (see `suppressOwn`), so the HIT moment has
  // to be fired here or knocking someone to the bar — the best beat in the game — would go unmarked.
  const [localHit, setLocalHit] = useState(0);


  const actedSeqRef = useRef(-1);
  const myMoveSeqRef = useRef(-1);
  const autoRef = useRef(-1);
  const soundRef = useRef("");
  const resultRef = useRef(-1);

  const ev = anim.ev;
  const vSeq = view?.seq ?? -1;

  // ── derived turn state (plain computation — no hooks, so it can precede the early return) ────
  const yourTurn = !!view && !view.over && view.current === yourSeat && seated;
  // A message on the table holds the game: acting through your own announcement is
  // the thing that made it feel like the two were unrelated. The event-driven beats
  // already block, because `animating` covers them — these two are ours.
  const ready = !!view && !animating && !acting && !myTurn && !forced;
  const canAct = ready && yourTurn;
  const inMove = canAct && view!.phase === PHASE_MOVE;
  const inRoll = canAct && view!.phase === PHASE_ROLL;
  const inCube = canAct && view!.phase === PHASE_CUBE;
  const inGameOver = !!view && view.phase === PHASE_GAME_OVER && ready;

  // Enumerating every legal turn is the one genuinely expensive thing this screen does (a doubles roll
  // can reach a few thousand sequences), and the clock re-renders us four times a second — so it runs
  // ONCE per position and everything below is prefix arithmetic over the result.
  const turns = useMemo(
    () => (view && inMove ? legalTurns(view) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inMove, vSeq],
  );
  const prefix = movesKey(pending);
  const steps: TurnMove[] = [];
  const seenStep = new Set<string>();
  let turnComplete = false;
  for (const t of turns) {
    if (movesKey(t.slice(0, pending.length)) !== prefix) continue;
    if (t.length === pending.length) {
      turnComplete = true;
      continue;
    }
    const s = t[pending.length];
    const k = `${s.from}:${s.die}`;
    if (!seenStep.has(k)) {
      seenStep.add(k);
      steps.push(s);
    }
  }

  // ── effects ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    Sound.unlock();
    Sound.preload();

  }, []);

  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Deliberately NOT keyed off `inRoll`: that now depends on `myTurn` (a message
    // holds the game), so keying off it would make the announcement re-arm itself the
    // instant it faded, forever. This watches the turn itself.
    const on = yourTurn && view?.phase === PHASE_ROLL && !animating && !acting;
    if (on && !turnRef.current) {
      setMyTurn(Date.now());
      Sound.play("turn");
    }
    turnRef.current = on;
  }, [yourTurn, view?.phase, animating, acting]);

  useEffect(() => {
    if (!myTurn) return;
    const t = setTimeout(() => setMyTurn(0), 3000);
    return () => clearTimeout(t);
  }, [myTurn]);

  useEffect(() => {
    if (!forced) return;
    const t = setTimeout(() => setForced(0), 3000);
    return () => clearTimeout(t);
  }, [forced]);

  useEffect(() => {
    if (!localHit) return;
    const t = setTimeout(() => setLocalHit(0), 850);
    return () => clearTimeout(t);
  }, [localHit]);

  // Release the action lock as soon as the AUTHORITATIVE state advances past the move we submitted —
  // never on an animation alone. In production submitAction can reject (declined signature, reverted
  // tx, dropped action); if the lock waited on an animation that then never plays, the player would
  // be frozen out of the rest of a real-money match.
  useEffect(() => {
    if (acting && auth.seq > actedSeqRef.current) setActing(false);
  }, [auth.seq, acting]);

  useEffect(() => {
    if (!acting) return;
    const t = setTimeout(() => setActing(false), 8000);
    return () => clearTimeout(t);
  }, [acting]);

  // A new position means the staged turn is gone.
  useEffect(() => {
    setPending([]);
    setSelected(null);
    setArmedDie(null);
    setHover(null);
    if (flyTimer.current) clearTimeout(flyTimer.current);
    setLocalFly(null);
  }, [vSeq]);

  // When the roll leaves exactly one playable POSITION (move order collapsed away), stage it — there
  // is no decision to make, and clicking a forced turn out by hand is busywork. They still confirm it.
  useEffect(() => {
    if (!view || !inMove || pending.length > 0 || autoRef.current === vSeq || turns.length === 0) return;
    const seen = new Set<string>();
    for (const t of turns) seen.add(boardKey(playTurn(boardOf(view), view.current, t).board));
    if (seen.size !== 1 || turns[0].length === 0) return;
    autoRef.current = vSeq;
    const only = turns[0];
    // Walk it out one checker at a time, the same hop the player would have got had
    // they clicked it themselves — a whole turn appearing at once is the thing that
    // looked broken.
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const t = setTimeout(() => {
      let at = 0;
      only.forEach((m, i) => {
        timers.push(
          setTimeout(() => {
            setPending(only.slice(0, i + 1));
            setLocalFly(m);
            if (flyTimer.current) clearTimeout(flyTimer.current);
            flyTimer.current = setTimeout(() => setLocalFly(null), moveDuration(m));
          }, at),
        );
        at += moveDuration(m);
      });
      // Say it. A checker that moves on its own, with no click behind it, reads as a
      // bug — and the rule underneath ("you must use as many dice as you can") is one
      // of the two rules new players never guess. So the callout names both the fact
      // and the reason, and CONFIRM still belongs to the player.
      setForced(Date.now());
    }, 420);
    return () => {
      clearTimeout(t);
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inMove, vSeq, pending.length, turns]);

  // Event sounds — keyed so each beat fires exactly once.
  useEffect(() => {
    if (!ev || !view) return;
    const key = `${ev.seq}:${anim.step}`;
    if (soundRef.current === key) return;
    soundRef.current = key;
    switch (ev.kind) {
      case EV_ROLL:
      case EV_DANCE:
      case EV_OPEN:
        Sound.play("roll");
        if (ev.kind === EV_DANCE) setTimeout(() => Sound.play("dance"), 700);
        break;
      case EV_MOVE: {
        const m = ev.moves[anim.step];
        if (!m) break;
        const pre = playTurn(boardOf(view), ev.player, ev.moves.slice(0, anim.step)).board;
        const dest = moveDest(ev.player, m.from, m.die);
        if (dest !== OFF && countAt(pre, dest, other(ev.player)) === 1) Sound.play("hit", 1.1);
        else if (dest === OFF) Sound.play("bearoff");
        else if (m.from === BAR) Sound.play("enter");
        // an ordinary landing says nothing here: the checker's own hops are the sound
        // of it arriving, one per point. A second thud on top was just noise.
        break;
      }
      case EV_DOUBLE:
        Sound.play("cube");
        break;
      case EV_TAKE:
        Sound.play("take");
        break;
      case EV_PASS:
      case EV_RESIGN:
        Sound.play("pass");
        break;
    }
  }, [ev, anim.step, view]);

  // The scoreline of a finished game.
  useEffect(() => {
    const r = view?.lastResult;
    if (!r || resultRef.current === r.seq) return;
    resultRef.current = r.seq;
    Sound.play(r.flavor >= 2 ? "gammon" : "gamewin");
  }, [view?.lastResult]);

  if (!view) return <div className="match-stage" />;

  // ── what to draw ─────────────────────────────────────────────────────────────

  const suppressOwn = !!ev && ev.kind === EV_MOVE && ev.seq === myMoveSeqRef.current;
  let board = boardOf(view);
  let flight: Flight | null = null;

  if (ev?.kind === EV_MOVE && ev.moves.length > 0) {
    if (suppressOwn) {
      // Our own move was already played out on this screen while we staged it — replaying it would
      // rewind the board under the player's hands.
      board = playTurn(boardOf(view), ev.player, ev.moves).board;
    } else {
      const pre = playTurn(boardOf(view), ev.player, ev.moves.slice(0, anim.step)).board;
      const m = ev.moves[anim.step];
      const dest = moveDest(ev.player, m.from, m.die);
      board = pre;
      flight = {
        from: m.from,
        to: dest,
        seat: ev.player,
        hit: dest !== OFF && countAt(pre, dest, other(ev.player)) === 1,
      };
    }
  } else if (!animating && pending.length > 0) {
    if (localFly) {
      // one move short, with the last one in the air
      const pre = playTurn(boardOf(view), view.current, pending.slice(0, -1)).board;
      const dest = moveDest(view.current, localFly.from, localFly.die);
      board = pre;
      flight = {
        from: localFly.from,
        to: dest,
        seat: view.current,
        hit: dest !== OFF && countAt(pre, dest, other(view.current)) === 1,
      };
    } else {
      board = playTurn(boardOf(view), view.current, pending).board;
    }
  }

  const rollingEv = ev && (ev.kind === EV_ROLL || ev.kind === EV_DANCE) ? ev : null;
  const diceShown = rollingEv
    ? [rollingEv.d1, rollingEv.d2]
    : view.phase === PHASE_MOVE
      ? view.dice
      : null;
  const diceOwner = rollingEv ? rollingEv.player : view.current;
  const rollKey =
    view.phase === PHASE_MOVE && view.lastEvent?.kind === EV_OPEN
      ? view.seq
      : rollingEv
        ? rollingEv.seq
        : null;

  const cubePending =
    view.phase === PHASE_CUBE
      ? Math.min(MAX_CUBE, view.cube * 2)
      : ev?.kind === EV_DOUBLE
        ? ev.cube
        : null;

  // An armed die narrows everything — which checkers can be lifted, and where each one lands. It
  // un-arms itself the moment no legal move uses that value any more, so it can never trap the player.
  const armed = armedDie !== null && steps.some((s) => s.die === armedDie) ? armedDie : null;
  const armedSteps = armed === null ? steps : steps.filter((s) => s.die === armed);
  const pickable = new Set(armedSteps.map((s) => s.from));
  const destsFor = (src: number) => {
    const m = new Map<number, number>();
    for (const s of armedSteps) if (s.from === src) m.set(moveDest(view.current, s.from, s.die), s.die);
    return m;
  };
  const targets = selected !== null ? destsFor(selected) : new Map<number, number>();
  const preview = selected === null && hover !== null && pickable.has(hover) ? destsFor(hover) : new Map<number, number>();

  // The throw owes two moves, or four on a double. Spend them left to right so the countdown always
  // reads in one direction.
  const diceTokens =
    view.phase === PHASE_MOVE && view.dice[0] > 0
      ? view.dice[0] === view.dice[1]
        ? [view.dice[0], view.dice[0], view.dice[0], view.dice[0]]
        : [view.dice[0], view.dice[1]]
      : [];
  const spentPool = pending.map((m) => m.die);
  const diceUsed = diceTokens.map((v) => {
    const i = spentPool.indexOf(v);
    if (i >= 0) {
      spentPool.splice(i, 1);
      return true;
    }
    return false;
  });

  // ── actions ──────────────────────────────────────────────────────────────────

  const submit = (kind: number, moves: TurnMove[] = []) => {
    if (acting) return;
    actedSeqRef.current = view.seq;
    setActing(true);
    Sound.unlock();
    Promise.resolve(
      hostApi.submitAction({ lobbyId: lobby.lobbyId, actionData: encodeAction(kind, moves) }),
    ).catch(() => setActing(false));
  };

  const stage = (m: TurnMove) => {
    const working = playTurn(boardOf(view), view.current, pending).board;
    const dest = moveDest(view.current, m.from, m.die);
    if (dest === OFF) {
      Sound.play("bearoff");
    } else if (countAt(working, dest, other(view.current)) === 1) {
      Sound.play("hit", 1.1);
      setLocalHit(Date.now());
    }
    setPending([...pending, m]);
    setSelected(null);
    // hop it, exactly like an opponent's move: hold the board at the pre-move
    // position and hand the checker to the animator for its own journey.
    if (flyTimer.current) clearTimeout(flyTimer.current);
    setLocalFly(m);
    flyTimer.current = setTimeout(() => setLocalFly(null), moveDuration(m));
  };

  const onPick = (place: number) => {
    if (!inMove) return;
    if (selected === place) {
      setSelected(null);
      return;
    }
    const opts = armedSteps.filter((s) => s.from === place);
    if (opts.length === 0) return;
    if (opts.length === 1) {
      stage(opts[0]);
      return;
    }
    Sound.play("lift");
    setSelected(place);
  };

  const onDrop = (dest: number, dieValue: number) => {
    if (!inMove || selected === null) return;
    if (dest === OFF || dest >= 0) stage({ from: selected, die: dieValue });
  };

  const undo = () => {
    if (pending.length === 0) return;
    Sound.play("lift");
    autoRef.current = view.seq; // don't immediately re-stage the forced turn we just took apart
    if (flyTimer.current) clearTimeout(flyTimer.current);
    setLocalFly(null);
    setPending(pending.slice(0, -1));
    setSelected(null);
  };

  const confirmMove = () => {
    if (!turnComplete) return;
    myMoveSeqRef.current = view.seq + 1;
    Sound.play("click");
    submit(MOVE, pending);
    setSelected(null);
    // `pending` deliberately stays on screen until the authoritative state lands (the [vSeq] effect
    // clears it). Clearing it here would rewind the board to before the move for however long the
    // transaction takes — seconds, on-chain — and a rejected submission would silently lose the turn
    // the player had already worked out.
  };

  // ── HUD numbers ──────────────────────────────────────────────────────────────

  // Dice still owed by the staged turn. Drives the CTA label, which must NOT flip back to a "play N"
  // prompt while a confirmed turn is in flight (the button is disabled then, but the words would lie).
  const diceLeft = Math.max(0, (view.dice[0] === view.dice[1] ? 4 : 2) - pending.length);
  const pips = [pipCount(board, 0), pipCount(board, 1)];
  const read = Math.round(winProbability(board, yourSeat, view.current === yourSeat) * 100);
  const remaining = Math.max(0, deadline - nowSec);
  const over = view.over;
  const winner = view.winner;

  // The board says exactly one thing out loud, and only when the rules have taken the turn away from
  // somebody. Everything else is on the cards or in the console.
  const hint =
    ev?.kind === EV_DANCE
      ? `${names[ev.player]} danced — no way in`
      : inMove && steps.length === 0 && pending.length === 0
        ? "No legal move"
        : null;

  const potNum = Number(formatUnits(BigInt(lobby.pot ?? "0"), decimals));
  const stakeNum = Number(formatUnits(BigInt(lobby.buyIn ?? "0"), decimals));
  const nextCube = Math.min(MAX_CUBE, view.cube * 2);
  const cubeAllowed = canDouble(view, yourSeat);

  /** What a seat is doing right now, in the card's status line. */
  const statusOf = (seat: number): string => {
    if (over) return seat === winner ? "Match won" : "Match lost";
    if (seat !== view.current) return "Waiting";
    if (view.phase === PHASE_CUBE) return "Deciding";
    if (view.phase === PHASE_GAME_OVER) return "Game over";
    return view.phase === PHASE_ROLL ? "On roll" : "Moving";
  };

  // A throw worth announcing, and a checker actually leaving the board. Both are
  // read off the animator's current event so a callout lands on the same frame
  // the board shows it, rather than a tick later.
  const bornOff = !!flight && flight.to === OFF;

  // One beat at a time, picked by loudness. Computed rather than written inline so it
  // carries an ID — which is what lets a click dismiss THIS one without silencing the
  // next, and what makes the pop-in replay when the message changes.
  type Beat = {
    id: string;
    tone: "hot" | "good" | "plain";
    word: string;
    big?: string;
    note?: string;
  };
  const beat: Beat | null =
    flight?.hit || localHit > 0
      ? { id: `hit:${localHit || vSeq}`, tone: "hot", word: "Hit!" }
      : ev?.kind === EV_DANCE
        ? { id: `dance:${ev.seq}`, tone: "hot", word: "No way in" }
        : ev?.kind === EV_DOUBLE
          ? { id: `dbl:${ev.seq}`, tone: "hot", big: `×${ev.cube}`, word: "Doubled" }
          : ev?.kind === EV_TAKE
            ? { id: `take:${ev.seq}`, tone: "good", word: "Taken" }
            : ev?.kind === EV_PASS || ev?.kind === EV_RESIGN
              ? { id: `drop:${ev!.seq}`, tone: "hot", word: "Dropped" }
              : bornOff
                ? { id: `off:${vSeq}:${board.off[yourSeat]}`, tone: "good",
                    big: String(board.off[yourSeat]), word: "Borne off" }
                : forced
                  ? { id: `forced:${forced}`, tone: "plain", word: "Played for you",
                      note: "Only one legal way to use the dice." }
                  : myTurn
                    ? { id: `turn:${myTurn}`, tone: "good", word: "Your turn!" }
                    : null;

  /** The one action, and what it says. Exactly one primary on screen at a time. */
  const cta = !yourTurn || over
    ? null
    : view.phase === PHASE_ROLL
      ? { label: "Roll", on: () => { Sound.play("click"); submit(ROLL); }, ready: inRoll }
      : view.phase === PHASE_MOVE
        ? {
            label: diceLeft > 0 ? `${diceLeft} left` : "Confirm",
            on: confirmMove,
            ready: turnComplete,
          }
        : null;

  return (
    <div className="neo">
      {(flight?.hit || localHit > 0) && <div className="neo-hitflash" />}
      <img className="neo-bg" src="/assets/neo/backdrop.png" alt="" />
      <div className="neo-speed" />

      {[0, 1].map((seat) => {
        const isYours = seat === yourSeat;
        return (
          <PlayerCard
            key={seat}
            side={isYours ? "you" : "foe"}
            name={names[seat]}
            active={seat === view.current && !over}
            status={statusOf(seat)}
            pips={pips[seat]}
            borneOff={board.off[seat]}
            score={view.score[seat]}
            matchTo={view.matchTo}
            secondsLeft={seat === view.current && !over ? remaining : null}
            holdsCube={view.cubeOwner === seat}
            cube={view.cube}
          />
        );
      })}

      {/* pot · board · dice and the one action, stacked as a single unit so the
          pot never shifts with the length of a player's name */}
      <div className="neo-slot">
        <div className="neo-pot">
          {view.cube > 1 && (
            <div className="cubetag">
              Game is worth <b className="num">{view.cube}</b>
            </div>
          )}
          <div className="plaque">
            <div className="plaqueIn">
              <span className="plbl">Pot</span>
              <b className="pot num">
                {fmt(potNum)} <i>◆</i>
              </b>
              <span className="psub">
                Stake each <b className="num">{fmt(stakeNum)} ◆</b>
              </span>
            </div>
          </div>
        </div>

        <Board
          points={board.points}
          bar={board.bar}
          off={board.off}
          flip={flip}
          yourSeat={yourSeat}
          cube={view.cube}
          cubeOwner={view.cubeOwner}
          cubeOn={view.cubeOn}
          cubePending={cubePending}
          dice={diceShown}
          diceOwner={diceOwner}
          diceUsed={diceUsed}
          rollKey={rollKey}
          pickable={pickable}
          selected={selected}
          targets={targets}
          preview={preview}
          onHover={setHover}
          flight={flight}
          hint={hint}
          onPick={onPick}
          onDrop={onDrop}
        />

        <div className="neo-dock">
          <MoveMagazine
            tokens={diceTokens}
            used={diceUsed}
            armed={armed}
            onArm={
              inMove
                ? (v) => {
                    setArmedDie(v);
                    setSelected(null);
                  }
                : null
            }
          />

          {/* exactly one primary action, and it is the drawn key */}
          {cta && (
            <button className="neo-go" disabled={!cta.ready} onClick={cta.on}>
              <span>{cta.label}</span>
            </button>
          )}
          {inGameOver && (
            <button className="neo-go" onClick={() => submit(NEXT)}>
              <span>Next</span>
            </button>
          )}
          {inMove && pending.length > 0 && (
            <button className="neo-tok live" title="Take the last step back" onClick={undo}>
              ↺
            </button>
          )}
        </div>
      </div>

      {/* ── the beats ──────────────────────────────────────────────────────────
          Ordered by loudness, and only ever ONE at a time. The ROLL is not in here
          any more: the dice rattle and settle on the board itself, which is where
          the player is already looking. What is left are the things you can MISS.

          Each one is keyed by its own id, so React remounts on a change of beat and
          the pop-in animation actually replays instead of the new text appearing
          inside the old, already-finished plaque. */}
      {beat && beatSkip !== beat.id && (
        <Callout
          key={beat.id}
          tone={beat.tone}
          big={beat.big}
          word={beat.word}
          note={beat.note}
          onSkip={() => {
            setBeatSkip(beat.id);
            setMyTurn(0);
            setForced(0);
          }}
        />
      )}

      {/* the scoreline between games */}
      {view.phase === PHASE_GAME_OVER && view.lastResult && (
        <GameResult
          names={names}
          winner={view.lastResult.winner}
          points={view.lastResult.points}
          flavor={view.lastResult.flavor}
          cube={view.lastResult.cube}
          score={view.score}
          matchTo={view.matchTo}
          pot={potNum}
          onNext={inGameOver ? () => submit(NEXT) : undefined}
          onResign={() => setConfirmLeave(true)}
        />
      )}

      {/* the cube decision — the one moment that stops everything else */}
      {inCube && (
        <div className="neo-veil">
          <div className="neo-sheet card">
            <div className="neo-eyebrow">
              {view.matchTo > 1 ? `Match to ${view.matchTo}` : "Single game"} · Score{" "}
              {view.score[0]} : {view.score[1]}
            </div>
            <div className="neo-title">
              {names[other(view.current)]} doubles<em>.</em>
            </div>
            <p className="neo-note">
              Take it and this game is worth <b>{nextCube} points</b> instead of {view.cube} — with a
              gammon <b className="num">{nextCube * 2}</b>, with a backgammon{" "}
              <b className="num">{nextCube * 3}</b>. After that <b>you own the cube</b>, and only you
              may double next.
              <br />
              Drop it and the game ends now — <b>{names[other(view.current)]} scores {view.cube}</b>.
              <br />
              <b>The pot does not move</b> — it settles to whoever takes the match.
              <br />
              Your read: <b className="num">{read}%</b> — taking is right from about 25% up.
            </p>
            <div className="neo-row">
              <button
                className="neo-btn alt"
                onClick={() => {
                  Sound.play("click");
                  submit(PASS);
                }}
              >
                <span>Drop · −{view.cube}</span>
              </button>
              <button
                className="neo-btn"
                onClick={() => {
                  Sound.play("click");
                  submit(TAKE);
                }}
              >
                <span>Take · worth {nextCube}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="neo-brand">
        NEO <em>GAMMON</em>
      </div>

      <div className="neo-tools">
        {inRoll && (
          <button
            disabled={!cubeAllowed}
            title={
              cubeAllowed
                ? "Only before your own roll. If they take, the cube becomes theirs."
                : view.cube >= MAX_CUBE
                  ? "The cube is on 64 — it goes no higher."
                  : `${names[other(yourSeat)]} owns the cube.`
            }
            onClick={() => {
              Sound.play("click");
              submit(DOUBLE);
            }}
          >
            Double ×{nextCube}
          </button>
        )}
        {seated && !over && canResign(view, yourSeat) && (
          <button
            onClick={() => {
              Sound.play("click");
              setConfirmResign(true);
            }}
          >
            Resign
          </button>
        )}
        <span className="snd-anchor">
          <button
            className={muted ? "off" : undefined}
            onClick={() => {
              Sound.play("click");
              setSoundOpen((o) => !o);
            }}
          >
            {muted ? "Muted" : "Sound"}
          </button>
          {soundOpen && <SoundPanel onClose={() => setSoundOpen(false)} />}
        </span>
        <button
          onClick={() => {
            Sound.play("click");
            setRulesOpen(true);
          }}
        >
          Rules
        </button>
      </div>

      {introOpen && (
        <IntroSheet
          cubeOn={view.cubeOn}
          matchTo={view.matchTo}
          onClose={() => {
            setIntroOpen(false);
            try {
              localStorage.setItem(INTRO_KEY, "1");
            } catch {
              /* private mode — it will simply open again next time */
            }
          }}
        />
      )}
      {rulesOpen && <RulesSheet onClose={() => setRulesOpen(false)} />}

      {confirmResign && (
        <ConfirmCard
          title="Resign this game?"
          body={`Your opponent scores ${view.cube} point${view.cube === 1 ? "" : "s"} and a fresh board is dealt. The match carries on.`}
          confirmLabel={`Resign · −${view.cube}`}
          onCancel={() => setConfirmResign(false)}
          onConfirm={() => {
            setConfirmResign(false);
            Sound.play("pass");
            submit(RESIGN);
          }}
        />
      )}

      {confirmLeave && (
        <ConfirmCard
          title="Forfeit the match?"
          body={`Leave now and the match is over. You lose your stake of ${fmt(stakeNum)} ◆ to ${names[other(yourSeat)]}. This cannot be undone.`}
          confirmLabel={`Forfeit · lose ${fmt(stakeNum)} ◆`}
          onCancel={() => setConfirmLeave(false)}
          onConfirm={() => {
            Sound.play("defeat");
            void hostApi.cancelLobby({ lobbyId: lobby.lobbyId });
          }}
        />
      )}

    </div>
  );
}

/**
 * A game beat, contained over the table.
 *
 * Deliberately NOT a full-screen flash: a blowout hides the board at exactly the
 * instant you want to see what just happened to it. This punches in over the
 * table, reads in a glance and gets out, and the position stays visible under it
 * the whole time.
 */
function Callout({
  tone = "hot",
  big,
  word,
  note,
  onSkip,
}: {
  tone?: "hot" | "good" | "plain";
  big?: string;
  word: string;
  /** One line of WHY, for the beats a new player cannot infer from the board. */
  note?: string;
  onSkip?: () => void;
}) {
  return (
    <>
      {/* The whole table is the dismiss target, not just the plaque: while a message
          is up nothing else is clickable anyway, so aiming at a small badge would be
          a needless precision test. */}
      {onSkip && <div className="neo-beatcatch" onClick={onSkip} />}
      <div className={`neo-callout ${tone}`} onClick={onSkip} role={onSkip ? "button" : undefined}>
      <span className="slab" aria-hidden />
      <span className="plate" aria-hidden />
      <span className="speed" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <span className="body">
        {big && <b className="big">{big}</b>}
        <span className="word">{word}</span>
        {note && <span className="note">{note}</span>}
        </span>
      </div>
    </>
  );
}

/**
 * The scoreline between games.
 *
 * The pot deliberately does not move here — a game is worth POINTS, and the money only changes hands
 * when the match itself is decided. Saying so out loud on every single scoreline is the one thing
 * that keeps the doubling cube from reading as "he just doubled my buy-in".
 */
function GameResult({
  names,
  winner,
  points,
  flavor,
  cube,
  score,
  matchTo,
  pot,
  onNext,
  onResign,
}: {
  names: string[];
  winner: number;
  points: number;
  flavor: number;
  cube: number;
  score: number[];
  matchTo: number;
  pot: number;
  onNext?: () => void;
  onResign: () => void;
}) {
  const short = matchTo - Math.max(score[0], score[1]);
  const leader = score[0] >= score[1] ? 0 : 1;
  return (
    <div className="neo-veil">
      <div className="neo-sheet card gut">
        <div className="neo-eyebrow">
          {matchTo > 1 ? `Match to ${matchTo}` : "Single game"} · game over
        </div>
        <div className="neo-title">
          Game to {names[winner]}<em>.</em>
        </div>

        <div className="neo-score" aria-label={`${names[0]} ${score[0]}, ${names[1]} ${score[1]}`}>
          <div className="side">
            <b className="num">{score[0]}</b>
            <span>{names[0]}</span>
          </div>
          <i>:</i>
          <div className="side">
            <b className="num">{score[1]}</b>
            <span>{names[1]}</span>
          </div>
        </div>

        <div className="neo-badges">
          <span className="neo-badge">
            {flavor === 0 ? "Conceded" : FLAVOR_WORD[flavor]} · +{points}
            {flavor >= 2 && ` (cube ${cube} × ${flavor === 3 ? 3 : 2})`}
          </span>
        </div>

        <p className="neo-note">
          The pot does not move — <b className="num">{fmt(pot)} ◆</b> settles to whoever takes the
          match.
          <br />
          {names[leader]} {short === 1 ? "needs" : "needs"} <b className="num">{short}</b> more{" "}
          {short === 1 ? "point" : "points"}.
        </p>

        <div className="neo-row">
          <button className="neo-btn alt" onClick={onResign}>
            <span>Resign match</span>
          </button>
          {onNext && (
            <button className="neo-btn" onClick={onNext}>
              <span>Next game</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfirmCard({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="neo-veil" onClick={onCancel}>
      <div className="neo-sheet card" onClick={(e) => e.stopPropagation()}>
        <div className="neo-eyebrow">Confirm</div>
        <div className="neo-title">
          {title.replace(/\?$/, "")}
          <em>?</em>
        </div>
        <p className="neo-note">{body}</p>
        <div className="neo-row">
          {/* Two ways out, and the quiet one is the safe one. */}
          <button className="neo-btn danger" onClick={onConfirm}>
            <span>{confirmLabel}</span>
          </button>
          <button
            className="neo-btn"
            onClick={() => {
              Sound.play("click");
              onCancel();
            }}
          >
            <span>Back to the game</span>
          </button>
        </div>
      </div>
    </div>
  );
}
