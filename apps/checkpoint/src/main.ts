import {
  type Binding,
  BYBIT_REPLAY,
  createArkivReader,
  createArkivSocket,
  type Decision,
  DEMO_KEYS,
  DEMO_ORIGINS,
  decide,
  describe,
  emptyRecords,
  explorerAddress,
  explorerEntity,
  fetchVerdictRecords,
  fileName,
  GATE,
  observeResources,
  PRELOAD,
  resourcesInHtml,
  shortHex,
  type Verdict,
  verify,
  watchBinding,
} from "@imprimatur/core"
import { h, link, mono } from "./dom"

const BLOCK_SECONDS = 2
const reader = createArkivReader({ timeoutMs: 10_000 })

const STAMP: Record<Verdict, string> = {
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

const SITES: Record<string, { name: string; what: string }> = {
  [DEMO_ORIGINS.clean]: { name: "Clean", what: "Serves exactly the release the team signed and approved." },
  [DEMO_ORIGINS.tampered]: {
    name: "Simulated bucket swap",
    what: "One file was changed after release and kept its content-hash name.",
  },
  [DEMO_ORIGINS.forged]: {
    name: "Forged release",
    what: "The changed file, plus a release for it from another wallet with every field copied and a higher seq.",
  },
  [DEMO_ORIGINS.stolenKey]: {
    name: "Stolen CI key",
    what: "The changed build, released with the team's real CI key. Nobody else approved it.",
  },
}

const fetchBytes = async (url: string) => new Uint8Array(await (await fetch(url, { cache: "no-store" })).arrayBuffer())

function lease(decision: Decision): string | undefined {
  const release = decision.release
  if (!release || decision.atBlock === 0n) return undefined
  const seconds = Number(release.expiresAt - decision.atBlock) * BLOCK_SECONDS
  if (seconds <= 0) return "lapsed"
  const hours = Math.floor(seconds / 3600)
  return hours >= 48 ? `${Math.floor(hours / 24)} days left unless renewed` : `${hours} h ${Math.floor((seconds % 3600) / 60)} min left unless renewed`
}

function stamp(verdict: Verdict): HTMLElement {
  return h("p", { class: "stamp", "data-verdict": verdict, "data-gate": GATE[verdict] }, STAMP[verdict])
}

function facts(decision: Decision): HTMLElement {
  const { release, approvals } = decision
  const rows: [string, Node | string][] = [["Files checked", String(decision.checked)]]
  if (release) {
    rows.push(["Release", h("span", {}, `v${release.version}, seq ${release.seq} `, link(explorerEntity(release.key), shortHex(release.key), "mono"))])
    rows.push(["Created by", link(explorerAddress(release.creator), shortHex(release.creator), "mono")])
    rows.push(["Approvals", `${approvals.have} of ${approvals.need}`])
    const remaining = lease(decision)
    if (remaining) rows.push(["Lease", remaining])
    if (release.readonly) rows.push(["Contents", `fixed since block ${release.createdAt}`])
  }
  if (decision.ignoredForgeries.length > 0) {
    rows.push([
      "Ignored",
      h(
        "span",
        {},
        `${decision.ignoredForgeries.length} release${decision.ignoredForgeries.length === 1 ? "" : "s"} from `,
        ...decision.ignoredForgeries.flatMap((forgery, index) => [
          index > 0 ? ", " : "",
          link(explorerEntity(forgery.key), shortHex(forgery.creator), "mono"),
        ]),
      ),
    ])
  }
  if (decision.observations.length > 0) {
    rows.push(["Watchers", `${decision.observations.length} report${decision.observations.length === 1 ? "" : "s"} of different bytes in the last hour`])
  }
  return h("dl", { class: "facts" }, ...rows.map(([term, value]) => h("div", {}, h("dt", {}, term), h("dd", {}, value))))
}

function failing(decision: Decision): HTMLElement | null {
  if (decision.failing.length === 0) return null
  return h(
    "ul",
    { class: "failing" },
    ...decision.failing.slice(0, 5).map((file) =>
      h(
        "li",
        {},
        h("span", { class: "failing-file" }, fileName(file.path)),
        h("span", { class: "failing-hashes" }, "expected ", mono(file.expected ? shortHex(file.expected, 10, 6) : "not in the release", file.expected), " got ", mono(shortHex(file.actual, 10, 6) || "unreachable", file.actual)),
      ),
    ),
  )
}

/** "Try to sign" runs the gate the extension runs. A blocked request never opens the wallet dialog. */
function trySign(decision: Decision, status: HTMLElement): void {
  const action = GATE[decision.verdict]
  if (action === "block") {
    status.textContent = `Refused before the wallet opened. ${describe(decision)}`
    status.dataset.tone = "refused"
    return
  }
  const dialog = document.querySelector<HTMLDialogElement>("#sim-wallet")
  const request = document.querySelector("#sim-request")
  if (!dialog || !request) return
  request.textContent =
    action === "warn"
      ? `Imprimatur would ask first: ${describe(decision)} Then the request reaches the wallet.`
      : `The request reached the wallet: sign typed data for ${decision.origin}.`
  status.textContent = "Reached the wallet."
  status.dataset.tone = "ok"
  dialog.showModal()
}

interface Checked {
  decision: Decision
  query?: string
  error?: string
}

async function checkSite(binding: Binding): Promise<Checked> {
  const url = `https://${binding.origin}/`
  let html: string
  try {
    html = await (await fetch(url, { cache: "no-store" })).text()
  } catch (error) {
    return {
      decision: decide({ origin: binding.origin, binding, observed: [], records: emptyRecords(), reachable: false, now: Date.now(), atBlock: 0n }),
      error: `Couldn't fetch ${url}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  const observed = await observeResources(resourcesInHtml(html, url), url, fetchBytes)
  const result = await verify({ reader, origin: binding.origin, binding, observed, countForgeries: true })
  return { decision: result.decision, ...(result.query && { query: result.query }), ...(result.error && { error: result.error.message }) }
}

function renderSite(binding: Binding, checked: Checked | undefined): HTMLElement {
  const site = SITES[binding.origin] ?? { name: binding.label ?? binding.origin, what: "" }
  const status = h("p", { class: "row-sim", role: "status", "aria-live": "polite" })
  const body = checked
    ? h(
        "div",
        { class: "row-body" },
        h("p", { class: "strip" }, describe(checked.decision)),
        facts(checked.decision),
        failing(checked.decision),
        checked.error ? h("p", { class: "row-error" }, checked.error) : null,
        h(
          "div",
          { class: "row-actions" },
          (() => {
            const button = h("button", { class: "button", type: "button" }, "Try to sign")
            button.addEventListener("click", () => trySign(checked.decision, status))
            return button
          })(),
          link(`https://${binding.origin}/`, "Open the site"),
          checked.query ? h("details", { class: "query" }, h("summary", {}, "Query"), h("pre", { class: "mono" }, checked.query)) : null,
        ),
        status,
      )
    : h("div", { class: "row-body" }, h("p", { class: "strip strip-waiting" }, "Fetching the site's scripts and asking Arkiv…"))

  return h(
    "article",
    { class: "row", "data-gate": checked ? GATE[checked.decision.verdict] : "pending" },
    h(
      "div",
      { class: "row-site" },
      h("h3", {}, site.name),
      link(`https://${binding.origin}/`, binding.origin, "row-host"),
      h("p", { class: "row-what" }, site.what),
    ),
    body,
    checked ? stamp(checked.decision.verdict) : h("p", { class: "stamp", "data-gate": "pending" }, "Checking"),
  )
}

const results = new Map<string, Checked>()

function renderSites(): void {
  const container = document.querySelector("#origin-rows")
  if (!container) return
  container.replaceChildren(...PRELOAD.map((binding) => renderSite(binding, results.get(binding.origin))))
  const lastQuery = results.get(DEMO_ORIGINS.tampered)?.query
  const cli = document.querySelector("#cli-block")
  if (cli) {
    cli.textContent = [
      "git clone https://github.com/winsznx/imprimatur && cd imprimatur && pnpm install",
      `pnpm --filter @imprimatur/cli dev verify https://${DEMO_ORIGINS.tampered}/`,
      "",
      lastQuery ? `# the query it runs\n${lastQuery}` : "",
    ].join("\n")
  }
}

async function checkSites(): Promise<void> {
  await Promise.all(
    PRELOAD.map(async (binding) => {
      results.set(binding.origin, await checkSite(binding))
      renderSites()
    }),
  )
  setLive("watching")
}

async function renderReplay(): Promise<void> {
  const container = document.querySelector("#replay-rows")
  if (!container) return
  const { binding, path, clean, tampered } = BYBIT_REPLAY
  const now = Date.now()
  let fetched: Awaited<ReturnType<typeof fetchVerdictRecords>> | undefined
  let error: string | undefined
  try {
    fetched = await fetchVerdictRecords(reader, binding, now)
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }
  const rows = [
    { label: "Copy captured Feb 14 2025", url: clean.url, sha256: clean.sha256, bytes: clean.bytes },
    { label: "Copy captured Feb 19 2025, 17:29", url: tampered.url, sha256: tampered.sha256, bytes: tampered.bytes },
  ].map((copy) => {
    const decision = decide({
      origin: binding.origin,
      binding,
      observed: [{ kind: "file", path, sha256: copy.sha256 }],
      records: fetched?.records ?? emptyRecords(),
      reachable: fetched !== undefined,
      now,
      atBlock: fetched?.atBlock ?? 0n,
    })
    return h(
      "article",
      { class: "row row-replay", "data-gate": GATE[decision.verdict] },
      h("div", { class: "row-site" }, h("h3", {}, copy.label), link(copy.url, "Wayback Machine", "row-host"), h("p", { class: "row-what" }, `${copy.bytes.toLocaleString("en-US")} bytes`)),
      h(
        "div",
        { class: "row-body" },
        h("p", { class: "strip" }, describe(decision, now)),
        h("p", { class: "hash" }, h("span", {}, "sha256 "), mono(copy.sha256)),
        decision.release ? facts(decision) : null,
        error ? h("p", { class: "row-error" }, error) : null,
      ),
      stamp(decision.verdict),
    )
  })
  container.replaceChildren(...rows)
}

function setLive(state: "connecting" | "watching" | "offline", detail?: string): void {
  const live = document.querySelector<HTMLElement>("#live")
  if (!live) return
  live.dataset.state = state
  const block = [...results.values()].map((r) => r.decision.atBlock).reduce((a, b) => (b > a ? b : a), 0n)
  live.textContent =
    state === "watching"
      ? `Live on Tiramisu${block > 0n ? `, block ${block.toLocaleString("en-US")}` : ""}${detail ? `. ${detail}` : ""}`
      : state === "offline"
        ? `Live updates off${detail ? `: ${detail}` : ""}`
        : "Connecting to Tiramisu"
}

function renderStatic(): void {
  const curl = document.querySelector("#replay-curl")
  if (curl) {
    curl.textContent = [BYBIT_REPLAY.clean.url, BYBIT_REPLAY.tampered.url].map((url) => `curl -s '${url}' | shasum -a 256`).join("\n")
  }
  const signer = document.querySelector<HTMLAnchorElement>("#replay-signer")
  if (signer) {
    signer.href = explorerAddress(DEMO_KEYS.replay)
    signer.textContent = shortHex(DEMO_KEYS.replay)
  }
  const roles: [string, string, string][] = [
    ["Publisher (CI)", DEMO_KEYS.publisher, "releases, heartbeats"],
    ["Maintainer A", DEMO_KEYS.maintainerA, "approvals"],
    ["Maintainer B", DEMO_KEYS.maintainerB, "approvals, revocations"],
    ["Recovery", DEMO_KEYS.recovery, "key revocations"],
    ["Watcher", DEMO_KEYS.watcher, "observations"],
    ["Forger (demo attacker)", DEMO_KEYS.forger, "the forged release"],
    ["Replay", DEMO_KEYS.replay, "the Bybit reconstruction"],
  ]
  document.querySelector("#keys-table tbody")?.replaceChildren(
    ...roles.map(([role, address, creates]) => h("tr", {}, h("th", { scope: "row" }, role), h("td", {}, link(explorerAddress(address), address, "mono")), h("td", {}, creates))),
  )
}

function startLive(): void {
  const team = PRELOAD[0]
  if (!team) return
  const watched: Binding = { ...team, signers: [...team.signers, DEMO_KEYS.forger, DEMO_KEYS.replay] }
  try {
    const socket = createArkivSocket()
    watchBinding(socket, watched, {
      onChange: (reason) => {
        setLive("watching", `Re-checking after an entity was ${reason}`)
        Promise.all([checkSites(), renderReplay()]).catch(reportFailure)
      },
      onError: (error) => setLive("offline", error.message),
      debounceMs: 800,
    })
  } catch (error) {
    setLive("offline", error instanceof Error ? error.message : String(error))
  }
}

function reportFailure(error: unknown): void {
  setLive("offline", error instanceof Error ? error.message : String(error))
}

renderStatic()
renderSites()
renderReplay().catch(reportFailure)
checkSites().catch(reportFailure)
startLive()
