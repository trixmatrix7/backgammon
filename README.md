# Chain Gammon

**On-chain PvP backgammon match play, with a real doubling cube.**

Two players wager into a shared pot and play a backgammon **match to N points**. Games inside the
match are worth points; the doubling cube decides how many. First to the match target takes the whole
pot minus the protocol fee. There is no house — you are playing against the other player, not against
the liquidity pool.

It runs as an iframe guest inside the chain.wtf host, and standalone (local dev or the deployed URL
opened directly) against a local opponent so you can actually play it.

---

## Why backgammon, and why the cube

Every other game on this stack is a luck race with a decision or two bolted on. Backgammon is the
opposite: the dice are pure luck and *everything* interesting is in what you do with them. That makes
it the first genuinely deep game in the family — and it fits a public chain perfectly, because
backgammon has **no hidden information at all**. The board, the dice on the table, the cube and the
match score are public by the rules themselves. No commit/reveal, no trusted dealer, nothing to hide.

The doubling cube is the reason this is a gambling game rather than a race. Before you roll, you may
double the stake; your opponent either **takes** — the game is now worth twice as much and the cube
becomes theirs alone — or **passes** and hands you the current value on the spot. That single decision
carries more of the game than any dice roll does.

Crucially it is denominated in **match points, not money**. The escrow is a plain winner-take-all pot,
exactly like every other game here; the cube changes how fast a game moves you toward the match
target. That keeps the payout trivially safe on-chain while preserving the cube's entire strategic
soul — doubling windows, take points, the Crawford game, gammon-go.

**What that gets you at the table:** a 5-point match where you are down 0–3 and your opponent doubles
is a completely different decision from the same position at 3–0 up. There is no version of a dice
race that produces that.

---

## Five boards, three chip finishes

The table is not a re-skin of a house style — it is modelled on real luxury backgammon sets, and you
pick the one you play on:

| Deck | Field | Points | Checkers |
|---|---|---|---|
| **Carbon** | carbon weave, red piping | brushed steel / black, red hairline | steel & black chrome |
| **Crimson** | red leather | bone & black hide | ivory & black leather |
| **Ivory & Gold** | cream lacquer | black & tan, gold hairline | black-and-gold & cream |
| **Savanna** | cognac leather | zebra hide & black, brass hinges | bone & black |
| **Crystal** | frosted acrylic | pale slate — a daylight board | milk white & smoke |

On top of that, three checker finishes: **ringed** (concentric inlay), **plain**, and **milled** (a
notched poker-chip rim). Every material is CSS — gradients, a clip-path needle for the points, a
hairline outline layer — so a deck costs nothing to load and stays crisp at any size.

The chosen deck drives the entire match HUD, not just the rectangle in the middle of it: the accent
colour, the seat glows and the primary button all follow the set. Your choice is **local**: it never
reaches the host, the engine or the wire format, so two players can sit at the same table looking at
completely different boards and still be playing the identical, verifiable match.

Pick a set in the lobby's create form, or from **Board** in the in-match toolbar.

---

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5188 and press **Play**. Other scripts: `npm run build`, `npm run typecheck`,
`npm test` (35 engine tests), `npm run preview`.

---

## How a turn works

1. **Your turn opens.** You may **DOUBLE** (if the cube is yours or centred, and it is not the
   Crawford game) or just **ROLL**.
2. **The dice land.** Fresh on-chain randomness, delivered *after* you committed — see below.
3. **You play them.** Every checker you can move is **physically raised** out of its stack — no glow,
   no pulse; a lifted checker is the only cue a backgammon player needs. Hover one and its landings
   appear as faint ghosts; click it and they turn solid. Each **ghost is a translucent copy of your
   own checker**, sitting exactly where it would come to rest and carrying the die that pays for it —
   ringed in red if it knocks an enemy blot to the bar. If only one landing is legal the checker just
   goes. **UNDO** takes a step back, **CONFIRM** sends the whole turn; a forced turn is staged for you.
4. **A game ends**, the scoreline lands, and the next board is dealt.

**The throw and the moves are two different things.** Two dice land at whatever angle they landed at;
underneath them a rail counts the moves you still owe — two, or four on a double — and each token
greys out as you spend it. Tap a token to **arm** that value and the whole board narrows to what that
die can reach. Doubles are four moves. A checker on the bar has to re-enter before anything else moves, and if every
entry point is closed you *dance* and lose the turn (the game skips it for you — no wasted
transaction). Bearing off needs all fifteen checkers home.

Win while your opponent has borne off nothing and it is a **gammon**: double points. If they are also
still on the bar or stuck in your home board, a **backgammon**: triple. Multiplied by the cube.

---

## Provable fairness

The whole match is a pure function of `(seed, matchTo)` plus the ordered list of
`(action, randomness)` pairs. `verifyMatch` in [`src/engine/verifier.ts`](src/engine/verifier.ts)
replays it offline and rejects a forged die, an illegal checker play, a move by the wrong seat, a
desynchronised event clock, or a double smuggled into the Crawford game.

**Cheat-safe randomness.** Exactly two actions consume a randomness word:

* **ROLL** — the dice. The word arrives *after* you commit to rolling. The doubling decision happens
  strictly before that, so nobody can double (or decline to) while already knowing what they are about
  to throw. This ordering is the entire cheat-safety argument, and it is why the cube and the roll are
  separate actions.
* **NEXT** — the following game's opening throw, drawn after the take/pass that ended the previous
  game, so no cube decision is ever made with the next opening roll already visible.

The opening throw of game 1 comes from the match seed. It is public, but it precedes every decision in
the match and is perfectly symmetric between the seats, so knowing it early buys nothing.

---

## Layout

```
src/engine/     pure, deterministic rules — no Date, no Math.random, no I/O
  types.ts        state, actions, phases, board geometry
  rng.ts          the ONE randomness primitive + the opening-throw draw
  board.ts        checker legality, bear-off, the legal-turn generator
  rules.ts        the turn machine, the cube, scoring, Crawford, the match layer
  eval.ts         position judgement — advisory only, never part of the rules
  bot.ts          the dev-only opponent (moves + cube policy)
  verifier.ts     replay verification
src/game/       codec.ts (the wire/contract bytes) · runtime.ts · pacing.ts
src/mock/       mockHost.ts — a local imitation of the contract + facet
src/sdk/        useHost.ts — the real penpal bridge, with the demo gated to dev/standalone
src/ui/         board, HUD, lobby, overlays
  decks.ts        the five board decks + chip finishes, as CSS custom properties
  geometry.ts     board units → percentages; the single source of every coordinate
lib/pvp-sdk/    vendored @chain/pvp-sdk
contracts/      README.md (the full byte schema) + the vendored IPvpGameV1.sol
test/           35 engine tests
```

The engine is the shared law: the client runs it to draw the game, and the contract runs it to make
the game real. `src/game/codec.ts` is the boundary — a Solidity struct of the same fields
`abi.encode`s byte-identically. [`contracts/README.md`](contracts/README.md) writes that out in full,
including the handler flow, the move-legality rules a contract must reproduce, and the termination
bounds. The Solidity implementation is deliberately deferred.

---

## The opponent you play standalone

`src/engine/bot.ts` picks the move that maximises a positional evaluation — pip lead, blot exposure
weighted by actual shot counts, points made in the home board, anchors in the opponent's, prime
length, checkers trapped behind a blockade — and turns or answers the cube off the same
win-probability estimate the HUD shows you as **RACE READ**. It is deterministic: the same position
always produces the same move. It never ships into the on-chain path — the MockHost is dynamically
imported and only offered when there is no real host (`window.parent === window` or `import.meta.env.DEV`).

---

## Assets

Audio is OGG-first with a Web-Audio **synth fallback**, so the game has full character audio today and
auto-upgrades the moment a file lands. Drop these into `public/assets/audio/` to replace the synth:

`click` · `select` · `checker-lift` · `checker-place` · `dice-roll` · `dice-land` · `hit` · `enter` ·
`bear-off` · `cube` · `take` · `pass` · `dance` · `turn` · `game-win` · `gammon` · `victory` · `defeat`

The board itself is pure CSS and SVG — no textures to load, no WebGL context to lose.

---

## Deploy

GitHub → Vercel. Vite defaults apply (build `vite build`, output `dist`). In production the app is
iframe-only; the standalone **Play** entry only appears when the page is the top window.
