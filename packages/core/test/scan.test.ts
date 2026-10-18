import { describe, expect, it } from "vitest"
import { parseMetaBinding } from "../src/binding"
import { resourcePath } from "../src/hash"
import { parseManifest } from "../src/manifest"
import { normalizeInlineScript, resourcesInHtml } from "../src/scan"

const PAGE = "https://app.example/"

describe("resourcesInHtml", () => {
  it("lists module scripts, stylesheets and module preloads as absolute URLs", () => {
    // #given a Vite build's index.html
    const html = `<head>
      <script type="module" crossorigin src="/assets/index-CI7WBpgv.js"></script>
      <link rel="stylesheet" crossorigin href="/assets/index-Cq94YnUZ.css">
      <link rel="modulepreload" href="/assets/vendor-abc.js">
      <link rel="icon" href="/favicon.ico">
    </head>`

    // #when it is scanned
    const resources = resourcesInHtml(html, PAGE)

    // #then the three code resources come back in document order, the icon doesn't
    expect(resources).toEqual([
      { kind: "file", url: "https://app.example/assets/index-CI7WBpgv.js" },
      { kind: "file", url: "https://app.example/assets/index-Cq94YnUZ.css" },
      { kind: "file", url: "https://app.example/assets/vendor-abc.js" },
    ])
  })

  it("keeps inline scripts and skips JSON data blocks", () => {
    // #given an inline config script and a Next.js data block
    const html = `<script>window.APP = 1</script><script id="__NEXT_DATA__" type="application/json">{"a":1}</script>`

    // #when it is scanned
    const resources = resourcesInHtml(html, PAGE)

    // #then only the executable inline script is listed
    expect(resources).toEqual([{ kind: "inline", text: "window.APP = 1" }])
  })

  it("lists a cross-origin CDN script once even when the HTML repeats it", () => {
    // #given the same CDN script referenced twice
    const tag = `<script src="https://cdn.jsdelivr.net/npm/dayjs@1.11.13/dayjs.min.js"></script>`

    // #when it is scanned
    const resources = resourcesInHtml(tag + tag, PAGE)

    // #then it appears once
    expect(resources).toHaveLength(1)
  })
})

describe("normalizeInlineScript", () => {
  it("turns CRLF and lone CR into LF, as the HTML parser does before textContent", () => {
    // #given script text saved with Windows and old Mac line endings
    const text = "a\r\nb\rc\n"

    // #when it is normalized
    const normalized = normalizeInlineScript(text)

    // #then it matches what the browser reports
    expect(normalized).toBe("a\nb\nc\n")
  })
})

describe("resourcePath", () => {
  it("uses the pathname on the page's origin and the full URL elsewhere, dropping queries", () => {
    // #given one same-origin and one CDN URL with queries
    const local = "https://app.example/assets/a.js?v=1"
    const cdn = "https://cdn.example/lib.js?v=2"

    // #when each is turned into a release path
    const paths = [resourcePath(local, PAGE), resourcePath(cdn, PAGE)]

    // #then they match how releases list files
    expect(paths).toEqual(["/assets/a.js", "https://cdn.example/lib.js"])
  })
})

describe("parseManifest", () => {
  it("rejects a payload whose hash isn't 64 hex characters", () => {
    // #given a release payload with a truncated hash
    const payload = { files: [{ path: "/a.js", sha256: "abc", bytes: 1 }], inline: [], builder: "x" }

    // #when it is parsed
    const manifest = parseManifest(payload)

    // #then it is refused, so the release never counts
    expect(manifest).toBeUndefined()
  })
})

describe("parseMetaBinding", () => {
  it("refuses a threshold higher than the number of signers", () => {
    // #given a declaration asking for 3 approvals from 2 signers
    const content =
      "signers=0x1830F524dF9CE6D347189dF08C1054edDB89fd81,0x69a1F684ED2E7c958B9aE4808a81DBCE8f5bec84;threshold=3;recovery=0x5b1dCa11839297ba5047f8a058f04b86C10C14e6"

    // #when it is parsed
    const binding = parseMetaBinding(content, "app.example")

    // #then it reads as no binding at all, never as a looser one
    expect(binding).toBeUndefined()
  })
})
