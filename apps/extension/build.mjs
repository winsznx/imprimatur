import { cpSync, mkdirSync, rmSync } from "node:fs"
import { build } from "esbuild"

rmSync("dist", { recursive: true, force: true })
mkdirSync("dist")
cpSync("static", "dist", { recursive: true })

// Unminified on purpose: anyone can read what the extension does to their pages.
const common = {
  bundle: true,
  target: "chrome116",
  legalComments: "none",
  logLevel: "warning",
  // Payload compression is a write-path dependency of the SDK; the extension only reads.
  external: ["brotli-wasm"],
}

await Promise.all([
  build({ ...common, entryPoints: ["src/background.ts"], outfile: "dist/background.js", format: "esm" }),
  build({ ...common, entryPoints: ["src/content.ts"], outfile: "dist/content.js", format: "iife" }),
  build({ ...common, entryPoints: ["src/inpage.ts"], outfile: "dist/inpage.js", format: "iife" }),
  build({ ...common, entryPoints: ["src/panel.ts"], outfile: "dist/panel.js", format: "iife" }),
  build({ ...common, entryPoints: ["src/confirm.ts"], outfile: "dist/confirm.js", format: "iife" }),
])
console.log("built dist/")
