/**
 * Receipt latency with viem's default polling versus a 500 ms poll. The tiramisu chain object has no
 * blockTime, so viem falls back to a 4 s polling interval while blocks come every 2 s.
 *
 *   pnpm --filter @imprimatur/arkiv-evidence repro friction/receipt-polling.ts
 */
import { createWalletClient, ExpirationTime, i32, str } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { type Hex, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"

const account = privateKeyToAccount(process.env.PUBLISHER_PK as Hex)
const make = (pollingInterval?: number) =>
  createWalletClient({ chain: tiramisu, transport: http(), account, ...(pollingInterval && { pollingInterval }) })

console.log("tiramisu.blockTime:", (tiramisu as { blockTime?: number }).blockTime ?? "not set")
for (const [label, client] of [["default polling", make()], ["pollingInterval 500", make(500)]] as const) {
  console.log(`${label}: client.pollingInterval = ${client.pollingInterval} ms`)
  const times: number[] = []
  for (let run = 0; run < 3; run++) {
    const started = performance.now()
    await client.createEntity({
      attributes: { type: str("probe"), run: i32(run) },
      payload: new Uint8Array(),
      contentType: "application/octet-stream",
      expires: ExpirationTime.fromMinutes(10),
    })
    times.push(Math.round(performance.now() - started))
  }
  console.log(`  send to receipt: ${times.join(", ")} ms`)
}
