# Randomness → unbiased d6 (PvP games)

**Audience:** Agents and humans implementing **`IPvpGameV1.onRandomness`** or off-chain mirrors (mocks, tests, guest previews).

**Applies to:** Any PvP game that maps facet / VRF **`bytes32`** randomness to **six-sided dice** (faces `1..6`). Examples: dice poker deals, Yahtzee-style re-rolls, any `onPlayerAction` → `WAITING_RANDOMNESS` → `onRandomness` loop.

The byte-level algorithm is **identical** to [`@chain/casino-sdk` RANDOMNESS_DICE](../casino-sdk/docs/RANDOMNESS_DICE.md). This file is duplicated here so PvP integrators do not need to read the casino package.

---

## Rule (read this first)

> **Never map a uniform byte to `1..6` with `(byte % 6) + 1` alone.**

Use **rejection sampling**: `DIE_REJECT = 252`, accept only `byte < 252`, then `face = (byte % 6) + 1`.

See the [casino-sdk copy](../casino-sdk/docs/RANDOMNESS_DICE.md) for the bias table, Solidity/TypeScript reference implementations, agent checklist, and general `limit = floor(M/n)*n` guidance.

---

## PvP lifecycle (`IPvpGameV1`)

1. `onPlayerAction` (or `onLobbyStart`) may return `requestRandomnessNow = true` → `WAITING_RANDOMNESS`.
2. Facet requests RNG; provider fulfills.
3. **`onRandomness(ctx, bytes32 randomness)`** maps bytes to dice/outcomes, updates `newGameState`, may return to **`WAITING_PLAYER_ACTION`** (same player can act again) or advance resolution.

Turn order lives in **`gameState`**; the facet only forwards `msg.sender` — your game validates the actor after consuming randomness.

---

## Many dice from one word (alternative pattern)

[`solidity/examples/DicePokerGame.sol`](../solidity/examples/DicePokerGame.sol) derives each die as:

```solidity
uint256 word = uint256(keccak256(abi.encode(randomness, player, index)));
return uint8((word % DIE_FACES) + 1);
```

Modulo bias on **2²⁵⁶** is negligible. That pattern is fine when you **expand** entropy per die with `keccak256(abi.encode(...))`.

It is **not** a substitute for rejection when you read **raw bytes** directly (`randomness[i] % 6`) — agents often make that mistake when porting casino byte-walk code into PvP.

| Pattern                                                    | When to use                                                                  |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Byte walk + `byte < 252` (this doc)                        | Sequential consumption of VRF bytes, 2d6, shared cursor across multiple dice |
| `keccak256(abi.encode(randomness, salt…))` then `word % 6` | Many independent dice from one fulfillment; salts must be unique per die     |

Pick one style per game and use it consistently in contract, mocks, and guest simulation.

---

## Agent checklist (PvP-specific)

| DO                                                                              | DON'T                                                     |
| ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Same rejection rules as casino when using raw bytes                             | Assume PvP “doesn’t matter” because it’s not house edge   |
| Unique `abi.encode` salts per die in keccak-expanded rolls                      | Reuse the same salt for two dice in one roll              |
| Mirror contract logic in guest mocks before showing outcomes                    | `Math.random()` for pot resolution                        |
| Keep `DicePokerGame._die` and byte-walk helpers in sync if you fork the example | Mix byte-walk for deal and raw `% 6` on bytes for re-roll |

---

## Related docs

- [`CHAIN_WTF_PVP_GAMES.md`](./CHAIN_WTF_PVP_GAMES.md) — lobby flow + `onRandomness` loops
- [`PVP_CONTRACT_CONSTRAINTS.md`](./PVP_CONTRACT_CONSTRAINTS.md) — MUST bullet on d6 mapping
- [`../casino-sdk/docs/RANDOMNESS_DICE.md`](../casino-sdk/docs/RANDOMNESS_DICE.md) — full reference implementations
