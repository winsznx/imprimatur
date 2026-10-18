// Isolated world. Collects what the tab actually loads and hashes it, on preload-list origins only:
// every other site is never read, hashed or reported.
import {
  findBinding,
  inlinePath,
  isExecutableScriptType,
  type ObservedResource,
  resourcePath,
  sha256Hex,
} from "@imprimatur/core"
import type { ReportMessage, VerdictMessage } from "./protocol"

const HASHED_EXTENSION = /\.(m?js|css)(\?|#|$)/i
const reported = new Set<string>()
let inlineReported = false

function isCode(entry: PerformanceResourceTiming): boolean {
  return entry.initiatorType === "script" || HASHED_EXTENSION.test(entry.name)
}

function collectUrls(): string[] {
  const urls = new Set<string>()
  for (const script of Array.from(document.scripts)) {
    if (script.src && isExecutableScriptType(script.type)) urls.add(script.src)
  }
  for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>("link[href]"))) {
    const rel = link.rel.toLowerCase().split(/\s+/)
    if (rel.includes("stylesheet") || rel.includes("modulepreload")) urls.add(link.href)
  }
  for (const entry of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
    if (isCode(entry)) urls.add(entry.name)
  }
  return [...urls].filter((url) => url.startsWith("http"))
}

/**
 * Same-origin files are read through the HTTP cache first, so the hash is of the bytes this tab
 * ran, not of a second download the server could answer differently.
 */
async function hashSameOrigin(url: string): Promise<ObservedResource> {
  const path = resourcePath(url, location.href)
  try {
    const response = await fetch(url, { cache: "force-cache", credentials: "same-origin" })
    return { kind: "file", path, sha256: await sha256Hex(await response.arrayBuffer()) }
  } catch {
    return { kind: "file", path, sha256: "" }
  }
}

async function hashInline(text: string): Promise<ObservedResource> {
  const sha256 = await sha256Hex(text)
  return { kind: "inline", path: inlinePath(sha256), sha256 }
}

async function report(): Promise<void> {
  const fresh = collectUrls().filter((url) => !reported.has(url))
  for (const url of fresh) reported.add(url)
  const sameOrigin = fresh.filter((url) => new URL(url).origin === location.origin)
  const external = fresh.filter((url) => new URL(url).origin !== location.origin)

  // Parser-inserted inline scripts only. Scripts a verified bundle adds at runtime are its own doing.
  const inline = inlineReported
    ? []
    : Array.from(document.scripts)
        .filter((script) => !script.src && isExecutableScriptType(script.type) && script.textContent?.trim())
        .map((script) => script.textContent ?? "")
  inlineReported = true

  if (sameOrigin.length === 0 && external.length === 0 && inline.length === 0) return
  const observed = await Promise.all([...sameOrigin.map(hashSameOrigin), ...inline.map(hashInline)])
  const message: ReportMessage = { type: "report", url: location.href, observed, external }
  await chrome.runtime.sendMessage(message)
}

const SHADOW_STYLE = `
  :host { all: initial; }
  .notice { position: fixed; z-index: 2147483647; top: 12px; left: 50%; transform: translateX(-50%);
    max-width: min(720px, calc(100vw - 24px)); padding: 12px 16px; border-radius: 6px;
    font: 600 15px/1.4 system-ui, sans-serif; color: #fff; background: #b3261e;
    box-shadow: 0 10px 30px rgba(0,0,0,.3); }
  .notice small { display: block; font-weight: 400; opacity: .9; margin-top: 2px; }
`

let noticeHost: HTMLElement | undefined
let noticeBox: HTMLElement | undefined

function showNotice(message: VerdictMessage): void {
  if (message.gate !== "block") {
    noticeHost?.remove()
    noticeHost = undefined
    noticeBox = undefined
    return
  }
  if (!noticeHost?.isConnected || !noticeBox) {
    noticeHost = document.createElement("imprimatur-notice")
    const shadow = noticeHost.attachShadow({ mode: "closed" })
    const style = document.createElement("style")
    style.textContent = SHADOW_STYLE
    noticeBox = document.createElement("div")
    noticeBox.className = "notice"
    noticeBox.setAttribute("role", "alert")
    shadow.append(style, noticeBox)
    document.documentElement.append(noticeHost)
  }
  const detail = document.createElement("small")
  detail.textContent = "Shown by the Imprimatur extension. A tampered page can hide this notice, but it can't unblock signing."
  noticeBox.replaceChildren(document.createTextNode(`Imprimatur: ${message.strip}`), detail)
}

function reportSoon(): void {
  report().catch((error: unknown) => console.warn("Imprimatur: report failed", error))
}

if (findBinding(location.host)) {
  chrome.runtime.onMessage.addListener((message: VerdictMessage | { type: "rescan" }) => {
    if (message.type === "verdict") showNotice(message)
    if (message.type === "rescan") {
      reported.clear()
      inlineReported = false
      reportSoon()
    }
  })

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", reportSoon, { once: true })
  else reportSoon()

  // Chunks loaded later (a route, a signing flow) are checked as they arrive.
  let timer: ReturnType<typeof setTimeout> | undefined
  new PerformanceObserver((list) => {
    if (!list.getEntries().some((entry) => isCode(entry as PerformanceResourceTiming))) return
    clearTimeout(timer)
    timer = setTimeout(reportSoon, 100)
  }).observe({ type: "resource", buffered: false })
}
