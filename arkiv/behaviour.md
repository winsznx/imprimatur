# How Tiramisu behaved

Probe: `arkiv/probe/probe.ts`, raw output in `arkiv/probe/results-2026-10-18T06-00-51.776Z.json`.
Tiramisu, Oct 18 2026 ~06:00 UTC, through Cloudflare's LOS edge, `@arkiv-network/sdk` 0.8.1, keyless
RPC. Five runs unless noted. The timeouts set earlier (8 s per query, 12 s before a waiting signature
reads UNREACHABLE) were checked against these numbers and kept.

## Timing

| What | Runs | Median | Range |
|---|---|---|---|
| `createEntity` send to receipt, viem default polling | 5 | 6,428 ms | 6,399 to 7,140 |
| Send to the entity answering a `$key` query | 5 | 6,748 ms | 6,728 to 7,476 |
| Send to `EntityCreated` on a separate WebSocket client | 5 | 3,245 ms | 2,783 to 4,582 |
| `createEntity` send to receipt, polling every 500 ms | 3 | 3,829 ms | 3,742 to 5,116 |
| `executeBatch` create + burn transfer, send to receipt | 1 | 2,414 ms | |
| `select("*")…limit(200).fetch()` | 5 | 359 ms | 327 to 369 |
| Revocation sent to an open verifier showing REVOKED (`proof/revocation-latency.ts`) | 5 | 3,877 ms | 3,341 to 4,058 |
| Block time reported by `arkiv_getBlockTiming` | | 2 s | |

What we took from it:

- The WebSocket event arrives about 3 s before viem reports the receipt, because viem polls receipts
  every 4 s on a chain object with no `blockTime` (friction #10). A revocation reaches open tabs
  faster than the CLI that sent it reports success. The CLI now polls every second.
- A query costs about a third of a second, so the extension can check a page between load and the
  first click on Sign. In our Chromium runs the verdict landed 0.7 to 1.3 s after page load.
- Heartbeat interval: 24 h against a 7 day lease, so a team can miss six days of CI before going STALE.

## Cost against the keyless budget

From the `Arkiv-Cost` response header.

| Method | Cost |
|---|---|
| `arkiv_query`, one key | 100 |
| `arkiv_query`, 30 full entities with payloads | 100 |
| `arkiv_query` filtering on `$createdAt` (raw) | 100, and 9.7 s instead of ~0.3 s |
| `arkiv_getEntity` (raw) | no header |
| `eth_blockNumber`, `arkiv_getBlockTiming`, `arkiv_getEntityCount` | no header |

Cost is per call, not per byte, so Imprimatur asks one compound query per page instead of one per
entity type.

## Semantics we depend on, tested

| Behaviour | Result |
|---|---|
| Patch a `readonly` entity | refused: "created readonly, so its contents can never change" |
| Owner extends a `readonly` entity | allowed |
| Another key extends it, no `permissionlessExtension` | refused: "is owned by 0x1830…, not 0x69a1…" |
| Owner deletes a `readonly` entity | allowed. `readonly` does not make a revocation permanent |
| `predictEntityKeys` then create + transfer to `0x…dEaD` in one `executeBatch` | key matched the prediction, owner is `0x…dEaD`, flags `readonly` + `permissionlessExtension` |
| Creator deletes the burned entity | refused: "is owned by 0x…dEaD" |
| Another key extends the burned entity | allowed |
| `ne`, `exists`, `hasType` | rejected by the node, `-32002` |
| Attribute named `Type` | rejected by the node (friction #11) |
