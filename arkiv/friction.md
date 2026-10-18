# Building Imprimatur on Arkiv: friction report

Versions: `@arkiv-network/sdk` 0.8.1, viem 2.57.7, Node 24.19.0, macOS 27.0, Chromium 156.0.8078.4 (Playwright
1.64.1), Tiramisu (chain 7738577). Tested 2026-10-18.

Only things we reproduced are listed. Each issue has a script under `/arkiv/friction/` or a pointer to
the code where we hit it. Issues others already filed are marked, with what we add.

Reproduce the read-side entries with no key:

```sh
pnpm install && pnpm --filter @imprimatur/arkiv-evidence repro friction/read-side.ts
```

## Surfaces we used

| Surface | How we used it | Issues |
|---|---|---|
| TypeScript SDK | queries, `createEntity`, `executeBatch`, `extendEntity`, `predictEntityKeys`, `watchEntityEvents` | 1, 2, 3, 5, 6, 7 |
| Direct JSON-RPC | the independent client (`examples/independent-check.mjs`), cost measurements | 1, 4 |
| WebSocket events | live revocation in the extension and the Checkpoint | 6 |
| Docs | fundamentals, access keys, Tiramisu page | 2, 4 |
| Block explorer | links from every release card | 8 |
| Faucet | funding the demo keys | 9 |
| Arkiv skills (`arkiv-security-trust`) | the multi-creator `or()` pattern | worked |

## What worked

- **A query string written by hand.** The independent client sends
  `origin = str('…') AND ((type = str('release') OR …) AND ($creator = addr(0x…) OR …))` over raw
  `arkiv_query` with no SDK, and the node parses it exactly as the SDK renders it. Being able to read a
  query off the SDK (`builder.toString()`) and paste it anywhere is why our Checkpoint can show judges
  the exact query that produced each verdict.
- **Browser access.** The RPC answers CORS preflights with `access-control-allow-origin: *` and exposes
  `RateLimit`, `Arkiv-Cost` and `Retry-After` to scripts, so the Checkpoint runs with no backend.
- **`createdBy` versus attributes.** Filtering on `$creator` did exactly what the Security rubric
  describes. A forged release with every attribute copied never reaches the verdict.
- **SDK source quality.** Errors say what to do (`InvalidPredicateError` for `$createdAt` tells you to
  filter in JavaScript). The 0.8.1 package ships its TypeScript source, which is how we checked batch
  ordering and event shapes before writing code.

## Issues

### 1. `$createdAt` is rejected by the SDK but answered by the node (sdk-js #100, open)

- Expected: the docs list `$createdAt` among filterable system attributes, so `gt("$createdAt", …)`
  works.
- Actual: the SDK throws `InvalidPredicateError: "$createdAt" is returned in query results but carries
  no index` before sending. The same predicate over raw `arkiv_query` returns rows, cost 100.
- Repro: `friction/read-side.ts`, steps 1 and 2.
- Workaround: we store our own `published` and `at` as `u64` attributes and range-filter those.
- Suggestion: move `$createdAt` to `QUERYABLE_SYSTEM_ATTRIBUTES` in `src/query/expression.ts`.

### 2. `ne`, `exists` and `hasType` are exported, and the node rejects them with a misleading error

- Expected: either the operators work, or the SDK refuses them like it refuses `$createdAt`. The
  fundamentals page says "There is no `!=` yet".
- Actual: the SDK sends `seq != i32(0)`, `EXISTS(seq)`, `TYPEOF(seq) = u64`. The node answers
  `-32002 Requested resource not available.` for all three. That reads like a missing entity or a
  rate limit, not an unsupported operator.
- Repro: `friction/read-side.ts`, step 2.
- Workaround: none needed for Imprimatur; we only use `=`, `>`, `AND`, `OR`.
- Suggestion: return a parse error that names the operator, and mark the three as unsupported in the
  SDK until the node accepts them.

### 3. `.createdBy()` called twice silently replaces the first filter

- Expected: `.createdBy(a).createdBy(b)` either means a OR b, or throws.
- Actual: the second call replaces the first (`src/query/queryBuilder.ts`, `this._createdBy = …`). A
  verifier trusting several keys that writes it this way trusts only the last one. The JSDoc says
  "Calling it again replaces the filter", but this is the one place a silent replace is a security bug.
- Repro: read `queryBuilder.ts`; Arkiv's own `arkiv-security-trust` skill warns about it.
- Workaround: `or(...keys.map((k) => eq("$creator", addr(k))))`, which is what
  `packages/core/src/query.ts` does.
- Suggestion: a `createdByAny(addresses)` helper, or throw on the second call.

### 4. Every `arkiv_query` costs 100 units, whatever it returns, and the budget isn't documented (reported-issues #17, open)

- Expected: a published keyless budget and a per-call cost table.
- Actual, measured from response headers: `arkiv_query` returning 1 key costs 100; returning 30 full
  entities with payloads also costs 100. `eth_blockNumber`, `arkiv_getBlockTiming` and
  `arkiv_getEntityCount` carry no `Arkiv-Cost` header. Issue #17 reports a 10,000-unit keyless budget
  and a ~40 minute `Retry-After`; we did not burn our IP's budget to confirm the ceiling.
- Repro: `friction/read-side.ts`, step 4.
- What it changed for us: one compound query per site instead of one per entity type, and
  `retryCount: 0` with an 8 s timeout so a 429 shows "Arkiv unreachable" instead of hanging the wallet
  for 40 minutes. A browser extension that ran a query per tab would exhaust a user's budget in a day.
- Suggestion: document the budget and the cost table on the access keys page, and make the SDK surface
  a 429 instead of waiting out `Retry-After`.

### 5. `predictEntityKeys` is on the public client but not the wallet client (sdk-js #123, open)

- Expected: the client that will sign the batch can predict its keys.
- Actual: `wallet.predictEntityKeys` doesn't exist. We need the prediction to hand a revocation to a
  burn address in the same batch that creates it, so the CLI keeps a public client just for this.
- Where: `createBurned` in `packages/cli/src/arkiv.ts`.
- Suggestion: add it to `WalletArkivActions`.

### 6. Entity events carry the owner, not the creator, type or attributes (sdk-js #124 asks for filtering)

- Expected: enough on the event to tell whether it matters to this page.
- Actual: `EntityCreated` has `entityKey`, `owner`, `expiresAt`, `creationFlags`. A consumer watching
  for revocations of one origin has to re-query on events. `ExpiryExtended.owner` is the owner, not the
  account that extended it, which matters once `permissionlessExtension` lets anyone extend.
- Where: `packages/core/src/live.ts` filters on owner at the time of the event (every entity we trust
  starts life owned by a bound key) and re-runs the verdict query, debounced.
- Suggestion: include `creator` on `EntityCreated`, and a server-side filter by creator, as #124 asks.

### 7. `executeBatch` applies operations by kind, not in the order you think in

- Expected: a batch is a list of operations applied in order.
- Actual: `ExecuteBatchParameters` takes separate arrays and `sendArkivTransaction` concatenates them
  as creates, patches, deletes, extensions, ownership changes, whatever the intent. "Extend X, then
  create Y" can't be expressed. For us the fixed order is what makes create-then-burn atomic, so it
  works in our favour, but it's not documented on the type.
- Where: `src/utils/arkivTransactions.ts` in the SDK.
- Suggestion: document the order on `ExecuteBatchParameters`.

### 8. No `blockExplorers` on the `tiramisu` chain (sdk-js #104, fix in open PR #120)

- Actual: `tiramisu.blockExplorers` is undefined, so viem utilities can't build explorer links. The URL
  PR #120 proposes (`tiramisu.scanner.arkiv.network`) doesn't resolve today; the explorer that works is
  `tiramisu.explorer.arkiv.network`, with routes `/entity/<key>`, `/tx/<hash>`, `/address/<addr>`.
- Repro: `friction/read-side.ts`, step 5.
- Workaround: `explorerEntity()` and friends in `packages/core/src/scan.ts`.

### 9. The faucet needs a connected wallet and a captcha (reported-issues #20)

- We generated seven role keys for the demo. The faucet only sends to a connected wallet's own cooldown,
  so funding a fresh CLI key means a human connecting a browser wallet first. That stalled every write
  in our build for hours while the read side, the UI and the extension were finished.
- Suggestion: a CLI-friendly faucet (paste an address, captcha only), as #20 asks.
