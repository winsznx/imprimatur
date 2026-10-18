import type { Hex } from "viem"

export const ENTITY_TYPE = {
  release: "release",
  approval: "approval",
  revocation: "revocation",
  keyRevocation: "keyrevocation",
  observation: "observation",
} as const

export type EntityType = (typeof ENTITY_TYPE)[keyof typeof ENTITY_TYPE]

/**
 * Revocations, key revocations and observations are handed to this address in the same batch that
 * creates them. `readonly` still lets an owner delete, so a thief holding the release key could
 * otherwise erase the revocation of the build they want to serve.
 */
export const BURN_ADDRESS: Hex = "0x000000000000000000000000000000000000dEaD"

/** Entity Expiration per type, in days. See /arkiv/schema.md for why each lifetime is what it is. */
export const LIFETIME_DAYS = {
  release: 7,
  approval: 7,
  revocation: 400,
  keyRevocation: 400,
  observation: 30,
} as const

/** How long a tab still running the previous release stays VERIFIED after a new one is published. */
export const DEFAULT_GRACE_MS = 60 * 60 * 1000

/** Watcher observations older than this don't appear in a verdict. */
export const OBSERVATION_WINDOW_MS = 60 * 60 * 1000

export const REVOCATION_REASONS = ["compromised", "bug"] as const
export type RevocationReason = (typeof REVOCATION_REASONS)[number]

/** Every EIP-1193 method that produces a signature or a transaction. */
export const SIGNING_METHODS: ReadonlySet<string> = new Set([
  "eth_sendTransaction",
  "eth_signTransaction",
  "eth_sign",
  "personal_sign",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
  "wallet_sendCalls",
])

