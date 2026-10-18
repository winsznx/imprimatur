const encoder = new TextEncoder()

export async function sha256Hex(data: Uint8Array | ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * The path a resource is listed under in a release: the pathname for files on the page's own
 * origin, the full URL without query for anything loaded from elsewhere (a CDN chunk).
 */
export function resourcePath(url: string, pageOrigin: string): string {
  const parsed = new URL(url, pageOrigin)
  return parsed.origin === new URL(pageOrigin).origin
    ? parsed.pathname
    : `${parsed.origin}${parsed.pathname}`
}

export function inlinePath(sha256: string): string {
  return `inline:${sha256.slice(0, 12)}`
}

/** Script types the browser executes. JSON and other data blocks are skipped. */
export function isExecutableScriptType(type: string | null | undefined): boolean {
  const normalized = (type ?? "").trim().toLowerCase()
  return (
    normalized === "" ||
    normalized === "module" ||
    normalized === "importmap" ||
    normalized === "text/javascript" ||
    normalized === "application/javascript"
  )
}
