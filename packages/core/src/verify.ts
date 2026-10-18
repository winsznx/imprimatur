import type { Binding } from "./binding"
import { type Decision, decide, type ObservedResource } from "./decide"
import { emptyRecords } from "./entities"
import { type ArkivReader, fetchReleaseCreators, fetchVerdictRecords } from "./query"

export interface VerifyOptions {
  reader: ArkivReader
  origin: string
  binding: Binding | undefined
  observed: readonly ObservedResource[]
  pinned?: Binding
  /** Also count releases for this origin from keys outside the binding. Costs one more query. */
  countForgeries?: boolean
  atBlock?: bigint
  now?: number
}

export interface VerifyResult {
  decision: Decision
  query?: string
  error?: Error
}

/** Queries Arkiv and decides. Network failure reads as UNREACHABLE, never as a pass. */
export async function verify(options: VerifyOptions): Promise<VerifyResult> {
  const now = options.now ?? Date.now()
  const { reader, origin, binding, observed, pinned } = options
  const common = { origin, binding, observed, now, ...(pinned && { pinned }) }

  if (!binding) {
    return { decision: decide({ ...common, records: emptyRecords(), reachable: true, atBlock: 0n }) }
  }
  try {
    const [fetched, forgeries] = await Promise.all([
      fetchVerdictRecords(reader, binding, now, options.atBlock),
      options.countForgeries ? fetchReleaseCreators(reader, origin) : Promise.resolve([]),
    ])
    return {
      decision: decide({ ...common, records: fetched.records, forgeries, reachable: true, atBlock: fetched.atBlock }),
      query: fetched.query,
    }
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause))
    return { decision: decide({ ...common, records: emptyRecords(), reachable: false, atBlock: 0n }), error }
  }
}
