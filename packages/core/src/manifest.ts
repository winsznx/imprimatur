export interface ManifestFile {
  /** Pathname for same-origin files, full URL without query for files loaded from elsewhere. */
  path: string
  sha256: string
  bytes: number
}

/** The release payload. Only the release whose attributes matched is ever decoded. */
export interface ReleaseManifest {
  files: ManifestFile[]
  /** SHA-256 of each inline script's text, exactly as the browser exposes it in `textContent`. */
  inline: string[]
  builder: string
  framework?: string
  note?: string
}

const SHA256_HEX = /^[0-9a-f]{64}$/

export function parseManifest(value: unknown): ReleaseManifest | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const candidate = value as Record<string, unknown>
  const { files, inline, builder, framework, note } = candidate
  if (!Array.isArray(files) || !Array.isArray(inline) || typeof builder !== "string") return undefined

  const parsedFiles: ManifestFile[] = []
  for (const file of files) {
    if (typeof file !== "object" || file === null) return undefined
    const { path, sha256, bytes } = file as Record<string, unknown>
    if (typeof path !== "string" || typeof sha256 !== "string" || typeof bytes !== "number") return undefined
    if (!SHA256_HEX.test(sha256)) return undefined
    parsedFiles.push({ path, sha256, bytes })
  }
  if (!inline.every((hash): hash is string => typeof hash === "string" && SHA256_HEX.test(hash))) {
    return undefined
  }

  return {
    files: parsedFiles,
    inline,
    builder,
    ...(typeof framework === "string" && { framework }),
    ...(typeof note === "string" && { note }),
  }
}
