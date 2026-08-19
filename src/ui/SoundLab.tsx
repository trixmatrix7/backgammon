// The sound library, at /?sound
//
// Your generator shelves, browsable and assignable. Click any tile to hear it,
// pick a cue to bolt it onto, and set that cue's own level. Everything is saved,
// so the table picks it up on the next load — no code.

import { useEffect, useState } from "react";
import {
  CUES, CUE_LABEL, SHELVES_FOR, Sound, getManifest, loadManifest, type Cue, type Manifest,
} from "../sound/sounds";

/** Strip the hash suffix the generator puts on filenames. */
const pretty = (f: string) => f.replace(/\.ogg$/i, "").replace(/-[0-9a-f]{6}$/i, "").replace(/[-_]/g, " ");

export function SoundLab() {
  const [man, setMan] = useState<Manifest | null>(getManifest());
  const [vol, setVol] = useState(Math.round(Sound.getVolume() * 100));
  const [shelf, setShelf] = useState<string>("ui-click");
  const [target, setTarget] = useState<Cue>("place");
  const [, bump] = useState(0);
  const redraw = () => bump((x) => x + 1);
  const [bedName, setBedName] = useState("—");

  useEffect(() => {
    Sound.preload();
    void loadManifest().then((m) => {
      setMan(m);
      if (m && !m.shelves[shelf]) setShelf(Object.keys(m.shelves)[0]);
    });
  }, []);

  if (!man) {
    return (
      <div className="lab">
        <h1>Sound library</h1>
        <p>Loading the shelves…</p>
      </div>
    );
  }

  const shelves = Object.keys(man.shelves);
  const files = man.shelves[shelf] ?? [];
  const cur = Sound.pickFor(target);
  const total = Object.values(man.shelves).reduce((a, b) => a + b.length, 0) + man.ambient.length;

  return (
    <div className="lab">
      <header>
        <h1>Sound library</h1>
        <p>
          {total} sounds from your generator shelves. Click a tile to hear it, then <b>Assign</b> it to
          the cue selected on the right. Each cue keeps its own level, so you can make the hit loud
          without making every click loud.
        </p>
        <div className="vol">
          <span>Master</span>
          <input
            type="range" min={0} max={100} value={vol}
            onChange={(e) => { const x = Number(e.target.value); setVol(x); Sound.setVolume(x / 100); }}
          />
          <b>{vol}</b>
          <span style={{ marginLeft: 20 }}>Room</span>
          <b>{bedName}</b>
          <button onClick={() => { Sound.setBed(null); setBedName("—"); }}>Silence</button>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          {man.ambient.map((f, i) => (
            <button
              key={f}
              className="mini"
              onClick={() => { Sound.setBed(`${man.base}/ambient/${f}`, 0.3); setBedName(pretty(f)); }}
            >
              bed {i + 1}
            </button>
          ))}
        </div>
      </header>

      <section>
        <h2>Assigning to</h2>
        <div className="row">
          {CUES.map((c) => (
            <button
              key={c}
              className={`mini${target === c ? " on" : ""}`}
              onClick={() => {
                setTarget(c);
                const s = SHELVES_FOR[c][0];
                if (man.shelves[s]) setShelf(s);
              }}
            >
              {CUE_LABEL[c]}
            </button>
          ))}
        </div>

        <div className="cuebar">
          <b>{CUE_LABEL[target]}</b>
          <span className="path">{cur ? pretty(cur.src.split("/").pop() || "") : "—"}</span>
          <span className="lvl">
            level
            <input
              type="range" min={0} max={200} value={Math.round((cur?.vol ?? 0.8) * 100)}
              onChange={(e) => { Sound.setCueVolume(target, Number(e.target.value) / 100); redraw(); }}
            />
            <b>{Math.round((cur?.vol ?? 0.8) * 100)}</b>
          </span>
          <button className="mini" onClick={() => Sound.play(target)}>play cue</button>
          {Sound.isCustom(target) && <em className="tagged">custom</em>}
        </div>
      </section>

      <nav className="tabs">
        {shelves.map((s) => (
          <button
            key={s}
            className={shelf === s ? "on" : undefined}
            onClick={() => setShelf(s)}
            title={SHELVES_FOR[target].includes(s) ? "suggested for this cue" : undefined}
          >
            {s.replace(/-/g, " ")}
            <em>{man.shelves[s].length}</em>
            {SHELVES_FOR[target].includes(s) && <i className="dot" />}
          </button>
        ))}
      </nav>

      <section>
        <div className="grid">
          {files.map((f) => {
            const src = `${man.base}/themelib/${shelf}/${f}`;
            const isCur = cur?.src === src;
            return (
              <div key={f} className={`tile${isCur ? " on" : ""}`}>
                <button className="hear" onClick={() => Sound.preview(src, cur?.vol ?? 0.8)}>
                  {pretty(f)}
                </button>
                <button
                  className="put"
                  onClick={() => { Sound.assign(target, src); Sound.preview(src, cur?.vol ?? 0.8); redraw(); }}
                >
                  {isCur ? "in use" : "assign"}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="row">
          <button onClick={() => { Sound.reset(); redraw(); }}>Reset all cues</button>
          <button
            className="wide"
            onClick={() => {
              Sound.unlock();
              const at = (c: Cue, ms: number) => window.setTimeout(() => Sound.play(c), ms);
              at("click", 0); at("roll", 140); at("land", 680);
              at("lift", 1050); at("place", 1230);
              at("lift", 1510); at("place", 1690);
              at("hit", 2100); at("gamewin", 2900);
            }}
          >
            ▶ Play a whole turn
          </button>
        </div>
      </section>
    </div>
  );
}
