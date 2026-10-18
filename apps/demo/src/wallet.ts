import { hashTypedData, type TypedDataDefinition } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"

const TIRAMISU_CHAIN_ID = "0x7614d1"

interface RequestArguments {
  method: string
  params?: unknown[]
}

export interface Eip1193Provider {
  request(args: RequestArguments): Promise<unknown>
  isImprimaturDemoWallet?: boolean
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider
  }
}

class ProviderError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
  }
}

function confirmInDialog(origin: string, hash: string): Promise<boolean> {
  const dialog = document.querySelector<HTMLDialogElement>("#wallet")
  const originField = document.querySelector("#wallet-origin")
  const hashField = document.querySelector("#wallet-hash")
  if (!dialog || !originField || !hashField) return Promise.resolve(false)
  originField.textContent = origin
  hashField.textContent = hash
  dialog.returnValue = ""
  dialog.showModal()
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "approve"), { once: true })
  })
}

/**
 * A wallet for judges who don't have one installed. It signs with a key generated for this page
 * load and asks through a dialog, like a wallet popup. When Imprimatur blocks a request, this dialog
 * never opens, the same way a real wallet's popup never opens.
 */
export function installDemoWallet(): Eip1193Provider | undefined {
  if (window.ethereum) return undefined
  const account = privateKeyToAccount(generatePrivateKey())
  const provider: Eip1193Provider = {
    isImprimaturDemoWallet: true,
    async request({ method, params = [] }) {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [account.address]
        case "eth_chainId":
          return TIRAMISU_CHAIN_ID
        case "eth_signTypedData_v4": {
          const typed = JSON.parse(String(params[1])) as TypedDataDefinition & {
            types: Record<string, unknown>
          }
          const { EIP712Domain: _domainType, ...types } = typed.types
          const definition = { ...typed, types } as TypedDataDefinition
          const approved = await confirmInDialog(location.host, hashTypedData(definition))
          if (!approved) throw new ProviderError(4001, "User rejected the request.")
          return account.signTypedData(definition)
        }
        default:
          throw new ProviderError(4200, `The demo wallet doesn't support ${method}.`)
      }
    },
  }
  window.ethereum = provider
  return provider
}
