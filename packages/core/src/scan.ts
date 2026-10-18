import type { ObservedResource } from "./decide"
import { inlinePath, isExecutableScriptType, resourcePath, sha256Hex } from "./hash"

export type PageResource = { kind: "file"; url: string } | { kind: "inline"; text: string }

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
const LINK = /<link\b([^>]*)>/gi

function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attributes)
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined
}

/**
 * The HTML parser turns CRLF and lone CR into LF before a script's text reaches `textContent`, so a
 * publisher hashing build output has to do the same to match what the browser reports.
 */
export function normalizeInlineScript(text: string): string {
  return text.replace(/\r\n?/g, "\n")
}

/**
 * Scripts, stylesheets and module preloads an HTML document loads, in document order. Used by the
 * CLI, the watcher and the Checkpoint so all three enumerate a page the same way. The extension
 * reads the live DOM instead, which also sees what scripts add after load.
 */
export function resourcesInHtml(html: string, pageUrl: string): PageResource[] {
  const found: PageResource[] = []
  const seen = new Set<string>()
  const addFile = (href: string) => {
    const url = new URL(href, pageUrl).toString()
    if (seen.has(url)) return
    seen.add(url)
    found.push({ kind: "file", url })
  }

  for (const [, attributes = "", body = ""] of html.matchAll(SCRIPT)) {
    if (!isExecutableScriptType(attribute(attributes, "type"))) continue
    const src = attribute(attributes, "src")
    if (src) addFile(src)
    else if (body.trim().length > 0) found.push({ kind: "inline", text: normalizeInlineScript(body) })
  }
  for (const [, attributes = ""] of html.matchAll(LINK)) {
    const rel = (attribute(attributes, "rel") ?? "").toLowerCase().split(/\s+/)
    const href = attribute(attributes, "href")
    if (href && (rel.includes("stylesheet") || rel.includes("modulepreload"))) addFile(href)
  }
  return found
}

export type FetchBytes = (url: string) => Promise<Uint8Array>

/** Hashes each resource. A file that can't be fetched is reported with an empty hash, so it fails. */
export async function observeResources(
  resources: readonly PageResource[],
  pageUrl: string,
  fetchBytes: FetchBytes,
): Promise<ObservedResource[]> {
  return Promise.all(
    resources.map(async (resource): Promise<ObservedResource> => {
      if (resource.kind === "inline") {
        const sha256 = await sha256Hex(resource.text)
        return { kind: "inline", path: inlinePath(sha256), sha256 }
      }
      const path = resourcePath(resource.url, pageUrl)
      try {
        return { kind: "file", path, sha256: await sha256Hex(await fetchBytes(resource.url)) }
      } catch {
        return { kind: "file", path, sha256: "" }
      }
    }),
  )
}

export function explorerEntity(key: string): string {
  return `https://tiramisu.explorer.arkiv.network/entity/${key}`
}

export function explorerTx(hash: string): string {
  return `https://tiramisu.explorer.arkiv.network/tx/${hash}`
}

export function explorerAddress(address: string): string {
  return `https://tiramisu.explorer.arkiv.network/address/${address}`
}
