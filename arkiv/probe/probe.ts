/**
 * Measures Tiramisu before any timing constant in Imprimatur is set, and tests the Arkiv behaviours
 * the design depends on. Writes results-<timestamp>.json next to this file.
 *
 *   pnpm --filter @imprimatur/arkiv-evidence probe
 */
import { writeFileSync } from "node:fs"
import {
  createWalletClient,
  ExpirationTime,
  i32,
  jsonToPayload,
  key,
  str,
  u64,
} from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { eq, exists, hasType, ne } from "@arkiv-network/sdk/query"
import { BURN_ADDRESS, createArkivReader, createArkivSocket, TIRAMISU_RPC } from "@imprimatur/core"
import { type Hex, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"

const RUNS = 5
const env = (name: string): Hex => {
  const value = process.env[`${name}_PK`]
  if (!value) throw new Error(`${name}_PK missing from .env`)
  return value as Hex
}
const wallet = (name: string) =>
  createWalletClient({ chain: tiramisu, transport: http(TIRAMISU_RPC, { timeout: 60_000 }), account: privateKeyToAccount(env(name)) })

const pub = createArkivReader({ timeoutMs: 30_000 })
const ws = createArkivSocket()
const owner = wallet("PUBLISHER")
const stranger = wallet("MAINTAINER_A")
const now = () => performance.now()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const results: Record<string, unknown> = { startedAt: new Date().toISOString(), sdk: "0.8.1", node: process.version }

async function attempt<T>(label: string, run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const value = await run()
    console.log(`  ${label}: ok`)
    return { ok: true, value }
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n").slice(0, 3).join(" | ") : String(error)
    console.log(`  ${label}: failed: ${message}`)
    return { ok: false, error: message }
  }
}

async function rawCall(method: string, params: unknown[]) {
  const started = now()
  const response = await fetch(TIRAMISU_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  const body = (await response.json()) as { result?: unknown; error?: { message: string } }
  return {
    method,
    status: response.status,
    ms: Math.round(now() - started),
    cost: response.headers.get("arkiv-cost"),
    quotaUsed: response.headers.get("arkiv-quota-used-percent"),
    rateLimit: response.headers.get("ratelimit"),
    error: body.error?.message,
  }
}

const probePayload = (run: number) => ({
  attributes: { type: str("probe"), run: i32(run) },
  payload: new Uint8Array(),
  contentType: "application/octet-stream",
  expires: ExpirationTime.fromMinutes(30),
})

// 1. Write receipt, query visibility, WebSocket event, five times.
console.log("1. write -> receipt -> query -> websocket")
results.blockTiming = await pub.getBlockTiming().catch((error: unknown) => String(error))
const timings: { run: number; receiptMs: number; visibleMs: number; wsMs: number | null }[] = []
for (let run = 0; run < RUNS; run++) {
  let wsAt: number | null = null
  let wanted: Hex | undefined
  const seen = new Map<string, number>()
  const stop = ws.watchEntityEvents({
    onEntityCreated: (event) => {
      seen.set(event.entityKey, now())
      if (event.entityKey === wanted) wsAt ??= now()
    },
    onError: (error) => console.log(`  ws error: ${error.message}`),
  })
  await sleep(1_500)
  const t0 = now()
  const { entityKey } = await owner.createEntity(probePayload(run))
  const t1 = now()
  wanted = entityKey
  wsAt = seen.get(entityKey) ?? null
  let t2 = 0
  while (!t2) {
    const page = await pub.select({ key: true }).where(eq("$key", key(entityKey))).fetch()
    if (page.entities.length > 0) t2 = now()
    else await sleep(150)
  }
  const deadline = now() + 15_000
  while (wsAt === null && now() < deadline) await sleep(100)
  stop()
  const row = { run, receiptMs: Math.round(t1 - t0), visibleMs: Math.round(t2 - t0), wsMs: wsAt === null ? null : Math.round(wsAt - t0) }
  timings.push(row)
  console.log(`  ${JSON.stringify(row)}`)
}
results.timings = timings

// 2. Query latency at limit(200).
console.log("2. query latency")
const queryMs: number[] = []
for (let run = 0; run < RUNS; run++) {
  const started = now()
  await pub.select("*").where(eq("type", str("probe"))).limit(200).fetch()
  queryMs.push(Math.round(now() - started))
}
results.queryMs = queryMs
console.log(`  ${queryMs.join(", ")} ms`)

// 3. What each method costs against the keyless budget.
console.log("3. cost per method")
const sampleKey = (timings.length > 0 && (await pub.select({ key: true }).where(eq("type", str("probe"))).limit(1).fetch()).entities[0]?.key) || "0x"
results.costs = [
  await rawCall("eth_blockNumber", []),
  await rawCall("arkiv_query", [`type = str('probe')`, { select: { key: true }, limit: "0x1" }]),
  await rawCall("arkiv_getEntityCount", []),
  await rawCall("arkiv_getBlockTiming", []),
  await rawCall("arkiv_getEntity", [sampleKey]),
  await rawCall("arkiv_query", [`$createdAt > u64(1)`, { select: { key: true }, limit: "0x1" }]),
]
for (const cost of results.costs as Awaited<ReturnType<typeof rawCall>>[]) console.log(`  ${JSON.stringify(cost)}`)

// 4. readonly blocks edits but not deletion.
console.log("4. readonly semantics")
const readonlyEntity = await owner.createEntity({ ...probePayload(100), flags: { readonly: true } })
results.readonly = {
  patch: await attempt("patch a readonly entity", () =>
    owner.patchEntity({ entityKey: readonlyEntity.entityKey, set: { run: i32(101) } }),
  ),
  extendByOwner: await attempt("owner extends a readonly entity", () =>
    owner.extendEntity({ entityKey: readonlyEntity.entityKey, expires: ExpirationTime.fromHours(2) }),
  ),
  extendByStranger: await attempt("another key extends it (no permissionlessExtension)", () =>
    stranger.extendEntity({ entityKey: readonlyEntity.entityKey, expires: ExpirationTime.fromHours(3) }),
  ),
  deleteByOwner: await attempt("owner deletes a readonly entity", () =>
    owner.deleteEntity({ entityKey: readonlyEntity.entityKey }),
  ),
}

// 5. Create and burn in one batch: nobody can delete, anyone can extend.
console.log("5. create + transfer to burn address in one batch")
const [predicted] = await pub.predictEntityKeys({ owner: owner.account.address, count: 1 })
if (!predicted) throw new Error("predictEntityKeys returned nothing")
const burnStarted = now()
const batch = await owner.executeBatch({
  creates: [
    {
      attributes: { type: str("probe"), run: i32(200), at: u64(BigInt(Date.now())) },
      payload: jsonToPayload({ probe: "burn" }),
      contentType: "application/json",
      expires: ExpirationTime.fromHours(1),
      flags: { readonly: true, permissionlessExtension: true },
      salt: predicted.salt,
    },
  ],
  ownershipChanges: [{ entityKey: predicted.key, newOwner: BURN_ADDRESS }],
})
const burnMs = Math.round(now() - burnStarted)
const burned = (await pub.select({ key: true, owner: true, creator: true, creationFlags: true }).where(eq("$key", key(predicted.key))).fetch()).entities[0]
results.burn = {
  predictedMatches: batch.createdEntities[0] === predicted.key,
  receiptMs: burnMs,
  owner: burned?.owner,
  creator: burned?.creator,
  flags: burned?.creationFlags,
  deleteByCreator: await attempt("creator deletes the burned entity", () => owner.deleteEntity({ entityKey: predicted.key })),
  extendByStranger: await attempt("another key extends the burned entity", () =>
    stranger.extendEntity({ entityKey: predicted.key, expires: ExpirationTime.fromHours(2) }),
  ),
  stillThere: (await pub.select({ key: true }).where(eq("$key", key(predicted.key))).fetch()).entities.length === 1,
}
console.log(`  ${JSON.stringify(results.burn, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`)

// 6. Query operators the SDK exports.
console.log("6. operators the SDK exports")
results.operators = {
  ne: await attempt("ne()", () => pub.select({ key: true }).where(eq("type", str("probe")), ne("run", i32(1))).limit(1).fetch()),
  exists: await attempt("exists()", () => pub.select({ key: true }).where(eq("type", str("probe")), exists("run")).limit(1).fetch()),
  hasType: await attempt("hasType()", () => pub.select({ key: true }).where(eq("type", str("probe")), hasType("run", "i32")).limit(1).fetch()),
}

// 7. Attribute names with uppercase letters: the SDK grammar allows them.
console.log("7. uppercase attribute name")
results.uppercase = await attempt("create with attribute 'Type'", () =>
  owner.createEntity({ ...probePayload(300), attributes: { Type: str("probe"), run: i32(300) } }),
)

results.finishedAt = new Date().toISOString()
const file = new URL(`./results-${results.startedAt as string}.json`.replace(/:/g, "-"), import.meta.url)
writeFileSync(file, JSON.stringify(results, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2))
console.log(`\nwrote ${file.pathname}`)
process.exit(0)
