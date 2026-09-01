# Chain.wtf — building PvP games guide

Chain.wtf is a fully decentralized wagering platform (Sportsbook, Casino, fully on-chain **PvP
games**, and prediction markets) built on Coinbase's Base L2.

This document is **self-contained**: you can follow it from a separate repository (e.g. a Vite
frontend + Forge/Hardhat) without internal Chain.wtf source access. Inline code blocks are the
**canonical** types and patterns you need.

The PvP model is the sibling of the casino model documented in `@chain/casino-sdk`. The bridge
(host/guest over Penpal), the iframe/manifest model, and the snapshot-driven UI are the **same**.
The difference is the economic model:

- **Casino**: one player wagers against the **house liquidity pool**; the protocol backs winnings and
  prices risk via reserves.
- **PvP**: players wager against **each other** into a shared **pot**. The protocol takes a **fee**
  and the game decides how the rest of the pot is **settled**. No house liquidity is ever at risk.

API **v2** removes protocol-level assumptions that every participant pays the same buy-in, enters
once, or fits in a bounded seat array. A lobby has one escrow asset; the game decides admission,
stake validation, repeat entries, positions, lifecycle permissions, lobby keys, and settlement mode.

---

## 1. Platform model

**Host** (Chain.wtf web app) owns the user's wallet, Smart Vault, session keys, and all transaction
signing. It loads your game in an **iframe** and talks to it over a **promise-based bridge** (Penpal
over `postMessage`).

**Guest** (your game UI): **does not** connect a wallet or send raw transactions. It only:

- Encodes intent as ABI-encoded **`config`** / **`openData`** (at lobby creation), **`stake`** +
  **`entryData`** (per entry), and **`actionData`** (per action).
- Calls **`hostApi.createLobby` / `enterLobby` / `startLobby` / `submitAction` / `cancelLobby` /
  `claimWinnings` / `claimRefund` / `claimPayout`** — each returns a **Promise** (host
  signs/broadcasts txs). `claimPayout` is optional on the host API — feature-detect it.
- Pages large lists via **`getLobbyParticipants`** / **`getLobbyContributions`**.
- Renders from **`PvpHostSnapshotV2`**, pushed by the host via **`guestApi.setState(snapshot)`**
  whenever wallet, balances, lobbies, host-provided metadata, or UI settings change.

**Chain**: the protocol exposes a PvP facet on the diamond/proxy. Your deployed game contract
implements **`IPvpGameV2`**. The protocol owns escrow, the contribution ledger, phase transitions,
randomness requests, the protocol fee, and settlement transfers. It calls into your game's pure/view
hooks for **policy**. **Turn order is owned by the game, not the protocol** (see §2.3) — which is
what makes permissionless skipping of a slacking player possible.

---

## 2. On-chain architecture

### 2.1 `IPvpGameV2` (full Solidity)

Your game contract implements this interface. Phases, context, ledger views, and step results are
fixed by the platform. The authoritative source lives at
[`../solidity/IPvpGameV2.sol`](../solidity/IPvpGameV2.sol).

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

enum LobbyPhase {
  NONE,
  WAITING_FOR_PLAYERS,
  IN_PROGRESS,
  WAITING_RANDOMNESS,
  WAITING_PLAYER_ACTION,
  RESOLVED,
  CANCELLED
}

enum SettlementMode {
  NONE,
  IMMEDIATE,
  CLAIMABLE
}

/// Bounded lobby summary. Unbounded collections stay behind ledger views.
struct LobbyContext {
  uint256 lobbyId;
  bytes32 lobbyKey;
  address opener;
  address token;
  uint256 pot;
  uint256 participantCount;
  uint256 contributionCount;
  uint16 protocolFeeBps;
  uint32 step;
  LobbyPhase phase;
  bytes config;
  bytes gameState;
}

struct ParticipantContext {
  bool joined;
  uint256 totalStake;
  uint256 contributionCount;
}

struct ContributionRecord {
  uint256 contributionId; // dense 0-based per-lobby index in append order
  address participant;
  uint256 amount;
  bytes32 positionId;
  uint256 cumulativePot;
  uint64 contributedAt;
}

interface IPvpLobbyLedgerV2 {
  function getContribution(uint256 lobbyId, uint256 contributionId)
    external view returns (ContributionRecord memory);
  function participantAt(uint256 lobbyId, uint256 index) external view returns (address);
  function participantIndex(uint256 lobbyId, address participant)
    external view returns (bool joined, uint256 index);
  function getParticipantContext(uint256 lobbyId, address participant)
    external view returns (ParticipantContext memory);
  function getPositionStake(uint256 lobbyId, bytes32 positionId) external view returns (uint256);
}

struct LobbyOpenResult {
  bytes32 lobbyKey; // zero disables uniqueness; non-zero keys are unique per game
  bytes newGameState;
}

struct EntryResult {
  bytes32 positionId;
  bytes newGameState;
}

struct PvpStepResult {
  bytes newGameState;
  LobbyPhase nextPhase;
  bool requestRandomnessNow;
  address[] recipients; // used only on RESOLVED; the protocol derives the settlement mode:
                        // exactly 1 → IMMEDIATE (whole pot - fee), 0 or 2+ → CLAIMABLE
}

struct ClaimQuote {
  address recipient;
  uint256 amount;
  bool valid;
}

interface IPvpGameV2 {
  function onLobbyOpen(
    LobbyContext calldata ctx,
    address opener,
    bytes calldata openData
  ) external view returns (LobbyOpenResult memory);

  function onEntry(
    LobbyContext calldata ctx,
    ParticipantContext calldata participant,
    address entrant,
    uint256 stake,
    bytes calldata entryData
  ) external view returns (EntryResult memory);

  function onLobbyStart(
    LobbyContext calldata ctx,
    address actor,
    bytes calldata actionData
  ) external view returns (PvpStepResult memory);

  function onPlayerAction(
    LobbyContext calldata ctx,
    address actor,
    bytes calldata actionData
  ) external view returns (PvpStepResult memory);

  function onRandomness(
    LobbyContext calldata ctx,
    bytes32 randomness
  ) external view returns (PvpStepResult memory);

  function canCancel(
    LobbyContext calldata ctx,
    address actor,
    bytes calldata cancelData
  ) external view returns (bool);

  function getClaim(
    LobbyContext calldata ctx,
    bytes32 claimId,
    bytes calldata claimData
  ) external view returns (ClaimQuote memory);
}
```

**Semantics:**

- **`onLobbyOpen`**: Validate asset/config/open data at creation. Optionally return a non-zero
  **`lobbyKey`** for game-scoped uniqueness (e.g. Jackpot keys by token + config). The opener is
  recorded but carries **no implicit authority**.
- **`onEntry`**: Accept or reject the caller's explicit stake (including zero) and return a
  **`positionId`**. Zero stake and repeated entry are valid protocol inputs; the game decides
  whether they are valid for that lobby. Revert to reject. Games that only allow entry while
  waiting for players must check `ctx.phase` themselves — the protocol does not invent a seat model.
- **`onLobbyStart`**: Validate who may start and whether the lobby is ready, then return the first
  step result (initial `gameState`, phase, optional randomness request).
- **`onPlayerAction`**: Called when a participant submits `actionData`. The protocol does **not**
  enforce turn order — it forwards the actor and your game decides what is valid (see §2.3).
- **`onRandomness`**: Called when the randomness provider fulfills a request. Can route the next turn
  back to the **same** player, enabling `decide → randomness → decide again` loops.
- **`canCancel`**: Own every normal and recovery cancellation permission. Cancellation always refunds
  full stakes; there is no protocol fill/action timeout policy.
- **`getClaim`**: For **claimable** settlement, compute one stable claim ID's recipient and amount
  from final state. The protocol records collected IDs and caps total transfers at the remaining
  distributable pot.

Game hooks remain **`view`**. Read the contribution ledger through `msg.sender` as
`IPvpLobbyLedgerV2` — do not maintain a parallel mutable copy of balances.

#### Consuming randomness: unbiased d6

When mapping facet **`bytes32`** randomness to six-sided dice via **raw bytes**, use **rejection
sampling** (`byte < 252`, then `(byte % 6) + 1`) — not `randomness[i] % 6` alone. For many independent
dice from one word, `keccak256(abi.encode(randomness, salt))` then `word % 6` is acceptable. Details:
**[`RANDOMNESS_DICE.md`](./RANDOMNESS_DICE.md)**.

#### Pot accounting and settlement

There is **no** `escrowDelta` / `reservedProfit` machinery. The lobby's **stake token** is chosen at
open from a governance-controlled whitelist. Stakes are pulled by the protocol on each accepted
entry. Your game never moves tokens; it only chooses settlement at resolution:

The settlement mode is **derived from `recipients.length`** on the resolving step:

| Mode        | When                                                                            | Who executes transfers                                                                                |
| ----------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `IMMEDIATE` | Exactly **1** recipient — it receives the whole pot − fee                       | Protocol, in the resolving transaction; a failed transfer parks the payout for `claimPayout(lobbyId)` |
| `CLAIMABLE` | **0** recipients (not enumerable) or **2+**; `getClaim(claimId)` quotes payouts | Anyone may call claim; recipient is fixed by the game                                                 |
| `CANCELLED` | Not a game result — always full refunds of each participant's aggregate stake   | Anyone may claim refund per participant                                                               |

Because claim amounts are explicit base units (not basis-point shares), any scoring system still
maps cleanly under claimable settlement:

| Scoring                        | Claim quote idea (3 players, pot after fee = 100) |
| ------------------------------ | ------------------------------------------------- |
| Winner-take-all                | `[100, —, —]` (omit zero seats)                   |
| Fixed places 50/30/20          | `[50, 30, 20]`                                    |
| Points-based (scores 30/10/10) | `[60, 20, 20]`                                    |
| Draw / even split              | `[34, 33, 33]` (assign dust so the sum is exact)  |

Immediate settlement is reserved for the single-winner case (1v1 duels, jackpots); every
multi-recipient distribution settles via claims.

### 2.2 Protocol responsibilities (summary)

Conceptual entrypoints (your deployment uses the protocol's verified ABI):

| Entry                      | Role                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Open lobby                 | Whitelist game + token; call `onLobbyOpen`; store opener, config, optional lobby key; start in `WAITING_FOR_PLAYERS`. No stake yet.  |
| Enter lobby                | Call `onEntry` with the caller's explicit stake; escrow funds; append a contribution ledger row; update participant/position totals. |
| Start lobby                | Call `onLobbyStart(actor, …)`; game validates readiness and who may start.                                                           |
| Submit action              | Forward `msg.sender` to `onPlayerAction` **without** enforcing turn order.                                                           |
| Randomness fulfilled       | Run `onRandomness`.                                                                                                                  |
| Cancel lobby               | Require `canCancel`; mark `CANCELLED`; each participant's aggregate stake becomes independently refundable.                          |
| Claim winnings / refund    | Claimable payouts via `getClaim`; cancellation refunds via ledger totals.                                                            |
| Ledger / participant views | Indexed reads for games; paginated reads for hosts.                                                                                  |

On a step returning `nextPhase == RESOLVED`, the protocol validates the recipients (no zero
addresses) and derives the mode. With exactly one recipient it deducts the fee and attempts the
payout transfer — if it fails, the payout is parked and collected via the permissionless
`claimPayout(lobbyId)`. Otherwise it records the remaining distributable pot and lets claims drain
it.

What the protocol **does not** own: player caps, fixed buy-ins, one-entry-per-address rules, opener
privileges, or timeout cancellation. Those are game policy (or intentionally absent).

### 2.3 Patterns: free-for-all, scheduled jackpot, turn-based

**Free-for-all fixed stake (e.g. Point Duel)** — every participant submits once, order-independent:

- `onLobbyOpen` validates `requiredStake` + administrator in `config`.
- `onEntry` requires `WAITING_FOR_PLAYERS`, exact stake, single entry, and a game-defined seat cap
  (Point Duel caps at ten to bound score arithmetic).
- `onLobbyStart` requires the configured administrator and `participantCount >= 2`, then
  **`IN_PROGRESS`**.
- `onPlayerAction` records the score; when the last player submits, **`RESOLVED`** with the
  positive scorers as `recipients` — a lone scorer is paid the whole distributable pot immediately;
  otherwise each recipient claims their proportional share with their address as the claim id
  (dust to the highest scorer).

**Scheduled weighted jackpot (e.g. Jackpot)** — variable stakes, repeat entries, one winner:

- `onLobbyOpen` sets `lobbyKey = keccak256(abi.encode(token, config))` so distinct schedules/assets
  cannot collide and keys cannot be squatted with a different administrator.
- `onEntry` time-gates on `opensAt`/`closesAt`, enforces `minimumStake`, and reuses an address-derived
  `positionId` so repeats aggregate.
- `onLobbyStart` (anyone, after close) requests randomness.
- `onRandomness` rejection-samples a ticket in `[0, pot)`, binary-searches dense contribution IDs by
  `cumulativePot`, and pays the winner **immediately**.

**Turn-based (e.g. heads-up poker, a board game)** — the game owns turn order in `gameState`:

- `onLobbyStart` → **`WAITING_PLAYER_ACTION`**, record the current actor (via `participantAt` /
  indexes) in `gameState`.
- `onPlayerAction` validates the actor against your own current actor, applies the move, and advances
  state. There is no protocol-level "next actor"; the guest reads it back from `raw.gameState`.
- An action may go **`WAITING_RANDOMNESS`** (`requestRandomnessNow = true`); `onRandomness` may hand
  the turn **back to the same player**.

**Skipping a slacking player** (no protocol support needed): store
`deadline = block.timestamp + timeBank` in `gameState`. Define a `SKIP` action that checks
`block.timestamp > deadline` (ignoring the caller) and forfeits the no-show — they get a **0 amount**
at resolution or are dropped from the active set — then advances. Because the protocol forwards
**any** caller, another player or a keeper can send the skip once the deadline passes. Your guest
decodes the deadline from `raw.gameState` to render a countdown.

```solidity
// inside onPlayerAction; State holds currentActor + deadline + your game data
(uint8 kind) = abi.decode(actionData, (uint8));
if (kind == SKIP) {
  require(block.timestamp > s.deadline, "not expired"); // caller irrelevant — anyone may poke
  // forfeit s.currentActor, advance turn, s.deadline = block.timestamp + timeBank
} else {
  require(actor == s.currentActor, "not your turn");
  // apply move; advance turn (or requestRandomnessNow = true); reset s.deadline
}
```

### 2.4 Sequence: open → enter → start → act → resolve

```mermaid
sequenceDiagram
  participant Guest as Game_iframe
  participant Host as Host_app
  participant Facet as PvpFacet
  participant Game as IPvpGameV2

  Guest->>Host: createLobby(asset, config, openData)
  Host->>Facet: openLobby(...)
  Facet->>Game: onLobbyOpen(ctx, opener, openData)
  Facet-->>Host: lobbyId
  Host->>Guest: setState(PvpHostSnapshotV2)

  Note over Guest,Facet: players enter with explicit stakes
  Guest->>Host: enterLobby(lobbyId, stake, entryData)
  Host->>Facet: enterLobby
  Facet->>Game: onEntry(ctx, participant, entrant, stake, entryData)
  Note over Facet: escrow stake; append contribution ledger
  Host->>Guest: setState(...)

  Guest->>Host: startLobby(lobbyId, actionData, ...)
  Host->>Facet: startLobby
  Facet->>Game: onLobbyStart(ctx, actor, actionData)
  Host->>Guest: setState(...)

  loop Player_actions
    Guest->>Host: submitAction(lobbyId, actionData, ...)
    Host->>Facet: submitAction
    Facet->>Game: onPlayerAction(ctx, actor, actionData)
    Game-->>Facet: PvpStepResult (maybe RESOLVED + settlement)
    Host->>Guest: setState(...)
  end

  Note over Facet,Game: IMMEDIATE pays the single winner; CLAIMABLE uses getClaim later
```

---

## 3. Bridge SDK (guest + host)

The package is **`@chain/pvp-sdk`** (`./guest`, `./host`, `.`). It is structurally identical to
`@chain/casino-sdk` — only the typed API/snapshot shapes differ.

**Dependency:** `penpal` **^7.0.4**.

### 3.1 `guest.ts` (iframe / game side)

```typescript
import { WindowMessenger, connect } from 'penpal';
import type { Connection } from 'penpal';
import type { PvpGuestApiV2, PvpHostApiV2 } from './types';

export type {
  PvpGuestApiV2,
  PvpHostApiV2,
  PvpHostMetadataV2,
  PvpHostSnapshotV2,
  PvpLobbyMetadataV2,
  PvpMetadataBag,
  PvpMetadataPrimitive,
  PvpMetadataValue,
  PvpPlayerMetadataV2,
  PvpRoomMetadataV2,
  PvpRoomParticipantMetadataV2,
} from './types';

export type PvpGuestBridgeConnection = Connection<PvpHostApiV2>;

const getAllowedParentOrigins = (): string[] => {
  if (typeof document === 'undefined' || !document.referrer) return ['*'];
  try {
    return [new URL(document.referrer).origin];
  } catch {
    return ['*'];
  }
};

export const connectGameToHost = (methods: PvpGuestApiV2): PvpGuestBridgeConnection =>
  connect<PvpHostApiV2>({
    messenger: new WindowMessenger({
      remoteWindow: window.parent,
      allowedOrigins: getAllowedParentOrigins(),
    }),
    methods,
  });
```

Also export **`reportGameContentSize`** / **`observeGameContentSize`** so games with
`capabilities.resize` can report dynamic iframe height to the host.

### 3.2 Guest lifecycle (required pattern)

1. On mount, call **`connectGameToHost`** with **`PvpGuestApiV2`** where **`setState`** stores the
   latest snapshot in component state.
2. **`await connection.promise`** to receive **`PvpHostApiV2`** — enable buttons that call lobby/action
   methods only after it resolves.
3. Optionally call **`observeGameContentSize(hostApi)`** when resize is supported.
4. On unmount, call **`connection.destroy()`** (and disconnect the size observer).

```tsx
import { useEffect, useState } from 'react';
import {
  connectGameToHost,
  observeGameContentSize,
  type PvpGuestApiV2,
  type PvpHostApiV2,
  type PvpHostSnapshotV2,
} from '@chain/pvp-sdk/guest';

export function App() {
  const [hostApi, setHostApi] = useState<PvpHostApiV2 | null>(null);
  const [snapshot, setSnapshot] = useState<PvpHostSnapshotV2 | null>(null);

  useEffect(() => {
    let mounted = true;
    const guestMethods: PvpGuestApiV2 = {
      async setState(next) {
        if (mounted) setSnapshot(next);
      },
    };
    const connection = connectGameToHost(guestMethods);
    let sizeObserver: { disconnect(): void } | undefined;
    void connection.promise.then(parent => {
      if (!mounted) return;
      setHostApi(parent);
      sizeObserver = observeGameContentSize(parent);
    });
    return () => {
      mounted = false;
      sizeObserver?.disconnect();
      connection.destroy();
    };
  }, []);

  if (!hostApi || !snapshot) return <section>Connecting to host…</section>;
  return null;
}
```

The host side mirrors `@chain/casino-sdk` — use `connectHostToGame({ iframe, childOrigin, methods })`
with stable method references that delegate to the latest closure, and call `guestApi.setState` on
every snapshot change.

---

## 4. Using `PvpHostSnapshotV2` in the game UI

| Field             | Use                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wallet.status`   | Enable lobby actions only when **`'ready'`**.                                                                                                                                   |
| `assets[]`        | Token list with optional `decimals` / `balance` / `iconUrl`. Format stakes with the lobby's own `asset`.                                                                        |
| `protocol.feeBps` | Preview the protocol cut; chain remains authoritative.                                                                                                                          |
| `lobbies.items`   | Each lobby: `phaseName`, `pot`, `opener`, `asset`, counts, optional `lobbyKey`, `viewer`, `settlement`, `raw.*`.                                                                |
| `lobby.viewer`    | Connected address's aggregate stake and contribution count if they have entered, plus claim state (`claimed`, `claimedAmount`, `claimedClaimIds`) after a claimable settlement. |
| `metadata.room`   | Host-app room context: room id/slug/title, invite URL, optional participants for presence UI.                                                                                   |
| `metadata.viewer` | Host-app profile for the connected viewer.                                                                                                                                      |
| `lobby.metadata`  | Host-provided lobby labels, invite URL, or other presentation-only details.                                                                                                     |

**Identify yourself**: match `wallet.address` to participant pages, or use `lobby.viewer` /
`isYou` on paged participants. Prefer `metadata.displayName` / `username` when present; fall back to
shortened addresses.

**Large lobbies**: snapshots carry **counts**, not full `players[]` arrays. Page with:

```ts
const participants = await hostApi.getLobbyParticipants({ lobbyId, limit: 50 });
const contributions = await hostApi.getLobbyContributions({ lobbyId, limit: 100 });
```

**Whose turn**: there is no `nextActor` in the snapshot — turn order is the game's own state. Decode
`raw.gameState` to find the current actor and enable the action UI only on the connected wallet's
turn. Treat the contract as authoritative; a submit may still revert if state moved.

**Host metadata is display-only**: `snapshot.metadata`, `lobby.metadata`, and participant metadata
are supplied by the parent app over the iframe bridge. They are useful for names, avatars, room
titles, invite links, spectator lists, and feature flags. Do **not** use them for authoritative game
rules, turn ownership, eligibility, scoring, payouts, or anything that must match contract state.
Room membership is **not** on-chain admission — restricted games must verify signed `entryData`.

Example host-provided metadata:

```typescript
const metadata: PvpHostSnapshotV2['metadata'] = {
  viewer: {
    username: 'alice',
    displayName: 'Alice',
    avatarUrl: 'https://example.com/alice.png',
  },
  room: {
    roomId: 'room_123',
    title: 'Friday table',
    inviteUrl: 'https://chain.wtf/rooms/room_123',
    participants: [
      {
        address: '0x1111111111111111111111111111111111111111',
        username: 'alice',
        role: 'player',
      },
      {
        address: '0x2222222222222222222222222222222222222222',
        username: 'bob',
        role: 'player',
      },
    ],
  },
};

const lobbyMetadata: NonNullable<PvpHostSnapshotV2['lobbies']['items'][number]['metadata']> = {
  title: 'Table 1',
  inviteUrl: 'https://chain.wtf/rooms/room_123/lobbies/1',
};
```

Example guest-side participant label:

```typescript
function participantLabel(p: {
  address: `0x${string}`;
  metadata?: { displayName?: string; username?: string };
}) {
  return (
    p.metadata?.displayName ??
    p.metadata?.username ??
    `${p.address.slice(0, 6)}...${p.address.slice(-4)}`
  );
}
```

**Skip a slacker**: decode the per-turn deadline you stored in `raw.gameState`; once it has passed,
show a **Skip** button (to any player, not just the current actor) that submits the game's `SKIP`
action.

**Terminal phases**:

- **`RESOLVED`** — read `lobby.settlement` (`IMMEDIATE` winner/amount or claimable remaining).
- **`CANCELLED`** — full stakes refundable via `claimRefund` per participant (not a batch payout).

---

## 5. `game.manifest.json` — host validation

The TypeScript type **`PvpGameManifestV2`** and the host validator **`validatePvpGameManifest`**
require **`presentation`**, **`lobby`**, and **`capabilities`**.

```json
{
  "schemaVersion": 2,
  "gameId": "PointDuelGame",
  "apiVersion": 2,
  "defaultLocale": "en",
  "locales": {
    "en": {
      "name": "Point Duel",
      "description": "Each player submits a score; the pot is split in proportion to scores."
    }
  },
  "presentation": {
    "mode": "full-iframe",
    "hostPanels": { "lobby": false, "history": false, "status": false }
  },
  "lobby": {
    "access": "public",
    "entries": "single",
    "defaultStake": "1000000",
    "usesLobbyKeys": false
  },
  "capabilities": {
    "createLobby": true,
    "enterLobby": true,
    "startLobby": true,
    "submitAction": true,
    "cancelLobby": true,
    "claimWinnings": false,
    "claimRefund": true,
    "claimPayout": true,
    "resize": true
  }
}
```

Manifest `lobby` fields are **catalog/UI hints only** — the contract remains authoritative:

| Field           | Meaning                                                            |
| --------------- | ------------------------------------------------------------------ |
| `access`        | `public` or `game-defined` (e.g. signed invitation in `entryData`) |
| `entries`       | `single`, `repeatable`, or `game-defined`                          |
| `defaultStake`  | Optional base-unit string to prefill stake inputs                  |
| `usesLobbyKeys` | Whether the game may assign keyed canonical lobbies                |

`gameId` must match the canonical id derived from on-chain registration (`canonicalPvpGameId` strips
a trailing `Game`, lowercases, keeps alphanumerics). Serve the manifest at the **same origin** as the
game URL.

---

## 6. Frontend patterns

Use `viem` for `encodeAbiParameters` / `decodeAbiParameters` / `formatUnits` / `parseUnits`.
`EMPTY_HEX = '0x'` is valid for unused opaque fields.

### 6.1 Open a lobby (asset + game config; opener is not privileged)

Point Duel config is `(uint256 requiredStake, address administrator)`:

```tsx
const EMPTY_HEX = '0x' as const;

async function handleCreate(
  hostApi: PvpHostApiV2,
  asset: `0x${string}`,
  requiredStake: bigint,
  administrator: `0x${string}`,
) {
  const config = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'address' }],
    [requiredStake, administrator],
  );

  const { lobbyId } = await hostApi.createLobby({
    asset,
    config,
    openData: EMPTY_HEX,
    randomnessRequestData: EMPTY_HEX,
  });
  // Track lobbyId until it appears in snapshot.lobbies.items
}
```

### 6.2 Enter with an explicit stake

```tsx
await hostApi.enterLobby({
  lobbyId,
  stake: requiredStake.toString(), // base units; '0' is valid at the protocol boundary
  entryData: EMPTY_HEX, // or a signed invitation for restricted lobbies
});
```

### 6.3 Start / act / cancel

```tsx
await hostApi.startLobby({ lobbyId, actionData: EMPTY_HEX, randomnessRequestData: EMPTY_HEX });
await hostApi.submitAction({
  lobbyId,
  actionData: encodeAbiParameters([{ type: 'uint256' }], [score]),
  randomnessRequestData: EMPTY_HEX,
});
await hostApi.cancelLobby({ lobbyId, cancelData: EMPTY_HEX }); // game decides who may cancel
```

### 6.4 Settle and claim

```tsx
// IMMEDIATE: host shows lobby.settlement.immediate after resolution — no claim tx unless the
// payout transfer failed and is parked (settlement.immediate.deferred). Collection is
// permissionless and always pays the recorded winner. claimPayout is optional on the host API:
if (lobby.settlement?.immediate?.deferred && hostApi.claimPayout) {
  await hostApi.claimPayout({ lobbyId });
}

// CLAIMABLE: skip the tx when the snapshot already shows the claim as collected. A returning
// player's `lobby.viewer` carries `claimed`, `claimedAmount`, and `claimedClaimIds` — check the
// specific claimId when the game issues several claims per player, or `claimed` when it issues one.
if (!lobby.viewer?.claimedClaimIds?.includes(claimId)) {
  await hostApi.claimWinnings({ lobbyId, claimId, claimData: EMPTY_HEX });
}

// CANCELLED:
await hostApi.claimRefund({ lobbyId, participant: walletAddress });
```

### 6.5 Render the result

When `lobby.phaseName === 'RESOLVED'`, read `lobby.settlement`:

- **Immediate** — `winner` / `amount` (with a `deferred` flag while a failed transfer awaits
  `claimPayout`), plus `feeAmount`.
- **Claimable** — remaining pot and per-claim quotes from the game. `lobby.viewer.claimed` /
  `claimedAmount` / `claimedClaimIds` tell a returning player their claim already went through, so
  render a "claimed" state instead of the claim button and skip the redundant transaction.

Decode `lobby.raw.gameState` for game-specific detail (scores, winner ticket, board).

---

## 7. Restricted lobbies

Restricted admission is entirely game-specific. A typical pattern:

1. Backend verifies external requirements (room membership, invite list, KYC flag, …).
2. Backend signs an address-bound credential scoped to chain ID, game, lobby, expiry, and nonce.
3. The entrant passes that signature as `entryData` on the first `enterLobby`.
4. `onEntry` recovers the signer, checks binding fields, and accepts or rejects.

Host `room` metadata remains display-only. It must never substitute for on-chain game admission.

---

## 8. Host integrator checklist (signing + snapshot)

1. **createLobby:** Call open with whitelisted game + asset and the guest-supplied `config` /
   `openData`. Parse `lobbyId` from the creation log. Opening does **not** pull stake.
2. **enterLobby:** Prepend ERC20 `approve` for the explicit stake, then enter. Parse
   `contributionId` if the host surfaces ledger rows.
3. **submitAction:** Forward from the player's wallet. Turn ownership is **not** enforced by the
   protocol — the game validates on-chain; the guest decodes whose-turn / deadlines from
   `raw.gameState`.
4. **Pagination:** Snapshot only carries counts. Host APIs must page participants and contributions
   for the iframe.
5. **Snapshot freshness:** Merge indexer lobby list with on-chain reads so `raw.config` /
   `raw.gameState` / `settlement` match chain bytes for decoding in the iframe.
6. **Metadata:** Attach display-only host context to `snapshot.metadata`, `lobby.metadata`, and
   participant metadata. Common fields: username, display name, avatar, profile URL, room id/title,
   invite URL, participants/spectators, and app-specific JSON under `custom`.
7. **Push updates:** Call `guestApi.setState` whenever wallet, assets, lobby rows, fee, metadata,
   locale, theme, or viewport change.

---

## 9. Security notes

- Penpal **origin allowlisting** works exactly as in `@chain/casino-sdk` (host passes `childOrigin`;
  guest allows the referrer origin, else `*` for development only).
- **Never** trust client-only math for settlement — treat `gameState`, `pot`, and `settlement` as
  **hints**; the **protocol + game contract** are authoritative. Resolution recipients are
  validated (no zero addresses; exactly one means an immediate full-pot payout) before funds move.
- Games must **phase-gate entries** and bound player-submitted numbers that feed arithmetic — see
  [`PVP_CONTRACT_CONSTRAINTS.md`](./PVP_CONTRACT_CONSTRAINTS.md) and the reference games.
- Treat host-provided metadata as untrusted presentation data. It may be missing, stale, or changed by
  the parent app; never encode assumptions from it into `config` / `entryData` / `actionData` unless
  the contract independently verifies the same rule.

---

_End of document._
