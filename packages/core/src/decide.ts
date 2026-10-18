import type { Hex } from "viem"
import { type Binding, sameTrust } from "./binding"
import type { ReleaseRecord, RevocationRecord, VerdictRecords } from "./entities"
import { OBSERVATION_WINDOW_MS } from "./schema"

export type Verdict =
  | "VERIFIED"
  | "PENDING"
  | "MISMATCH"
  | "REVOKED"
  | "KEY_REVOKED"
  | "SIGNER_CHANGED"
  | "STALE"
  | "UNREACHABLE"
  | "UNLISTED"

export type GateAction = "allow" | "warn" | "block"

/** What signing does under each verdict. The extension, the Checkpoint and the CLI all use this. */
export const GATE: Readonly<Record<Verdict, GateAction>> = {
  VERIFIED: "allow",
  UNLISTED: "allow",
  STALE: "warn",
  UNREACHABLE: "warn",
  PENDING: "block",
  MISMATCH: "block",
  REVOKED: "block",
  KEY_REVOKED: "block",
  SIGNER_CHANGED: "block",
}

export interface ObservedResource {
  kind: "file" | "inline"
  /** `resourcePath()` for files, `inlinePath()` for inline scripts. */
  path: string
  sha256: string
}

export interface ReleaseSummary {
  key: Hex
  version: string
  seq: bigint
  creator: Hex
  commit: string
  published: number
  expiresAt: bigint
  createdAt: bigint
  readonly: boolean
}

export interface Decision {
  verdict: Verdict
  origin: string
  release?: ReleaseSummary
  approvals: { have: number; need: number; by: Hex[] }
  failing: { path: string; expected?: string; actual: string }[]
  checked: number
  ignoredForgeries: { key: Hex; creator: Hex }[]
  observations: { path: string; sha256: string; expected: string; at: number; watcher: Hex }[]
  revocation?: { reason: string; at: number; owner: Hex }
  revokedSigner?: Hex
  supersededBy?: { version: string; published: number; graceEndsAt: number }
  previousSigners?: Hex[]
  atBlock: bigint
}

export interface DecideInput {
  origin: string
  binding: Binding | undefined
  observed: readonly ObservedResource[]
  records: VerdictRecords
  forgeries?: readonly { key: Hex; creator: Hex }[]
  /** The binding the user trusted before, if it came from a page declaration. */
  pinned?: Binding
  reachable: boolean
  now: number
  atBlock: bigint
}

/**
 * The whole verdict, as a pure function of what the tab ran and what Arkiv returned. Every line the
 * user reads is generated from the Decision this returns, so what the UI says and what the gate does
 * can't drift apart.
 */
export function decide(input: DecideInput): Decision {
  const { origin, binding, observed, records, now, atBlock } = input
  const base: Decision = {
    verdict: "UNLISTED",
    origin,
    approvals: { have: 0, need: binding?.threshold ?? 0, by: [] },
    failing: [],
    checked: observed.length,
    ignoredForgeries: binding ? forgeriesOf(input.forgeries ?? [], binding) : [],
    observations: [],
    atBlock,
  }

  if (!binding) return base
  if (input.pinned && !sameTrust(input.pinned, binding)) {
    return { ...base, verdict: "SIGNER_CHANGED", previousSigners: [...input.pinned.signers] }
  }
  if (!input.reachable) return { ...base, verdict: "UNREACHABLE" }

  const signers = lowerSet(binding.signers)
  const watchers = lowerSet(binding.watchers)
  const recovery = binding.recovery.toLowerCase()
  const revokedSigners = new Set(
    records.keyRevocations.filter((k) => k.creator.toLowerCase() === recovery).map((k) => k.signer.toLowerCase()),
  )
  const revocations = records.revocations.filter((r) => signers.has(r.creator.toLowerCase()))
  const revocationOf = (release: ReleaseRecord) => revocations.find((r) => r.release === release.key)

  const releases = records.releases
    .filter((release) => signers.has(release.creator.toLowerCase()))
    .sort((a, b) => (a.seq === b.seq ? b.published - a.published : a.seq > b.seq ? -1 : 1))

  const approversOf = (release: ReleaseRecord): Hex[] => {
    const by = new Map<string, Hex>([[release.creator.toLowerCase(), release.creator]])
    for (const approval of records.approvals) {
      const creator = approval.creator.toLowerCase()
      if (approval.release === release.key && signers.has(creator)) by.set(creator, approval.creator)
    }
    return [...by.entries()].filter(([lower]) => !revokedSigners.has(lower)).map(([, address]) => address)
  }
  const isLive = (release: ReleaseRecord) =>
    !revocationOf(release) &&
    !revokedSigners.has(release.creator.toLowerCase()) &&
    approversOf(release).length >= binding.threshold

  const withObservations: Decision = {
    ...base,
    observations: records.observations
      .filter((o) => watchers.has(o.creator.toLowerCase()) && now - o.at <= OBSERVATION_WINDOW_MS)
      .map((o) => ({ path: o.path, sha256: o.sha256, expected: o.expected, at: o.at, watcher: o.creator })),
  }

  if (releases.length === 0) return { ...withObservations, verdict: "STALE" }

  // Only a release that is approved, unrevoked and from an unrevoked key can supersede another.
  // Otherwise a stolen CI key could push an unapproved release and turn every honest tab STALE.
  const latest = releases.find(isLive)
  const matched = releases.find((release) => matches(release, observed))

  if (!matched) {
    const reference = latest ?? releases[0]
    if (!reference) return { ...withObservations, verdict: "STALE" }
    return {
      ...withObservations,
      verdict: "MISMATCH",
      release: summarize(reference),
      approvals: approvalsFor(approversOf(reference), binding),
      failing: observed
        .filter((resource) => !lists(reference, resource))
        .map((resource) => ({
          path: resource.path,
          ...(resource.kind === "file" && reference.files.has(resource.path)
            ? { expected: reference.files.get(resource.path) }
            : {}),
          actual: resource.sha256,
        })),
    }
  }

  const decided: Decision = {
    ...withObservations,
    release: summarize(matched),
    approvals: approvalsFor(approversOf(matched), binding),
  }

  if (revokedSigners.has(matched.creator.toLowerCase())) {
    return { ...decided, verdict: "KEY_REVOKED", revokedSigner: matched.creator }
  }
  const revocation = revocationOf(matched)
  if (revocation) return { ...decided, verdict: "REVOKED", revocation: revocationSummary(revocation) }
  if (decided.approvals.have < binding.threshold) return { ...decided, verdict: "PENDING" }

  if (latest && latest.key !== matched.key && latest.seq > matched.seq) {
    const graceEndsAt = latest.published + latest.grace
    const supersededBy = { version: latest.version, published: latest.published, graceEndsAt }
    return { ...decided, verdict: now < graceEndsAt ? "VERIFIED" : "STALE", supersededBy }
  }
  return { ...decided, verdict: "VERIFIED" }
}

/** True when every resource the tab ran is listed in the release with the same hash. */
export function matches(release: ReleaseRecord, observed: readonly ObservedResource[]): boolean {
  return observed.every((resource) => lists(release, resource))
}

function lists(release: ReleaseRecord, resource: ObservedResource): boolean {
  return resource.kind === "inline"
    ? release.inline.has(resource.sha256)
    : release.files.get(resource.path) === resource.sha256
}

function summarize(release: ReleaseRecord): ReleaseSummary {
  const { key, version, seq, creator, commit, published, expiresAt, createdAt, readonly } = release
  return { key, version, seq, creator, commit, published, expiresAt, createdAt, readonly }
}

function approvalsFor(by: Hex[], binding: Binding): Decision["approvals"] {
  return { have: by.length, need: binding.threshold, by }
}

function revocationSummary(revocation: RevocationRecord): NonNullable<Decision["revocation"]> {
  return { reason: revocation.reason, at: revocation.at, owner: revocation.owner }
}

function forgeriesOf(all: readonly { key: Hex; creator: Hex }[], binding: Binding) {
  const signers = lowerSet(binding.signers)
  return all.filter((entry) => !signers.has(entry.creator.toLowerCase()))
}

function lowerSet(list: readonly Hex[]): Set<string> {
  return new Set(list.map((address) => address.toLowerCase()))
}
