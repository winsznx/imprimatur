import type { PanelState } from "./protocol"

interface WireDecision {
  checked: number
  atBlock: string
  release?: { version: string; seq: string; creator: string; key: string; expiresAt: string }
  approvals: { have: number; need: number }
  failing: { path: string; expected?: string; actual: string }[]
  ignoredForgeries: { creator: string }[]
}

const STAMP: Record<string, string> = {
  VERIFIED: "Cleared to sign",
  PENDING: "Held for approval",
  MISMATCH: "Signing blocked",
  REVOKED: "Revoked",
  KEY_REVOKED: "Key revoked",
  SIGNER_CHANGED: "Keys changed",
  STALE: "Stale",
  UNREACHABLE: "Not checked",
  UNLISTED: "Not enrolled",
}

const short = (value: string) => (value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value)

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function render(state: PanelState): void {
  const root = document.querySelector("#panel")
  const liveLine = document.querySelector<HTMLElement>("#live")
  if (!root || !liveLine) return
  liveLine.dataset.state = state.live
  liveLine.textContent = state.live === "watching" ? "Live on Tiramisu" : state.live === "offline" ? "Live updates off" : "Connecting"

  if (!state.origin) {
    root.replaceChildren(el("p", "quiet", "Open a site to check it."))
    return
  }
  if (!state.bound) {
    root.replaceChildren(
      el("p", "origin", state.origin),
      el("p", "stamp", STAMP.UNLISTED),
      el("p", "strip", `${state.origin} doesn't publish releases. Imprimatur isn't reading or checking it.`),
    )
    return
  }
  if (!state.verdict || !state.decision) {
    root.replaceChildren(el("p", "origin", state.origin), el("p", "strip quiet", "Hashing this page's scripts and asking Arkiv…"))
    return
  }

  const decision = JSON.parse(state.decision) as WireDecision
  const stamp = el("p", "stamp", STAMP[state.verdict] ?? state.verdict)
  stamp.dataset.gate = state.gate ?? ""
  const children: Node[] = [el("p", "origin", state.origin), stamp, el("p", "strip", state.strip ?? "")]
  if (state.next) children.push(el("p", "next", state.next))

  const facts = el("dl", "facts")
  const add = (term: string, value: string) => facts.append(el("dt", undefined, term), el("dd", undefined, value))
  add("Files checked", String(decision.checked))
  if (decision.release) {
    add("Release", `v${decision.release.version}, seq ${decision.release.seq}`)
    add("Signed by", short(decision.release.creator))
    add("Approvals", `${decision.approvals.have} of ${decision.approvals.need}`)
  }
  if (decision.ignoredForgeries.length > 0) add("Forgeries ignored", String(decision.ignoredForgeries.length))
  add("Checked at block", decision.atBlock)
  children.push(facts)

  if (decision.failing.length > 0) {
    const list = el("ul", "failing")
    for (const file of decision.failing.slice(0, 6)) {
      const item = el("li")
      item.append(
        el("span", "file", file.path.split("/").pop() ?? file.path),
        el("span", "hashes", `expected ${file.expected ? short(file.expected) : "not listed"}, got ${short(file.actual) || "unreachable"}`),
      )
      list.append(item)
    }
    children.push(list)
  }
  if (state.query) {
    const details = el("details", "query")
    details.append(el("summary", undefined, "The query that decided this"), el("pre", undefined, state.query))
    children.push(details)
  }
  if (state.checking) children.push(el("p", "quiet", "Re-checking…"))
  root.replaceChildren(...children)
}

const port = chrome.runtime.connect({ name: "panel" })
port.onMessage.addListener((state: PanelState) => render(state))
