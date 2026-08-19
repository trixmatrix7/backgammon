import { useEffect, useState } from "react";
import { Sound } from "../sound/sounds";

const MUTE_KEY = "chain-gammon-muted";
const MASTER_KEY = "chain-backgammon-vol";
const MUSIC_KEY = "chain-backgammon-music";

/** Where the two sliders start. The panel shows them as 0–100, so these read as 16
 *  and 4 — quiet enough that the game does not announce itself on the first load,
 *  and the player turns it UP if they want it rather than lunging for the mute. */
const DEFAULT_MASTER = 0.16;
const DEFAULT_MUSIC = 0.04;

const read = (key: string, fallback: number): number => {
  if (typeof localStorage === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
};

/**
 * The player's sound settings, remembered across sessions.
 *
 * Two levels rather than one, because they are two different annoyances: the dice
 * and the checkers are information — you may want them loud — while the room tone
 * is atmosphere you may want gone without going silent. Mute stays separate from
 * both, so silencing the game for a phone call does not cost you the levels you
 * spent time setting.
 */
export function useSound() {
  const [muted, setMuted] = useState(() => {
    if (typeof localStorage === "undefined") return Sound.isMuted();
    return localStorage.getItem(MUTE_KEY) === "1";
  });
  const [master, setMaster] = useState(() => read(MASTER_KEY, DEFAULT_MASTER));
  const [music, setMusic] = useState(() => read(MUSIC_KEY, DEFAULT_MUSIC));

  useEffect(() => {
    Sound.setMuted(muted);
    Sound.setVolume(master);
    Sound.setBedLevel(music);
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
      localStorage.setItem(MASTER_KEY, String(master));
      localStorage.setItem(MUSIC_KEY, String(music));
    } catch {
      /* private mode — the settings just won't persist */
    }
  }, [muted, master, music]);

  return {
    muted,
    master,
    music,
    toggleMute: () => {
      const next = !muted;
      setMuted(next);
      if (!next) Sound.play("click");
    },
    /** Moving a slider plays a cue at the new level, so you hear what you are setting. */
    setMaster: (v: number) => {
      setMaster(v);
      Sound.setMuted(false);
      Sound.setVolume(v);
      Sound.play("click");
      if (muted) setMuted(false);
    },
    setMusic: (v: number) => {
      setMusic(v);
      Sound.setBedLevel(v);
    },
  };
}
