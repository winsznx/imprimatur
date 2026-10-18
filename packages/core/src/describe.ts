import type { Hex } from "viem"
import { type Decision, GATE } from "./decide"

export function shortHex(value: string, head = 6, tail = 4): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`
}

export function fileName(path: string): string {
  if (path.startsWith("inline:")) return `inline script ${path.slice("inline:".length, "inline:".length + 8)}`
  const last = path.split("/").filter(Boolean).pop()
  return last ?? path
}

function minutesAgo(now: number, at: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000))
  if (minutes < 1) return "just now"
  if (minutes < 90) return `${minutes} min ago`
  return `${Math.round(minutes / 60)} h ago`
}

function signedBy(creator: Hex): string {
  return `signed by ${shortHex(creator)}`
}

function forgeryNote(decision: Decision): string {
  const count = decision.ignoredForgeries.length
  if (count === 0) return ""
  const first = decision.ignoredForgeries[0]
  const from = first ? ` from ${shortHex(first.creator)}` : ""
  return ` ${count} forged release${count === 1 ? "" : "s"}${from} ignored.`
}

/**
 * The one sentence the user reads. Generated from the same Decision the gate acts on, and covered
 * by tests, so the strip never says something the gate isn't doing.
 */
export function describe(decision: Decision, now: number = Date.now()): string {
  const { release, approvals, failing, origin } = decision
  const version = release ? `v${release.version}` : "the release"

  switch (decision.verdict) {
    case "VERIFIED": {
      const base = `${decision.checked} file${decision.checked === 1 ? "" : "s"} match release ${version} ${signedBy(release?.creator ?? "0x")}, ${approvals.have} of ${approvals.need} approvals.`
      const superseded = decision.supersededBy
        ? ` Replaced by v${decision.supersededBy.version} ${minutesAgo(now, decision.supersededBy.published)}, still inside the grace window.`
        : ""
      return `${base}${superseded}${forgeryNote(decision)}`
    }
    case "PENDING":
      return `Release ${version} has ${approvals.have} of ${approvals.need} approvals. Signing blocked until another signer approves it.`
    case "MISMATCH": {
      const first = failing[0]
      if (!first || !release) return `This page doesn't match any release for ${origin}. Signing blocked.${forgeryNote(decision)}`
      const more = failing.length > 1 ? ` ${failing.length - 1} more file${failing.length === 2 ? "" : "s"} differ.` : ""
      return `${fileName(first.path)} hash ${shortHex(first.actual, 6, 4)} is not in release ${version} ${signedBy(release.creator)}. Signing blocked.${more}${forgeryNote(decision)}`
    }
    case "REVOKED":
      return `Release ${version} was revoked by its team (${decision.revocation?.reason ?? "no reason given"}). Signing blocked.`
    case "KEY_REVOKED":
      return `Signer ${shortHex(decision.revokedSigner ?? release?.creator ?? "0x")} was revoked by ${origin}'s recovery key. Signing blocked.`
    case "SIGNER_CHANGED":
      return `The keys for ${origin} changed since you first trusted them. Signing blocked until you confirm the new keys.`
    case "STALE":
      return decision.supersededBy
        ? `This tab runs ${version}, replaced by v${decision.supersededBy.version} ${minutesAgo(now, decision.supersededBy.published)}. Reload before you sign.`
        : `No live release for ${origin}. The team stopped renewing it, or never published one.`
    case "UNREACHABLE":
      return "Arkiv unreachable, so this page couldn't be checked. Signing is not blocked, but nothing vouches for this code."
    case "UNLISTED":
      return `${origin} doesn't publish releases. Imprimatur isn't checking it.`
  }
}

/** The second line, shown under the strip while a signature request is waiting. */
export function nextAction(decision: Decision): string {
  switch (GATE[decision.verdict]) {
    case "allow":
      return "If you sign now, the request goes to your wallet."
    case "warn":
      return "If you sign now, you'll be asked to confirm first."
    case "block":
      return "If you sign now, the request will be refused."
  }
}
