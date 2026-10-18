// Runs in the page's own world at document_start, before any page script, and only does work on
// origins in the preload list (the only ones that can reach the extension through
// externally_connectable). It wraps `request` on every injected provider so a signing method waits
// for the extension's verdict. The verdict travels over chrome.runtime.sendMessage, whose reply
// goes only to this caller: a page posting fake "allow" messages can't answer it.
import { SIGNING_METHODS } from "@imprimatur/core"
import { EXTENSION_ID, type GateReply } from "./protocol"

interface RequestArguments {
  method: string
  params?: unknown
}

interface Provider {
  request?: (args: RequestArguments) => Promise<unknown>
  sendAsync?: (payload: RequestArguments, callback: (error: unknown, result?: unknown) => void) => void
}

class ProviderRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
  }
}

type SendMessage = (extensionId: string, message: unknown, callback: (reply: unknown) => void) => void

const runtime = (globalThis as { chrome?: { runtime?: { sendMessage?: SendMessage; lastError?: unknown } } }).chrome?.runtime
const sendMessage = runtime?.sendMessage?.bind(runtime)

function ask(method: string): Promise<GateReply> {
  return new Promise((resolve) => {
    if (!sendMessage) {
      resolve({ action: "block", message: "Imprimatur couldn't reach its extension, so signing is blocked on this site." })
      return
    }
    sendMessage(EXTENSION_ID, { type: "gate", method }, (reply) => {
      const answer = reply as GateReply | undefined
      resolve(
        answer && (answer.action === "allow" || answer.action === "block")
          ? answer
          : { action: "block", message: "Imprimatur couldn't reach its extension, so signing is blocked on this site." },
      )
    })
  })
}

async function gate(method: string): Promise<void> {
  const reply = await ask(method)
  if (reply.action === "block") throw new ProviderRpcError(4001, `Imprimatur blocked signing. ${reply.message}`)
}

const wrapped = new WeakSet<object>()

function wrap(provider: unknown): void {
  if (!provider || typeof provider !== "object" || wrapped.has(provider)) return
  const target = provider as Provider
  const request = target.request
  if (typeof request !== "function") return
  wrapped.add(provider)

  try {
    target.request = async function gatedRequest(args: RequestArguments) {
      if (args && SIGNING_METHODS.has(args.method)) await gate(args.method)
      return request.call(provider, args)
    }
  } catch (error) {
    console.warn("Imprimatur: this wallet's provider can't be wrapped, so signing on this page isn't gated", error)
    return
  }

  const sendAsync = target.sendAsync
  if (typeof sendAsync === "function") {
    target.sendAsync = function gatedSendAsync(payload, callback) {
      if (!payload || !SIGNING_METHODS.has(payload.method)) return sendAsync.call(provider, payload, callback)
      gate(payload.method).then(
        () => sendAsync.call(provider, payload, callback),
        (error: unknown) => callback(error),
      )
    }
  }
}

if (sendMessage) {
  let current = (window as { ethereum?: unknown }).ethereum
  wrap(current)
  try {
    Object.defineProperty(window, "ethereum", {
      configurable: true,
      get: () => current,
      set: (value: unknown) => {
        current = value
        wrap(value)
      },
    })
  } catch (error) {
    console.warn("Imprimatur: couldn't watch window.ethereum", error)
  }

  // EIP-6963: wallets announce their providers as events. Capture runs before the dapp's listener.
  window.addEventListener(
    "eip6963:announceProvider",
    (event) => wrap((event as CustomEvent<{ provider?: unknown }>).detail?.provider),
    true,
  )

  // Wallets that define window.ethereum with their own descriptor replace ours; catch them late.
  const rewrap = () => wrap((window as { ethereum?: unknown }).ethereum)
  window.addEventListener("ethereum#initialized", rewrap)
  document.addEventListener("DOMContentLoaded", rewrap)
  window.addEventListener("load", rewrap)
}
