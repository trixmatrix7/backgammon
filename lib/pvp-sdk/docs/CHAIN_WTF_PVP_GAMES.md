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
  and the game decides how the rest of the pot is **split**. No house liquidity is ever at risk.

---

## 1. Platform model

**Host** (Chain.wtf web app) owns the user's wallet, Smart Vault, session keys, and all transaction
signing. It loads your game in an **iframe** and talks to it over a **promise-based bridge** (Penpal
over `postMessage`).

**Guest** (your game UI): **does not** connect a wallet or send raw transactions. It only:

- Encodes intent as ABI-encoded **`config`** (at lobby creation) and **`actionData`** (per action).
- Calls **`hostApi.createLobby` / `joinLobby` / `leaveLobby` / `startLobby` / `submitAction` /
  `cancelLobby`** — each returns a **Promise** (host signs/broadcasts txs).
- Renders from **`PvpHostSnapshotV1`**, pushed by the host via **`guestApi.setState(snapshot)`**
  whenever wallet, balances, lobbies, host-provided metadata, or UI settings change.

**Chain**: the protocol exposes a **`PvpGameFacet`** on the diamond/proxy. Your deployed game
contract implements **`IPvpGameV1`**. The facet orchestrates lobby creation, buy-in escrow, the pot,
randomness requests, the protocol fee, and payout distribution. It calls into your game's pure/view
step handlers. **Turn order is owned by the game, not the facet** (see §2.3) — which is what makes
permissionless skipping of a slacking player possible.

---

## 2. On-chain architecture

### 2.1 `IPvpGameV1` (full Solidity)

Your game contract implements this interface. Phases, context, and step results are fixed by the
platform.

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

struct PlayerSlot {
  address player;
  address vault;
  uint256 buyIn;
  uint64 joinedAt;
}

struct LobbyContext {
  uint256 lobbyId;
  address creator;
  uint256 buyIn;
  uint256 pot;
  uint8 maxPlayers; // seat cap chosen by the creator
  uint32 step;
  bytes config;
  bytes gameState;
  PlayerSlot[] players;
}

struct PayoutSplit {
  address[] players;
  uint256[] shareBps; // sums to 10_000 of the distributable pot (pot - protocol fee)
}

struct PvpStepResult {
  bytes newGameState;
  LobbyPhase nextPhase;
  bool requestRandomnessNow; // valid from any handler, incl. onPlayerAction
  // no "next actor": whose turn it is lives in newGameState, at the game's discretion
  PayoutSplit payout; // only when nextPhase == RESOLVED
  uint8 outcome;
}

interface IPvpGameV1 {
  // No quoteLobby: the creator picks buyIn + maxPlayers at createLobby; the game owns the rest.
  function canStart(LobbyContext calldata ctx) external view returns (bool);

  function onLobbyStart(LobbyContext calldata ctx) external view returns (PvpStepResult memory);

  function onPlayerAction(
    LobbyContext calldata ctx,
    address player,
    bytes calldata actionData
  ) external view returns (PvpStepResult memory);

  function onRandomness(
    LobbyContext calldata ctx,
    bytes32 randomness
  ) external view returns (PvpStepResult memory);
}
```

**Semantics:**

- **`canStart`**: The game's sole lobby-validation hook — the facet has **no** `quoteLobby`. The
  creator chooses `buyIn` and the seat cap `maxPlayers` at `createLobby`; everything else (minimum
  players, team parity, `config` invariants) is enforced here. The facet calls it on `startLobby` and
  on fill (for auto-start).
- **`onLobbyStart`**: Called once when the lobby starts. Return the initial opaque **`newGameState`**
  (record whose turn it is here, if your game has turns) and the next phase (e.g.
  `WAITING_PLAYER_ACTION`, `IN_PROGRESS` for free-for-all submission, or `WAITING_RANDOMNESS` if you
  deal cards first).
- **`onPlayerAction`**: Called when a player submits `actionData`. The facet does **not** enforce turn
  order — it forwards `msg.sender` as `player` and your game decides what is valid (validate
  `player` against your own current actor for normal moves; see §2.3 for skipping). May return
  `requestRandomnessNow = true` to roll as part of the action.
- **`onRandomness`**: Called when the randomness provider fulfills a request. Can route the next turn
  back to the **same** player, enabling `decide → randomness → decide again` loops.

#### Consuming randomness: unbiased d6

When mapping facet **`bytes32`** randomness to six-sided dice via **raw bytes**, use **rejection
sampling** (`byte < 252`, then `(byte % 6) + 1`) — not `randomness[i] % 6` alone. For many independent
dice from one word, `keccak256(abi.encode(randomness, salt))` then `word % 6` is acceptable (see
`DicePokerGame`). Details: **[`RANDOMNESS_DICE.md`](./RANDOMNESS_DICE.md)** (same rules as
[`@chain/casino-sdk`](../casino-sdk/docs/RANDOMNESS_DICE.md)).

**Pot accounting (the key difference from casino):**

There is **no** `escrowDelta` / `reservedProfit` machinery. The lobby's **stake token** is chosen by
the creator at `createLobby` from a **governance-controlled whitelist** (`setPvpTokenWhitelisted` /
`isPvpTokenWhitelisted`) — restricting stakes to vetted, standard ERC20s keeps the pot accounting
sound and protects players from junk/malicious tokens. Buy-ins are pulled into the pot by the facet on
`createLobby`/`joinLobby`. Your game never moves tokens; it only decides the **split** at resolution by
returning a `PayoutSplit`:

- `shareBps[i]` is the basis-point share of the **distributable** pot for `players[i]`.
- The facet computes `fee = pot * protocolFeeBps / 10_000`, `distributable = pot - fee`, then pays
  each listed player `distributable * shareBps[i] / 10_000`.
- `shareBps` **must sum to exactly 10_000**, and every address must be a lobby member, or the facet
  reverts (`PvpGameFacet__InvalidPayoutSplit`).
- A "loser" is simply a member with a 0 share (or omitted from the array) — they forfeit their buy-in
  to the winners.

Because you return _shares_, any scoring system maps cleanly:

| Scoring                        | `shareBps` example (3 players) |
| ------------------------------ | ------------------------------ |
| Winner-take-all                | `[10000, 0, 0]`                |
| Fixed places 50/30/20          | `[5000, 3000, 2000]`           |
| Points-based (scores 30/10/10) | `[6000, 2000, 2000]`           |
| Draw / refund-ish split        | `[3334, 3333, 3333]`           |

### 2.2 `PvpGameFacet` responsibilities (summary)

The facet (names only — your deployment uses the protocol's verified ABI):

| Entry                                                                        | Role                                                                                                                                                                 |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createLobby(game, token, buyIn, maxPlayers, config, randomnessRequestData)` | Validates the game + **token** are whitelisted, `buyIn > 0`, `maxPlayers >= 2`; pulls the creator's buy-in into the pot; creates the lobby in `WAITING_FOR_PLAYERS`. |
| `joinLobby(lobbyId, vault, randomnessRequestData)`                           | Requires `WAITING_FOR_PLAYERS` and a free seat; pulls the buy-in; if `canStart` and the game auto-starts (or the lobby is full), runs `onLobbyStart`.                |
| `leaveLobby(lobbyId)`                                                        | Only while `WAITING_FOR_PLAYERS`; refunds the caller's buy-in and frees the seat.                                                                                    |
| `startLobby(lobbyId)`                                                        | Creator-only; requires `canStart`; runs `onLobbyStart`.                                                                                                              |
| `submitAction(lobbyId, actionData, randomnessRequestData)`                   | Requires an active phase; forwards `msg.sender` to `onPlayerAction` **without** enforcing turn order (the game validates). Lets anyone submit a deadline-gated skip. |
| `onRandomnessFulfilled(requestId, randomness)`                               | Provider callback; runs `onRandomness`.                                                                                                                              |
| `getLobby(lobbyId)`                                                          | View the full lobby struct (players, pot, `config`, `gameState`, phase, deadlines).                                                                                  |
| `cancelLobby` / `forfeitExpiredLobby`                                        | Refund buy-ins when a lobby never starts, stalls past a deadline, or a player abandons a turn (facet rules).                                                         |

On a step returning `nextPhase == RESOLVED`, the facet validates the `PayoutSplit`, deducts the
protocol fee, distributes the pot, and marks the lobby `RESOLVED`.

### 2.3 Patterns: free-for-all vs. turn-based

**Free-for-all (e.g. Point Duel)** — every player submits once, order-independent:

- `onLobbyStart` → **`IN_PROGRESS`** (open submission; no turn order to track).
- `onPlayerAction` records the submission; when the last player submits, transition to
  **`RESOLVED`** with a `PayoutSplit`.

**Turn-based (e.g. heads-up poker, a board game)** — the game owns turn order in `gameState`:

- `onLobbyStart` → **`WAITING_PLAYER_ACTION`**, record the current actor (e.g. `players[0].player`) in
  `gameState`.
- `onPlayerAction` validates `player` against your own current actor (`require(player ==
currentActor)`), applies the move, and advances the actor in `gameState`. The facet does not reject
  wrong-turn callers for you — your `require` does. There is no protocol-level "next actor"; it is
  entirely the game's bookkeeping, and the game's own UI reads it back from `raw.gameState`.
- An action may go **`WAITING_RANDOMNESS`** (`requestRandomnessNow = true`) to deal/roll; `onRandomness`
  then continues — and may hand the turn **back to the same player** (decide → randomness → decide
  again), since you control the actor in `gameState`. Repeat until a terminal **`RESOLVED`**.

**Skipping a slacking player** (no facet support needed): when you hand someone the turn, also store
`deadline = block.timestamp + timeBank` in `gameState`. Define a `SKIP` action that checks
`block.timestamp > deadline` (ignoring the caller) and forfeits the no-show — they get a **0 share**
at resolution — then advances. Because the facet forwards **any** caller, another player or a keeper
bot can send the skip once the deadline passes, so no one can stall the game by going offline. Your
guest decodes the deadline from `raw.gameState` (it's the game's own state) to render a countdown.

```solidity
// inside onPlayerAction; State holds currentActor + deadline + your game data
(uint8 kind) = abi.decode(actionData, (uint8));
if (kind == SKIP) {
  require(block.timestamp > s.deadline, "not expired"); // caller irrelevant — anyone may poke
  // forfeit s.currentActor, advance turn, s.deadline = block.timestamp + timeBank
} else {
  require(player == s.currentActor, "not your turn");
  // apply move; advance turn (or requestRandomnessNow = true); reset s.deadline
}
```

### 2.4 Sequence: create → join → start → act → resolve

```mermaid
sequenceDiagram
  participant Guest as Game_iframe
  participant Host as Host_app
  participant Facet as PvpGameFacet
  participant Game as IPvpGameV1

  Guest->>Host: createLobby(buyIn, maxPlayers, config)
  Host->>Facet: createLobby(game, token, buyIn, maxPlayers, config, ...)
  Facet-->>Host: lobbyId (CONFIRM: PvpLobbyCreated log)
  Host->>Guest: setState(PvpHostSnapshotV1)

  Note over Guest,Facet: other players join (own wallets) → snapshot updates
  Guest->>Host: joinLobby(lobbyId)
  Host->>Facet: joinLobby
  Facet->>Game: canStart(ctx)
  alt full / auto-start
    Facet->>Game: onLobbyStart(ctx)
  end
  Host->>Guest: setState(...)

  loop Player_actions
    Guest->>Host: submitAction(lobbyId, actionData, ...)
    Host->>Facet: submitAction
    Facet->>Game: onPlayerAction(ctx, player, actionData)
    Game-->>Facet: PvpStepResult (maybe RESOLVED + PayoutSplit)
    Host->>Guest: setState(...)
  end

  Note over Facet,Game: on RESOLVED: fee = pot*feeBps/1e4; distribute pot-fee by shareBps
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
import type { PvpGuestApiV1, PvpHostApiV1 } from './types';

export type {
  PvpGuestApiV1,
  PvpHostApiV1,
  PvpHostMetadataV1,
  PvpHostSnapshotV1,
  PvpLobbyMetadataV1,
  PvpMetadataBag,
  PvpMetadataPrimitive,
  PvpMetadataValue,
  PvpPlayerMetadataV1,
  PvpRoomMetadataV1,
  PvpRoomParticipantMetadataV1,
} from './types';

export type PvpGuestBridgeConnection = Connection<PvpHostApiV1>;

const getAllowedParentOrigins = (): string[] => {
  if (typeof document === 'undefined' || !document.referrer) {
    return ['*'];
  }
  try {
    return [new URL(document.referrer).origin];
  } catch {
    return ['*'];
  }
};

export const connectGameToHost = (methods: PvpGuestApiV1): PvpGuestBridgeConnection =>
  connect<PvpHostApiV1>({
    messenger: new WindowMessenger({
      remoteWindow: window.parent,
      allowedOrigins: getAllowedParentOrigins(),
    }),
    methods,
  });
```

### 3.2 Guest lifecycle (required pattern)

1. On mount, call **`connectGameToHost`** with **`PvpGuestApiV1`** where **`setState`** stores the
   latest snapshot in component state.
2. **`await connection.promise`** to receive **`PvpHostApiV1`** — enable buttons that call lobby/action
   methods only after it resolves.
3. On unmount, call **`connection.destroy()`**.

```tsx
import { useEffect, useState } from 'react';
import {
  connectGameToHost,
  type PvpGuestApiV1,
  type PvpHostApiV1,
  type PvpHostSnapshotV1,
} from '@chain/pvp-sdk/guest';

export function App() {
  const [hostApi, setHostApi] = useState<PvpHostApiV1 | null>(null);
  const [snapshot, setSnapshot] = useState<PvpHostSnapshotV1 | null>(null);

  useEffect(() => {
    let mounted = true;
    const guestMethods: PvpGuestApiV1 = {
      async setState(next) {
        if (mounted) setSnapshot(next);
      },
    };
    const connection = connectGameToHost(guestMethods);
    void connection.promise.then(parent => {
      if (mounted) setHostApi(parent);
    });
    return () => {
      mounted = false;
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

## 4. Using `PvpHostSnapshotV1` in the game UI

| Field                        | Use                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `wallet.status`              | Enable lobby actions only when **`'ready'`**.                                                                                          |
| `token.decimals`             | Parse buy-in input with `viem` `parseUnits`; format pot with `formatUnits`.                                                            |
| `balances.smartVaultBalance` | Gate **create/join** on sufficient balance for the buy-in.                                                                             |
| `protocol.feeBps`            | Preview the protocol cut; compute net payouts in the UI (chain is authoritative).                                                      |
| `lobbies.items`              | Each lobby: `phaseName`, `buyIn`, `pot`, `players[]` (with `isYou`), `creator`, `maxPlayers`, `payout`, `raw.config`, `raw.gameState`. |
| `metadata.room`              | Host-app room context: room id/slug/title, invite URL, and optional participants for presence or spectator UI.                         |
| `metadata.viewer`            | Host-app profile for the connected viewer, such as username, display name, avatar URL, or profile URL.                                 |
| `players[].metadata`         | Display/profile metadata for seated players, such as usernames and avatars.                                                            |
| `lobby.metadata`             | Host-provided lobby labels, invite URL, or other presentation-only details.                                                            |

**Identify yourself**: match `wallet.address` against `players[].address`, or use `players[].isYou`.
Use `players[].metadata.username` / `displayName` when present for player labels, with shortened
addresses as the fallback.

**Whose turn**: there is no `nextActor` in the snapshot — turn order is the game's own state. Decode
`raw.gameState` (your game's layout) to find the current actor and enable your action UI when it's the
connected wallet's turn. Treat the contract as authoritative; a submit may still revert if state moved.

**Host metadata is display-only**: `snapshot.metadata`, `lobby.metadata`, and `players[].metadata`
are supplied by the parent app over the iframe bridge. They are useful for names, avatars, room titles,
invite links, spectator lists, per-room cosmetics, and feature flags. Do **not** use them for
authoritative game rules, turn ownership, eligibility, scoring, payouts, or anything that must match
contract state. Keep custom values JSON-serializable.

Example host-provided metadata:

```typescript
const metadata: PvpHostSnapshotV1['metadata'] = {
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

const seatedPlayer: PvpHostSnapshotV1['lobbies']['items'][number]['players'][number] = {
  address: '0x1111111111111111111111111111111111111111',
  isYou: true,
  metadata: { username: 'alice', displayName: 'Alice' },
};

const lobbyMetadata: PvpHostSnapshotV1['lobbies']['items'][number]['metadata'] = {
  title: 'Table 1',
  inviteUrl: 'https://chain.wtf/rooms/room_123/lobbies/1',
};
```

Example guest-side player label:

```typescript
function playerLabel(player: PvpHostSnapshotV1['lobbies']['items'][number]['players'][number]) {
  return (
    player.metadata?.displayName ??
    player.metadata?.username ??
    `${player.address.slice(0, 6)}...${player.address.slice(-4)}`
  );
}
```

**Skip a slacker**: decode the per-turn deadline you stored in `raw.gameState`; once it has passed,
show a **Skip** button (to any player, not just the current actor) that submits the game's `SKIP`
action. This is how a stalled turn gets unblocked permissionlessly.

**Terminal phases**: `RESOLVED` (read `payout`), `CANCELLED` (buy-ins refunded).

---

## 5. `game.manifest.json` — host validation

The TypeScript type **`PvpGameManifestV1`** is minimal; the **host validator**
(`validatePvpGameManifest`) additionally requires **`presentation`**, **`lobby`**, and
**`capabilities`**.

```json
{
  "schemaVersion": 1,
  "gameId": "PointDuelGame",
  "apiVersion": 1,
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
    "minPlayers": 2,
    "maxPlayers": 8,
    "defaultBuyIn": "1000000",
    "autoStartWhenFull": true
  },
  "capabilities": {
    "createLobby": true,
    "joinLobby": true,
    "leaveLobby": true,
    "startLobby": true,
    "submitAction": true,
    "cancelLobby": true,
    "resize": true
  }
}
```

`gameId` must match the canonical id derived from on-chain registration (`canonicalPvpGameId` strips
a trailing `Game`, lowercases, keeps alphanumerics). Serve the manifest at the **same origin** as the
game URL.

---

## 6. Frontend patterns

Use `viem` for `encodeAbiParameters` / `decodeAbiParameters` / `formatUnits` / `parseUnits`.
`EMPTY_HEX = '0x'` is valid `randomnessRequestData` when no provider payload is needed.

### 6.1 Create a lobby (creator picks buy-in + seat cap; Point Duel needs no `config`)

```tsx
const EMPTY_HEX = '0x' as const;

async function handleCreate(
  hostApi: PvpHostApiV1,
  snapshot: PvpHostSnapshotV1,
  buyInInput: string,
  maxPlayers: number,
) {
  const buyIn = parseUnits(buyInInput, snapshot.token.decimals ?? 18).toString();

  const { lobbyId } = await hostApi.createLobby({
    buyIn,
    maxPlayers,
    config: EMPTY_HEX, // a game that needs setup encodes it here
    randomnessRequestData: EMPTY_HEX,
  });
  // Track lobbyId until it appears in snapshot.lobbies.items
}
```

### 6.2 Join / leave / start

```tsx
await hostApi.joinLobby({ lobbyId });
await hostApi.leaveLobby({ lobbyId }); // only while WAITING_FOR_PLAYERS
await hostApi.startLobby({ lobbyId }); // creator, once the game's canStart allows (if not auto-start)
```

### 6.3 Submit an action (Point Duel: `actionData = (uint256 score)`)

```tsx
async function handleSubmitScore(hostApi: PvpHostApiV1, lobbyId: string, score: bigint) {
  await hostApi.submitAction({
    lobbyId,
    actionData: encodeAbiParameters([{ type: 'uint256' }], [score]),
    randomnessRequestData: EMPTY_HEX,
  });
}
```

### 6.4 Render the result

When `lobby.phaseName === 'RESOLVED'`, read `lobby.payout` (`players`, `shareBps`, `amounts`,
`feeAmount`) to show who won what. Decode `lobby.raw.gameState` for game-specific detail (e.g. each
player's score).

---

## 7. Host integrator checklist (signing + snapshot)

1. **createLobby:** Prepend ERC20 `approve(facetOrProxy, buyIn)`, then call
   `PvpGameFacet.createLobby(game, vault, buyIn, config, randomnessRequestData)`. Parse `lobbyId` from
   the `PvpLobbyCreated` log.
2. **joinLobby:** Prepend `approve(facetOrProxy, buyIn)`, then `joinLobby(lobbyId, vault, ...)`.
3. **submitAction:** `submitAction(lobbyId, actionData, randomnessRequestData)` from the player's
   wallet. Turn ownership is **not** enforced by the facet — the game validates it on-chain, and the
   guest decodes whose-turn / any deadline from `raw.gameState` to drive its move and skip buttons.
4. **Snapshot freshness:** Merge indexer lobby list with `getLobby(lobbyId)` reads so `raw.config` /
   `raw.gameState` / `payout` match on-chain bytes for decoding in the iframe.
5. **Metadata:** Attach display-only host context to `snapshot.metadata`, `lobby.metadata`, and
   `players[].metadata`. Common fields are username, display name, avatar URL, profile URL, room id,
   room title, invite URL, participants/spectators, and app-specific JSON under `custom`.
6. **Push updates:** Call `guestApi.setState` whenever wallet, balances, lobby rows, the protocol fee,
   metadata, locale, or theme change.

---

## 8. Security notes

- Penpal **origin allowlisting** works exactly as in `@chain/casino-sdk` (host passes `childOrigin`;
  guest allows the referrer origin, else `*` for development only).
- **Never** trust client-only math for the split — treat `gameState`, `pot`, and `payout` as **hints**;
  the **facet + game contract** are authoritative. The facet independently validates that `shareBps`
  sums to 10_000 and that all payees are lobby members before moving funds.
- Treat host-provided metadata as untrusted presentation data. It may be missing, stale, or changed by
  the parent app; never encode assumptions from it into `config` / `actionData` unless the contract
  independently verifies the same rule.

---

_End of document._
