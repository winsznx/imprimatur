import { createPublicClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { http, webSocket } from "viem"

export const TIRAMISU_RPC = "https://rpc.tiramisu.db-chain.testnet.arkiv.network"
export const TIRAMISU_WS = "wss://rpc.tiramisu.db-chain.testnet.arkiv.network"

export interface ReaderOptions {
  rpcUrl?: string
  /** A 429 on the keyless budget comes with a ~40 min Retry-After. Fail fast and say UNREACHABLE. */
  timeoutMs?: number
}

export function createArkivReader(options: ReaderOptions = {}) {
  return createPublicClient({
    chain: tiramisu,
    transport: http(options.rpcUrl ?? TIRAMISU_RPC, { retryCount: 0, timeout: options.timeoutMs ?? 8_000 }),
  })
}

/** WebSocket transport with no `fromBlock` on the watcher, so events arrive by subscription, not polling. */
export function createArkivSocket(wsUrl: string = TIRAMISU_WS) {
  return createPublicClient({
    chain: tiramisu,
    transport: webSocket(wsUrl, { keepAlive: { interval: 20_000 }, reconnect: { attempts: 10, delay: 2_000 } }),
  })
}

export type ArkivPublicClient = ReturnType<typeof createArkivReader>
export type ArkivSocketClient = ReturnType<typeof createArkivSocket>
