// The board.
//
// One drawn plate with a single absolutely-positioned layer over it, addressed
// entirely in percentages of the picture — so the whole thing scales with the
// art and there is nothing to keep in sync at any size.
//
// Everything on the layer is built the same way, and it is the construction
// rule rather than the palette that makes it read as cel-shaded: a flat fill, a
// thick ink outline, exactly one hard highlight, one flat shadow. No gradients,
// no blur, no glow — the moment one element cheats with a gradient the screen
// falls back to looking like a dark UI with anime colours on it.

import { useEffect, useRef, useState } from "react";
import { BAR, CHECKERS, NUM_POINTS, OFF, dirOf } from "@engine";
import {
  BOARD_SRC,
  GEOM,
  PIPS,
  barX,
  barY,
  checkerY,
  chipW,
  colX,
  diceAnchor,
  isTopPoint,
  markNo,
  TRAY_SRC,
} from "./neoGeom";
import { HOP_MS } from "../game/pacing";
import { Sound } from "../sound/sounds";
import { MARK_H, MARK_W, markHatch, markPath } from "./neomarks";

/** A checker (and, on a hit, its victim) travelling between two places. */
export interface Flight {
  from: number; // 0..23 or BAR
  to: number; // 0..23 or OFF
  seat: number;
  hit: boolean;
}

export interface BoardProps {
  points: number[];
  bar: number[];
  off: number[];
  /** Render from seat 1's side, so the local player's home is always bottom-right. */
  flip: boolean;
  yourSeat: number;
  cube: number;
  cubeOwner: number;
  /** Table rule. With doubling off there is no cube in the game, so drawing one in
   *  the middle of the board is just an unexplained object — it read as leftover
   *  furniture, which is exactly what it was. */
  cubeOn: boolean;
  cubePending: number | null;

  dice: number[] | null;
  diceOwner: number;
  diceUsed: boolean[];
  rollKey: number | null;

  /** Points (and BAR) holding a checker this player can lift right now. */
  pickable: Set<number>;
  selected: number | null;
  /** Landing spot (0..23 or OFF) → the die that gets you there. */
  targets: Map<number, number>;
  preview: Map<number, number>;
  onHover: (place: number | null) => void;

  flight: Flight | null;
  hint: string | null;
  onPick: (place: number) => void;
  onDrop: (dest: number, die: number) => void;
}

const ownerOf = (v: number): number => (v > 0 ? 0 : 1);

const pips = (v: number) =>
  (PIPS[v] ?? PIPS[1]).map(([x, y], i) => <i key={i} style={{ left: `${x}%`, top: `${y}%` }} />);

export function Board(props: BoardProps) {
  const {
    points, bar, off, flip, yourSeat, cube, cubeOwner, cubeOn, cubePending,
    dice, diceOwner, diceUsed, rollKey,
    pickable, selected, targets, preview, onHover, flight, hint, onPick, onDrop,
  } = props;

  const bottomSeat = flip ? 1 : 0;
  const cw = chipW;
  const no = (i: number) => markNo(i, flip);

  // Take the flying checkers out of the static board so nothing is drawn twice.
  const disp = [...points];
  const dbar = [...bar];
  const doff = [...off];
  const victimSeat = flight ? flight.seat ^ 1 : 0;
  let moverFrom = { x: 50, y: 50 };
  let moverTo = { x: 50, y: 50 };
  let victimFrom = { x: 50, y: 50 };
  let victimTo = { x: 50, y: 50 };

  const anchorOf = (place: number, seat: number, idx: number, count: number) => {
    if (place === BAR) return { x: barX, y: barY(seat === bottomSeat, idx) };
    // a checker on its way off flies to the mouth of its own well
    if (place === OFF) return { x: 99, y: seat === bottomSeat ? 88 : 12 };
    if (place < 0 || place >= NUM_POINTS) return { x: 50, y: 50 };
    const n = no(place);
    return { x: colX(n), y: checkerY(n, idx, count) };
  };

  if (flight) {
    const sign = flight.seat === 0 ? 1 : -1;
    const fromCount = flight.from === BAR ? dbar[flight.seat] : Math.abs(disp[flight.from]);
    moverFrom = anchorOf(flight.from, flight.seat, Math.max(0, fromCount - 1), fromCount);
    if (flight.from === BAR) dbar[flight.seat] = Math.max(0, dbar[flight.seat] - 1);
    else disp[flight.from] -= sign;

    if (flight.hit && flight.to !== OFF) {
      victimFrom = anchorOf(flight.to, victimSeat, 0, 1);
      victimTo = anchorOf(BAR, victimSeat, dbar[victimSeat], dbar[victimSeat] + 1);
      disp[flight.to] = 0;
      dbar[victimSeat] += 1;
    }
    if (flight.to === OFF) {
      moverTo = anchorOf(OFF, flight.seat, doff[flight.seat], doff[flight.seat] + 1);
    } else {
      const landed = Math.abs(disp[flight.to]);
      const same = disp[flight.to] === 0 || ownerOf(disp[flight.to]) === flight.seat;
      const idx = same ? landed : 0;
      moverTo = anchorOf(flight.to, flight.seat, idx, idx + 1);
    }
  }

  /**
   * The stations a checker touches on its way, one per pip. Counting out the pips
   * is how the game is actually played at a table, so the move is animated the
   * same way — a hand lifting and setting the checker down on each point it
   * counts — instead of gliding straight to the answer.
   *
   * Intermediate points are only ever touched, never landed on, so it does not
   * matter that some of them are occupied or closed.
   */
  const hopPath = (f: Flight): Array<{ x: number; y: number }> => {
    const out: Array<{ x: number; y: number }> = [];
    const dir = dirOf(f.seat);
    const start = f.from === BAR ? (f.seat === 0 ? NUM_POINTS : -1) : f.from;
    for (let i = start + dir; i !== f.to && i >= 0 && i < NUM_POINTS; i += dir) {
      const n = no(i);
      out.push({ x: colX(n), y: checkerY(n, 0, 1) });
    }
    return out;
  };

  const offTarget = targets.get(OFF);
  const cubeSide = cubeOwner < 0 ? "none" : cubeOwner === bottomSeat ? "you" : "foe";

  return (
    <div className="neo-boardrow">
    <div className="nb" style={{ ["--ar" as string]: GEOM.aspect }}>
      <img className="nb-art" src={BOARD_SRC} alt="Backgammon board" draggable={false} />
      <div className="nb-layer">
        {/* Landing marks: the measured silhouette of the point, filled with the violet hatch from
            the handover (§9). Violet because magenta and lime already belong to the board. A
            preview (hover) is drawn at half strength, a live target at full. */}
        <svg className="nb-marks" viewBox={`0 0 ${MARK_W} ${MARK_H}`} aria-hidden>
          <defs>
            {[...targets.keys(), ...preview.keys()].map((d) => {
              if (d === OFF) return null;
              const h = markHatch(no(d));
              if (!h) return null;
              return (
                <pattern
                  key={`hp${d}`}
                  id={`neoS${no(d)}`}
                  width="133"
                  height="133"
                  patternUnits="userSpaceOnUse"
                  patternTransform={`translate(${h.x.toFixed(1)} ${h.y.toFixed(1)}) rotate(${h.angle}) translate(0 -14)`}
                >
                  <rect x="0" y="0" width="133" height="100" fill="#8A5CFF" />
                  <rect x="0" y="0" width="133" height="14" fill="#FBFBF3" />
                  <rect x="0" y="86" width="133" height="14" fill="#FBFBF3" />
                </pattern>
              );
            })}
          </defs>
          {[...preview.keys()].map((d) => {
            if (d === OFF || targets.has(d)) return null;
            const p = markPath(no(d));
            return p ? <path key={`pm${d}`} d={p} fill={`url(#neoS${no(d)})`} opacity={0.45} /> : null;
          })}
          {[...targets.keys()].map((d) => {
            if (d === OFF) return null;
            const p = markPath(no(d));
            return p ? <path key={`tm${d}`} d={p} fill={`url(#neoS${no(d)})`} /> : null;
          })}
        </svg>

        {/* hit areas: the full half-height of a column, so the top of a tall stack
            stays clickable and a landing spot can be hit anywhere along it */}
        {Array.from({ length: NUM_POINTS }, (_, i) => {
          const n = no(i);
          const isTarget = targets.has(i);
          const isPick = pickable.has(i);
          if (!isTarget && !isPick) return null;
          return (
            <div
              key={`h${i}`}
              className="nb-hit"
              style={{
                left: `${colX(n)}%`,
                width: `${cw * 1.3}%`,
                height: "42%",
                ...(isTopPoint(n) ? { top: 0 } : { bottom: 0 }),
              }}
              onMouseEnter={() => onHover(isPick ? i : null)}
              onMouseLeave={() => onHover(null)}
              onClick={() => {
                if (isTarget) onDrop(i, targets.get(i)!);
                else if (isPick) onPick(i);
              }}
            />
          );
        })}

        {/* checkers on the points */}
        {Array.from({ length: NUM_POINTS }, (_, i) => {
          const v = disp[i];
          if (v === 0) return null;
          const seat = ownerOf(v);
          const count = Math.abs(v);
          const shown = count;
          const n = no(i);
          const canLift = pickable.has(i) && !flight && seat === yourSeat;
          return Array.from({ length: shown }, (_, k) => {
            const a = anchorOf(i, seat, k, count);
            const top = k === shown - 1;
            const state = canLift && top ? (selected === i ? " sel" : " can") : "";
            return (
              <span
                key={`c${i}-${k}`}
                className={`nb-chk ${seat === 0 ? "w" : "b"}${state}`}
                style={{
                  left: `${a.x}%`,
                  top: `${a.y}%`,
                  width: `${cw}%`,
                  zIndex: 10 + (isTopPoint(n) ? k : shown - k),
                }}
              />
            );
          });
        })}

        {/* the bar */}
        {[0, 1].map((seat) => {
          const n = Math.min(dbar[seat], 5);
          return Array.from({ length: n }, (_, k) => {
            const top = k === n - 1;
            const state =
              pickable.has(BAR) && seat === yourSeat && top ? (selected === BAR ? " sel" : " can") : "";
            return (
              <span
                key={`b${seat}-${k}`}
                className={`nb-chk ${seat === 0 ? "w" : "b"}${state}`}
                style={{
                  left: `${barX}%`,
                  top: `${barY(seat === bottomSeat, k)}%`,
                  width: `${cw}%`,
                  zIndex: 40 + k,
                  cursor: state ? "pointer" : undefined,
                  pointerEvents: state ? "auto" : "none",
                }}
                onClick={() => state && onPick(BAR)}
              />
            );
          });
        })}

        {offTarget !== undefined && (
          <div
            className="nb-offzone"
            style={{ top: bottomSeat === yourSeat ? "62%" : "4%" }}
            onClick={() => onDrop(OFF, offTarget)}
          />
        )}

        {/* the doubling cube, parked on its owner's side of the bar — only when the
            table is actually playing with one */}
        {cubeOn && (
        <span
          className={`nb-cube own-${cubeSide}${cubePending !== null ? " pending" : ""}`}
          style={{ left: `${barX}%`, top: cubeSide === "foe" ? "12%" : "88%", width: `${cw * 1.1}%` }}
        >
          {cubePending ?? (cube <= 1 ? 64 : cube)}
        </span>
        )}

        {/* The throw. While `rolling` the two dice shake where they lie and their
            faces flicker; the result is read off the board itself, which is where a
            player is already looking. */}
        {dice &&
          dice[0] > 0 &&
          dice.slice(0, 2).map((v, k) => {
            const a = diceAnchor(k);
            return (
              <Tumbler
                key={`d${k}-${diceOwner}`}
                value={v}
                spent={diceUsed[k]}
                rollKey={rollKey}
                delay={k * 90}
                x={a.x}
                y={a.y}
                width={cw * 1.05}
                tilt={k ? 12 : -9}
              />
            );
          })}

        {/* checkers in flight — see Hop below */}
        {flight && flight.hit && flight.to !== OFF && (
          <Hop
            className={`nb-chk ${victimSeat === 0 ? "w" : "b"} flying`}
            width={cw}
            from={victimFrom}
            to={victimTo}
            /* a checker that has just been knocked off takes one long arc to the
               bar, not a counted walk — it is being thrown, not moved */
            stations={[]}
          />
        )}
        {flight && (
          <Hop
            className={`nb-chk ${flight.seat === 0 ? "w" : "b"} flying`}
            width={cw}
            from={moverFrom}
            to={moverTo}
            stations={hopPath(flight)}
          />
        )}

        {hint && <div className="nb-hint">{hint}</div>}
      </div>
    </div>

      {/* The collecting tray. Both players bear off to the RIGHT — the opponent into the upper well,
          you into the lower one. A checker that has left the board is only ever seen edge-on, and
          from the side a checker IS its coloured rim: pink for the light set, blue for the dark.
          They stack from the floor of the well and close up automatically so all fifteen fit. */}
      <div className="neo-fach">
        <img className="neo-schale" src={TRAY_SRC} alt="" draggable={false} />
        {[0, 1].map((seat) => {
          const onBottom = seat === bottomSeat;
          const n = Math.min(doff[seat], CHECKERS);
          // one slab is 1/15th of the usable depth; below that they overlap rather than overflow
          const kh = 94 / 15;
          const step = Math.min(kh * 0.96, (100 - kh * 1.12) / Math.max(n - 1, 1));
          return (
            <div
              key={`mulde${seat}`}
              className={`neo-mulde ${onBottom ? "unten" : "oben"}${
                offTarget !== undefined && seat === yourSeat ? " ziel" : ""
              }`}
              onClick={() => {
                if (offTarget !== undefined && seat === yourSeat) onDrop(OFF, offTarget);
              }}
            >
              {Array.from({ length: n }, (_, k) => (
                <span
                  key={k}
                  className={`neo-kante ${seat === 0 ? "w" : "b"}`}
                  style={{
                    height: `${kh}%`,
                    bottom: `${3 + k * step}%`,
                    // stacked by hand, not by machine — a small repeating tilt reads as real chips
                    transform: `translateX(-50%) rotate(${(((k * 37) % 5) - 2) * 0.9}deg)`,
                    zIndex: k + 1,
                  }}
                />
              ))}
            </div>
          );
        })}
        <span className="neo-fachtext o">{flip ? "YOU" : "THEM"}</span>
        <span className="neo-fachtext u">{flip ? "THEM" : "YOU"}</span>
      </div>
    </div>
  );
}

/**
 * A checker travelling, animated as a series of hops.
 *
 * Driven by the Web Animations API rather than CSS, because the number of
 * waypoints depends on the die — a keyframe set that changes shape per move
 * cannot be written as a static rule. Each pip gets a lift and a landing, so the
 * arc reads as picked up and set down rather than dragged.
 */
function Hop({
  className,
  width,
  from,
  to,
  stations,
}: {
  className: string;
  width: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  stations: Array<{ x: number; y: number }>;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stops = [from, ...stations, to];
    const segs = stops.length - 1;
    const seg = 1 / segs;
    const frames: Keyframe[] = [];

    // One hop per pip: a beat standing on the point, a quick lift, a quick drop.
    // The first cut interpolated straight through the midpoints at a constant
    // rate, which is a glide with a bulge in it — the checker never appeared to
    // touch anything. What makes it read as HOPPING is the rest at each station
    // and the easing flipping at the top of every arc.
    for (let i = 0; i < segs; i++) {
      const base = i * seg;
      const a = stops[i];
      const b = stops[i + 1];
      const flat = "translate(-50%, -50%)";
      // stand on the point
      frames.push({ offset: base, left: `${a.x}%`, top: `${a.y}%`, transform: flat, easing: "linear" });
      frames.push({
        offset: base + seg * 0.24,
        left: `${a.x}%`,
        top: `${a.y}%`,
        transform: flat,
        easing: "ease-out",
      });
      // top of the arc, halfway across and lifted off the board
      frames.push({
        offset: base + seg * 0.62,
        left: `${(a.x + b.x) / 2}%`,
        top: `${(a.y + b.y) / 2}%`,
        transform: `${flat} translateY(-52%) scale(1.08)`,
        easing: "ease-in",
      });
    }
    frames.push({
      offset: 1,
      left: `${to.x}%`,
      top: `${to.y}%`,
      transform: "translate(-50%, -50%)",
    });

    const anim = el.animate(frames, {
      // one hop's worth of time per hop, so a six is not six times faster than a one
      duration: Math.max(1, segs) * HOP_MS,
      easing: "linear",
      fill: "forwards",
    });

    // One plop per point entered — fired on the LANDING of each arc, not the lift-off,
    // because that is the frame the eye reads as contact. A six therefore ticks six
    // times as it counts itself out, which is what makes the count audible.
    const beats: Array<ReturnType<typeof setTimeout>> = [];
    for (let i = 0; i < segs; i++) {
      beats.push(setTimeout(() => Sound.play("hop"), (i + 1) * HOP_MS));
    }

    return () => {
      anim.cancel();
      beats.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from.x, from.y, to.x, to.y, stations.length]);

  return (
    <span
      ref={ref}
      className={className}
      style={{ left: `${from.x}%`, top: `${from.y}%`, width: `${width}%` }}
    />
  );
}

/** How long the faces flicker before they settle. */
const TUMBLE_MS = 720;

/**
 * One die, thrown.
 *
 * The faces cycle on a timer rather than through CSS, because what makes a throw
 * feel thrown is that you cannot read it while it is happening — a shuffle of real
 * values, decelerating, landing on the one the chain actually rolled. The shake is
 * CSS on the same element, so the two run together without either owning the other.
 *
 * `delay` staggers the second die: two dice that stop on the same frame read as one
 * object with two halves.
 */
function Tumbler({
  value,
  spent,
  rollKey,
  delay,
  x,
  y,
  width,
  tilt,
}: {
  value: number;
  spent: boolean;
  rollKey: number | null;
  delay: number;
  x: number;
  y: number;
  width: number;
  tilt: number;
}) {
  const [face, setFace] = useState(value);
  const [rolling, setRolling] = useState(false);

  useEffect(() => {
    if (rollKey === null) {
      setRolling(false);
      setFace(value);
      return;
    }
    setRolling(true);
    let n = 0;
    // the flicker slows as it goes, the way a die loses its spin
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      n += 1;
      // Step 5, not 3: 3 shares a factor with 6, so it only ever reached two of the
      // six faces and the die read as flipping between 1 and 4. 5 is coprime with 6
      // and walks all six. `delay` offsets the second die so the pair never flickers
      // in lockstep — two dice showing the same number every frame looks like one die
      // drawn twice, not a throw.
      setFace(((n * 5 + (delay > 0 ? 2 : 0)) % 6) + 1);
      const t = 45 + n * 6;
      timer = setTimeout(tick, t);
    };
    timer = setTimeout(tick, 40);
    const stop = setTimeout(() => {
      clearTimeout(timer);
      setRolling(false);
      setFace(value);
      Sound.play("land", 0.9);
    }, TUMBLE_MS + delay);
    return () => {
      clearTimeout(timer);
      clearTimeout(stop);
    };
  }, [rollKey, value, delay]);

  return (
    <span
      className={`nb-die${spent && !rolling ? " spent" : ""}${rolling ? " rolling" : ""}`}
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: `${width}%`,
        ["--r" as string]: `${tilt}deg`,
        ["--rdelay" as string]: `${delay}ms`,
      }}
    >
      {pips(rolling ? face : value)}
    </span>
  );
}
