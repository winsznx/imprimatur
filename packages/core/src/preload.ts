import type { Binding } from "./binding"

/** Testnet keys for the demo. Roles are listed in the README and /arkiv/evidence.md. */
export const DEMO_KEYS = {
  publisher: "0x1830F524dF9CE6D347189dF08C1054edDB89fd81",
  maintainerA: "0x69a1F684ED2E7c958B9aE4808a81DBCE8f5bec84",
  maintainerB: "0x0E0B69eCB7D11C9b67717D6513D6DD1881468EA4",
  recovery: "0x5b1dCa11839297ba5047f8a058f04b86C10C14e6",
  forger: "0xFf6d752c31A871d630349001B87aA0cBE5e64645",
  watcher: "0xE94f0a5D30f06CbAEbe2dc8b0c7f5BfFEAD863df",
  replay: "0x9f85E7401b69eaBE3d6eD0b9ED99864C3A46d3A8",
} as const

const demoTeam = {
  signers: [DEMO_KEYS.publisher, DEMO_KEYS.maintainerA, DEMO_KEYS.maintainerB],
  threshold: 2,
  recovery: DEMO_KEYS.recovery,
  watchers: [DEMO_KEYS.watcher],
  source: "preload",
} as const satisfies Omit<Binding, "origin" | "label">

export const DEMO_ORIGINS = {
  clean: "imprimatur-clean.vercel.app",
  tampered: "imprimatur-tampered.vercel.app",
  forged: "imprimatur-forged.vercel.app",
  stolenKey: "imprimatur-stolen-key.vercel.app",
} as const

/**
 * Origins whose signers ship with Imprimatur, the way browsers ship the HSTS preload list. A
 * bucket or DNS takeover can't change this list.
 */
export const PRELOAD: readonly Binding[] = [
  { origin: DEMO_ORIGINS.clean, label: "Treasury Demo (clean)", ...demoTeam },
  { origin: DEMO_ORIGINS.tampered, label: "Treasury Demo (simulated bucket swap)", ...demoTeam },
  { origin: DEMO_ORIGINS.forged, label: "Treasury Demo (forged release)", ...demoTeam },
  { origin: DEMO_ORIGINS.stolenKey, label: "Treasury Demo (stolen CI key)", ...demoTeam },
]

/**
 * The Bybit replay. Kept out of PRELOAD on purpose: Safe never published a release, so binding the
 * live app.safe.global to our reconstruction key would block every real Safe user.
 */
export const BYBIT_REPLAY = {
  binding: {
    origin: "app.safe.global",
    label: "Safe{Wallet} as of Feb 19 2025 (reconstruction)",
    signers: [DEMO_KEYS.replay],
    threshold: 1,
    recovery: DEMO_KEYS.recovery,
    watchers: [],
    source: "preload",
  } satisfies Binding,
  path: "/_next/static/chunks/pages/_app-52c9031bfa03da47.js",
  safeRelease: { version: "1.50.3", commit: "4bf400135937df676e7ddccdf8dbe326acd905ee" },
  clean: {
    url: "https://web.archive.org/web/20250214190721id_/https://app.safe.global/_next/static/chunks/pages/_app-52c9031bfa03da47.js",
    sha256: "b93eeeb2063e69101c78eb218991c82f9228191794a4d289ba1403b076c5eef2",
    bytes: 3_744_304,
    s3LastModified: "2025-02-13T11:35:08Z",
  },
  tampered: {
    url: "https://web.archive.org/web/20250219172905id_/https://app.safe.global/_next/static/chunks/pages/_app-52c9031bfa03da47.js",
    sha256: "fbd5e3eb17ef62f2ecf7890108a3af9bcc229aaa51820a6e5ec08a56864d864d",
    bytes: 3_746_298,
    s3LastModified: "2025-02-19T15:29:43Z",
  },
  restoredAt: "2025-02-21T14:15:32Z",
  theftTx: "0x46deef0f52e3a983b67abf4714448a41dd7ffd6d32d32da69d62081c68ad7882",
  theftAt: "2025-02-21T14:13:35Z",
} as const
