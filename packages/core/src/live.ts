import type { PublicArkivClient } from "@arkiv-network/sdk"
import type { Hex } from "viem"
import type { Binding } from "./binding"

export type LiveReason = "created" | "transferred" | "extended" | "deleted"

export interface WatchOptions {
  onChange: (reason: LiveReason, entityKey: Hex) => void
  onError: (error: Error) => void
  /** Collapses the create + burn of one revocation batch into a single re-check. */
  debounceMs?: number
}

/**
 * Calls back when an entity that could change this origin's verdict is created, burned, extended
 * or deleted. Events carry the owner but not the creator, type or origin, so the filter is on the
 * owner at the moment of the event: every entity we trust starts life owned by a bound key.
 */
export function watchBinding(
  socket: Pick<PublicArkivClient, "watchEntityEvents">,
  binding: Binding,
  options: WatchOptions,
): () => void {
  const relevant = new Set(
    [...binding.signers, binding.recovery, ...binding.watchers].map((address) => address.toLowerCase()),
  )
  const isRelevant = (address: Hex) => relevant.has(address.toLowerCase())
  const debounceMs = options.debounceMs ?? 400
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: { reason: LiveReason; key: Hex } | undefined

  const notify = (reason: LiveReason, key: Hex) => {
    pending ??= { reason, key }
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      const fired = pending
      pending = undefined
      if (fired) options.onChange(fired.reason, fired.key)
    }, debounceMs)
  }

  const unwatch = socket.watchEntityEvents({
    onEntityCreated: (event) => {
      if (isRelevant(event.owner)) notify("created", event.entityKey)
    },
    onOwnershipTransferred: (event) => {
      if (isRelevant(event.previousOwner)) notify("transferred", event.entityKey)
    },
    onExpiryExtended: (event) => {
      if (isRelevant(event.owner)) notify("extended", event.entityKey)
    },
    onEntityDeleted: (event) => {
      if (isRelevant(event.owner)) notify("deleted", event.entityKey)
    },
    onError: options.onError,
  })

  return () => {
    if (timer) clearTimeout(timer)
    unwatch()
  }
}
