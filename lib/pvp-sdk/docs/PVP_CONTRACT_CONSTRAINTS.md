# Smart contract constraints (`PvpGameFacet` + `IPvpGameV1`)

PvP games wager players against each other into a shared pot — **no house liquidity is at risk**, so
there is no `quoteCaps` / `quoteRiskParams` / reserved-profit machinery (contrast `@chain/casino-sdk`).
The facet's job is escrow, the protocol fee, and payout distribution. **Turn order is enforced by the
game, not the facet** (see "Turn order & skipping").

## Game interface

Your game **must** implement [`IPvpGameV1`](../solidity/IPvpGameV1.sol):

- **`canStart(ctx)`** — the game's sole lobby-validation hook (there is **no** `quoteLobby`). Must
  return `true` before the lobby can leave `WAITING_FOR_PLAYERS`. The creator picks `buyIn` and the
  seat cap `maxPlayers` at `createLobby`; everything else — minimum players, team parity, and any
  `config` invariants — is enforced here (or in `onLobbyStart`, which may revert).
- **`onLobbyStart` / `onPlayerAction` / `onRandomness`** — pure/view step handlers returning a
  `PvpStepResult` (`nextPhase`, `requestRandomnessNow`, `payout`, `outcome`, `newGameState`). There is
  no "next actor" field — whose turn it is lives in `gameState`, at the game's discretion.
- **Unbiased d6 from `bytes32` randomness (MUST)** — If you map facet bytes to faces `1..6` via a
  **byte walk**, use rejection sampling (`byte < 252` then `(byte % 6) + 1`). **Do not** use raw
  `(randomness[i] % 6) + 1`. For many dice per fulfillment, you may instead use
  `keccak256(abi.encode(randomness, uniqueSalt))` then `word % 6` (see
  [`DicePokerGame.sol`](../solidity/examples/DicePokerGame.sol)); see [`RANDOMNESS_DICE.md`](./RANDOMNESS_DICE.md).

## Payout-split invariants (enforced by the facet)

When a step returns `nextPhase == RESOLVED`, the facet validates the `PayoutSplit` before moving
funds. A violation reverts and the lobby stays open/unresolved:

- `payout.players.length == payout.shareBps.length` — else `PvpGameFacet__PayoutLengthMismatch`.
- Every `payout.players[i]` is a current lobby member, with **no duplicates** — else
  `PvpGameFacet__PayoutNotAMember`.
- `sum(shareBps) == 10_000` exactly — else `PvpGameFacet__InvalidPayoutSplit`. (Watch integer
  rounding: assign any dust to one player so the total is exact — see `PointDuelGame._split`.)
- Distribution: `fee = pot * protocolFeeBps / 10_000`, `distributable = pot - fee`, then each payee
  receives `distributable * shareBps[i] / 10_000`. Rounding dust from this division stays in the
  protocol fee account. Members omitted from `players` (or given a 0 share) forfeit their buy-in.

`protocolFeeBps` is a facet-level governance constant (not game-controlled); the game only decides the
relative split of the distributable pot.

## Facet orchestration

- **Whitelist**: `PvpGameFacet__GameNotWhitelisted` if the game address is not whitelisted
  (governance). The **stake token** must likewise be on a governance-controlled whitelist
  (`setPvpTokenWhitelisted`) or `createLobby` reverts with `PvpGameFacet__TokenNotWhitelisted` — this
  confines stakes to vetted, standard ERC20s so the pot accounting (exact, hook-free transfers) holds.
- **Vault / buy-in**: the funding vault must be a protocol vault; buy-in is pulled on
  `createLobby`/`joinLobby`. A min buy-in may be enforced.
- **Seats**: `joinLobby` reverts if the lobby is full (`PvpGameFacet__LobbyFull`), not in
  `WAITING_FOR_PLAYERS` (`PvpGameFacet__LobbyNotJoinable`), or the caller already holds a seat
  (`PvpGameFacet__AlreadyJoined`).
- **Auto-start**: after a join, if the lobby is full **or** the game's `autoStartWhenFull` /
  `canStart` allows, the facet runs `onLobbyStart` in the same tx.
- **Turns are NOT facet-enforced.** `submitAction` forwards `msg.sender` to `onPlayerAction(ctx,
player, actionData)` and lets the **game** decide what is valid. The facet has no concept of a "next
  actor" at all — turn order lives entirely in `gameState`. Intentional — see "Turn order & skipping".
- **Randomness from actions**: any step handler — `onLobbyStart`, **`onPlayerAction`**, or
  `onRandomness` — may return `requestRandomnessNow = true` with `nextPhase = WAITING_RANDOMNESS`. So
  a single player's action can trigger a roll, and `onRandomness` can route the next turn back to the
  same player (decide → randomness → decide again). The randomness provider must be set or
  `PvpGameFacet__RandomnessProviderNotSet`.
- **Phases**: invalid transitions revert (`PvpGameFacet__InvalidStepTransition`). You cannot resolve
  from a terminal phase or request randomness inconsistently.
- **Simulation**: like casino, the facet may call `onLobbyStart` once as a simulation (`lobbyId == 0`)
  before committing. Your step handlers must be **view-safe and deterministic** for a given context.
- **Reentrancy**: every value-moving entrypoint (`createLobby`, `joinLobby`, `leaveLobby`,
  `startLobby`, `submitLobbyAction`, `onPvpRandomnessFulfilled`, `cancelLobby`) is `nonReentrant`
  (OpenZeppelin `ReentrancyGuardTransient` — a diamond-safe, EIP-1153 transient guard), layered on
  checks-effects-interactions ordering (pot/phase finalized before any transfer). Combined with the
  token whitelist, this protects the pot from reentrancy and malicious-token callbacks.

## Turn order & skipping (game-enforced)

Because the facet does not enforce turns, **the game owns all turn logic** in `onPlayerAction`:

- A game with turns tracks its current actor (and any sub-turn structure) in `gameState`, and a normal
  move must `require(player == currentActor)` itself.
- This is what lets an action trigger randomness and then route the **same** player to act again
  (`decide → WAITING_RANDOMNESS → onRandomness keeps currentActor → that player decides again`) — a
  shape a fixed facet-level turn-guard could not express.

**Skipping a slacking player** falls straight out of this and needs **no facet support**:

1. When the game hands a turn to a player, it writes a deadline into `gameState`
   (`deadline = block.timestamp + timeBank`).
2. It defines a `SKIP` action whose handler checks `block.timestamp > deadline` (and ignores the
   caller), then forfeits the no-show — they simply receive a **0 share** at resolution (or are
   dropped from the active set) — and advances the turn.
3. Since the facet forwards **any** caller to `onPlayerAction`, **anyone** (another player, or a
   keeper bot) can send the `SKIP` tx once the deadline passes; the laggard cannot stall the game.

```solidity
// inside onPlayerAction
(uint8 kind) = abi.decode(actionData, (uint8));
if (kind == SKIP) {
  require(block.timestamp > s.deadline, "not expired"); // caller is irrelevant
  // forfeit s.currentActor (0 share), advance turn, set s.deadline = block.timestamp + timeBank
} else {
  require(player == s.currentActor, "not your turn");
  require(block.timestamp <= s.deadline, "timed out"); // optional hard cutoff
  // apply move, advance turn, reset deadline (and/or requestRandomnessNow = true)
}
```

The guest decodes the deadline from `raw.gameState` (its own state) to render a countdown and a "skip"
button — the facet/host has no notion of it. A game that does **not** want permissionless callers may
additionally `require` membership for non-skip actions — but the skip path should stay open to keep
the game live.

## Refunds, cancellation, timeouts

| Constant (configurable by governance) | Default      | Meaning                                                                                                                                                                                                   |
| ------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_LOBBY_FILL_TIMEOUT_BLOCKS`   | 43200        | If an open lobby never starts within this window, anyone may `cancelLobby` → refund all buy-ins (the creator may cancel immediately).                                                                     |
| `DEFAULT_ACTION_TIMEOUT_BLOCKS`       | 43200        | Facet-level **safety net**: the whole lobby stalled with no progress for this long can be unwound via `forfeitExpiredLobby`. Per-turn skipping is normally handled in-game (see "Turn order & skipping"). |
| `DEFAULT_RANDOMNESS_TIMEOUT_BLOCKS`   | 150          | RNG fulfillment window before stuck-randomness handling.                                                                                                                                                  |
| `DEFAULT_PROTOCOL_FEE_BPS`            | (governance) | Fee taken from each resolved pot.                                                                                                                                                                         |

- **`leaveLobby`** is only valid in `WAITING_FOR_PLAYERS`; it refunds the caller and frees the seat.
  The creator leaving may cancel the lobby (refund all) per facet policy.
- **`cancelLobby` / `forfeitExpiredLobby`** define how stalled games unwind. The default forfeit
  policy (e.g. award the pot to players who did act, or refund everyone) is a facet/governance
  decision; the game can also encode an abandonment resolution by returning a `PayoutSplit` from a
  timeout-aware action path.

## Reference implementation

A working `PvpGameFacet` (diamond facet) lives in the monorepo at
`packages/contracts/contracts/Pvp/`, with example games (`PointDuelGame`, `CoinDuelGame`), a
PvP-specific randomness consumer/mock provider, and a test suite at
`packages/contracts/test/PvpGameFacet.test.ts`.

Because the casino subsystem already occupies generic selectors on the same diamond (`submitAction`,
`setRandomnessProvider`, `onRandomnessFulfilled`, …), the PvP facet uses **distinct selectors** —
`createLobby`, `joinLobby`, `leaveLobby`, `startLobby`, **`submitLobbyAction`**, `cancelLobby`,
`getLobby`, `setPvpGameWhitelisted`, `setPvpTokenWhitelisted`, `setPvpRandomnessProvider`,
`setPvpFeeConfig`, and the dedicated randomness callback **`onPvpRandomnessFulfilled`** (via
`IPvpRandomnessConsumer`). The conceptual
names used above map onto these; a host integrator calls the prefixed on-chain functions.

Treat the deployed facet's verified ABI as authoritative if this doc drifts.
