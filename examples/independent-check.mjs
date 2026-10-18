// A second Imprimatur client, written from /arkiv/schema.md alone. Node built-ins only: no Arkiv SDK,
// nothing imported from this repo. If it reaches the same verdict as @imprimatur/core, the schema is
// a data contract another team can build on without asking us.
//
// It implements "Deciding" steps 1 to 6 and 8 from the schema. It leaves out watcher observations
// (display only) and the grace window for superseded releases (step 7).
//
//   node examples/independent-check.mjs https://imprimatur-tampered.vercel.app/
import { createHash } from "node:crypto"

const RPC = "https://rpc.tiramisu.db-chain.testnet.arkiv.network"

// The binding for the demo team, copied from the README, not imported.
const TEAM = {
  signers: [
    "0x1830F524dF9CE6D347189dF08C1054edDB89fd81",
    "0x69a1F684ED2E7c958B9aE4808a81DBCE8f5bec84",
    "0x0E0B69eCB7D11C9b67717D6513D6DD1881468EA4",
  ],
  threshold: 2,
  recovery: "0x5b1dCa11839297ba5047f8a058f04b86C10C14e6",
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex")
const lower = (address) => address.toLowerCase()

async function fetchText(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return response
}

/** Scripts, stylesheets and module preloads in the HTML, plus inline scripts. */
async function observe(pageUrl) {
  const html = await (await fetchText(pageUrl)).text()
  const observed = []
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const type = (/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1] ?? "").toLowerCase()
    if (!["", "module", "importmap", "text/javascript", "application/javascript"].includes(type)) continue
    const src = /\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]
    if (src) observed.push({ kind: "file", url: new URL(src, pageUrl).toString() })
    else if (body.trim()) observed.push({ kind: "inline", sha256: sha256(body.replace(/\r\n?/g, "\n")) })
  }
  for (const [, attrs] of html.matchAll(/<link\b([^>]*)>/gi)) {
    const rel = (/\brel\s*=\s*["']?([^"'>]+)/i.exec(attrs)?.[1] ?? "").toLowerCase()
    const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]
    if (href && /\b(stylesheet|modulepreload)\b/.test(rel)) observed.push({ kind: "file", url: new URL(href, pageUrl).toString() })
  }
  for (const item of observed) {
    if (item.kind !== "file") continue
    const url = new URL(item.url)
    item.path = url.origin === new URL(pageUrl).origin ? url.pathname : `${url.origin}${url.pathname}`
    item.sha256 = sha256(Buffer.from(await (await fetchText(item.url)).arrayBuffer()))
  }
  return observed
}

/** The query from /arkiv/schema.md, "Queries the app runs", number 1. Watcher branch left out. */
function verdictQuery(origin) {
  const creators = TEAM.signers.map((a) => `$creator = addr(${a})`).join(" OR ")
  return (
    `origin = str('${origin}') AND (` +
    `(type = str('release') OR type = str('approval') OR type = str('revocation')) AND (${creators})` +
    ` OR type = str('keyrevocation') AND $creator = addr(${TEAM.recovery}))`
  )
}

async function query(text) {
  const select = { key: true, creator: true, expiresAt: true, payload: true, attributes: true }
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "arkiv_query", params: [text, { select, limit: "0xc8" }] }),
  })
  const body = await response.json()
  if (body.error) throw new Error(body.error.message)
  return body.result
}

const attribute = (entity, name) => entity.attributes?.find((a) => a.name === name)?.value
const asNumber = (value) => (typeof value === "string" && value.startsWith("0x") ? Number(BigInt(value)) : Number(value))

function decide(origin, observed, entities) {
  const signers = new Set(TEAM.signers.map(lower))
  const byType = (type) => entities.filter((e) => attribute(e, "type") === type)
  const revokedSigners = new Set(
    byType("keyrevocation").filter((e) => lower(e.creator) === lower(TEAM.recovery)).map((e) => lower(attribute(e, "signer"))),
  )
  const revoked = new Set(byType("revocation").filter((e) => signers.has(lower(e.creator))).map((e) => attribute(e, "release")))
  const releases = byType("release")
    .filter((e) => signers.has(lower(e.creator)))
    .map((e) => {
      const manifest = JSON.parse(Buffer.from(e.payload.slice(2), "hex").toString("utf8"))
      return {
        key: e.key,
        creator: lower(e.creator),
        version: attribute(e, "version"),
        seq: asNumber(attribute(e, "seq")),
        files: new Map(manifest.files.map((f) => [f.path, f.sha256])),
        inline: new Set(manifest.inline),
      }
    })
    .sort((a, b) => b.seq - a.seq)
  if (releases.length === 0) return { verdict: "STALE" }

  const lists = (release, item) => (item.kind === "inline" ? release.inline.has(item.sha256) : release.files.get(item.path) === item.sha256)
  const matched = releases.find((release) => observed.every((item) => lists(release, item)))
  if (!matched) return { verdict: "MISMATCH", against: releases[0].version }
  if (revokedSigners.has(matched.creator)) return { verdict: "KEY_REVOKED", release: matched.version }
  if (revoked.has(matched.key)) return { verdict: "REVOKED", release: matched.version }
  const approvers = new Set([matched.creator])
  for (const approval of byType("approval")) {
    const creator = lower(approval.creator)
    if (attribute(approval, "release") === matched.key && signers.has(creator)) approvers.add(creator)
  }
  for (const signer of revokedSigners) approvers.delete(signer)
  if (approvers.size < TEAM.threshold) return { verdict: "PENDING", release: matched.version, approvals: approvers.size }
  return { verdict: "VERIFIED", release: matched.version, approvals: approvers.size }
}

const pageUrl = process.argv[2]
if (!pageUrl) {
  console.error("usage: node examples/independent-check.mjs <url>")
  process.exit(1)
}
const origin = new URL(pageUrl).host
const observed = await observe(pageUrl)
const result = await query(verdictQuery(origin))
const decision = decide(origin, observed, result.data)
console.log(JSON.stringify({ origin, block: Number(BigInt(result.blockNumber)), files: observed.length, ...decision }))
