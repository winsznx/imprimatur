import {
  type Binding,
  findBinding,
  hostOf,
  type ObservedResource,
  observeResources,
  parseMetaBinding,
  type ReleaseRecord,
  resourcesInHtml,
  sha256Hex,
} from "@imprimatur/core"

const USER_AGENT = "imprimatur/0.1 (+https://github.com/winsznx/imprimatur)"

export async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT }, redirect: "follow" })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return new Uint8Array(await response.arrayBuffer())
}

const META = /<meta\b[^>]*\bname\s*=\s*["']imprimatur["'][^>]*>/i
const CONTENT = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i

export interface PageScan {
  url: string
  origin: string
  observed: ObservedResource[]
  declared?: Binding
}

/** Fetches a page and hashes every script, inline script, stylesheet and module preload it lists. */
export async function scanPage(url: string): Promise<PageScan> {
  const html = new TextDecoder().decode(await fetchBytes(url))
  const origin = hostOf(url)
  const observed = await observeResources(resourcesInHtml(html, url), url, fetchBytes)
  const meta = META.exec(html)?.[0]
  const content = meta ? CONTENT.exec(meta) : null
  const declared = content ? parseMetaBinding(content[1] ?? content[2] ?? "", origin) : undefined
  return { url, origin, observed, ...(declared && { declared }) }
}

/**
 * The watcher also fetches every file the release lists, not only what the HTML references, so a
 * swapped lazy chunk (the Bybit file was loaded by every page) is caught before any tab loads it.
 */
export async function observeReleaseFiles(pageUrl: string, release: ReleaseRecord): Promise<ObservedResource[]> {
  const base = new URL(pageUrl)
  return Promise.all(
    release.manifest.files.map(async (file): Promise<ObservedResource> => {
      const url = file.path.startsWith("http") ? file.path : new URL(file.path, base).toString()
      try {
        return { kind: "file", path: file.path, sha256: await sha256Hex(await fetchBytes(url)) }
      } catch {
        return { kind: "file", path: file.path, sha256: "" }
      }
    }),
  )
}

export function mergeObserved(...lists: ObservedResource[][]): ObservedResource[] {
  const byPath = new Map<string, ObservedResource>()
  for (const list of lists) for (const resource of list) byPath.set(`${resource.kind}:${resource.path}`, resource)
  return [...byPath.values()]
}

export function bindingFor(origin: string, declared?: Binding): Binding | undefined {
  return findBinding(origin) ?? declared
}
