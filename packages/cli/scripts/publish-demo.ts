/**
 * Publishes the demo releases to Tiramisu with the real role keys and records every transaction in /arkiv/evidence.md. Run again
 * after a testnet wipe to recreate it.
 *
 *   pnpm --filter @imprimatur/demo build
 *   pnpm --filter @imprimatur/cli exec tsx --env-file=../../.env scripts/publish-demo.ts
 */
import { writeFileSync } from "node:fs"
import { BYBIT_REPLAY, CHECKPOINT_ORIGIN, DEMO_ORIGINS, explorerEntity, explorerTx } from "@imprimatur/core"
import { approveRelease, publishRelease, type WriteResult } from "../src/arkiv"
import { reader, walletFrom } from "../src/env"
import { buildManifest } from "../src/manifest"

const CLEAN_DIR = new URL("../../../apps/demo/dist", import.meta.url).pathname
const TAMPERED_DIR = new URL("../../../apps/demo/dist-tampered", import.meta.url).pathname
const CHECKPOINT_DIR = new URL("../../../apps/checkpoint/dist", import.meta.url).pathname
const COMMIT = process.env.SEED_COMMIT ?? "0".repeat(40)

const rpc = reader()
const publisher = walletFrom("PUBLISHER_PK")
const maintainer = walletFrom("MAINTAINER_A_PK")
const forger = walletFrom("FORGER_PK")
const replayKey = walletFrom("REPLAY_PK")

const clean = await buildManifest(CLEAN_DIR, { base: "/", extern: [], framework: "vite" })
const tampered = await buildManifest(TAMPERED_DIR, { base: "/", extern: [], framework: "vite" })
const checkpoint = await buildManifest(CHECKPOINT_DIR, { base: "/", extern: [], framework: "vite" })

const rows: { step: string; who: string; result: WriteResult }[] = []
const record = <T extends WriteResult>(step: string, who: string, result: T): T => {
  rows.push({ step, who, result })
  console.log(`${step.padEnd(52)} ${Math.round(result.ms).toString().padStart(5)} ms  ${result.entityKey}`)
  return result
}

async function signedAndApproved(origin: string, step: string, manifest = clean, version = "1.4.2") {
  const release = record(`${step}: release v${version}`, "publisher", await publishRelease(publisher, rpc, { origin, version, commit: COMMIT, manifest }))
  record(`${step}: approval of v${version}`, "maintainer A", await approveRelease(maintainer, { origin, release: release.entityKey, version }))
  return release
}

await signedAndApproved(DEMO_ORIGINS.clean, "clean")
await signedAndApproved(DEMO_ORIGINS.tampered, "tampered")
await signedAndApproved(DEMO_ORIGINS.forged, "forged")
record(
  "forged: forged release, every field copied, seq 99",
  "forger",
  await publishRelease(forger, rpc, { origin: DEMO_ORIGINS.forged, version: "1.4.2", commit: COMMIT, manifest: tampered, seq: 99n }),
)
await signedAndApproved(DEMO_ORIGINS.stolenKey, "stolen-key")
record(
  "stolen-key: v1.4.3 from the CI key, nobody approves",
  "publisher",
  await publishRelease(publisher, rpc, { origin: DEMO_ORIGINS.stolenKey, version: "1.4.3", commit: COMMIT, manifest: tampered }),
)
await signedAndApproved(CHECKPOINT_ORIGIN, "checkpoint (real production build)", checkpoint, "0.1.0")
record(
  "replay: Safe's clean chunk, reconstructed",
  "replay",
  await publishRelease(replayKey, rpc, {
    origin: BYBIT_REPLAY.binding.origin,
    version: `${BYBIT_REPLAY.safeRelease.version}-reconstructed`,
    commit: BYBIT_REPLAY.safeRelease.commit,
    manifest: {
      files: [{ path: BYBIT_REPLAY.path, sha256: BYBIT_REPLAY.clean.sha256, bytes: BYBIT_REPLAY.clean.bytes }],
      inline: [],
      builder: "imprimatur-cli/0.1.0 replay",
      framework: "next",
      note: `Reconstruction from the Wayback Machine (${BYBIT_REPLAY.clean.url}). Not Safe's key. Safe never published releases.`,
    },
  }),
)

const lines = [
  "# On-chain evidence",
  "",
  `Written by \`packages/cli/scripts/publish-demo.ts\` on ${new Date().toISOString()}. Tiramisu, chain 7738577.`,
  "If the testnet is wiped, these transactions are the record; rerun the script to recreate the state.",
  "",
  "| Step | Key | Entity | Transaction | Receipt |",
  "|---|---|---|---|---|",
  ...rows.map(
    ({ step, who, result }) =>
      `| ${step} | ${who} | [${result.entityKey.slice(0, 10)}…](${explorerEntity(result.entityKey)}) | [${result.txHash.slice(0, 10)}…](${explorerTx(result.txHash)}) | ${Math.round(result.ms)} ms |`,
  ),
  "",
]
writeFileSync(new URL("../../../arkiv/evidence.md", import.meta.url), lines.join("\n"))
console.log("wrote arkiv/evidence.md")
