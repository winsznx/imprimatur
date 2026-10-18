import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  // Core ships as TypeScript source inside the workspace, so the CLI carries its own compiled copy.
  noExternal: ["@imprimatur/core"],
})
