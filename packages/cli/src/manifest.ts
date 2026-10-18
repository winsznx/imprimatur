import { readdir, readFile } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import { type ManifestFile, type ReleaseManifest, resourcesInHtml, sha256Hex } from "@imprimatur/core"

const HASHED = /\.(m?js|css)$/i

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = join(dir, entry.name)
      return entry.isDirectory() ? walk(full) : Promise.resolve([full])
    }),
  )
  return nested.flat().sort()
}

export interface BuildManifestOptions {
  /** URL path the build is served under, e.g. "/" or "/app/". */
  base: string
  /** Files the app loads from other origins at runtime (CDN chunks). Hashed now, pinned in the release. */
  extern: readonly string[]
  framework?: string
  note?: string
}

/**
 * Hashes every script and stylesheet in a build directory, plus the inline scripts in every HTML
 * file. HTML documents themselves aren't listed: a page can change per request, and anything it
 * could inject shows up as an unlisted script or inline hash.
 */
export async function buildManifest(dir: string, options: BuildManifestOptions): Promise<ReleaseManifest> {
  const base = options.base.endsWith("/") ? options.base : `${options.base}/`
  const files: ManifestFile[] = []
  const inline = new Set<string>()

  for (const path of await walk(dir)) {
    const urlPath = base + relative(dir, path).split(sep).join("/")
    if (HASHED.test(path)) {
      const bytes = await readFile(path)
      files.push({ path: urlPath, sha256: await sha256Hex(bytes), bytes: bytes.byteLength })
    } else if (path.endsWith(".html")) {
      const html = await readFile(path, "utf8")
      for (const resource of resourcesInHtml(html, `https://build.invalid${urlPath}`)) {
        if (resource.kind === "inline") inline.add(await sha256Hex(resource.text))
      }
    }
  }

  for (const url of options.extern) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`could not fetch ${url}: HTTP ${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    const parsed = new URL(url)
    files.push({ path: `${parsed.origin}${parsed.pathname}`, sha256: await sha256Hex(bytes), bytes: bytes.byteLength })
  }

  return {
    files,
    inline: [...inline].sort(),
    builder: "imprimatur-cli/0.1.0",
    ...(options.framework && { framework: options.framework }),
    ...(options.note && { note: options.note }),
  }
}
