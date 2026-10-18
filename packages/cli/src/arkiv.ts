import { addr, ExpirationTime, jsonToPayload, key, str, u64, i32 } from "@arkiv-network/sdk"
import { eq } from "@arkiv-network/sdk/query"
import {
  BURN_ADDRESS,
  type Binding,
  DEFAULT_GRACE_MS,
  ENTITY_TYPE,
  fetchVerdictRecords,
  LIFETIME_DAYS,
  type ReleaseManifest,
  type ReleaseRecord,
} from "@imprimatur/core"
import type { Hex } from "viem"
import { CliError, type Reader, type WalletClient } from "./env"

export interface WriteResult {
  entityKey: Hex
  txHash: Hex
  ms: number
}

const JSON_TYPE = "application/json"

/** Highest seq this signer has used for the origin, among releases that are still alive. */
async function nextSeq(reader: Reader, origin: string, signer: Hex): Promise<bigint> {
  const page = await reader
    .select({ attributes: { seq: true } })
    .where(eq("type", str(ENTITY_TYPE.release)), eq("origin", str(origin)))
    .createdBy(signer)
    .limit(200)
    .fetch()
  let max = 0n
  for (const entity of page.entities) {
    const seq = entity.attributes.seq
    if (seq?.type === "u64" && seq.value > max) max = seq.value
  }
  return max + 1n
}

export async function publishRelease(
  wallet: WalletClient,
  reader: Reader,
  options: { origin: string; version: string; commit: string; manifest: ReleaseManifest; graceMs?: number },
): Promise<WriteResult & { seq: bigint }> {
  const seq = await nextSeq(reader, options.origin, wallet.account.address)
  const started = performance.now()
  const { entityKey, txHash } = await wallet.createEntity({
    attributes: {
      type: str(ENTITY_TYPE.release),
      origin: str(options.origin),
      version: str(options.version),
      seq: u64(seq),
      commit: str(options.commit),
      assets: i32(options.manifest.files.length),
      published: u64(BigInt(Date.now())),
      grace: u64(BigInt(options.graceMs ?? DEFAULT_GRACE_MS)),
    },
    payload: jsonToPayload(options.manifest),
    contentType: JSON_TYPE,
    expires: ExpirationTime.fromDays(LIFETIME_DAYS.release),
    flags: { readonly: true },
  })
  return { entityKey, txHash, seq, ms: performance.now() - started }
}

/**
 * Approvals can be extended by anyone so the publisher's daily heartbeat keeps them alive. It can
 * renew a maintainer's approval but never change or forge one: the creator stays the maintainer.
 */
export async function approveRelease(
  wallet: WalletClient,
  options: { origin: string; release: Hex; version: string },
): Promise<WriteResult> {
  const started = performance.now()
  const { entityKey, txHash } = await wallet.createEntity({
    attributes: {
      type: str(ENTITY_TYPE.approval),
      origin: str(options.origin),
      release: key(options.release),
      at: u64(BigInt(Date.now())),
    },
    payload: jsonToPayload({ version: options.version }),
    contentType: JSON_TYPE,
    expires: ExpirationTime.fromDays(LIFETIME_DAYS.approval),
    flags: { readonly: true, permissionlessExtension: true },
  })
  return { entityKey, txHash, ms: performance.now() - started }
}

type BurnedAttributes = Parameters<WalletClient["createEntity"]>[0]["attributes"]

/**
 * Creates an entity and hands it to the burn address in the same transaction. The key is predicted
 * first (on the public client: the wallet client doesn't have predictEntityKeys, sdk-js #123), and
 * the batch applies creates before ownership changes, so there is no block in which the creator
 * could delete it. Nobody can edit or delete it afterwards; anyone can extend it.
 */
export async function createBurned(
  wallet: WalletClient,
  reader: Reader,
  options: { attributes: BurnedAttributes; payload: Record<string, unknown>; days: number },
): Promise<WriteResult> {
  const [predicted] = await reader.predictEntityKeys({ owner: wallet.account.address, count: 1 })
  if (!predicted) throw new CliError("predictEntityKeys returned nothing")
  const started = performance.now()
  const result = await wallet.executeBatch({
    creates: [
      {
        attributes: options.attributes,
        payload: jsonToPayload(options.payload),
        contentType: JSON_TYPE,
        expires: ExpirationTime.fromDays(options.days),
        flags: { readonly: true, permissionlessExtension: true },
        salt: predicted.salt,
      },
    ],
    ownershipChanges: [{ entityKey: predicted.key, newOwner: BURN_ADDRESS }],
  })
  const created = result.createdEntities[0]
  if (created !== predicted.key) {
    throw new CliError(`created ${created ?? "nothing"} but predicted ${predicted.key}; ownership went to the predicted key`)
  }
  return { entityKey: created, txHash: result.txHash, ms: performance.now() - started }
}

export function revocationAttributes(origin: string, release: Hex, reason: string): BurnedAttributes {
  return {
    type: str(ENTITY_TYPE.revocation),
    origin: str(origin),
    release: key(release),
    reason: str(reason),
    at: u64(BigInt(Date.now())),
  }
}

export function keyRevocationAttributes(origin: string, signer: Hex): BurnedAttributes {
  return { type: str(ENTITY_TYPE.keyRevocation), origin: str(origin), signer: addr(signer), at: u64(BigInt(Date.now())) }
}

export function observationAttributes(o: {
  origin: string
  path: string
  sha256: string
  expected: string
  release: Hex
}): BurnedAttributes {
  return {
    type: str(ENTITY_TYPE.observation),
    origin: str(o.origin),
    path: str(o.path.slice(0, 128)),
    sha256: str(o.sha256 || "unreachable"),
    expected: str(o.expected || "unlisted"),
    release: key(o.release),
    at: u64(BigInt(Date.now())),
  }
}

/** Newest release by seq from the bound signers, or the one named. */
export async function findRelease(reader: Reader, binding: Binding, wanted?: Hex): Promise<ReleaseRecord> {
  const { records } = await fetchVerdictRecords(reader, binding, Date.now())
  const releases = [...records.releases].sort((a, b) => (a.seq === b.seq ? 0 : a.seq > b.seq ? -1 : 1))
  const found = wanted ? releases.find((release) => release.key.toLowerCase() === wanted.toLowerCase()) : releases[0]
  if (!found) throw new CliError(wanted ? `release ${wanted} not found for ${binding.origin}` : `no live release for ${binding.origin}`)
  return found
}

/**
 * The lease. Pushes this signer's live releases for the origin, and every approval of them, out to
 * a fresh lifetime in one transaction. A team that stops running this goes STALE by itself.
 */
export async function heartbeat(
  wallet: WalletClient,
  reader: Reader,
  binding: Binding,
  days: number = LIFETIME_DAYS.release,
): Promise<{ txHash: Hex; extended: Hex[]; ms: number }> {
  const { records } = await fetchVerdictRecords(reader, binding, Date.now())
  const mine = records.releases.filter((r) => r.creator.toLowerCase() === wallet.account.address.toLowerCase())
  if (mine.length === 0) throw new CliError(`no live release for ${binding.origin} created by ${wallet.account.address}`)
  const keys = new Set(mine.map((r) => r.key))
  const approvals = records.approvals.filter((a) => keys.has(a.release)).map((a) => a.key)
  const extended = [...keys, ...approvals]
  const started = performance.now()
  const { txHash } = await wallet.executeBatch({
    extensions: extended.map((entityKey) => ({ entityKey, expires: ExpirationTime.fromDays(days) })),
  })
  return { txHash, extended, ms: performance.now() - started }
}
