import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";
import "./neo.css";

const root = createRoot(document.getElementById("root")!);

// The sound bench at /?sound is an internal tool. It is imported dynamically and
// only in dev, so it is not in the production bundle at all — same reasoning as
// the MockHost: nothing a player could reach should ship to devnet.
if (import.meta.env.DEV && new URLSearchParams(location.search).has("sound")) {
  void Promise.all([import("./ui/SoundLab"), import("./lab.css")]).then(([m]) =>
    root.render(<m.SoundLab />),
  );
} else {
  root.render(<App />);
}
