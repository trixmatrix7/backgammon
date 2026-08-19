// A whole EVM, in the test process.
//
// The contract's four entry points are `pure`/`view`, so proving it agrees with the
// TypeScript engine needs no chain, no node and no signer — only somewhere to execute
// bytecode. This deploys the compiled `Backgammon` once and calls into it with
// viem-encoded calldata, which is exactly what the facet would send.

import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createEVM } from "@ethereumjs/evm";
import { Address, hexToBytes } from "@ethereumjs/util";
import { decodeFunctionResult, encodeFunctionData, type Abi, type Hex } from "viem";

// fileURLToPath, not `.pathname` — on Windows the latter yields "/C:/..." and percent-
// encodes spaces, and this project lives under a path with a space in it.
const OUT = fileURLToPath(new URL("../contracts/out/", import.meta.url));
const SRC = fileURLToPath(new URL("../contracts/src/", import.meta.url));
const BIN = `${OUT}Backgammon_sol_Backgammon.bin`;
const ABI_FILE = `${OUT}Backgammon_sol_Backgammon.abi`;

/**
 * Load the compiled contract, refusing stale bytecode.
 *
 * The compile itself is a separate step (`npm run build:contracts`) rather than
 * something this function shells out to: the test runner has no permission to spawn
 * processes, and — more to the point — a test that silently rebuilds its own subject
 * can pass against code the developer never looked at.
 */
function build(): { abi: Abi; bytecode: Hex } {
  if (!existsSync(BIN)) {
    throw new Error("contracts not built — run `npm run build:contracts` first");
  }
  const newer = ["Backgammon.sol", "BackgammonRules.sol", "BackgammonTypes.sol", "IPvpGameV1.sol"]
    .filter((f) => statMtime(`${SRC}${f}`) > statMtime(BIN));
  if (newer.length > 0) {
    throw new Error(
      `contract bytecode is stale (${newer.join(", ")} changed) — run \`npm run build:contracts\``,
    );
  }
  return {
    abi: JSON.parse(readFileSync(ABI_FILE, "utf8")) as Abi,
    bytecode: `0x${readFileSync(BIN, "utf8").trim()}` as Hex,
  };
}

function statMtime(p: string): number {
  return statSync(p).mtimeMs;
}

export interface Deployed {
  abi: Abi;
  call: (fn: string, args: unknown[]) => Promise<unknown>;
}

const CALLER = new Address(hexToBytes(`0x${"11".repeat(20)}`));
const TARGET = new Address(hexToBytes(`0x${"cc".repeat(20)}`));

export async function deployBackgammon(): Promise<Deployed> {
  const { abi, bytecode } = build();
  const evm = await createEVM();

  const created = await evm.runCall({
    caller: CALLER,
    to: undefined,
    data: hexToBytes(bytecode),
    gasLimit: 200_000_000n,
  });
  if (created.execResult.exceptionError) {
    throw new Error(`deploy reverted: ${created.execResult.exceptionError.error}`);
  }
  await evm.stateManager.putCode(TARGET, created.execResult.returnValue);

  return {
    abi,
    async call(fn: string, args: unknown[]) {
      const data = encodeFunctionData({ abi, functionName: fn, args } as never);
      const res = await evm.runCall({
        caller: CALLER,
        to: TARGET,
        data: hexToBytes(data),
        gasLimit: 500_000_000n,
      });
      const ret = `0x${Buffer.from(res.execResult.returnValue).toString("hex")}` as Hex;
      if (res.execResult.exceptionError) {
        throw new EvmRevert(fn, ret, res.execResult.exceptionError.error);
      }
      return decodeFunctionResult({ abi, functionName: fn, data: ret } as never);
    },
  };
}

/** A revert carries the custom-error selector, which is how we assert on rule violations. */
export class EvmRevert extends Error {
  constructor(
    readonly fn: string,
    readonly data: Hex,
    readonly reason: string,
  ) {
    super(`${fn} reverted (${reason}) data=${data.slice(0, 74)}`);
    this.name = "EvmRevert";
  }
}
