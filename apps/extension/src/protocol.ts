import type { GateAction, ObservedResource, Verdict } from "@imprimatur/core"

/** Pinned by the public key in manifest.json, so the in-page wrapper knows who to ask. */
export const EXTENSION_ID = "flchagkcmkhgebpcbloondfehnghbcbm"

/** Content script to background: what the tab ran. Cross-origin files are hashed by the background. */
export interface ReportMessage {
  type: "report"
  url: string
  observed: ObservedResource[]
  external: string[]
}

/** In-page wrapper to background, over externally_connectable so the page can't forge the reply. */
export interface GateRequest {
  type: "gate"
  method: string
}

export interface GateReply {
  action: "allow" | "block"
  message: string
}

/** Background to content script, to draw the in-page notice. */
export interface VerdictMessage {
  type: "verdict"
  gate: GateAction
  verdict: Verdict
  strip: string
}

export interface PanelState {
  live: "connecting" | "watching" | "offline"
  url?: string
  origin?: string
  bound: boolean
  checking: boolean
  verdict?: Verdict
  gate?: GateAction
  strip?: string
  next?: string
  /** The Decision as JSON, bigints as strings. */
  decision?: string
  query?: string
  error?: string
}

export interface ConfirmDetails {
  origin: string
  method: string
  strip: string
}
