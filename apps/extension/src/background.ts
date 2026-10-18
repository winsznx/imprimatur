import {
  type Binding,
  createArkivReader,
  createArkivSocket,
  type Decision,
  decide,
  describe,
  emptyRecords,
  findBinding,
  GATE,
  type GateAction,
  hostOf,
  nextAction,
  type ObservedResource,
  PRELOAD,
  resourcePath,
  sha256Hex,
  verify,
  watchBinding,
} from "@imprimatur/core"
import type { ConfirmDetails, GateReply, PanelState, ReportMessage, VerdictMessage } from "./protocol"

/** How long a signing request waits for a check to finish before it is treated as UNREACHABLE. */
const CHECK_TIMEOUT_MS = 12_000

interface TabRecord {
  tabId: number
  url: string
  origin: string
  binding: Binding
  observed: Map<string, ObservedResource>
  decision?: Decision
  query?: string
  error?: string
  checking: boolean
  generation: number
  waiters: ((decision: Decision) => void)[]
}

const reader = createArkivReader({ timeoutMs: 10_000 })
const tabs = new Map<number, TabRecord>()
const panels = new Set<chrome.runtime.Port>()
let live: PanelState["live"] = "connecting"

const logError = (context: string) => (error: unknown) => console.warn(`Imprimatur: ${context}`, error)
const jsonWithBigints = (value: unknown) => JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v))

// ---- verification ----------------------------------------------------------------------------

async function hashExternal(url: string, pageUrl: string): Promise<ObservedResource> {
  const path = resourcePath(url, pageUrl)
  try {
    const response = await fetch(url, { cache: "force-cache", credentials: "omit" })
    return { kind: "file", path, sha256: await sha256Hex(await response.arrayBuffer()) }
  } catch {
    return { kind: "file", path, sha256: "" }
  }
}

function recordFor(tabId: number, url: string): TabRecord | undefined {
  const origin = hostOf(url)
  const binding = findBinding(origin)
  if (!binding) return undefined
  const existing = tabs.get(tabId)
  if (existing && existing.url === url) return existing
  const record: TabRecord = { tabId, url, origin, binding, observed: new Map(), checking: false, generation: 0, waiters: [] }
  tabs.set(tabId, record)
  return record
}

async function recheck(record: TabRecord): Promise<void> {
  const generation = ++record.generation
  record.checking = true
  pushPanels()
  const result = await verify({
    reader,
    origin: record.origin,
    binding: record.binding,
    observed: [...record.observed.values()],
  })
  if (generation !== record.generation) return
  record.decision = result.decision
  record.query = result.query
  record.error = result.error?.message
  record.checking = false
  for (const resolve of record.waiters.splice(0)) resolve(result.decision)

  const gate = GATE[result.decision.verdict]
  setBadge(record.tabId, gate)
  const message: VerdictMessage = { type: "verdict", gate, verdict: result.decision.verdict, strip: describe(result.decision) }
  chrome.tabs.sendMessage(record.tabId, message).catch(logError("couldn't reach the tab"))
  pushPanels()
}

async function handleReport(tabId: number, message: ReportMessage): Promise<void> {
  const record = recordFor(tabId, message.url)
  if (!record) return
  for (const resource of message.observed) record.observed.set(`${resource.kind}:${resource.path}`, resource)
  const external = await Promise.all(message.external.map((url) => hashExternal(url, message.url)))
  for (const resource of external) record.observed.set(`${resource.kind}:${resource.path}`, resource)
  await recheck(record)
}

/** The decision for this exact document, waiting for a check in flight or asking the tab to rescan. */
async function decisionFor(tabId: number, url: string): Promise<Decision> {
  const record = recordFor(tabId, url)
  if (!record) throw new Error("not a bound origin")
  if (record.decision && !record.checking) return record.decision
  if (!record.checking) {
    chrome.tabs.sendMessage(tabId, { type: "rescan" }).catch(logError("couldn't ask the tab to rescan"))
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(
        decide({
          origin: record.origin,
          binding: record.binding,
          observed: [...record.observed.values()],
          records: emptyRecords(),
          reachable: false,
          now: Date.now(),
          atBlock: 0n,
        }),
      )
    }, CHECK_TIMEOUT_MS)
    record.waiters.push((decision) => {
      clearTimeout(timer)
      resolve(decision)
    })
  })
}

// ---- the gate ---------------------------------------------------------------------------------

const confirmations = new Map<number, { details: ConfirmDetails; resolve: (approved: boolean) => void }>()

/** A warning needs a click the page can't fake, so it opens in the extension's own window. */
async function confirmWarning(details: ConfirmDetails): Promise<boolean> {
  const window = await chrome.windows.create({ url: chrome.runtime.getURL("confirm.html"), type: "popup", width: 440, height: 360, focused: true })
  const windowId = window?.id
  if (windowId === undefined) return false
  return new Promise((resolve) => {
    confirmations.set(windowId, { details, resolve })
  })
}

chrome.windows.onRemoved.addListener((windowId) => {
  confirmations.get(windowId)?.resolve(false)
  confirmations.delete(windowId)
})

async function answerGate(tabId: number, url: string, method: string): Promise<GateReply> {
  if (!findBinding(hostOf(url))) return { action: "allow", message: "" }
  const decision = await decisionFor(tabId, url)
  const strip = describe(decision)
  const action: GateAction = GATE[decision.verdict]
  if (action === "allow") return { action: "allow", message: strip }
  if (action === "block") return { action: "block", message: strip }
  const approved = await confirmWarning({ origin: decision.origin, method, strip })
  return approved ? { action: "allow", message: strip } : { action: "block", message: `You chose not to sign. ${strip}` }
}

chrome.runtime.onMessageExternal.addListener((message: { type?: string; method?: unknown }, sender, sendResponse) => {
  const tabId = sender.tab?.id
  if (message?.type !== "gate" || tabId === undefined || !sender.url || sender.frameId !== 0) return false
  answerGate(tabId, sender.url, String(message.method)).then(sendResponse, (error: unknown) =>
    sendResponse({
      action: "block",
      message: `Imprimatur couldn't check this page (${error instanceof Error ? error.message : String(error)}), so signing is blocked.`,
    } satisfies GateReply),
  )
  return true
})

// ---- messages from the content script, panel and confirm window -------------------------------

chrome.runtime.onMessage.addListener((message: { type?: string } & Record<string, unknown>, sender, sendResponse) => {
  if (message.type === "report" && sender.tab?.id !== undefined && sender.frameId === 0) {
    handleReport(sender.tab.id, message as unknown as ReportMessage).catch(logError("check failed"))
    return false
  }
  if (message.type === "confirm:get" && sender.tab?.windowId !== undefined) {
    sendResponse(confirmations.get(sender.tab.windowId)?.details)
    return false
  }
  if (message.type === "confirm:answer" && sender.tab?.windowId !== undefined) {
    const windowId = sender.tab.windowId
    confirmations.get(windowId)?.resolve(message.approved === true)
    confirmations.delete(windowId)
    chrome.windows.remove(windowId).catch(logError("couldn't close the confirm window"))
    return false
  }
  return false
})

chrome.tabs.onRemoved.addListener((tabId) => tabs.delete(tabId))
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading" && change.url) tabs.delete(tabId)
  if (change.status === "complete") pushPanels()
})
chrome.tabs.onActivated.addListener(() => pushPanels())

// ---- badge and side panel ---------------------------------------------------------------------

const BADGE: Record<GateAction, { text: string; color: string }> = {
  allow: { text: "✓", color: "#2f6b4f" },
  warn: { text: "!", color: "#a86a12" },
  block: { text: "✕", color: "#b3261e" },
}

function setBadge(tabId: number, gate: GateAction | undefined): void {
  const badge = gate ? BADGE[gate] : { text: "", color: "#6b7684" }
  chrome.action.setBadgeText({ tabId, text: badge.text }).catch(logError("badge"))
  chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color }).catch(logError("badge"))
}

async function activeState(): Promise<PanelState> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab?.id || !tab.url?.startsWith("http")) return { live, bound: false, checking: false }
  const record = tabs.get(tab.id)
  const origin = hostOf(tab.url)
  if (!record || record.url !== tab.url) {
    return { live, url: tab.url, origin, bound: findBinding(origin) !== undefined, checking: findBinding(origin) !== undefined }
  }
  const decision = record.decision
  return {
    live,
    url: record.url,
    origin: record.origin,
    bound: true,
    checking: record.checking,
    ...(decision && {
      verdict: decision.verdict,
      gate: GATE[decision.verdict],
      strip: describe(decision),
      next: nextAction(decision),
      decision: jsonWithBigints(decision),
    }),
    ...(record.query && { query: record.query }),
    ...(record.error && { error: record.error }),
  }
}

function pushPanels(): void {
  if (panels.size === 0) return
  activeState()
    .then((state) => {
      for (const port of panels) port.postMessage(state)
    })
    .catch(logError("panel update"))
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "panel") return
  panels.add(port)
  port.onDisconnect.addListener(() => panels.delete(port))
  pushPanels()
})

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(logError("side panel"))

// ---- live revocations ---------------------------------------------------------------------------

function startLive(): void {
  const everyone: Binding = {
    origin: "*",
    signers: [...new Set(PRELOAD.flatMap((binding) => binding.signers))],
    threshold: 1,
    recovery: PRELOAD[0]?.recovery ?? "0x0000000000000000000000000000000000000000",
    watchers: [...new Set(PRELOAD.flatMap((binding) => binding.watchers))],
    source: "preload",
  }
  try {
    watchBinding(createArkivSocket(), everyone, {
      onChange: () => {
        live = "watching"
        for (const record of tabs.values()) recheck(record).catch(logError("live re-check"))
      },
      onError: (error) => {
        live = "offline"
        pushPanels()
        console.warn("Imprimatur: live updates", error)
      },
      debounceMs: 500,
    })
    live = "watching"
  } catch (error) {
    live = "offline"
    console.warn("Imprimatur: couldn't open the Arkiv WebSocket", error)
  }
}

startLive()
