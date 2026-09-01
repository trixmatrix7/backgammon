# Smart contract constraints (`IPvpGameV2` + protocol ledger)

PvP games wager players against each other into a shared pot — **no house liquidity is at risk**, so
there is no `quoteCaps` / `quoteRiskParams` / reserved-profit machinery (contrast `@chain/casino-sdk`).
The protocol's job is escrow, the contribution ledger, the protocol fee, and settlement transfers.
**Turn order is enforced by the game, not the protocol** (see "Turn order & skipping").

API v2 separates **protocol-owned money/accounting** from **game-owned policy**. The protocol does
not assume a fixed buy-in, a unique seat per address, a creator privilege, a player cap, or a timeout
cancellation policy.

The canonical interface lives at [`../solidity/IPvpGameV2.sol`](../solidity/IPvpGameV2.sol).

---

## Game interface

Your game **must** implement `IPvpGameV2`. All hooks are **`view`** (stateless policy). The protocol
records contributions, claims, and phase; games read a bounded `LobbyContext` plus ledger views
through `msg.sender` as `IPvpLobbyLedgerV2`.

| Hook             | Responsibility                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `onLobbyOpen`    | Validate asset/config/open data. Optionally assign a non-zero `lobbyKey` unique within this game's namespace.   |
| `onEntry`        | Accept or reject the caller's explicit stake (including zero) and return a `positionId`. Revert to reject.      |
| `onLobbyStart`   | Validate the actor and readiness; return the first `PvpStepResult` (state, phase, optional randomness request). |
| `onPlayerAction` | Apply `actionData` for the forwarded actor. The protocol does **not** check turn order.                         |
| `onRandomness`   | Consume fulfilled randomness; may return the turn to the same actor via `gameState`.                            |
| `canCancel`      | Own every normal and recovery cancellation permission. The protocol adds no fill/action timeout.                |
| `getClaim`       | For claimable settlement, quote one stable `claimId` → recipient + amount from final state.                     |

There is **no** `quoteLobby`, **no** protocol `canStart` boolean separate from `onLobbyStart`, and
**no** vault identity in the participant model — the submitting address is the participant.

### Unbiased d6 from `bytes32` randomness (MUST)

If you map facet bytes to faces `1..6` via a **byte walk**, use rejection sampling (`byte < 252`
then `(byte % 6) + 1`). **Do not** use raw `(randomness[i] % 6) + 1`. For many dice per fulfillment,
you may instead use `keccak256(abi.encode(randomness, uniqueSalt))` then `word % 6`. See
[`RANDOMNESS_DICE.md`](./RANDOMNESS_DICE.md).

---

## Protocol responsibilities

- Whitelist the game and the lobby's single immutable ERC20 escrow asset.
- Store lobby lifecycle state, the game-defined `lobbyKey`, opaque `config`, and opaque `gameState`.
- Enforce non-zero lobby-key uniqueness within the game contract's namespace.
- Transfer only the explicit stake authorized by the entering address.
- Append every accepted entry to the contribution ledger and maintain participant/position aggregates.
- Expose indexed ledger reads to games and paginated reads to host applications.
- Request randomness and validate phase transitions.
- Deduct the protocol fee once at resolution:
  `fee = pot * protocolFeeBps / 10_000`, `distributable = pot - fee`.
- Derive the settlement mode from the recipients returned at resolution: exactly **one** recipient
  is paid the whole distributable pot immediately (a failed transfer is parked for `claimPayout`);
  zero or several recipients settle via claims.
- Track collected claim IDs and cap claimable transfers at the remaining distributable pot.
- On cancellation, make each participant's **full aggregate stake** independently refundable.

`protocolFeeBps` is a protocol-level governance constant (not game-controlled). The game only decides
who receives the distributable pot and how.

---

## Game responsibilities (money-safety checklist)

- **Phase-gate entries** when your arrays or rules assume a closed set of participants after start
  (Point Duel reverts unless `ctx.phase == WAITING_FOR_PLAYERS`). The protocol does not invent seats.
- **Bound player-submitted numbers** that feed sums or multiplications (Point Duel caps scores at
  `type(uint64).max`) so resolution cannot overflow under Solidity 0.8 checked math and freeze the pot.
- **Return recipients deliberately**: exactly one recipient means that address is paid the whole
  distributable pot immediately; return several (or none, when not enumerable) for claimable
  distributions.
- **Assign rounding dust deliberately** in claimable splits so claim quotes sum exactly to the
  distributable pot (Point Duel dust goes to the highest scorer).
- **Derive lobby keys** from everything that should make a lobby unique (e.g. Jackpot:
  `keccak256(abi.encode(token, config))`). Do not key only on a timestamp field that another opener
  can squat.
- **Treat contribution IDs as dense** `0 .. contributionCount - 1` in append order when walking or
  binary-searching the ledger (documented on `getContribution`).

---

## Entry and position accounting

Each accepted entry becomes one ledger record:

| Field            | Meaning                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| `contributionId` | Dense per-lobby 0-based index in append order (`0 .. contributionCount - 1`) |
| `participant`    | Entering address                                                             |
| `amount`         | Accepted stake for this entry                                                |
| `positionId`     | Game-defined position key                                                    |
| `cumulativePot`  | Pot total after this entry (enables weighted ticket search)                  |
| `contributedAt`  | Timestamp                                                                    |

Returning the **same** `positionId` aggregates repeated entries into one position. Returning
**different** IDs keeps them independent.

Examples:

- **Point Duel** — rejects `ParticipantContext.joined == true`; `positionId` is address-derived;
  fixed exact stake; at most ten participants (game rule bounding score arithmetic).
- **Jackpot** — accepts repeats; same address-derived `positionId`; minimum stake; time window.

`IPvpLobbyLedgerV2.getContribution(lobbyId, contributionId)` therefore supports ordered index walks
and binary search over cumulative pots (see `JackpotGame`).

---

## Settlement invariants (enforced by the protocol)

When a step returns `nextPhase == RESOLVED`, the protocol validates settlement before moving funds.
A violation reverts and the lobby stays unresolved.

### Immediate settlement (derived: exactly one recipient)

- The game returns `recipients` with a single non-zero address, which receives the whole
  distributable pot (`distributable = pot - fee`).
- The payout transfer is attempted without reverting: if it fails (e.g. a blacklisted recipient),
  the payout is parked on the lobby and the winner collects it later via the permissionless
  `claimPayout(lobbyId)`.

Reference pattern (Jackpot): draw a stake-weighted ticket, return the drawn participant as the only
recipient.

### Claimable settlement (derived: zero or several recipients)

- No payout loop at resolution; the returned recipients (if enumerated) only select the mode and
  must contain no zero addresses.
- Anyone may submit a game-defined `claimId`; the protocol calls `getClaim`, records the ID, and
  transfers to the returned recipient.
- The caller **cannot** redirect payment. Multiple claims may share a recipient.
- Total paid across all claims is capped at the remaining distributable pot.

### Cancellation

`CANCELLED` is **not** a game result. It always means **full refunds** of each participant's
aggregate stake, claimed independently via the host API / protocol refund path — never a penalty or
forfeiture. Who may cancel is entirely `canCancel`.

---

## Protocol orchestration notes

- **Whitelist**: game and stake token must be governance-whitelisted so pot accounting stays exact
  against standard ERC20s.
- **No stake on open**: opening records config and optional lobby key only. Value moves on
  **entry**.
- **Turns are not protocol-enforced.** Submit forwards the actor to `onPlayerAction` and lets the
  game decide validity. Intentional — see "Turn order & skipping".
- **Randomness from any step**: `onLobbyStart`, `onPlayerAction`, or `onRandomness` may return
  `requestRandomnessNow = true` with `nextPhase = WAITING_RANDOMNESS`.
- **Phases**: invalid transitions revert. You cannot resolve from a terminal phase or request
  randomness inconsistently.
- **View safety**: hooks must be deterministic and view-safe for a given context (the protocol may
  simulate).
- **Reentrancy**: value-moving entrypoints are non-reentrant and finalize pot/phase before
  transfers, layered on the token whitelist.

Exact selector names and error codes live on the deployed facet ABI; treat verified bytecode as
authoritative if this document drifts.

---

## Turn order & skipping (game-enforced)

Because the protocol does not enforce turns, **the game owns all turn logic** in `onPlayerAction`:

- A game with turns tracks its current actor (and any sub-turn structure) in `gameState`, and a normal
  move must `require(actor == currentActor)` itself.
- This is what lets an action trigger randomness and then route the **same** player to act again
  (`decide → WAITING_RANDOMNESS → onRandomness keeps currentActor → that player decides again`) — a
  shape a fixed protocol-level turn-guard could not express.

**Skipping a slacking player** falls straight out of this and needs **no protocol support**:

1. When the game hands a turn to a player, it writes a deadline into `gameState`
   (`deadline = block.timestamp + timeBank`).
2. It defines a `SKIP` action whose handler checks `block.timestamp > deadline` (and ignores the
   caller), then forfeits the no-show — they simply receive a **0 amount** at resolution (or are
   dropped from the active set) — and advances the turn.
3. Since the protocol forwards **any** caller to `onPlayerAction`, **anyone** (another player, or a
   keeper bot) can send the `SKIP` tx once the deadline passes; the laggard cannot stall the game.

```solidity
// inside onPlayerAction
(uint8 kind) = abi.decode(actionData, (uint8));
if (kind == SKIP) {
  require(block.timestamp > s.deadline, "not expired"); // caller is irrelevant
  // forfeit s.currentActor (0 amount), advance turn, set s.deadline = block.timestamp + timeBank
} else {
  require(actor == s.currentActor, "not your turn");
  require(block.timestamp <= s.deadline, "timed out"); // optional hard cutoff
  // apply move, advance turn, reset deadline (and/or requestRandomnessNow = true)
}
```

The guest decodes the deadline from `raw.gameState` (its own state) to render a countdown and a
"Skip" button — the protocol/host has no notion of it. A game that does **not** want permissionless
callers may additionally require membership for non-skip actions — but the skip path should stay open
to keep the game live.

---

## Cancellation and refunds

Unlike v1, the protocol does **not** define default fill / action / randomness timeout constants that
auto-cancel lobbies. Recovery is game policy via `canCancel`:

| Concern                  | v2 approach                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| Lobby never starts       | Game may allow the administrator, opener, or anyone to cancel while waiting                    |
| Mid-game abandon / stall | Prefer in-game skip + 0 amount at resolution; optional `canCancel` for full unwind             |
| Stuck randomness         | Protocol/provider operational concern; games should not strand funds on unfulfillable requests |
| Who gets money on cancel | Always full refund of each participant's aggregate stake — never a partial penalty             |

There is no protocol `leaveLobby` seat model. Leaving before start is either a game that allows
cancel/refund patterns or simply not entering again for single-entry games.

---

## Reference implementations

SDK reference games:

| Contract        | Path                                                                               | Demonstrates                                                                   |
| --------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `PointDuelGame` | [`../solidity/examples/PointDuelGame.sol`](../solidity/examples/PointDuelGame.sol) | Fixed stake, single entry, phase-gated admission, immediate proportional split |
| `JackpotGame`   | [`../solidity/examples/JackpotGame.sol`](../solidity/examples/JackpotGame.sol)     | Variable/repeat stakes, lobby keys, weighted ticket via ledger binary search   |

Full protocol facets, when deployed in this monorepo, live under `packages/contracts`. Treat the
deployed facet's verified ABI as authoritative if this doc drifts.

---

## Related docs

- [`CHAIN_WTF_PVP_GAMES.md`](./CHAIN_WTF_PVP_GAMES.md) — bridge, snapshot, manifest, frontend patterns
- [`RANDOMNESS_DICE.md`](./RANDOMNESS_DICE.md) — rejection sampling for d6
- [`VISUAL_AND_UX.md`](./VISUAL_AND_UX.md) — iframe UX expectations
