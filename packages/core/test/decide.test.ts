import type { Hex } from "viem"
import { describe as suite, expect, it } from "vitest"
import type { Binding } from "../src/binding"
import { type DecideInput, decide, GATE, type ObservedResource } from "../src/decide"
import { describe } from "../src/describe"
import { emptyRecords, type ReleaseRecord, type VerdictRecords } from "../src/entities"
import { verdictPredicate } from "../src/query"

const A: Hex = "0x1830F524dF9CE6D347189dF08C1054edDB89fd81"
const B: Hex = "0x69a1F684ED2E7c958B9aE4808a81DBCE8f5bec84"
const C: Hex = "0x0E0B69eCB7D11C9b67717D6513D6DD1881468EA4"
const RECOVERY: Hex = "0x5b1dCa11839297ba5047f8a058f04b86C10C14e6"
const FORGER: Hex = "0xFf6d752c31A871d630349001B87aA0cBE5e64645"
const WATCHER: Hex = "0xE94f0a5D30f06CbAEbe2dc8b0c7f5BfFEAD863df"
const NOW = 1_760_000_000_000
const HOUR = 3_600_000

const binding: Binding = {
  origin: "app.example",
  signers: [A, B, C],
  threshold: 2,
  recovery: RECOVERY,
  watchers: [WATCHER],
  source: "preload",
}

const sha = (n: number) => n.toString(16).padStart(64, "0")
const key = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`

function release(n: number, creator: Hex, files: Record<string, string>, extra: Partial<ReleaseRecord> = {}): ReleaseRecord {
  return {
    key: key(n),
    creator,
    version: `1.${n}.0`,
    seq: BigInt(n),
    commit: "a".repeat(40),
    published: NOW - 10 * HOUR,
    grace: HOUR,
    assets: Object.keys(files).length,
    expiresAt: 1_000_000n,
    createdAt: 100n,
    readonly: true,
    files: new Map(Object.entries(files)),
    inline: new Set(extra.inline ?? []),
    manifest: { files: [], inline: [], builder: "test" },
    ...extra,
  }
}

const tab: ObservedResource[] = [
  { kind: "file", path: "/assets/index.js", sha256: sha(1) },
  { kind: "file", path: "/assets/vendor.js", sha256: sha(2) },
]
const cleanFiles = { "/assets/index.js": sha(1), "/assets/vendor.js": sha(2), "/assets/lazy.js": sha(3) }

function input(records: Partial<VerdictRecords>, overrides: Partial<DecideInput> = {}): DecideInput {
  return {
    origin: binding.origin,
    binding,
    observed: tab,
    records: { ...emptyRecords(), ...records },
    reachable: true,
    now: NOW,
    atBlock: 500n,
    ...overrides,
  }
}

const approvedClean = (): Partial<VerdictRecords> => ({
  releases: [release(1, A, cleanFiles)],
  approvals: [{ key: key(100), creator: B, release: key(1), at: NOW - 9 * HOUR }],
})

suite("decide", () => {
  it("stays silent on origins nobody bound", () => {
    const decision = decide(input({}, { binding: undefined }))
    expect(decision.verdict).toBe("UNLISTED")
    expect(GATE[decision.verdict]).toBe("allow")
  })

  it("verifies a release created by one signer and approved by another", () => {
    const decision = decide(input(approvedClean()))
    expect(decision.verdict).toBe("VERIFIED")
    expect(decision.approvals).toEqual({ have: 2, need: 2, by: [A, B] })
    expect(describe(decision, NOW)).toBe(
      "2 files match release v1.1.0 signed by 0x1830…fd81, 2 of 2 approvals.",
    )
  })

  it("blocks a release only one signer stands behind (stolen CI key)", () => {
    const decision = decide(input({ releases: [release(1, A, cleanFiles)] }))
    expect(decision.verdict).toBe("PENDING")
    expect(GATE[decision.verdict]).toBe("block")
    expect(describe(decision, NOW)).toContain("1 of 2 approvals")
  })

  it("names the file that differs and blocks", () => {
    const swapped = [tab[0]!, { kind: "file" as const, path: "/assets/vendor.js", sha256: sha(9) }]
    const decision = decide(input(approvedClean(), { observed: swapped }))
    expect(decision.verdict).toBe("MISMATCH")
    expect(decision.failing).toEqual([{ path: "/assets/vendor.js", expected: sha(2), actual: sha(9) }])
    expect(describe(decision, NOW)).toMatch(/^vendor\.js hash 000000…0009 is not in release v1\.1\.0 signed by 0x1830…fd81\. Signing blocked\.$/)
  })

  it("flags a script that isn't in the release at all", () => {
    const injected = [...tab, { kind: "file" as const, path: "/evil.js", sha256: sha(7) }]
    const decision = decide(input(approvedClean(), { observed: injected }))
    expect(decision.verdict).toBe("MISMATCH")
    expect(decision.failing).toEqual([{ path: "/evil.js", actual: sha(7) }])
  })

  it("never lets a release from another key decide, even with every attribute copied", () => {
    const forged = release(2, FORGER, { "/assets/index.js": sha(1), "/assets/vendor.js": sha(9) })
    const swapped = [tab[0]!, { kind: "file" as const, path: "/assets/vendor.js", sha256: sha(9) }]
    const records = approvedClean()
    const decision = decide(
      input({ ...records, releases: [...records.releases!, forged] }, {
        observed: swapped,
        forgeries: [{ key: forged.key, creator: FORGER }, { key: key(1), creator: A }],
      }),
    )
    expect(decision.verdict).toBe("MISMATCH")
    expect(decision.ignoredForgeries).toEqual([{ key: forged.key, creator: FORGER }])
    expect(describe(decision, NOW)).toContain("1 forged release from 0xFf6d…4645 ignored.")
  })

  it("blocks a revoked release", () => {
    const records = approvedClean()
    const decision = decide(
      input({
        ...records,
        revocations: [{ key: key(200), creator: B, owner: "0x000000000000000000000000000000000000dEaD", release: key(1), reason: "compromised", at: NOW, createdAt: 600n }],
      }),
    )
    expect(decision.verdict).toBe("REVOKED")
    expect(describe(decision, NOW)).toBe("Release v1.1.0 was revoked by its team (compromised). Signing blocked.")
  })

  it("ignores a revocation written by a key outside the binding", () => {
    const records = approvedClean()
    const decision = decide(
      input({
        ...records,
        revocations: [{ key: key(200), creator: FORGER, owner: FORGER, release: key(1), reason: "compromised", at: NOW, createdAt: 600n }],
      }),
    )
    expect(decision.verdict).toBe("VERIFIED")
  })

  it("blocks everything a revoked signer created", () => {
    const records = approvedClean()
    const decision = decide(
      input({ ...records, keyRevocations: [{ key: key(300), creator: RECOVERY, signer: A, at: NOW, createdAt: 700n }] }),
    )
    expect(decision.verdict).toBe("KEY_REVOKED")
    expect(decision.revokedSigner).toBe(A)
  })

  it("ignores a key revocation that wasn't written by the recovery key", () => {
    const records = approvedClean()
    const decision = decide(
      input({ ...records, keyRevocations: [{ key: key(300), creator: B, signer: A, at: NOW, createdAt: 700n }] }),
    )
    expect(decision.verdict).toBe("VERIFIED")
  })

  it("keeps a tab on the previous release verified inside the grace window", () => {
    const records = approvedClean()
    const next = release(2, A, { "/assets/index.js": sha(11) }, { published: NOW - 10 * 60_000 })
    const decision = decide(
      input({
        releases: [...records.releases!, next],
        approvals: [...records.approvals!, { key: key(101), creator: C, release: next.key, at: NOW }],
      }),
    )
    expect(decision.verdict).toBe("VERIFIED")
    expect(decision.supersededBy?.version).toBe("1.2.0")
    expect(describe(decision, NOW)).toContain("Replaced by v1.2.0 10 min ago, still inside the grace window.")
  })

  it("marks a tab on the previous release stale after the grace window", () => {
    const records = approvedClean()
    const next = release(2, A, { "/assets/index.js": sha(11) }, { published: NOW - 2 * HOUR })
    const decision = decide(
      input({
        releases: [...records.releases!, next],
        approvals: [...records.approvals!, { key: key(101), creator: C, release: next.key, at: NOW }],
      }),
    )
    expect(decision.verdict).toBe("STALE")
    expect(GATE[decision.verdict]).toBe("warn")
  })

  it("doesn't let an unapproved newer release push honest tabs to stale", () => {
    const records = approvedClean()
    const rogue = release(5, A, { "/assets/index.js": sha(66) }, { published: NOW - 5 * HOUR })
    const decision = decide(input({ ...records, releases: [...records.releases!, rogue] }))
    expect(decision.verdict).toBe("VERIFIED")
    expect(decision.supersededBy).toBeUndefined()
  })

  it("reads a bound origin with no live release as stale", () => {
    expect(decide(input({})).verdict).toBe("STALE")
  })

  it("never passes silently when Arkiv can't be reached", () => {
    const decision = decide(input(approvedClean(), { reachable: false }))
    expect(decision.verdict).toBe("UNREACHABLE")
    expect(GATE[decision.verdict]).toBe("warn")
  })

  it("blocks when a page's declared keys change after the user pinned them", () => {
    const pinned: Binding = { ...binding, signers: [A, B], source: "pinned" }
    const decision = decide(input(approvedClean(), { pinned, binding: { ...binding, source: "pinned" } }))
    expect(decision.verdict).toBe("SIGNER_CHANGED")
  })

  it("checks inline scripts by hash", () => {
    const records = { ...approvedClean(), releases: [release(1, A, cleanFiles, { inline: new Set([sha(42)]) })] }
    const withInline: ObservedResource[] = [...tab, { kind: "inline", path: "inline:abc", sha256: sha(42) }]
    expect(decide(input(records, { observed: withInline })).verdict).toBe("VERIFIED")
    const injected: ObservedResource[] = [...tab, { kind: "inline", path: "inline:def", sha256: sha(43) }]
    expect(decide(input(records, { observed: injected })).verdict).toBe("MISMATCH")
  })

  it("shows recent observations only from trusted watchers", () => {
    const records: Partial<VerdictRecords> = {
      ...approvedClean(),
      observations: [
        { key: key(400), creator: WATCHER, path: "/assets/vendor.js", sha256: sha(9), expected: sha(2), release: key(1), at: NOW - 60_000 },
        { key: key(401), creator: FORGER, path: "/assets/vendor.js", sha256: sha(9), expected: sha(2), release: key(1), at: NOW - 60_000 },
        { key: key(402), creator: WATCHER, path: "/assets/vendor.js", sha256: sha(9), expected: sha(2), release: key(1), at: NOW - 2 * HOUR },
      ],
    }
    expect(decide(input(records)).observations.map((o) => o.watcher)).toEqual([WATCHER])
  })
})

suite("verdictPredicate", () => {
  it("puts the trust in $creator terms and keeps origin as a lookup", () => {
    const rendered = verdictPredicate(binding, NOW).toString()
    expect(rendered).toContain(`origin = str('app.example')`)
    expect(rendered).toContain(`$creator = addr(${A})`)
    expect(rendered).toContain(`$creator = addr(${RECOVERY})`)
    expect(rendered).toContain(`type = str('keyrevocation')`)
    expect(rendered).toContain(`at > u64(${NOW - HOUR})`)
  })
})
