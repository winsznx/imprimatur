// Drives the real extension in Chromium against the deployed demo sites: press Sign, record whether
// the wallet dialog opened, what the page said, and how long the verdict took after load.
//
//   pnpm --filter @imprimatur/extension build
//   node extension-flows.mjs [--headed] [--shots <dir>]
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"

const EXTENSION = new URL("../apps/extension/dist", import.meta.url).pathname
const headed = process.argv.includes("--headed")
const shotsIndex = process.argv.indexOf("--shots")
const shots = shotsIndex > 0 ? process.argv[shotsIndex + 1] : undefined
if (shots) mkdirSync(shots, { recursive: true })

const SITES = [
  { name: "clean", url: "https://imprimatur-clean.vercel.app/", expectWallet: true },
  { name: "tampered", url: "https://imprimatur-tampered.vercel.app/", expectWallet: false },
  { name: "forged", url: "https://imprimatur-forged.vercel.app/", expectWallet: false },
  { name: "stolen-key", url: "https://imprimatur-stolen-key.vercel.app/", expectWallet: false },
]

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "imp-flows-")), {
  channel: "chromium",
  headless: !headed,
  viewport: { width: 1280, height: 820 },
  args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
})
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))

const results = []
for (const site of SITES) {
  const page = await context.newPage()
  const loadedAt = Date.now()
  await page.goto(site.url, { waitUntil: "load" })
  // The badge is set when the verdict lands; read it from the service worker.
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}*` }))[0]?.id, site.url)
  let badge = ""
  while (Date.now() - loadedAt < 20_000) {
    badge = await worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId)
    if (badge) break
    await page.waitForTimeout(100)
  }
  const verdictMs = Date.now() - loadedAt

  // A warning verdict opens the extension's own confirm window; answer "Don't sign" and record it.
  let confirmAsked = false
  const onPage = async (opened) => {
    if (!opened.url().includes("confirm.html")) return
    confirmAsked = true
    await opened.waitForLoadState()
    await opened.click('button[data-answer="cancel"]')
  }
  context.on("page", onPage)
  await page.click("#sign")
  const walletOpened = await page
    .waitForFunction(() => document.querySelector("#wallet")?.open === true, null, { timeout: 4_000 })
    .then(() => true)
    .catch(() => false)
  if (walletOpened) await page.click('#wallet button[value="approve"]')
  await page.waitForFunction(() => !document.querySelector("#result")?.textContent?.startsWith("Waiting"), null, { timeout: 10_000 }).catch(() => undefined)
  const result = (await page.textContent("#result"))?.trim()
  if (shots) await page.screenshot({ path: join(shots, `${site.name}.png`) })

  context.off("page", onPage)
  const row = { site: site.name, badge, verdictMs, confirmAsked, walletOpened, asExpected: walletOpened === site.expectWallet, result }
  results.push(row)
  console.log(JSON.stringify(row))
  await page.close()
}
await context.close()

mkdirSync(new URL("./results/", import.meta.url), { recursive: true })
const out = new URL(`./results/extension-flows-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, import.meta.url)
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2))
console.log(`wrote ${out.pathname}`)
