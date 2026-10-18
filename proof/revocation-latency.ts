/**
 * How long a revocation takes to reach an open tab. Uses the extension's live path from core
 * (watchBinding over a WebSocket, then verify) on a fresh origin, so the demo sites are untouched.
 *
 *   tsx --env-file=../.env revocation-latency.ts [runs]    writes results/revocation-<timestamp>.json
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { type Binding, createArkivSocket, DEMO_KEYS, type ObservedResource, verify, watchBinding } from "@imprimatur/core"
import { approveRelease, createBurned, publishRelease, revocationAttributes } from "../packages/cli/src/arkiv"
import { reader, walletFrom } from "../packages/cli/src/env"

const RUNS = Number(process.argv[2] ?? "5")
const rpc = reader()
const publisher = walletFrom("PUBLISHER_PK")
const maintainerA = walletFrom("MAINTAINER_A_PK")
const maintainerB = walletFrom("MAINTAINER_B_PK")
const socket = createArkivSocket()

const FILE: ObservedResource = { kind: "file", path: "/app.js", sha256: "a".repeat(64) }
const rows: { run: number; eventMs: number | null; revokedMs: number | null; receiptMs: number }[] = []

for (let run = 0; run < RUNS; run++) {
  const origin = `latency-${Date.now().toString(36)}-${run}.imprimatur.invalid`
  const binding: Binding = {
    origin,
    signers: [DEMO_KEYS.publisher, DEMO_KEYS.maintainerA, DEMO_KEYS.maintainerB],
    threshold: 2,
    recovery: DEMO_KEYS.recovery,
    watchers: [],
    source: "preload",
  }
  const release = await publishRelease(publisher, rpc, {
    origin,
    version: "1.0.0",
    commit: "0".repeat(40),
    manifest: { files: [{ path: FILE.path, sha256: FILE.sha256, bytes: 1 }], inline: [], builder: "latency" },
  })
  await approveRelease(maintainerA, { origin, release: release.entityKey, version: "1.0.0" })
  const before = await verify({ reader: rpc, origin, binding, observed: [FILE] })
  if (before.decision.verdict !== "VERIFIED") throw new Error(`setup: expected VERIFIED, got ${before.decision.verdict}`)

  let sentAt = 0
  let eventMs: number | null = null
  let revokedMs: number | null = null
  const done = new Promise<void>((resolve) => {
    const stop = watchBinding(socket, binding, {
      debounceMs: 0,
      onError: (error) => console.warn("ws", error.message),
      onChange: () => {
        if (sentAt === 0) return
        eventMs ??= performance.now() - sentAt
        verify({ reader: rpc, origin, binding, observed: [FILE] }).then(({ decision }) => {
          if (decision.verdict === "REVOKED" && revokedMs === null) {
            revokedMs = performance.now() - sentAt
            stop()
            resolve()
          }
        }).catch((error: unknown) => console.warn("re-check failed", error))
      },
    })
    setTimeout(() => {
      stop()
      resolve()
    }, 30_000)
  })
  await new Promise((resolve) => setTimeout(resolve, 1_500))
  sentAt = performance.now()
  const revocation = await createBurned(maintainerB, rpc, {
    attributes: revocationAttributes(origin, release.entityKey, "compromised"),
    payload: { reason: "compromised" },
    days: 1,
  })
  await done
  const row = { run, eventMs: eventMs && Math.round(eventMs), revokedMs: revokedMs && Math.round(revokedMs), receiptMs: Math.round(revocation.ms) }
  rows.push(row)
  console.log(JSON.stringify(row))
}

const sorted = (key: "eventMs" | "revokedMs") => rows.map((r) => r[key]).filter((v): v is number => v !== null).sort((a, b) => a - b)
const median = (values: number[]) => values[Math.floor(values.length / 2)]
console.log(`revoke sent to tab showing REVOKED: median ${median(sorted("revokedMs"))} ms, max ${sorted("revokedMs").at(-1)} ms, ${sorted("revokedMs").length} of ${rows.length} runs`)
mkdirSync(new URL("./results/", import.meta.url), { recursive: true })
writeFileSync(
  new URL(`./results/revocation-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, import.meta.url),
  JSON.stringify({ ranAt: new Date().toISOString(), rows }, null, 2),
)
process.exit(0)
