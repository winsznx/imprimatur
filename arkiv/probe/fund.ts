import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { formatEther, type Hex, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"

const ROLES = ["MAINTAINER_A", "MAINTAINER_B", "RECOVERY", "FORGER", "WATCHER", "REPLAY"] as const
const SHARE = 0.08

function key(name: string): Hex {
  const value = process.env[`${name}_PK`]
  if (!value) throw new Error(`${name}_PK missing from .env`)
  return value as Hex
}

const pub = createPublicClient({ chain: tiramisu, transport: http() })
const funder = createWalletClient({ chain: tiramisu, transport: http(), account: privateKeyToAccount(key("PUBLISHER")) })

const balance = await pub.getBalance({ address: funder.account.address })
console.log(`PUBLISHER ${funder.account.address} has ${formatEther(balance)} GLM`)
if (balance === 0n) throw new Error("PUBLISHER is unfunded. Claim from https://hub.arkiv.network/faucet first.")

const each = (balance * BigInt(Math.round(SHARE * 1000))) / 1000n
for (const role of ROLES) {
  const to = privateKeyToAccount(key(role)).address
  const current = await pub.getBalance({ address: to })
  if (current >= each / 2n) {
    console.log(`${role.padEnd(13)} ${to} already has ${formatEther(current)} GLM`)
    continue
  }
  const hash = await funder.sendTransaction({ to, value: each })
  await pub.waitForTransactionReceipt({ hash })
  console.log(`${role.padEnd(13)} ${to} +${formatEther(each)} GLM  ${hash}`)
}
