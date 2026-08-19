# Backgammon.sol — build brief

The Solidity side of Chain Backgammon. The TypeScript engine in `src/engine/` is the
reference implementation; this contract must reproduce it **exactly**, because
`verifyMatch` replays a finished match and both sides have to agree byte for byte.

Status: **done and passing.** `Backgammon.sol` compiles (13 952 bytes, EIP-170 limit
24 576) and agrees with the TypeScript engine byte for byte across every case the
differential harness covers.

**Coverage.** 12 opening deals; 8 complete matches played end to end, comparing the
encoded state after every single action; three table rules walked separately (single
game, cube live, cube live with the official opening) with the cube actually offered,
taken and dropped; and seven refusal cases where the contract must revert.

**Bugs the harness caught**, none of which would have looked wrong on screen — this is
the argument for building it:
1. `lastResult.cube` must read 1, not 0, before any game has finished.
2. `seed` is the MATCH seed and must not be rewritten on every throw.
3. `gameIndex` advances when a game ENDS, not when the next one is dealt.
4. `lastResult.points` is the total already multiplied by the cube, not the base value.
5. The LOSER is left on turn at a game boundary — either seat may submit NEXT, and the
   loser is the one who sets the board up.
6. `turnIndex` advances and the dice come off the table BEFORE the win is checked.
7. The OPEN event always reports `cube: 1`, even when the official-opening rule raised
   the game value.
8. **Every ordinary transition clears `lastResult`.** The scoreline belongs to the moment
   between games; once play resumes it is stale. Keeping it was the last divergence.
9. The opening position had two signs transposed (found by reading, not by the test).

**Running it:**
```
npm run build:contracts     # the test refuses stale bytecode rather than rebuilding it
npx vitest run test/differential.test.ts
```
`test/evm.ts` deploys the compiled contract into an in-process EVM (`@ethereumjs/evm`)
— no node, no chain, no signer, because all four entry points are `view`.

---

## 1. What the facet guarantees, and what it does not

- The facet owns escrow, the protocol fee and distribution. It does **not** enforce
  turn order — `submitLobbyAction` forwards any `msg.sender` to `onPlayerAction` and
  the game decides what is legal. Turn order lives in `gameState`.
- Every handler is `view` and must be **deterministic** for a given context: the facet
  may call `onLobbyStart` as a simulation with `lobbyId == 0` before committing.
  No `block.timestamp` in anything but the deadline field, no storage reads that vary.
- `PayoutSplit.shareBps` must sum to **exactly 10_000**; members omitted forfeit.
  Assign any rounding dust to one player.
- Randomness is requested by returning `requestRandomnessNow = true` together with
  `nextPhase = WAITING_RANDOMNESS`. It arrives later in `onRandomness(ctx, bytes32)`.

## 2. Unbiased dice (MUST)

Never `randomness[i] % 6`. Our engine derives every die from a keccak word:

```
rngWord(word, n) = keccak256(abi.encode(word, n))   // bytes32, uint256
die(word, n)     = uint8(uint256(rngWord(word, n)) % 6) + 1
```

`% 6` on a full 256-bit word is unbiased for practical purposes and is the pattern the
SDK explicitly permits for many dice per fulfillment. The TS side is
`src/engine/rng.ts`; the two must produce identical faces for identical inputs.

Opening throw (`openingThrow`): draw pairs `(die(w, n+2k), die(w, n+2k+1))` for
`k = 0..7`, return the first pair that is not a double, counting `ties = k`. If all
eight tie, fall back to `openingPair(w, n + 64)`, `ties = 8`.

**Only ROLL and NEXT consume a randomness word**, and the word is delivered *after*
the action commits — that is the cheat-safety property. Everything else is pure.

## 3. Wire format — must match `src/game/codec.ts` byte for byte

### Config (`ctx.config`)
`abi.encode(uint16 turnSec, uint8 matchTo, bool cubeOn, bool officialOpening)`

`cubeOn` is forced false when `matchTo == 1` (no cube in a single game).
The client offers exactly two lengths: `matchTo = 1` (1 game) and `matchTo = 3`
(best of 3, counted in points).

### Action (`actionData`)
`abi.encode(uint8 kind, uint8 moveCount, uint8[4] moveFrom, uint8[4] moveDie)`

kind: 0 ROLL · 1 MOVE · 2 DOUBLE · 3 TAKE · 4 PASS · 5 RESIGN · 6 NEXT
`moveFrom[i] == 24` means the bar. A MOVE is **whole-turn atomic**: the complete
sequence is submitted at once, because "use as many dice as you can" is a property of
the finished sequence, not of any single move.

### State (`gameState`) — one tuple, in this order
```
uint8   numPlayers      uint8   matchTo        uint8  current      uint8  phase
uint8   cube            int8    cubeOwner      bool   cubeOn       bool   officialOpening
uint8   gameIndex       uint16  turnIndex      uint32 seq          int8   winner
bool    over            bytes32 seed           uint64 deadline
int8[24] points         uint8[2] bar           uint8[2] off        uint8[2] score
uint8[2] dice
lastEvent  (bool valid, uint8 kind, uint8 player, uint32 seq, uint8 d1, uint8 d2,
            uint8 cube, uint8 moveCount, uint8[4] moveFrom, uint8[4] moveDie)
lastResult (bool valid, uint8 gameIndex, uint8 winner, uint8 points, uint8 flavor,
            uint32 seq)                      // NB flavor: 1 single 2 gammon 3 backgammon 0 conceded
```
`points`: **+ = seat 0, − = seat 1**, absolute 24-slot board. Seat 0 travels 23 → 0,
seat 1 travels 0 → 23. `cubeOwner == -1` means centred. `winner == -1` means in
progress or drawn.

### Constants
```
NUM_POINTS 24   CHECKERS 15   BAR 24   OFF 25   MAX_CUBE 64
PHASE  0 ROLL · 1 MOVE · 2 CUBE · 3 OVER · 4 GAME_OVER
EV     0 NONE · 1 ROLL · 2 MOVE · 3 DANCE · 4 DOUBLE · 5 TAKE · 6 PASS · 7 RESIGN · 8 OPEN
MAX_TURNS_PER_GAME 400   MAX_GAMES 32
```

## 4. Rules the contract must enforce

- Opening: both throw, higher number moves first with both dice. A tie re-throws; with
  `officialOpening` each tie doubles the game value first (`opened = 2 ** ties`, capped
  at `MAX_CUBE`).
- A turn: two dice, two moves; a double is four moves. **You must use as many dice as
  you can**; if only one can be played it must be the higher one. If none can, the turn
  is skipped (EV_DANCE).
- Bar first: while you have checkers on the bar you may move nothing else.
- Landing: empty point, your own point, or exactly one enemy checker (which goes to the
  bar).
- Bear off only when all 15 are home; a die may take from a lower point only if nothing
  stands further back.
- Scoring: single 1 · gammon 2 (loser has none off) · backgammon 3 (none off and still
  on the bar or in the winner's home). Multiplied by the cube.
- Cube: only when `cubeOn`. Offered before your roll by the owner (or by either side
  while centred). TAKE passes ownership; PASS ends the game at its pre-double value.
  **The cube multiplies match POINTS, never the pot** — escrow stays winner-takes-all.
- No Crawford rule (the handover defines match play without it).

## 5. Turn deadline and skipping

`gameState.deadline = block.timestamp + turnSec` whenever a turn is handed over. Define
a SKIP path that any caller may send once `block.timestamp > deadline`: it forfeits the
no-show (0 share at resolution) so a laggard cannot stall the match. This is the only
place `block.timestamp` may be read.

## 6. Payout

Winner takes the distributable pot: `shareBps = [10000, 0]` in lobby-member order.
A cancelled/abandoned match resolves 5000/5000. Points and the cube decide **who** wins
the match, never how much.

## 7. Definition of done

- [x] `Backgammon.sol` implements `IPvpGameV1`, compiles under `^0.8.30`.
- [x] A differential test against the TS engine, asserting identical `gameState` bytes at
      every step. This is the real correctness bar — not unit tests either side alone.
- [x] The bot is gated: build with `VITE_DEMO_BOT=0` (`npm run build:platform`) and the
      `mockHost` chunk is not emitted at all. Verified by inspecting `dist/assets/`.

Still outside this repo's reach, and the platform's to answer:
- [ ] Governance must whitelist the deployed game address and the stake token.
- [ ] A private/public lobby setting: `createLobby` has no visibility parameter and
      `IPvpGameV1` has no join hook, so it cannot be built from the game side alone.
- [ ] Deployment itself — this needs keys, and no audit has been done.
