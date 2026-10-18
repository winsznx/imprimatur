/**
 * Read-only friction repros. No key needed.
 *
 *   pnpm --filter @imprimatur/arkiv-evidence repro friction/read-side.ts
 */
import { createPublicClient, i32, str } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { eq, exists, gt, hasType, ne } from "@arkiv-network/sdk/query"
import { http } from "viem"

const RPC = "https://rpc.tiramisu.db-chain.testnet.arkiv.network"
const client = createPublicClient({ chain: tiramisu, transport: http(RPC, { retryCount: 0, timeout: 20_000 }) })

async function step(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    const value = await run()
    console.log(`ok      ${label}${value === undefined ? "" : `: ${JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`}`)
  } catch (error) {
    const message = error instanceof Error ? `${error.constructor.name}: ${error.message.split("\n")[0]}` : String(error)
    console.log(`threw   ${label}: ${message}`)
  }
}

async function raw(method: string, params: unknown[]) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  const body = (await response.json()) as { result?: { data?: unknown[] }; error?: { message: string } }
  return {
    status: response.status,
    cost: response.headers.get("arkiv-cost"),
    rateLimit: response.headers.get("ratelimit"),
    error: body.error?.message,
    rows: body.result?.data?.length,
  }
}

// 1. $createdAt: the SDK refuses it before sending; the node answers it (sdk-js #100).
await step("SDK: where($createdAt > 1)", () => client.select({ key: true }).where(gt("$createdAt", 1n)).limit(1).fetch().then((p) => p.entities.length))
await step("raw arkiv_query: $createdAt > u64(1)", () => raw("arkiv_query", ["$createdAt > u64(1)", { select: { key: true }, limit: "0x1" }]))

// 2. Operators the SDK exports. The docs say "There is no != yet".
await step("SDK: ne()", () => client.select({ key: true }).where(eq("type", str("release")), ne("seq", i32(0))).limit(1).fetch().then((p) => p.entities.length))
await step("SDK: exists()", () => client.select({ key: true }).where(eq("type", str("release")), exists("seq")).limit(1).fetch().then((p) => p.entities.length))
await step("SDK: hasType()", () => client.select({ key: true }).where(eq("type", str("release")), hasType("seq", "u64")).limit(1).fetch().then((p) => p.entities.length))

// 3. A query with no predicate.
await step("SDK: select().fetch() with no where()", () => client.select({ key: true }).fetch().then((p) => p.entities.length))

// 4. What each read costs against the keyless budget.
await step("cost: eth_blockNumber", () => raw("eth_blockNumber", []))
await step("cost: arkiv_query, one row", () => raw("arkiv_query", ["type = str('release')", { select: { key: true }, limit: "0x1" }]))
await step("cost: arkiv_query, 200 rows of everything", () => raw("arkiv_query", ["type = str('release')", { select: { key: true, payload: true, attributes: true }, limit: "0xc8" }]))
await step("cost: arkiv_getBlockTiming", () => raw("arkiv_getBlockTiming", []))
await step("cost: arkiv_getEntityCount", () => raw("arkiv_getEntityCount", []))

// 5. The chain object has no block explorer (sdk-js #104), so viem can't build explorer links.
await step("tiramisu.blockExplorers", async () => tiramisu.blockExplorers ?? null)
