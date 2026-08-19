# `GammonGame.sol` — byte schema and handler flow

This directory documents the **on-chain contract for Chain Gammon** down to the byte, plus the
vendored `IPvpGameV1.sol` it implements. The Solidity implementation is deliberately deferred (the
same stopping point several games in this lineage use): the engine, the client and the MockHost are
the working spec, and everything a contract needs to reproduce them exactly is written out below.

Everything here is already true of the shipped TypeScript. `src/engine` is pure and deterministic,
`src/game/codec.ts` defines the wire bytes, and `src/mock/mockHost.ts` drives them through exactly the
handler sequence described here — so a contract written against this document is byte-compatible with
the client by construction, and `verifyMatch` will replay the on-chain log without modification.

---

## 1. The trust model, in one paragraph

The client renders and submits; it has zero authority. The contract owns escrow, turn order, move
legality, randomness and payouts. Both sides run the *same* rules over the *same* bytes: the client
computes outcomes only to draw them, the contract recomputes them to make them real. Backgammon is a
perfect-information game, so **nothing in `gameState` needs hiding** — no commit/reveal, no
trusted dealer. The only secret in the whole design is the *next throw*, and that is protected by
ordering (§4), not by encryption.

---

## 2. Lobby config

```
config = abi.encode(uint16 turnSeconds, uint8 matchTo)
```

* `turnSeconds` — the per-turn clock. A whole turn (cube decision + roll + checker play) shares one
  clock; it is refreshed when the turn changes and whenever a double lands on a player.
* `matchTo` — match length in POINTS. Validate `matchTo ∈ {1, 3, 5, 7}` in `canStart`.

`canStart` must additionally require exactly **2 seated players** (`ctx.players.length == 2`) and
`ctx.maxPlayers == 2`. The facet has no minimum of its own.

The pot is `buyIn × 2` and the **winner of the MATCH takes all of it**. The doubling cube changes how
many *match points* a game is worth — it never changes how much money is escrowed, which is what lets
this game keep the standard winner-take-all payout every other game on this stack uses.

---

## 3. `gameState` layout

One `abi.encode` of a single tuple. Field order, names and widths are **normative** — they are exactly
`STATE_TUPLE` in [`src/game/codec.ts`](../src/game/codec.ts), and a Solidity struct declared in this
order encodes byte-identically.

```solidity
struct GameState {
  uint8   numPlayers;    // always 2
  uint8   matchTo;       // 1 | 3 | 5 | 7
  uint8   current;       // seat that must act
  uint8   phase;         // see §3.1
  uint8   cube;          // 1,2,4,…,64
  int8    cubeOwner;     // -1 = centred, else the owning seat
  uint8   gameIndex;     // games completed in this match
  uint16  turnIndex;     // turns completed in the CURRENT game
  uint32  seq;           // event clock; +1 on every accepted action
  int8    winner;        // -1 in progress or drawn, else the winning seat
  bool    over;
  bytes32 seed;          // the match seed (recorded for offline verification)
  uint64  deadline;      // unix seconds; the current actor's clock
  int8[24] points;       // + = seat-0 checkers, − = seat-1 checkers
  uint8[2] bar;
  uint8[2] off;
  uint8[2] score;        // match points
  uint8[2] dice;         // live only in PHASE_MOVE, else [0,0]
  LastEvent lastEvent;   // display only — see §3.2
  LastResult lastResult; // display only — see §3.2
}

struct LastEvent {
  bool    valid;
  uint8   kind;       // §3.3
  uint8   player;
  uint32  seq;
  uint8   d1; uint8 d2;
  uint8   cube;
  uint8   moveCount;  // 0..4
  uint8[4] moveFrom;  // 0..23, or 24 = the bar
  uint8[4] moveDie;   // 1..6
}

struct LastResult {
  bool   valid;
  uint8  gameIndex;
  uint8  winner;
  uint8  points;
  uint8  flavor;   // 1 single · 2 gammon · 3 backgammon · 0 conceded
  uint8  cube;
  uint32 seq;
}
```

### 3.1 Board geometry (this is the part that must not drift)

`points` is ONE absolute array of 24 slots, signed by owner. Seat 0 travels **23 → 0** and bears off
past index 0 (home board `0..5`); seat 1 travels **0 → 23** and bears off past index 23 (home board
`18..23`). So index 0 is seat 0's 1-point *and* seat 1's 24-point.

```
dir(seat)        = seat == 0 ? -1 : +1
homeLo(seat)     = seat == 0 ? 0  : 18
homeHi(seat)     = seat == 0 ? 5  : 23
entryIndex(s,d)  = seat == 0 ? 24 - d : d - 1        // coming off the bar
pipsFrom(s,i)    = seat == 0 ? i + 1  : 24 - i       // the die that bears that checker off exactly
```

Opening setup (absolute indices): `+2 @23, +5 @12, +3 @7, +5 @5` and the mirror
`-2 @0, -5 @11, -3 @16, -5 @18`. Both sides start on 167 pips.

### 3.2 `lastEvent` / `lastResult` are display-only

Neither field is ever read back by the rules. They exist because the OPPONENT's client has no other
way to know which checkers moved: it replays `moveFrom`/`moveDie` against the previous board to
animate the turn (and derives the hits itself). Writing them is optional for correctness and
mandatory for a watchable game.

### 3.3 Enums

```
phase:  0 PHASE_ROLL   1 PHASE_MOVE   2 PHASE_CUBE   3 PHASE_OVER   4 PHASE_GAME_OVER
event:  0 none 1 roll 2 move 3 dance 4 double 5 take 6 pass 7 resign 8 open
action: 0 ROLL  1 MOVE  2 DOUBLE  3 TAKE  4 PASS  5 RESIGN  6 NEXT
```

---

## 4. Randomness — the cheat-safety argument

Exactly **two** action kinds consume a randomness word. Everything else is deterministic and must NOT
set `requestRandomnessNow`.

| Action | Word used for | Why it is safe |
|---|---|---|
| `ROLL` | the two dice | The word is delivered by the facet *after* the player has committed to roll. The doubling decision happens in `PHASE_ROLL`, strictly earlier — so nobody can double (or decline to) while already knowing what they are about to throw. |
| `NEXT` | the next game's opening throw | Drawn strictly after the take/pass and the checker play that ended the previous game, so no cube decision is ever made with the next opening roll already visible. |

The opening throw of **game 1** derives from the match seed. It is public, but it precedes every
decision in the match and is perfectly symmetric between the seats, so knowing it early buys nothing.

### The one derivation primitive

```solidity
function rngWord(bytes32 w, uint256 n) internal pure returns (uint256) {
  return uint256(keccak256(abi.encode(w, n)));
}
function die(bytes32 w, uint256 n)      internal pure returns (uint8)  { return uint8(rngWord(w, n) % 6) + 1; }
function rngBelow(bytes32 w, uint256 n, uint256 b) internal pure returns (uint256) { return rngWord(w, n) % b; }
```

Dice: `d1 = die(word, 0)`, `d2 = die(word, 1)`. Equal faces mean **four** moves of that value.

Opening throw — the two dice must differ, so instead of a rejection loop (unbounded gas) draw
uniformly from the 30 ordered distinct pairs:

```solidity
uint256 r = rngBelow(word, 0, 30);
uint8 a = uint8(r / 5) + 1;          // seat 0's die
uint8 t = uint8(r % 5);
uint8 b = t < a - 1 ? t + 1 : t + 2; // seat 1's die, walking the 5 faces that are not `a`
// higher die goes first and plays [max(a,b), min(a,b)]
```

This is `openingPair` in [`src/engine/rng.ts`](../src/engine/rng.ts) — one hash, always, and every
ordered distinct pair hit exactly once.

---

## 5. `actionData` layout

```
actionData = abi.encode(uint8 kind, uint8 moveCount, uint8[4] moveFrom, uint8[4] moveDie)
```

A whole turn travels in ONE action. This is not an optimisation — backgammon's *"you must play as many
dice as you legally can"* rule is a property of the **complete sequence**, so a per-checker action
could not be validated at all, and four transactions per turn would be absurd. Non-move actions leave
the move fields zeroed; `moveCount ≤ 4` (4 only on doubles).

**Bounds-check every index before use**: `moveCount ≤ 4`, each `moveFrom[i] ≤ 24`, each
`moveDie[i] ∈ 1..6`, and `kind ≤ 6`. Then validate the sequence against the legal-turn generator
(§6) — never trust that a submitted sequence is playable just because each step looks well-formed.

---

## 6. Move legality (what `onPlayerAction` must reproduce)

A single step from `from` with die `d` is legal iff:

1. **Bar first** — if `bar[seat] > 0` then `from` must be `24` (the bar); otherwise `from` must be a
   board index the seat actually occupies.
2. **Destination open** — `dest = from == 24 ? entryIndex(seat, d) : from + dir(seat)·d`. If `dest` is
   on the board it must not hold **2 or more** enemy checkers. Exactly one enemy checker is a *blot*:
   the move is legal and sends it to the bar.
3. **Bear-off** — if `dest` runs off the edge, every one of the seat's 15 checkers must be home
   (`bar[seat] == 0` and nothing outside `homeLo..homeHi`). `d == pipsFrom(seat, from)` bears off
   exactly; `d > pipsFrom(seat, from)` bears off only when the seat has **no checker further back**
   inside its home board; `d < pipsFrom(...)` is not a bear-off at all (the destination is still on
   the board).

A complete TURN additionally satisfies:

4. **Use as many dice as you legally can.** Enumerate every sequence (depth ≤ 4, dedupe interchangeable
   die values), take the maximum achievable length, and accept only sequences of that length.
5. **If exactly one die is playable but not both, it must be the higher one** — when the maximum
   length is 1 and the roll is not a double, drop sequences that use the smaller die if any sequence
   uses the larger.

Reference implementation: `legalTurnsFor` in [`src/engine/board.ts`](../src/engine/board.ts). It
returns a single empty sequence when the player **dances** (no legal move at all).

---

## 7. Handler flow

### `onLobbyStart`
Validate `config`, deal the opening position, derive the opening throw from `ctx`'s match seed, set
`current` to the higher die, `phase = PHASE_MOVE`, `dice = [hi, lo]`, `cube = 1`, `cubeOwner = -1`,
`deadline = block.timestamp + turnSeconds`.
→ `nextPhase = WAITING_PLAYER_ACTION`.

### `onPlayerAction`
`seq += 1` on every accepted action, and refresh `deadline`.

| kind | required phase | actor | effect |
|---|---|---|---|
| `ROLL` | `PHASE_ROLL` | `current` | set `requestRandomnessNow = true`; resolve in `onRandomness` |
| `MOVE` | `PHASE_MOVE` | `current` | validate the sequence (§6), apply it, end the turn |
| `DOUBLE` | `PHASE_ROLL` | `current`, `cube < 64`, `cubeOwner ∈ {-1, current}` | `phase = PHASE_CUBE`, `current = other(current)` |
| `TAKE` | `PHASE_CUBE` | `current` (the responder) | `cube *= 2` (cap 64), `cubeOwner = responder`, `current = doubler`, `phase = PHASE_ROLL` |
| `PASS` | `PHASE_CUBE` | `current` | the doubler wins the game for the **current** cube value (never the offered one), `flavor = 0` |
| `RESIGN` | `PHASE_ROLL` or `PHASE_MOVE` | `current` | opponent wins for `cube`, `flavor = 0` |
| `NEXT` | `PHASE_GAME_OVER` | **either seat** | `requestRandomnessNow = true`; deal the next game in `onRandomness` |

`NEXT` is deliberately open to both seats so a losing player cannot stall the match by refusing to set
the board up again.

**Deadline-gated auto-play.** Once `block.timestamp > deadline`, accept the action from *any* caller
and substitute the forced move: `PHASE_ROLL → ROLL`, `PHASE_MOVE → autoTurn`, `PHASE_CUBE → PASS`,
`PHASE_GAME_OVER → NEXT`. `autoTurn` is the **lexicographically smallest** legal maximal sequence —
ordered by `(from, die)` ascending, shorter first on a prefix tie. It is deliberately ordering-based
rather than evaluation-based so Solidity reproduces it exactly (`autoTurn` /
`compareTurns` in the engine).

### `onRandomness`
* Outstanding `ROLL`: `dice = [die(w,0), die(w,1)]`, `phase = PHASE_MOVE`. If the roll **dances**,
  skip the turn inside the same call (`lastEvent.kind = 3`, hand over, `phase = PHASE_ROLL`) — there
  is nothing to submit, so charging a second transaction for it would be pure waste.
* Outstanding `NEXT`: reset the board, `cube = 1`, `cubeOwner = -1`, `turnIndex = 0`, derive the opening throw, `phase = PHASE_MOVE`.

---

## 8. Scoring and the end of a match

When a seat bears off its 15th checker:

```
flavor = off[loser] > 0                                     ? 1   // single
       : bar[loser] > 0 || loser has a checker in winner's home ? 3   // backgammon
       :                                                       2   // gammon
points = cube × flavor          // a concession (pass / resign / turn cap) scores cube × 1, flavor 0
score[winner] += points
```

Then park in `PHASE_GAME_OVER` with the finishing position intact and `current = loser`.

**No Crawford rule.** `TOBI-BACKGAMMON.md` §2.9/§2.10 defines match play without it, so a trailer may
turn the cube at any score, match point included. Two `bool`s left the state tuple with it — the
contract struct must drop them too or `abi.encode` will not match the client byte for byte.

**Match end.** `score[winner] >= matchTo` → `over = true`, `winner` set, `phase = PHASE_OVER`,
`nextPhase = RESOLVED`.

**Payout.** Winner-take-all: `shareBps = [10000, 0]` for the winner's seat. A drawn match (only
reachable through the `MAX_GAMES` cap, see §9) splits `[5000, 5000]`; dust goes to one payee.

---

## 9. Termination

* `MAX_TURNS_PER_GAME = 400` — a game that somehow will not end is decided on the pip count for
  `cube × 1` (lower pips win; a tie goes to seat 0).
* `MAX_GAMES = 32` — the match ends on the higher score; a level score is a genuine draw (`winner = -1`).

Both bounds are far beyond any real backgammon match; they exist so an on-chain match is *guaranteed*
to terminate rather than merely very likely to.

---

## 10. Verification

`verifyMatch(seed, numPlayers, matchTo, log)` in
[`src/engine/verifier.ts`](../src/engine/verifier.ts) replays `(action, randomness)` pairs from the
seed and re-derives every die. It rejects a forged face, an illegal checker play, a move by the wrong
seat, a desynchronised event clock, and a double turned by the seat that does not hold the cube. The authenticity of
each randomness word is the chain's job (the VRF attests it); the verifier proves everything else,
offline, without trusting the server.

## 11. Foundry notes

On this machine `forge` lives at `~/.foundry/bin/forge.exe` and is usually **not** on `PATH` — call it
by full path. `foundry.toml`: solc `0.8.30`, `libs = ["lib"]`, optimizer runs 200;
`git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std` and remap
`forge-std/=lib/forge-std/src/`.

Test through a **facet simulator**: loop `onLobbyStart → onRandomness / onPlayerAction → … → RESOLVED`,
feeding `keccak256(abi.encode(seed, step))` as randomness and `autoTurn` as the action, and assert the
match always terminates with a payout summing to 10 000 bps. Then cross-check TS↔Solidity parity by
running the same seeds through `src/engine` and comparing `encodeState` bytes.
