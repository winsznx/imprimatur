import type { AnyArkivValue, Entity } from "@arkiv-network/sdk"
import type { Hex } from "viem"
import { parseManifest, type ReleaseManifest } from "./manifest"
import { ENTITY_TYPE } from "./schema"

export interface ReleaseRecord {
  key: Hex
  origin: string
  creator: Hex
  version: string
  seq: bigint
  commit: string
  published: number
  grace: number
  assets: number
  expiresAt: bigint
  createdAt: bigint
  readonly: boolean
  files: ReadonlyMap<string, string>
  inline: ReadonlySet<string>
  manifest: ReleaseManifest
}

export interface ApprovalRecord {
  key: Hex
  origin: string
  creator: Hex
  release: Hex
  at: number
}

export interface RevocationRecord {
  key: Hex
  origin: string
  creator: Hex
  owner: Hex
  release: Hex
  reason: string
  at: number
  createdAt: bigint
}

export interface KeyRevocationRecord {
  key: Hex
  origin: string
  creator: Hex
  signer: Hex
  at: number
  createdAt: bigint
}

export interface ObservationRecord {
  key: Hex
  origin: string
  creator: Hex
  path: string
  sha256: string
  expected: string
  release: Hex
  at: number
}

export interface VerdictRecords {
  releases: ReleaseRecord[]
  approvals: ApprovalRecord[]
  revocations: RevocationRecord[]
  keyRevocations: KeyRevocationRecord[]
  observations: ObservationRecord[]
  /** Entities that matched the query but don't follow the schema. Never trusted, only counted. */
  malformed: number
}

export function emptyRecords(): VerdictRecords {
  return { releases: [], approvals: [], revocations: [], keyRevocations: [], observations: [], malformed: 0 }
}

/**
 * Sorts query results into typed records. Anything that doesn't follow /arkiv/schema.md is counted
 * as malformed and dropped, so a half-written entity can never loosen a verdict.
 */
export function parseRecords(entities: readonly Entity[]): VerdictRecords {
  const records = emptyRecords()
  for (const entity of entities) {
    const parsed = parseEntity(entity)
    if (!parsed) {
      records.malformed += 1
      continue
    }
    switch (parsed.kind) {
      case "release":
        records.releases.push(parsed.record)
        break
      case "approval":
        records.approvals.push(parsed.record)
        break
      case "revocation":
        records.revocations.push(parsed.record)
        break
      case "keyrevocation":
        records.keyRevocations.push(parsed.record)
        break
      case "observation":
        records.observations.push(parsed.record)
        break
    }
  }
  return records
}

type ParsedEntity =
  | { kind: "release"; record: ReleaseRecord }
  | { kind: "approval"; record: ApprovalRecord }
  | { kind: "revocation"; record: RevocationRecord }
  | { kind: "keyrevocation"; record: KeyRevocationRecord }
  | { kind: "observation"; record: ObservationRecord }

function parseEntity(entity: Entity): ParsedEntity | undefined {
  const { key, creator } = entity
  if (!key || !creator) return undefined
  const read = reader(entity)
  const origin = read.str("origin")
  if (!origin) return undefined

  switch (read.str("type")) {
    case ENTITY_TYPE.release: {
      const version = read.str("version")
      const seq = read.u64("seq")
      const commit = read.str("commit")
      const published = read.u64("published")
      const grace = read.u64("grace")
      const assets = read.i32("assets")
      const manifest = parseManifest(decodeJson(entity.payload))
      if (version === undefined || seq === undefined || commit === undefined) return undefined
      if (published === undefined || grace === undefined || assets === undefined || !manifest) return undefined
      return {
        kind: "release",
        record: {
          key,
          origin,
          creator,
          version,
          seq,
          commit,
          published: Number(published),
          grace: Number(grace),
          assets,
          expiresAt: entity.expiresAt ?? 0n,
          createdAt: entity.createdAt ?? 0n,
          readonly: entity.creationFlags?.readonly ?? false,
          files: new Map(manifest.files.map((file) => [file.path, file.sha256])),
          inline: new Set(manifest.inline),
          manifest,
        },
      }
    }
    case ENTITY_TYPE.approval: {
      const release = read.key("release")
      const at = read.u64("at")
      if (!release || at === undefined) return undefined
      return { kind: "approval", record: { key, origin, creator, release, at: Number(at) } }
    }
    case ENTITY_TYPE.revocation: {
      const release = read.key("release")
      const reason = read.str("reason")
      const at = read.u64("at")
      if (!release || !reason || at === undefined) return undefined
      return {
        kind: "revocation",
        record: {
          key,
          origin,
          creator,
          owner: entity.owner ?? creator,
          release,
          reason,
          at: Number(at),
          createdAt: entity.createdAt ?? 0n,
        },
      }
    }
    case ENTITY_TYPE.keyRevocation: {
      const signer = read.addr("signer")
      const at = read.u64("at")
      if (!signer || at === undefined) return undefined
      return {
        kind: "keyrevocation",
        record: { key, origin, creator, signer, at: Number(at), createdAt: entity.createdAt ?? 0n },
      }
    }
    case ENTITY_TYPE.observation: {
      const path = read.str("path")
      const sha256 = read.str("sha256")
      const expected = read.str("expected")
      const release = read.key("release")
      const at = read.u64("at")
      if (!path || !sha256 || !expected || !release || at === undefined) return undefined
      return { kind: "observation", record: { key, origin, creator, path, sha256, expected, release, at: Number(at) } }
    }
    default:
      return undefined
  }
}

/** Typed reads that return undefined unless the attribute carries exactly the expected type tag. */
function reader(entity: Entity) {
  const at = (name: string): AnyArkivValue | undefined => entity.attributes?.[name]
  return {
    str: (name: string): string | undefined => {
      const value = at(name)
      return value?.type === "str" ? value.value : undefined
    },
    u64: (name: string): bigint | undefined => {
      const value = at(name)
      return value?.type === "u64" ? value.value : undefined
    },
    i32: (name: string): number | undefined => {
      const value = at(name)
      return value?.type === "i32" ? value.value : undefined
    },
    addr: (name: string): Hex | undefined => {
      const value = at(name)
      return value?.type === "addr" ? value.value : undefined
    },
    key: (name: string): Hex | undefined => {
      const value = at(name)
      return value?.type === "key" ? value.value : undefined
    },
  }
}

const decoder = new TextDecoder()

function decodeJson(payload: Uint8Array | undefined): unknown {
  if (!payload || payload.length === 0) return undefined
  try {
    return JSON.parse(decoder.decode(payload))
  } catch {
    return undefined
  }
}

/** Splits records fetched for several origins into one set per origin. */
export function recordsByOrigin(records: VerdictRecords): Map<string, VerdictRecords> {
  const byOrigin = new Map<string, VerdictRecords>()
  const bucket = (origin: string) => {
    let found = byOrigin.get(origin)
    if (!found) {
      found = emptyRecords()
      byOrigin.set(origin, found)
    }
    return found
  }
  for (const r of records.releases) bucket(r.origin).releases.push(r)
  for (const r of records.approvals) bucket(r.origin).approvals.push(r)
  for (const r of records.revocations) bucket(r.origin).revocations.push(r)
  for (const r of records.keyRevocations) bucket(r.origin).keyRevocations.push(r)
  for (const r of records.observations) bucket(r.origin).observations.push(r)
  return byOrigin
}
