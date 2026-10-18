import { addr, type Entity, type PublicArkivClient, str, u64 } from "@arkiv-network/sdk"
import { and, eq, type Expression, gt, or } from "@arkiv-network/sdk/query"
import type { Hex } from "viem"
import type { Binding } from "./binding"
import { parseRecords, type VerdictRecords } from "./entities"
import { ENTITY_TYPE, OBSERVATION_WINDOW_MS } from "./schema"

export type ArkivReader = Pick<PublicArkivClient, "select">

const creatorIn = (addresses: readonly Hex[]): Expression =>
  or(addresses.map((address) => eq("$creator", addr(address))))

const typeIn = (types: readonly string[]): Expression => or(types.map((type) => eq("type", str(type))))

/**
 * Everything a verdict needs for one origin, as one predicate:
 *
 *   origin = o AND (
 *     (type in {release, approval, revocation} AND $creator in signers)
 *     OR (type = keyrevocation AND $creator = recovery)
 *     OR (type = observation AND at > now - 1h AND $creator in watchers)
 *   )
 *
 * The trust is in the `$creator` terms. `origin` and `type` only narrow the lookup: anyone can write
 * them, so an entity that copies them under another key never reaches the verdict.
 * `.createdBy()` replaces itself when called twice, so several keys need an explicit `or()`.
 */
export function verdictPredicate(binding: Binding, now: number): Expression {
  const branches: Expression[] = [
    and(typeIn([ENTITY_TYPE.release, ENTITY_TYPE.approval, ENTITY_TYPE.revocation]), creatorIn(binding.signers)),
    and(eq("type", str(ENTITY_TYPE.keyRevocation)), eq("$creator", addr(binding.recovery))),
  ]
  if (binding.watchers.length > 0) {
    branches.push(
      and(
        eq("type", str(ENTITY_TYPE.observation)),
        gt("at", u64(BigInt(Math.max(0, now - OBSERVATION_WINDOW_MS)))),
        creatorIn(binding.watchers),
      ),
    )
  }
  return and(eq("origin", str(binding.origin)), or(branches))
}

export interface VerdictFetch {
  records: VerdictRecords
  atBlock: bigint
  /** The query string the node parsed, so the Checkpoint can show judges exactly what ran. */
  query: string
  pages: number
}

/** Pages are capped: a page costs a query against the keyless budget, and an origin needs one. */
const MAX_PAGES = 3

export async function fetchVerdictRecords(
  reader: ArkivReader,
  binding: Binding,
  now: number,
  atBlock?: bigint,
): Promise<VerdictFetch> {
  const builder = reader.select("*").where(verdictPredicate(binding, now)).limit(200)
  if (atBlock !== undefined) builder.atBlock(atBlock)
  const query = builder.toString()

  const entities: Entity[] = []
  let page = await builder.fetch()
  const block = page.blockNumber
  let pages = 1
  entities.push(...(page.entities as Entity[]))
  while (page.hasNextPage() && pages < MAX_PAGES) {
    page = await page.next()
    pages += 1
    entities.push(...(page.entities as Entity[]))
  }
  return { records: parseRecords(entities), atBlock: block, query, pages }
}

/** Releases for the origin from any key. Everything not in the binding is a forgery we ignored. */
export async function fetchReleaseCreators(
  reader: ArkivReader,
  origin: string,
): Promise<{ key: Hex; creator: Hex }[]> {
  const page = await reader
    .select({ key: true, creator: true })
    .where(eq("type", str(ENTITY_TYPE.release)), eq("origin", str(origin)))
    .limit(200)
    .fetch()
  return page.entities.flatMap((entity) => (entity.key && entity.creator ? [{ key: entity.key, creator: entity.creator }] : []))
}
