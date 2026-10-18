// The false-positive floor, measured on production dapps that don't use Imprimatur.
//
// Each site is loaded twice in fresh browser profiles (cold cache), PAUSE_MS apart. For every script,
// stylesheet and inline script, we record the bytes the browser actually received. Then we count
// what a release manifest would trip over: files whose bytes changed between loads under the same
// URL, inline scripts that differ per load, and how often re-reading a file through the page's HTTP
// cache (what the extension does) returns exactly the bytes the page ran.
//
//   node scan-dapps.mjs [pauseMinutes]     writes results/scan-<timestamp>.json
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"

const SITES = [
  "https://app.uniswap.org/",
  "https://app.safe.global/",
  "https://app.aave.com/",
  "https://curve.finance/",
  "https://balancer.fi/",
  "https://revoke.cash/",
  "https://app.1inch.io/",
  "https://app.compound.finance/",
  "https://stake.lido.fi/",
  "https://app.ens.domains/",
  "https://pancakeswap.finance/",
  "https://jup.ag/",
  "https://app.morpho.org/",
  "https://app.across.to/",
  "https://app.euler.finance/",
]
const PAUSE_MS = Number(process.argv[2] ?? "5") * 60_000
const SETTLE_MS = 8_000
const CODE = /\.(m?js|css)(\?|#|$)/i

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex")

async function load(browser, site) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const received = new Map()
  page.on("response", async (response) => {
    const type = response.request().resourceType()
    const url = response.url()
    if (!(type === "script" || type === "stylesheet" || CODE.test(url))) return
    if (!url.startsWith("http") || response.status() !== 200) return
    try {
      received.set(url, sha(await response.body()))
    } catch {
      received.set(url, "unreadable")
    }
  })
  const started = Date.now()
  let error
  try {
    await page.goto(site, { waitUntil: "load", timeout: 45_000 })
    await page.waitForTimeout(SETTLE_MS)
  } catch (cause) {
    error = String(cause).split("\n")[0]
  }

  const inline = await page
    .evaluate(() =>
      Array.from(document.scripts)
        .filter((s) => !s.src && ["", "module", "text/javascript", "application/javascript"].includes(s.type.trim().toLowerCase()) && s.textContent?.trim())
        .map((s) => s.textContent),
    )
    .catch(() => [])

  // What the extension does: read each same-origin file back through the page's HTTP cache.
  const sameOrigin = [...received.keys()].filter((url) => new URL(url).origin === new URL(page.url() || site).origin)
  const refetched = await page
    .evaluate(async (urls) => {
      const toHex = (buffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("")
      const out = {}
      for (const url of urls) {
        try {
          const response = await fetch(url, { cache: "force-cache", credentials: "same-origin" })
          out[url] = toHex(await crypto.subtle.digest("SHA-256", await response.arrayBuffer()))
        } catch {
          out[url] = "failed"
        }
      }
      return out
    }, sameOrigin)
    .catch(() => ({}))

  await context.close()
  return {
    finalUrl: page.url(),
    ms: Date.now() - started,
    error,
    files: Object.fromEntries(received),
    inline: inline.map((text) => sha(text)),
    refetched,
  }
}

function compare(first, second) {
  const urls = new Set([...Object.keys(first.files), ...Object.keys(second.files)])
  let same = 0
  const changed = []
  const onlyOnce = []
  for (const url of urls) {
    const a = first.files[url]
    const b = second.files[url]
    if (a && b) {
      if (a === b) same += 1
      else changed.push(url)
    } else onlyOnce.push(url)
  }
  const inlineA = new Set(first.inline)
  const inlineB = new Set(second.inline)
  const inlineSame = [...inlineA].filter((h) => inlineB.has(h)).length
  const refetch = Object.entries(first.refetched)
  const refetchSame = refetch.filter(([url, hash]) => first.files[url] === hash).length
  return {
    files: urls.size,
    sameBothLoads: same,
    changedSameUrl: changed,
    presentInOneLoadOnly: onlyOnce.length,
    inline: { first: inlineA.size, second: inlineB.size, identical: inlineSame },
    cacheReadBack: { checked: refetch.length, identical: refetchSame },
  }
}

const browser = await chromium.launch()
const firstPass = {}
for (const site of SITES) {
  firstPass[site] = await load(browser, site)
  console.log(`load 1 ${site} ${Object.keys(firstPass[site].files).length} files ${firstPass[site].error ?? ""}`)
}
console.log(`waiting ${PAUSE_MS / 60_000} min before the second load`)
await new Promise((resolve) => setTimeout(resolve, PAUSE_MS))
const results = []
for (const site of SITES) {
  const second = await load(browser, site)
  const summary = compare(firstPass[site], second)
  results.push({ site, ...summary, errors: [firstPass[site].error, second.error].filter(Boolean) })
  console.log(`load 2 ${site} ${JSON.stringify({ ...summary, changedSameUrl: summary.changedSameUrl.length })}`)
}
await browser.close()

mkdirSync(new URL("./results/", import.meta.url), { recursive: true })
const out = new URL(`./results/scan-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, import.meta.url)
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), pauseMinutes: PAUSE_MS / 60_000, browser: "chromium (playwright 1.64.1)", results, raw: firstPass }, null, 2))
console.log(`wrote ${out.pathname}`)
