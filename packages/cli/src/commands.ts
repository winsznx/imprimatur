import { execFileSync } from "node:child_process"
import {
  type Binding,
  BYBIT_REPLAY,
  type Decision,
  describe,
  explorerEntity,
  explorerTx,
  findBinding,
  GATE,
  LIFETIME_DAYS,
  PRELOAD,
  REVOCATION_REASONS,
  sha256Hex,
  shortHex,
  verify,
} from "@imprimatur/core"
import { getAddress, type Hex, isAddress, isHex } from "viem"
import {
  approveRelease,
  createBurned,
  findRelease,
  heartbeat,
  keyRevocationAttributes,
  observationAttributes,
  publishRelease,
  revocationAttributes,
} from "./arkiv"
import { CliError, reader, walletFrom } from "./env"
import { buildManifest } from "./manifest"
import { fetchBytes, mergeObserved, observeReleaseFiles, scanPage } from "./page"

export type Flags = Record<string, string | boolean | undefined>

const text = (flags: Flags, name: string): string | undefined => {
  const value = flags[name]
  return typeof value === "string" ? value : undefined
}

const required = (flags: Flags, name: string): string => {
  const value = text(flags, name)
  if (!value) throw new CliError(`--${name} is required`)
  return value
}

const hexKey = (value: string | undefined, name: string): Hex | undefined => {
  if (value === undefined) return undefined
  if (!isHex(value) || value.length !== 66) throw new CliError(`--${name} must be a 32-byte entity key`)
  return value
}

function addresses(value: string | undefined, name: string): Hex[] {
  if (!value) return []
  const list = value.split(",").map((s) => s.trim())
  for (const item of list) if (!isAddress(item)) throw new CliError(`--${name}: ${item} is not an address`)
  return list.map((item) => getAddress(item))
}

/** Preload list first, then explicit flags for origins outside it. */
export function resolveBinding(origin: string, flags: Flags): Binding {
  if (origin === BYBIT_REPLAY.binding.origin) return BYBIT_REPLAY.binding
  const preloaded = findBinding(origin)
  if (preloaded) return preloaded
  const signers = addresses(text(flags, "signers"), "signers")
  const recovery = addresses(text(flags, "recovery"), "recovery")[0]
  if (signers.length === 0 || !recovery) {
    throw new CliError(`${origin} isn't in the preload list. Pass --signers and --recovery.`)
  }
  return {
    origin,
    signers,
    threshold: Number(text(flags, "threshold") ?? "1"),
    recovery,
    watchers: addresses(text(flags, "watchers"), "watchers"),
    source: "pinned",
  }
}

const keyEnv = (flags: Flags, fallback: string) => text(flags, "key-env") ?? fallback

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  } catch {
    return "0".repeat(40)
  }
}

function print(flags: Flags, human: string, data: unknown): void {
  if (flags.json) console.log(JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2))
  else console.log(human)
}

function written(label: string, result: { entityKey: Hex; txHash: Hex; ms: number }): string {
  return [
    `${label} ${result.entityKey}`,
    `  tx       ${explorerTx(result.txHash)}`,
    `  entity   ${explorerEntity(result.entityKey)}`,
    `  receipt  ${Math.round(result.ms)} ms`,
  ].join("\n")
}

export async function publish(positionals: string[], flags: Flags): Promise<void> {
  const dir = positionals[0]
  if (!dir) throw new CliError("usage: imprimatur publish <build-dir> --origin <host> --version <v>")
  const origin = required(flags, "origin")
  const manifest = await buildManifest(dir, {
    base: text(flags, "base") ?? "/",
    extern: text(flags, "extern")?.split(",").filter(Boolean) ?? [],
    ...(text(flags, "framework") && { framework: text(flags, "framework") }),
    ...(text(flags, "note") && { note: text(flags, "note") }),
  })
  const graceMinutes = Number(text(flags, "grace-minutes") ?? "60")
  const result = await publishRelease(walletFrom(keyEnv(flags, "IMPRIMATUR_PK")), reader(), {
    origin,
    version: required(flags, "version"),
    commit: text(flags, "commit") ?? gitCommit(),
    manifest,
    graceMs: graceMinutes * 60_000,
  })
  print(
    flags,
    `${written("release", result)}\n  seq      ${result.seq}\n  files    ${manifest.files.length} + ${manifest.inline.length} inline\n  expires  in ${LIFETIME_DAYS.release} days unless renewed by heartbeat`,
    { ...result, files: manifest.files.length, inline: manifest.inline.length },
  )
}

export async function approve(flags: Flags): Promise<void> {
  const origin = required(flags, "origin")
  const binding = resolveBinding(origin, flags)
  const release = await findRelease(reader(), binding, hexKey(text(flags, "release"), "release"))
  const result = await approveRelease(walletFrom(keyEnv(flags, "IMPRIMATUR_PK")), {
    origin,
    release: release.key,
    version: release.version,
  })
  print(flags, `${written("approval", result)}\n  of       v${release.version} (${shortHex(release.key)})`, result)
}

export async function revoke(flags: Flags): Promise<void> {
  const origin = required(flags, "origin")
  const reason = text(flags, "reason") ?? "compromised"
  if (!REVOCATION_REASONS.includes(reason as (typeof REVOCATION_REASONS)[number])) {
    throw new CliError(`--reason must be one of ${REVOCATION_REASONS.join(", ")}`)
  }
  const rpc = reader()
  const release = await findRelease(rpc, resolveBinding(origin, flags), hexKey(text(flags, "release"), "release"))
  const result = await createBurned(walletFrom(keyEnv(flags, "IMPRIMATUR_PK")), rpc, {
    attributes: revocationAttributes(origin, release.key, reason),
    payload: { version: release.version, reason },
    days: LIFETIME_DAYS.revocation,
  })
  print(flags, `${written("revocation", result)}\n  of       v${release.version}, owned by 0x…dEaD from the same tx`, result)
}

export async function revokeKey(flags: Flags): Promise<void> {
  const origin = required(flags, "origin")
  const [signer] = addresses(required(flags, "signer"), "signer")
  if (!signer) throw new CliError("--signer is required")
  const result = await createBurned(walletFrom(keyEnv(flags, "IMPRIMATUR_RECOVERY_PK")), reader(), {
    attributes: keyRevocationAttributes(origin, signer),
    payload: { signer },
    days: LIFETIME_DAYS.keyRevocation,
  })
  print(flags, `${written("key revocation", result)}\n  signer   ${signer}`, result)
}

export async function beat(flags: Flags): Promise<void> {
  const origin = required(flags, "origin")
  const result = await heartbeat(walletFrom(keyEnv(flags, "IMPRIMATUR_PK")), reader(), resolveBinding(origin, flags))
  print(
    flags,
    `heartbeat ${explorerTx(result.txHash)}\n  renewed  ${result.extended.length} entities for ${LIFETIME_DAYS.release} days\n  receipt  ${Math.round(result.ms)} ms`,
    result,
  )
}

function report(decision: Decision): string {
  const lines = [`${decision.verdict.padEnd(14)} ${describe(decision)}`, `signing        ${GATE[decision.verdict]}`]
  if (decision.release) {
    lines.push(`release        v${decision.release.version} seq ${decision.release.seq} ${explorerEntity(decision.release.key)}`)
  }
  for (const failing of decision.failing.slice(0, 10)) {
    lines.push(`  differs      ${failing.path}  expected ${failing.expected ? shortHex(failing.expected) : "(not listed)"}  got ${shortHex(failing.actual) || "(unreachable)"}`)
  }
  lines.push(`checked        ${decision.checked} resources at block ${decision.atBlock}`)
  return lines.join("\n")
}

export async function verifyUrl(positionals: string[], flags: Flags): Promise<void> {
  const url = positionals[0]
  if (!url) throw new CliError("usage: imprimatur verify <url>")
  const scan = await scanPage(url)
  const binding = findBinding(scan.origin) ?? scan.declared
  const atBlock = text(flags, "at-block")
  const { decision, query, error } = await verify({
    reader: reader(),
    origin: scan.origin,
    binding,
    observed: scan.observed,
    countForgeries: true,
    ...(atBlock && { atBlock: BigInt(atBlock) }),
  })
  print(flags, `${report(decision)}${query ? `\nquery          ${query}` : ""}${error ? `\nerror          ${error.message}` : ""}`, { decision, query })
  if (GATE[decision.verdict] === "block") process.exitCode = 2
}

/**
 * The watcher. Every interval it re-fetches each bound origin's page and every file its release
 * lists, from its own network, and writes an observation for each file whose bytes differ. One
 * observation per path and hash per hour, so a long attack leaves a trail without flooding Arkiv.
 */
export async function watch(flags: Flags): Promise<void> {
  const origins = text(flags, "origins")?.split(",").filter(Boolean) ?? PRELOAD.map((b) => b.origin)
  const intervalMs = Number(text(flags, "interval") ?? "60") * 1000
  const wallet = walletFrom(keyEnv(flags, "IMPRIMATUR_WATCHER_PK"))
  const rpc = reader()
  const reported = new Map<string, number>()

  const pass = async () => {
    for (const origin of origins) {
      const binding = findBinding(origin)
      if (!binding) continue
      const started = performance.now()
      try {
        const url = `https://${origin}/`
        const scan = await scanPage(url)
        const first = await verify({ reader: rpc, origin, binding, observed: scan.observed })
        const release = first.decision.release
        const releaseFiles = release
          ? await observeReleaseFiles(url, await findRelease(rpc, binding, release.key))
          : []
        const observed = mergeObserved(scan.observed, releaseFiles)
        const { decision } = await verify({ reader: rpc, origin, binding, observed })
        const elapsed = Math.round(performance.now() - started)
        console.log(`${new Date().toISOString()} ${origin} ${decision.verdict} (${observed.length} files, ${elapsed} ms)`)
        if (decision.verdict !== "MISMATCH" || !decision.release) continue
        for (const failing of decision.failing) {
          const id = `${origin}|${failing.path}|${failing.actual}`
          if (Date.now() - (reported.get(id) ?? 0) < 3_600_000) continue
          const written = await createBurned(wallet, rpc, {
            attributes: observationAttributes({
              origin,
              path: failing.path,
              sha256: failing.actual,
              expected: failing.expected ?? "",
              release: decision.release.key,
            }),
            payload: { url, fetchedAt: new Date().toISOString(), watcher: "imprimatur-cli/0.1.0" },
            days: LIFETIME_DAYS.observation,
          })
          reported.set(id, Date.now())
          console.log(`  observation ${failing.path} -> ${explorerEntity(written.entityKey)}`)
        }
      } catch (error) {
        console.error(`${new Date().toISOString()} ${origin} error: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  await pass()
  if (flags.once) return
  setInterval(() => {
    pass().catch((error: unknown) => console.error("watch pass failed", error))
  }, intervalMs)
}

/**
 * The Bybit replay. Hashes Safe's archived chunk in both versions, straight from the Wayback
 * Machine. The bytes are only hashed: never executed, never written to disk, never re-served.
 */
export async function replay(flags: Flags): Promise<void> {
  const { binding, path, clean, tampered, safeRelease } = BYBIT_REPLAY
  const rpc = reader()

  const [cleanHash, tamperedHash] = await Promise.all([
    fetchBytes(clean.url).then(sha256Hex),
    fetchBytes(tampered.url).then(sha256Hex),
  ])
  if (cleanHash !== clean.sha256 || tamperedHash !== tampered.sha256) {
    throw new CliError(`Wayback bytes changed: clean ${cleanHash}, tampered ${tamperedHash}`)
  }

  if (flags.publish) {
    const result = await publishRelease(walletFrom(keyEnv(flags, "REPLAY_PK")), rpc, {
      origin: binding.origin,
      version: `${safeRelease.version}-reconstructed`,
      commit: safeRelease.commit,
      manifest: {
        files: [{ path, sha256: clean.sha256, bytes: clean.bytes }],
        inline: [],
        builder: "imprimatur-cli/0.1.0 replay",
        framework: "next",
        note: `Reconstruction from the Wayback Machine (${clean.url}). Not Safe's key. Safe never published releases.`,
      },
    })
    console.log(written("replay release", result))
  }

  for (const [label, sha256] of [["clean (2025-02-14)", cleanHash], ["tampered (2025-02-19)", tamperedHash]] as const) {
    const { decision } = await verify({
      reader: rpc,
      origin: binding.origin,
      binding,
      observed: [{ kind: "file", path, sha256 }],
    })
    console.log(`\n${label}\n${report(decision)}`)
  }
}
