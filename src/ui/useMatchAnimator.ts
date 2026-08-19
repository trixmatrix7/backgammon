import { useEffect, useRef, useState } from "react";
import { EV_MOVE, type GameState, type LastEvent } from "@engine";
import { MOVE_TAIL_MS, eventDuration, moveDuration } from "../game/pacing";

/**
 * The host pushes a FULL new state after every action, but backgammon is only readable if you SEE it
 * happen — which checker left which point, what got hit, which die paid for it. So we hold a
 * "displayed" state that lags the authoritative one: each incoming state is queued, its `lastEvent`
 * is played out against the PREVIOUS board, and only then do the numbers commit.
 *
 * `step` walks a move sequence one checker at a time, so the caller can render the board with the
 * first `step` moves applied and fly the `step`-th checker across it. The MockHost paces its bot off
 * the same `eventDuration`, so the queue never backs up.
 */
export interface MatchAnim {
  ev: LastEvent | null;
  /** Index of the checker currently in flight (EV_MOVE only). */
  step: number;
}

const IDLE: MatchAnim = { ev: null, step: 0 };

export function useMatchAnimator(auth: GameState | null) {
  const [view, setView] = useState<GameState | null>(auth);
  const [anim, setAnim] = useState<MatchAnim>(IDLE);
  const viewRef = useRef<GameState | null>(auth);
  const queue = useRef<GameState[]>([]);
  const busy = useRef(false);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const later = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  };

  useEffect(() => () => clearTimers(), []);

  function commit(s: GameState) {
    viewRef.current = s;
    setView(s);
    setAnim(IDLE);
    busy.current = false;
    pump();
  }

  function pump() {
    if (busy.current) return;
    const next = queue.current.shift();
    if (!next) return;
    const cur = viewRef.current;
    if (!cur) {
      viewRef.current = next;
      setView(next);
      pump();
      return;
    }
    busy.current = true;
    const ev = next.lastEvent;

    if (!ev || ev.seq <= cur.seq) {
      commit(next);
      return;
    }

    if (ev.kind === EV_MOVE && ev.moves.length > 0) {
      setAnim({ ev, step: 0 });
      // Each checker gets as long as its own journey needs — a six counts out six
      // hops and takes six hops' worth of time, so the rhythm never changes.
      const n = ev.moves.length;
      let at = 0;
      for (let i = 0; i < n; i++) {
        if (i > 0) {
          const when = at;
          later(when, () => setAnim({ ev, step: i }));
        }
        at += moveDuration(ev.moves[i]);
      }
      later(at + MOVE_TAIL_MS, () => commit(next));
      return;
    }

    setAnim({ ev, step: 0 });
    later(eventDuration(ev.kind, ev.moves), () => commit(next));
  }

  useEffect(() => {
    if (!auth) {
      queue.current = [];
      busy.current = false;
      clearTimers();
      viewRef.current = null;
      setView(null);
      setAnim(IDLE);
      return;
    }
    if (viewRef.current === null) {
      viewRef.current = auth;
      setView(auth);
      return;
    }
    const lastSeq = queue.current.length
      ? queue.current[queue.current.length - 1].seq
      : viewRef.current.seq;
    if (auth.seq > lastSeq) {
      queue.current.push(auth);
      pump();
    } else if (auth.seq === viewRef.current.seq && queue.current.length === 0 && !busy.current) {
      // Same event index — refresh non-animated fields (a winner flip, a new deadline) in place.
      viewRef.current = auth;
      setView(auth);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  return { view, anim, animating: anim.ev !== null };
}
