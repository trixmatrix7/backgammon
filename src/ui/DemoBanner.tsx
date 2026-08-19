// The one thing a test deployment must never be: convincing.
//
// The mock host deals real-looking dice, keeps a real score and settles a pot that
// looks exactly like the real one. That is what makes it useful for testing the whole
// game end to end — and exactly what makes it dangerous on a public URL. So while it is
// driving, this sits on top of everything and says so.
//
// It is `position: fixed` and `pointer-events: none`, so it cannot shift the board or
// swallow a click on anything underneath.

export function DemoBanner() {
  return (
    <div className="demo-banner" role="status">
      <b>Demo</b>
      <span>Local test opponent — no chain, no wallet, no real money.</span>
    </div>
  );
}
