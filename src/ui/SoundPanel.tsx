// The sound control, as a panel rather than a single mute button.
//
// A toggle only ever offers "all of it" or "none of it", which in a game with a
// room tone under it is not really a choice. Two sliders and a mute cover what a
// player actually wants: keep the dice, lose the music; keep everything, quieter;
// or silence the lot for a minute without losing the levels they set.

import { useSound } from "./useSound";

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const pct = Math.round(value * 100);
  return (
    <label className="snd-row">
      <span className="snd-label">{label}</span>
      <input
        className="snd-range"
        type="range"
        min={0}
        max={100}
        value={pct}
        style={{ ["--fill" as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        aria-label={label}
      />
      <span className="snd-val num">{pct}</span>
    </label>
  );
}

export function SoundPanel({ onClose }: { onClose: () => void }) {
  const { muted, master, music, toggleMute, setMaster, setMusic } = useSound();

  return (
    <div className="snd-pop" onClick={(e) => e.stopPropagation()}>
      <div className="snd-head">Sound</div>
      <Slider label="Master" value={master} onChange={setMaster} />
      <Slider label="Music" value={music} onChange={setMusic} />
      <div className="snd-foot">
        <button className={`snd-mute${muted ? " on" : ""}`} onClick={toggleMute}>
          {muted ? "Unmute" : "Mute all"}
        </button>
        <button className="snd-done" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
