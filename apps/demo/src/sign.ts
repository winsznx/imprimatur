import type { Eip1193Provider } from "./wallet"

export const SAFE = "0x7a3d5f0c2e9b41a8d6c3e5f7091b2d4c6e8f0a12"
export const WARM_WALLET = "0x4b2e8d1f6a0c3957be21d4f8a6c09e3b57d19c1d"
const TOKEN = "0x6d1e3a9c4b7f20e58d1c3a6b9e0f4d7c2a5b8e1f"

/** ERC-20 transfer(WARM_WALLET, 250,000 * 1e6), the call the screen describes. */
const TRANSFER_DATA =
  "0xa9059cbb0000000000000000000000004b2e8d1f6a0c3957be21d4f8a6c09e3b57d19c1d0000000000000000000000000000000000000000000000000000003a35294400"

/** Loaded only when someone presses Sign, the way production apps split their signing code. */
export async function signPending(provider: Eip1193Provider): Promise<string> {
  const [from] = (await provider.request({ method: "eth_requestAccounts" })) as string[]
  const chainId = Number.parseInt(String(await provider.request({ method: "eth_chainId" })), 16)
  const typed = {
    types: {
      EIP712Domain: [
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      SafeTx: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
        { name: "operation", type: "uint8" },
        { name: "safeTxGas", type: "uint256" },
        { name: "baseGas", type: "uint256" },
        { name: "gasPrice", type: "uint256" },
        { name: "gasToken", type: "address" },
        { name: "refundReceiver", type: "address" },
        { name: "nonce", type: "uint256" },
      ],
    },
    primaryType: "SafeTx",
    domain: { chainId, verifyingContract: SAFE },
    message: {
      to: TOKEN,
      value: "0",
      data: TRANSFER_DATA,
      operation: 0,
      safeTxGas: "0",
      baseGas: "0",
      gasPrice: "0",
      gasToken: "0x0000000000000000000000000000000000000000",
      refundReceiver: "0x0000000000000000000000000000000000000000",
      nonce: "41",
    },
  }
  return (await provider.request({ method: "eth_signTypedData_v4", params: [from, JSON.stringify(typed)] })) as string
}
