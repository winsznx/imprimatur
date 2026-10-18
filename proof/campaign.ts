/**
 * The tamper campaign. Publishes real releases to Tiramisu under fresh origins, then checks each
 * tampered build the way the watcher does (every file the server holds, plus what the HTML loads).
 * Variants come from variants.mjs, which imports nothing from the verifier.
 *
 *   pnpm --filter @imprimatur/proof campaign      writes results/campaign-<timestamp>.json
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, sep } from "node:path"
import {
  type Binding,
  DEMO_KEYS,
  decide,
  type Decision,
  ENTITY_TYPE,
  type ObservedResource,
  observeResources,
  parseRecords,
  resourcesInHtml,
  sha256Hex,
  verify,
} from "@imprimatur/core"
import { str } from "@arkiv-network/sdk"
import { eq } from "@arkiv-network/sdk/query"
import {
  approveRelease,
  createBurned,
  keyRevocationAttributes,
  publishRelease,
  revocationAttributes,
} from "../packages/cli/src/arkiv"
import { reader, walletFrom } from "../packages/cli/src/env"
import { buildManifest } from "../packages/cli/src/manifest"
import { VARIANTS } from "./variants.mjs"

const RUN = Date.now().toString(36)
const ROOT = new URL("..", import.meta.url).pathname
const WORK = mkdtempSync(join(tmpdir(), "imprimatur-campaign-"))
const CDN = "https://cdn.jsdelivr.net/npm/dayjs@1.11.13/dayjs.min.js"

const rpc = reader()
const publisher = walletFrom("PUBLISHER_PK")
const maintainerA = walletFrom("MAINTAINER_A_PK")
const maintainerB = walletFrom("MAINTAINER_B_PK")
const recovery = walletFrom("RECOVERY_PK")
const forger = walletFrom("FORGER_PK")

const originFor = (name: string) => `campaign-${RUN}-${name}.imprimatur.invalid`
const teamFor = (origin: string): Binding => ({
  origin,
  signers: [DEMO_KEYS.publisher, DEMO_KEYS.maintainerA, DEMO_KEYS.maintainerB],
  threshold: 2,
  recovery: DEMO_KEYS.recovery,
  watchers: [],
  source: "preload",
})

function codeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return codeFiles(full)
    return /\.(m?js|css)$/.test(name) ? [full] : []
  })
}

/** What a watcher sees: every script and stylesheet the server holds, plus what the HTML loads. */
async function observeDir(dir: string, origin: string): Promise<ObservedResource[]> {
  const pageUrl = `https://${origin}/`
  const html = readFileSync(join(dir, "index.html"), "utf8")
  const fromHtml = await observeResources(resourcesInHtml(html, pageUrl), pageUrl, async (url) => {
    const parsed = new URL(url)
    if (parsed.host === origin) return new Uint8Array(readFileSync(join(dir, parsed.pathname)))
    return new Uint8Array(await (await fetch(url)).arrayBuffer())
  })
  const onServer = await Promise.all(
    codeFiles(dir).map(async (path): Promise<ObservedResource> => ({
      kind: "file",
      path: `/${relative(dir, path).split(sep).join("/")}`,
      sha256: await sha256Hex(readFileSync(path)),
    })),
  )
  const byPath = new Map<string, ObservedResource>()
  for (const resource of [...fromHtml, ...onServer]) byPath.set(`${resource.kind}:${resource.path}`, resource)
  return [...byPath.values()]
}

async function signAndApprove(origin: string, dir: string, extern: string[], version = "1.0.0", lifetimeMinutes?: number) {
  const manifest = await buildManifest(dir, { base: "/", extern, framework: "campaign" })
  const release = await publishRelease(publisher, rpc, {
    origin,
    version,
    commit: "0".repeat(40),
    manifest,
    ...(lifetimeMinutes && { lifetimeMinutes }),
  })
  await approveRelease(maintainerA, { origin, release: release.entityKey, version })
  return release
}

interface Row {
  build: string
  variant: string
  expect: string
  got: string
  pass: boolean
  miss?: string
  note?: string
}
const rows: Row[] = []

function report(build: string, variant: string, expect: string, decision: Decision, extra: Partial<Row> = {}): void {
  const row: Row = { build, variant, expect, got: decision.verdict, pass: decision.verdict === expect, ...extra }
  rows.push(row)
  console.log(`${row.pass ? "as expected" : "UNEXPECTED "}  ${build.padEnd(6)} ${variant.padEnd(26)} expect ${expect.padEnd(11)} got ${decision.verdict}${row.miss ? `  (known miss: ${row.miss})` : ""}`)
}

async function check(origin: string, dir: string, countForgeries = false): Promise<Decision> {
  const { decision, error } = await verify({ reader: rpc, origin, binding: teamFor(origin), observed: await observeDir(dir, origin), countForgeries })
  if (error) throw error
  return decision
}

const BUILDS = {
  vite: { dir: join(ROOT, "apps/demo/dist"), extern: [] as string[] },
  plain: { dir: join(ROOT, "proof/fixtures/plain-site"), extern: [CDN] },
}

// File-level variants, both builds.
for (const [build, { dir, extern }] of Object.entries(BUILDS)) {
  const origin = originFor(build)
  await signAndApprove(origin, dir, extern)
  report(build, "clean", "VERIFIED", await check(origin, dir))
  for (const [name, variant] of Object.entries(VARIANTS)) {
    if (variant.only && variant.only !== build) continue
    const target = join(WORK, `${build}-${name}`)
    variant.make(dir, target)
    report(build, name, variant.expect, await check(origin, target), variant.miss ? { miss: variant.miss } : {})
  }
}

// Rebuilding the same commit gives the same bytes, so a team can publish from CI and serve that build.
const rebuildDir = join(WORK, "vite-rebuild")
execFileSync("pnpm", ["--filter", "@imprimatur/demo", "exec", "vite", "build", "--outDir", rebuildDir, "--emptyOutDir"], { cwd: ROOT, stdio: "ignore" })
report("vite", "rebuild-same-commit", "VERIFIED", await check(originFor("vite"), rebuildDir))

// Arkiv-state variants, each on its own origin so a revocation can't leak into another case.
const clean = BUILDS.vite.dir
const tampered = join(WORK, "vite-byte-flip")

{
  const origin = originFor("forged")
  await signAndApprove(origin, clean, [])
  const manifest = await buildManifest(tampered, { base: "/", extern: [], framework: "campaign" })
  await publishRelease(forger, rpc, { origin, version: "1.0.0", commit: "0".repeat(40), manifest, seq: 99n })
  const decision = await check(origin, tampered, true)
  report("vite", "forged-release", "MISMATCH", decision, { note: `${decision.ignoredForgeries.length} forged release ignored` })

  // The ablation: the same check filtered by attributes only, the way a naive client would.
  const page = await rpc.select("*").where(eq("type", str(ENTITY_TYPE.release)), eq("origin", str(origin))).limit(200).fetch()
  const records = parseRecords([...page.entities])
  const creators = [...new Set(records.releases.map((r) => r.creator))]
  const naive = decide({
    origin,
    binding: { ...teamFor(origin), signers: creators, threshold: 1 },
    observed: await observeDir(tampered, origin),
    records,
    reachable: true,
    now: Date.now(),
    atBlock: page.blockNumber,
  })
  report("vite", "forged, attribute filter", "VERIFIED", naive, { note: "the hole $creator closes: without it the forgery passes" })
}
{
  const origin = originFor("stolen")
  await signAndApprove(origin, clean, [])
  const manifest = await buildManifest(tampered, { base: "/", extern: [], framework: "campaign" })
  await publishRelease(publisher, rpc, { origin, version: "1.0.1", commit: "0".repeat(40), manifest })
  report("vite", "stolen-ci-key", "PENDING", await check(origin, tampered))
}
{
  const origin = originFor("revoked")
  const release = await signAndApprove(origin, clean, [])
  await createBurned(maintainerB, rpc, { attributes: revocationAttributes(origin, release.entityKey, "compromised"), payload: { reason: "compromised" }, days: 1 })
  report("vite", "revoked-release", "REVOKED", await check(origin, clean))
}
{
  const origin = originFor("keyrevoked")
  await signAndApprove(origin, clean, [])
  await createBurned(recovery, rpc, { attributes: keyRevocationAttributes(origin, DEMO_KEYS.publisher), payload: { signer: DEMO_KEYS.publisher }, days: 1 })
  report("vite", "revoked-signer-key", "KEY_REVOKED", await check(origin, clean))
}
{
  const origin = originFor("poisoned")
  await signAndApprove(origin, tampered, [])
  report("vite", "poisoned-at-build-time", "VERIFIED", await check(origin, tampered), {
    miss: "the team built and signed the poisoned bundle, so it verifies",
  })
}
{
  const origin = originFor("lapsed")
  await signAndApprove(origin, clean, [], "1.0.0", 1)
  console.log("waiting 150 s for a 1-minute release to lapse")
  await new Promise((resolve) => setTimeout(resolve, 150_000))
  report("vite", "lease-lapsed", "STALE", await check(origin, clean))
}

const passed = rows.filter((r) => r.pass).length
console.log(`\n${passed} of ${rows.length} as expected; ${rows.filter((r) => r.miss).length} of them are known misses`)
mkdirSync(new URL("./results/", import.meta.url), { recursive: true })
const out = new URL(`./results/campaign-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, import.meta.url)
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), run: RUN, rows }, null, 2))
console.log(`wrote ${out.pathname}`)
process.exit(0)
