// Chain Gammon engine — pure, deterministic, replay-verifiable. The whole barrel is portable to a
// Solidity `GammonGame.sol` (see contracts/README.md) one-to-one, with the single exception of
// eval.ts, which is advisory only and never touches the rules.
export * from "./types.js";
export * from "./rng.js";
export * from "./board.js";
export * from "./rules.js";
export * from "./eval.js";
export * from "./bot.js";
export * from "./verifier.js";
