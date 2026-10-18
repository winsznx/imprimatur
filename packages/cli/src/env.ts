import { createWalletClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { createArkivReader, TIRAMISU_RPC } from "@imprimatur/core"
import { type Hex, http, isHex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

export class CliError extends Error {}

/** Reads a private key from the named environment variable. Keys never come from flags or files we write. */
export function walletFrom(envName: string) {
  const value = process.env[envName]
  if (!value || !isHex(value) || value.length !== 66) {
    throw new CliError(`${envName} is not set to a 32-byte hex private key`)
  }
  const account = privateKeyToAccount(value as Hex)
  return createWalletClient({
    chain: tiramisu,
    account,
    // The tiramisu chain object has no blockTime, so viem polls receipts every 4 s against 2 s
    // blocks. Measured: 6.4 s to a receipt by default, 3.8 s at 500 ms polling (arkiv/friction.md #10).
    pollingInterval: 1_000,
    transport: http(process.env.ARKIV_RPC ?? TIRAMISU_RPC, { retryCount: 1, timeout: 60_000 }),
  })
}

export function reader() {
  return createArkivReader({
    timeoutMs: 20_000,
    ...(process.env.ARKIV_RPC && { rpcUrl: process.env.ARKIV_RPC }),
    ...(process.env.ARKIV_ACCESS_KEY && { accessKey: process.env.ARKIV_ACCESS_KEY }),
  })
}

export type WalletClient = ReturnType<typeof walletFrom>
export type Reader = ReturnType<typeof reader>
