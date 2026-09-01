# `@chain/pvp-sdk`

Bridge types and the canonical Solidity policy interface for wagered multiplayer games embedded in
the Chain.wtf host application.

API v2 removes protocol-level assumptions that every participant pays the same buy-in, enters once,
or fits in a bounded seat array. A lobby has one escrow asset, while its game decides admission,
stake validation, repeat entries, positions, lifecycle permissions, lobby keys, and settlement mode.

## Core model

1. Anyone opens a lobby; the opener receives no implicit authority.
2. The game validates the lobby config and may assign a game-scoped unique `lobbyKey`.
3. An address enters with an explicit stake, including zero. The game may reject the amount or a
   repeated entry and returns the entry's `positionId`.
4. The protocol escrows accepted stakes and appends them to an indexed contribution ledger.
5. The game controls start, actions, randomness transitions, and cancellation eligibility.
6. Resolution derives settlement from the recipients the game returns: a single recipient is paid
   the whole distributable pot immediately; zero or several settle via claims. Cancellation always
   makes every contribution fully refundable.

Unbounded participant and contribution lists are paginated. They are never embedded in lobby
snapshots or passed wholesale to game hooks.

## Layout

| Path                                  | Purpose                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/types.ts`                        | API v2 host/guest, lobby, entry, pagination, and settlement types                                                                                                                                            |
| `src/manifest.ts`                     | API v2 manifest validation and game-id helpers                                                                                                                                                               |
| `src/host.ts`, `src/guest.ts`         | Penpal iframe bridge connectors                                                                                                                                                                              |
| `solidity/IPvpGameV2.sol`             | Stateless game-policy and protocol-ledger interfaces                                                                                                                                                         |
| `solidity/examples/JackpotGame.sol`   | Scheduled weighted jackpot with repeat entries                                                                                                                                                               |
| `solidity/examples/PointDuelGame.sol` | Fixed-stake, single-entry reference game                                                                                                                                                                     |
| `docs/PVP_CONTRACT_CONSTRAINTS.md`    | Protocol/game responsibility boundary                                                                                                                                                                        |
| `docs/CHAIN_WTF_PVP_GAMES.md`         | Integration guide                                                                                                                                                                                            |
| `local-verify-network/`               | Local Verify Network VRF simulator (real router + fulfilling node) for testing games against a local chain. In-repo it is a gitignored mirror of `tools/local-verify-network` — edit the tool, not the copy. |

The TypeScript sources are also mirrored into the `@chain/ui` registry for `shadcn add
@chain/pvp-sdk` distribution.
