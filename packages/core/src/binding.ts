import { getAddress, type Hex, isAddress } from "viem"
import { PRELOAD } from "./preload"

/**
 * Who may sign releases for an origin. Lives outside both the web host and Arkiv: an attacker who
 * owns the bucket can't change it, and neither can anyone writing entities to Arkiv.
 */
export interface Binding {
  /** Host only, e.g. `app.safe.global`. Matches the `origin` attribute on every entity. */
  origin: string
  signers: readonly Hex[]
  /** Distinct signers that must have created or approved a release before it verifies. */
  threshold: number
  /** The only key whose `keyrevocation` entities count. */
  recovery: Hex
  /** Watchers whose observations are shown. Empty means none are trusted. */
  watchers: readonly Hex[]
  label?: string
  /** Set when the binding came from a page's own declaration rather than the preload list. */
  source: "preload" | "pinned"
}

export function hostOf(url: string): string {
  return new URL(url).host
}

export function findBinding(origin: string, list: readonly Binding[] = PRELOAD): Binding | undefined {
  return list.find((binding) => binding.origin === origin)
}

/**
 * Parses `<meta name="imprimatur" content="signers=0x..,0x..;threshold=2;recovery=0x..;watchers=0x..">`.
 * Returns undefined for anything malformed, so a broken declaration reads as UNLISTED, never as a
 * looser binding.
 */
export function parseMetaBinding(content: string, origin: string): Binding | undefined {
  const fields = new Map<string, string>()
  for (const part of content.split(";")) {
    const [name, value] = part.split("=").map((s) => s.trim())
    if (name && value) fields.set(name, value)
  }
  const signers = parseAddressList(fields.get("signers"))
  const recovery = fields.get("recovery")
  const threshold = Number(fields.get("threshold") ?? "1")
  if (!signers || signers.length === 0 || !recovery || !isAddress(recovery)) return undefined
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > signers.length) return undefined
  return {
    origin,
    signers,
    threshold,
    recovery: getAddress(recovery),
    watchers: parseAddressList(fields.get("watchers")) ?? [],
    source: "pinned",
  }
}

function parseAddressList(value: string | undefined): Hex[] | undefined {
  if (!value) return undefined
  const parts = value.split(",").map((s) => s.trim())
  if (!parts.every((part) => isAddress(part))) return undefined
  return parts.map((part) => getAddress(part))
}

/** True when two bindings would accept exactly the same releases. */
export function sameTrust(a: Binding, b: Binding): boolean {
  const set = (list: readonly Hex[]) => [...list].map((x) => x.toLowerCase()).sort().join(",")
  return (
    set(a.signers) === set(b.signers) &&
    a.threshold === b.threshold &&
    a.recovery.toLowerCase() === b.recovery.toLowerCase()
  )
}
