// Audio for Neo Gammon.
//
// Plays REAL sounds out of your generator library — 444 of them across 17
// shelves, in /public/assets/audio/lib. Everything is decoded once into an
// AudioBuffer and played through one bus, so overlapping cues duck each other
// through a compressor instead of adding up into clipping, and per-cue volume is
// exact rather than whatever an <audio> element felt like doing.
//
// A cue resolves in this order:
//   1. The sound you ASSIGNED to it (survives reloads).
//   2. The default file for that cue.
// Your pick always wins. An earlier version let a file on disk override the
// dropdown, which meant changing the dropdown appeared to do nothing at all.

export type Cue =
  | "click" | "select" | "lift" | "place" | "roll" | "land" | "hit" | "hop"
  | "enter" | "bearoff" | "cube" | "take" | "pass" | "dance" | "turn"
  | "gamewin" | "gammon" | "victory" | "defeat";

export const CUES: Cue[] = [
  "click", "select", "turn", "lift", "place", "enter", "bearoff",
  "roll", "land", "hit", "dance", "cube", "take", "pass",
  "gamewin", "gammon", "victory", "defeat",
];

export const CUE_LABEL: Record<Cue, string> = {
  click: "Button", select: "Select", turn: "Your turn", lift: "Pick up", hop: "Hop",
  place: "Place checker", enter: "Re-enter", bearoff: "Bear off",
  roll: "Dice roll", land: "Dice land", hit: "Hit", dance: "No move",
  cube: "Cube", take: "Take", pass: "Drop",
  gamewin: "Game won", gammon: "Gammon", victory: "Match won", defeat: "Match lost",
};

/** Which shelves make sense for each cue, so the picker offers the right ones. */
export const SHELVES_FOR: Record<Cue, string[]> = {
  hop: ["holz-bambus", "tick-count", "pop-burst"],
  click: ["ui-click", "tick-count", "pop-burst"],
  select: ["ui-click", "pop-burst", "glas-kristall"],
  turn: ["ui-click", "glas-kristall", "tick-count"],
  lift: ["ui-click", "tick-count", "holz-bambus"],
  place: ["holz-bambus", "tick-count", "pop-burst", "metall-muenzen"],
  enter: ["pop-burst", "holz-bambus", "glas-kristall"],
  bearoff: ["coin-chime", "glas-kristall", "metall-muenzen"],
  roll: ["dice", "tumble-drop", "holz-bambus", "metall-muenzen"],
  land: ["dice", "holz-bambus", "metall-muenzen", "tumble-drop"],
  hit: ["stinger-impact", "abschluss-terminator", "metall-muenzen"],
  dance: ["stinger-impact", "retro-arcade", "whoosh-riser"],
  cube: ["metall-muenzen", "stinger-impact", "abschluss-terminator"],
  take: ["glas-kristall", "coin-chime", "pop-burst"],
  pass: ["whoosh-riser", "stinger-impact", "wasser-natur"],
  gamewin: ["jingle-fanfare", "coin-chime", "mystic-casino"],
  gammon: ["jingle-fanfare", "abschluss-terminator", "mystic-casino"],
  victory: ["jingle-fanfare", "mystic-casino", "coin-chime"],
  defeat: ["abschluss-terminator", "wasser-natur", "whoosh-riser"],
};

export interface Manifest {
  base: string;
  shelves: Record<string, string[]>;
  ambient: string[];
}

export interface Pick {
  /** Full URL of the chosen sound. */
  src: string;
  /** 0..2, applied on top of the master fader. */
  vol: number;
}

let manifest: Manifest | null = null;
let manifestLoad: Promise<Manifest | null> | null = null;

export function loadManifest(): Promise<Manifest | null> {
  if (manifestLoad) return manifestLoad;
  manifestLoad = fetch("/assets/audio/lib/manifest.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((m: Manifest | null) => {
      manifest = m;
      applyDefaults();
      return m;
    })
    .catch(() => null);
  return manifestLoad;
}
export const getManifest = () => manifest;

const url = (shelf: string, file: string) =>
  shelf === "__ambient" ? `${manifest!.base}/ambient/${file}` : `${manifest!.base}/themelib/${shelf}/${file}`;

// ── the bus ───────────────────────────────────────────────────────────────────

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let bedGain: GainNode | null = null;
let bedSrc: AudioBufferSourceNode | null = null;
let bedLevel = 0;
let bedDuck = 0;

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 22;
  comp.ratio.value = 5;
  comp.attack.value = 0.004;
  comp.release.value = 0.2;
  const master = ctx.createGain();
  master.gain.value = 1.15;
  comp.connect(master).connect(ctx.destination);
  bus = ctx.createGain();
  bus.connect(comp);
  return ctx;
}

// ── buffers ───────────────────────────────────────────────────────────────────

const buffers = new Map<string, AudioBuffer>();
const pending = new Map<string, Promise<AudioBuffer | null>>();

function fetchBuffer(src: string): Promise<AudioBuffer | null> {
  const have = buffers.get(src);
  if (have) return Promise.resolve(have);
  const inflight = pending.get(src);
  if (inflight) return inflight;
  const c = ensureCtx();
  if (!c) return Promise.resolve(null);
  const p = fetch(src)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((ab) => c.decodeAudioData(ab))
    .then((buf) => {
      buffers.set(src, buf);
      pending.delete(src);
      return buf;
    })
    .catch(() => {
      pending.delete(src);
      return null;
    });
  pending.set(src, p);
  return p;
}

function playBuffer(buf: AudioBuffer, gain: number, rate = 1) {
  const c = ctx!;
  const s = c.createBufferSource();
  s.buffer = buf;
  s.playbackRate.value = rate;
  const g = c.createGain();
  g.gain.value = gain;
  s.connect(g).connect(bus!);
  s.start();
}

/**
 * Cues that come from a file shipped WITH the game rather than from the remote
 * sample shelf.
 *
 * These two are the sounds you hear most often — every button press, and once per
 * point a checker travels over — so they cannot be "whatever the shelf serves".
 * Both are cut to the transient: the attack is on sample 0, so there is no gap
 * between the click and the sound of it. hop.wav is 115 ms, shorter than the 165 ms
 * a hop takes, so consecutive hops never overlap into a smear.
 */
const LOCAL: Partial<Record<Cue, [src: string, vol: number]>> = {
  click: ["/assets/sfx/click.wav", 0.85],
  select: ["/assets/sfx/click.wav", 0.7],
  turn: ["/assets/sfx/click.wav", 0.8],
  hop: ["/assets/sfx/hop.wav", 0.55],
  // picking a checker up is the same material as putting one down, one step drier
  lift: ["/assets/sfx/hop.wav", 0.7],
  // the signal that a throw has started. The landing sound stays on the shelf —
  // this only replaces the cue that fires as the dice begin to rattle.
  roll: ["/assets/sfx/rollstart.wav", 0.8],
  // the die settling. The shelf sample was a bright rattle that read as shrill next
  // to everything else; this is a low wooden tok — a fundamental at G3 with two fast
  // partials over it, all gone inside 100 ms.
  land: ["/assets/sfx/land.wav", 0.6],
  // getting knocked to the bar. The shelf's stinger was a bright cinematic hit that
  // stood outside the rest of the table; this is a low thock with a pitch drop and a
  // short slap on the front — weight, not shriek. Gone in 220 ms.
  hit: ["/assets/sfx/hit.wav", 0.75],
};

// ── assignment, with per-cue volume ───────────────────────────────────────────

const KEY = "neo-gammon-sound-v2";
type Store = Partial<Record<Cue, Pick>>;
let picks: Store = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Store;
  } catch {
    return {};
  }
})();
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(picks));
  } catch {
    /* private mode — the choice just won't persist */
  }
};

/** Sensible opening pick per cue: the nth sound off its first shelf. */
const SEED: Record<Cue, [string, number, number]> = {
  hop: ["holz-bambus", 1, 0.5],
  click: ["ui-click", 0, 0.55], select: ["ui-click", 5, 0.5], turn: ["glas-kristall", 3, 0.45],
  lift: ["tick-count", 2, 0.4], place: ["holz-bambus", 1, 0.85], enter: ["pop-burst", 4, 0.7],
  bearoff: ["coin-chime", 2, 0.7], roll: ["dice", 4, 0.9], land: ["dice", 1, 0.9],
  hit: ["stinger-impact", 3, 1], dance: ["stinger-impact", 12, 0.6],
  cube: ["metall-muenzen", 6, 0.9], take: ["glas-kristall", 8, 0.7], pass: ["whoosh-riser", 5, 0.6],
  gamewin: ["jingle-fanfare", 2, 0.8], gammon: ["jingle-fanfare", 9, 0.9],
  victory: ["jingle-fanfare", 0, 0.9], defeat: ["abschluss-terminator", 4, 0.7],
};

const defaults: Store = {};
function applyDefaults() {
  if (!manifest) return;
  CUES.forEach((c) => {
    const [shelf, idx, vol] = SEED[c];
    const files = manifest!.shelves[shelf];
    if (files?.length) defaults[c] = { src: url(shelf, files[idx % files.length]), vol };
  });
  CUES.forEach((c) => {
    const p = picks[c] ?? defaults[c];
    if (p) void fetchBuffer(p.src);
  });
}

const resolve = (c: Cue): Pick | undefined => picks[c] ?? defaults[c];

// ── the bed ───────────────────────────────────────────────────────────────────

export function setBed(src: string | null, vol = 0.35) {
  const c = ensureCtx();
  if (!c || !bus) return;
  bedSrc?.stop();
  bedSrc = null;
  if (!src) {
    bedLevel = 0;
    bedGain?.gain.setTargetAtTime(0, c.currentTime, 0.4);
    return;
  }
  void fetchBuffer(src).then((buf) => {
    if (!buf || !ctx || !bus) return;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(bus);
    bedGain = g;
    bedLevel = vol;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(g);
    s.start();
    bedSrc = s;
    g.gain.setTargetAtTime(vol, ctx.currentTime, 2);
  });
}

/** Dip the room so a heavy cue has space — most of why impact feels physical. */
function duck(depth: number, ms: number) {
  const c = ensureCtx();
  if (!c || !bedGain || bedLevel <= 0) return;
  bedDuck++;
  const mine = bedDuck;
  bedGain.gain.cancelScheduledValues(c.currentTime);
  bedGain.gain.setTargetAtTime(bedLevel * (1 - depth), c.currentTime, 0.015);
  window.setTimeout(() => {
    if (mine !== bedDuck || !bedGain || !ctx) return;
    bedGain.gain.setTargetAtTime(bedLevel, ctx.currentTime, 0.35);
  }, ms);
}

// ── voice cap ─────────────────────────────────────────────────────────────────

let voices = 0;
const HEAVY: Cue[] = ["hit", "cube", "gammon", "victory", "defeat", "gamewin"];
function budget(): boolean {
  if (voices > 7) return false;
  voices++;
  window.setTimeout(() => voices--, 200);
  return true;
}

let muted = false;
let volume = 0.8;

export const Sound = {
  unlock() {
    const c = ensureCtx();
    if (c && c.state === "suspended") void c.resume();
    void loadManifest();
    for (const v of Object.values(LOCAL)) if (v) void fetchBuffer(v[0]);
  },
  preload() {
    ensureCtx();
    void loadManifest();
  },

  play(cue: Cue, scale = 1) {
    if (muted) return;
    const c = ensureCtx();
    if (!c) return;
    const local = LOCAL[cue];
    if (local) {
      if (!budget()) return;
      const [src, vol] = local;
      const g = vol * volume * scale;
      const buf = buffers.get(src);
      // a hair of pitch drift, so a run of six hops does not sound like one file stamped six times
      const rate = 1 + (Math.random() * 0.07 - 0.035);
      if (buf) playBuffer(buf, g, rate);
      else void fetchBuffer(src).then((b) => b && playBuffer(b, g, rate));
      return;
    }
    const pick = resolve(cue);
    if (!pick) return;
    const heavy = HEAVY.includes(cue);
    if (!heavy && !budget()) return;
    if (cue === "hit") duck(0.75, 260);
    if (cue === "cube") duck(0.7, 320);
    if (cue === "gammon" || cue === "victory") duck(0.85, 900);
    // a touch of pitch drift so repeats of the same file never sound stamped
    const rate = heavy ? 1 : 1 + (Math.random() * 0.06 - 0.03);
    const g = pick.vol * volume * scale;
    const buf = buffers.get(pick.src);
    if (buf) playBuffer(buf, g, rate);
    else void fetchBuffer(pick.src).then((b) => b && playBuffer(b, g, rate));
  },

  /** Audition any file at a given level, straight from the picker. */
  preview(src: string, vol = 0.8) {
    this.unlock();
    const g = vol * volume;
    const buf = buffers.get(src);
    if (buf) playBuffer(buf, g);
    else void fetchBuffer(src).then((b) => b && playBuffer(b, g));
  },
  setBed(src: string | null, vol?: number) {
    this.unlock();
    setBed(src, vol);
  },

  assign(cue: Cue, src: string, vol?: number) {
    picks[cue] = { src, vol: vol ?? picks[cue]?.vol ?? defaults[cue]?.vol ?? 0.8 };
    save();
    void fetchBuffer(src);
  },
  setCueVolume(cue: Cue, vol: number) {
    const cur = resolve(cue);
    if (!cur) return;
    picks[cue] = { src: cur.src, vol: Math.max(0, Math.min(2, vol)) };
    save();
  },
  pickFor(cue: Cue): Pick | undefined {
    return resolve(cue);
  },
  isCustom(cue: Cue): boolean {
    return !!picks[cue];
  },
  reset() {
    picks = {};
    save();
  },
  urlFor: (shelf: string, file: string) => (manifest ? url(shelf, file) : ""),

  setMuted(m: boolean) { muted = m; },
  isMuted() { return muted; },
  /** Master: scales every cue AND the ambient bed. */
  setVolume(x: number) { volume = Math.max(0, Math.min(1, x)); },
  getVolume() { return volume; },
  /**
   * Music on its own, without reloading the track. Ramped rather than set, because
   * a gain that jumps on a running buffer clicks audibly.
   */
  setBedLevel(x: number) {
    bedLevel = Math.max(0, Math.min(1, x));
    const c = ensureCtx();
    if (c && bedGain) bedGain.gain.setTargetAtTime(bedLevel, c.currentTime, 0.08);
  },
  getBedLevel() { return bedLevel; },
};
