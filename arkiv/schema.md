# Imprimatur data contract

Everything a client needs to reach the same verdict as Imprimatur, with no code from this repo.
`examples/independent-check.mjs` is a client written from this file alone (Node built-ins, raw
JSON-RPC) and reaches the same verdicts as `@imprimatur/core`.

Network: Tiramisu testnet, chain 7738577, `https://rpc.tiramisu.db-chain.testnet.arkiv.network`.
SDK used by the reference implementation: `@arkiv-network/sdk` 0.8.1.

## The one rule

Trust comes from `$creator` and nothing else. `origin`, `type`, `version`, `seq` are lookup and
display fields. Anyone can write an entity with `origin = app.safe.global`. Only the release key can
create an entity whose `$creator` is that key's address, and `$creator` never changes, even after an
ownership transfer.

## What lives where

| Data | Where | Why |
|---|---|---|
| Hashes of every script and stylesheet in a release | Arkiv, `release` payload | The host that serves the code is the thing that gets compromised |
| Who may sign for an origin (signers, threshold, recovery key, watchers) | Preload list shipped in the extension and in `@imprimatur/core` | A third channel, separate from the web host and from Arkiv |
| The JS and CSS files | The team's host | Arkiv holds hashes, not code |
| Anything about the person using the app | Nowhere | The extension and the Checkpoint only read |
| Keys | The team's CI secrets and hardware | Never on Arkiv |

## Entity types

Attribute names are lowercase. Timestamps are `u64` milliseconds since the epoch. Every type is
created with `readonly: true`, so attributes and payload can never change. `readonly` doesn't stop the
owner from deleting or transferring, which is why revocations, key revocations and observations are
also handed to a burn address in the transaction that creates them.

### `release`

One build of a frontend, signed by one of the origin's signers.

| Attribute | Type | Example | Notes |
|---|---|---|---|
| `type` | str | `release` | |
| `origin` | str | `imprimatur-clean.vercel.app` | host only, no scheme |
| `version` | str | `1.4.2` | display |
| `seq` | u64 | `3` | per signer and origin, increasing. Newest wins |
| `commit` | str | 40 hex chars | the source commit the build came from |
| `assets` | i32 | `3` | number of files in the payload |
| `published` | u64 | `1792281366798` | ms |
| `grace` | u64 | `3600000` | ms a tab on the previous release stays VERIFIED after this one is published |

Payload, `application/json`:

```json
{
  "files": [{ "path": "/assets/index-CI7WBpgv.js", "sha256": "797187…5dc7", "bytes": 73340 }],
  "inline": ["<sha256 of each inline script's text>"],
  "builder": "imprimatur-cli/0.1.0",
  "framework": "vite",
  "note": "optional"
}
```

`path` is the URL pathname for files on the page's origin and the full URL without query for files
loaded from elsewhere (CDN chunks). Inline script hashes are taken over the script's text with CRLF and
lone CR turned into LF, which is what the browser exposes as `textContent`. HTML documents aren't
listed: anything a changed document injects shows up as an unlisted script or inline hash.

Flags: `readonly`. Entity Expiration: 7 days. The team's CI runs `imprimatur heartbeat` daily, which
pushes the release (and its approvals) 7 days out with `extendEntity`. If the team stops, the release
expires and the origin reads STALE. The lifetime of the attestation is the team's continued presence.

### `approval`

A second signer standing behind a release.

| Attribute | Type | Notes |
|---|---|---|
| `type` | str | `approval` |
| `origin` | str | |
| `release` | key | the release entity |
| `at` | u64 | ms |

Payload: `{ "version": "1.4.2" }`. Flags: `readonly`, `permissionlessExtension`. Entity Expiration:
7 days. `permissionlessExtension` lets the publisher's heartbeat renew a maintainer's approval in the
same batch as the release. It can keep the approval alive but can't change it or create one: the
approval's `$creator` stays the maintainer.

### `revocation`

| Attribute | Type | Notes |
|---|---|---|
| `type` | str | `revocation` |
| `origin` | str | |
| `release` | key | the revoked release |
| `reason` | str | `compromised` or `bug` |
| `at` | u64 | ms |

Flags: `readonly`, `permissionlessExtension`. Entity Expiration: 400 days, and anyone can extend it.
Created and transferred to `0x000000000000000000000000000000000000dEaD` in one `executeBatch`, so
nobody, including a thief holding the signer's key, can delete it. Superseding a release is not a
revocation. Revocations always block.

### `keyrevocation`

| Attribute | Type | Notes |
|---|---|---|
| `type` | str | `keyrevocation` |
| `origin` | str | |
| `signer` | addr | the revoked signer key |
| `at` | u64 | ms |

Counts only when created by the origin's recovery key. Every release and approval from the revoked
signer stops counting at once. Flags, lifetime and burn: same as `revocation`.

### `observation`

Written by a watcher that re-fetches an origin's files from its own network.

| Attribute | Type | Notes |
|---|---|---|
| `type` | str | `observation` |
| `origin` | str | |
| `path` | str | the file that differed |
| `sha256` | str | what the watcher received |
| `expected` | str | what the release lists, or `unlisted` |
| `release` | key | the release it was compared with |
| `at` | u64 | ms |

Payload: `{ "url", "fetchedAt", "watcher" }`. Flags: `readonly`, `permissionlessExtension`, burned in
the same batch. Entity Expiration: 30 days. Users choose which watchers to trust by address.

## Expiration per type

| Type | Lifetime | Renewed by | Why |
|---|---|---|---|
| release | 7 days | the team's daily heartbeat | an abandoned frontend stops verifying by itself |
| approval | 7 days | the same heartbeat (permissionless extension) | an approval lives as long as its release |
| revocation | 400 days | anyone | must outlive anything it kills |
| keyrevocation | 400 days | anyone | same |
| observation | 30 days | anyone | evidence that outlasts the attack window |

## Queries the app runs

1. Everything a verdict needs for one origin, one request (`packages/core/src/query.ts`):

```ts
reader.select("*").where(
  eq("origin", str(origin)),
  or(
    and(or(eq("type", str("release")), eq("type", str("approval")), eq("type", str("revocation"))),
        or(...signers.map((a) => eq("$creator", addr(a))))),
    and(eq("type", str("keyrevocation")), eq("$creator", addr(recovery))),
    and(eq("type", str("observation")), gt("at", u64(now - 3_600_000n)),
        or(...watchers.map((a) => eq("$creator", addr(a))))),
  ),
).limit(200).fetch()
```

The string the node receives, for the demo team:

```
origin = str('imprimatur-tampered.vercel.app') AND ((type = str('release') OR type = str('approval')
OR type = str('revocation')) AND ($creator = addr(0x1830F524dF9CE6D347189dF08C1054edDB89fd81) OR
$creator = addr(0x69a1F684ED2E7c958B9aE4808a81DBCE8f5bec84) OR $creator = addr(0x0E0B69eCB7D11C9b67717D6513D6DD1881468EA4))
OR type = str('keyrevocation') AND $creator = addr(0x5b1dCa11839297ba5047f8a058f04b86C10C14e6)
OR type = str('observation') AND at > u64(<now - 1h>) AND $creator = addr(0xE94f0a5D30f06CbAEbe2dc8b0c7f5BfFEAD863df))
```

Several trusted keys need an explicit `or()` of `$creator` terms: calling `.createdBy()` twice replaces
the first filter.

2. Forgeries, shown on the Checkpoint: same origin, any creator, keys only.

```ts
reader.select({ key: true, creator: true }).where(eq("type", str("release")), eq("origin", str(origin))).limit(200).fetch()
```

Every result whose creator isn't a bound signer is a release we ignored, and the UI says so.

3. Live updates: `watchEntityEvents` over a WebSocket transport with no `fromBlock`, so it is a
subscription and not polling. Events carry the owner but not the creator, type or origin, so clients
re-run query 1 when an `EntityCreated` owner, an `OwnershipTransferred` previous owner or an
`ExpiryExtended` / `EntityDeleted` owner is a bound key.

4. `predictEntityKeys` before every burned write, then:

```ts
wallet.executeBatch({
  creates: [{ attributes, payload, contentType: "application/json", expires: ExpirationTime.fromDays(400),
              flags: { readonly: true, permissionlessExtension: true }, salt: predicted.salt }],
  ownershipChanges: [{ entityKey: predicted.key, newOwner: "0x000000000000000000000000000000000000dEaD" }],
})
```

The batch applies creates before ownership changes, so there is no block in which the entity exists
and its creator could delete it.

## Deciding

Given the files a page ran (path and SHA-256) and the results of query 1:

1. Keep releases, approvals and revocations whose creator is a bound signer; key revocations whose
   creator is the recovery key; observations whose creator is a trusted watcher, from the last hour.
2. A signer named by a key revocation stops counting everywhere.
3. Sort releases by `seq`, newest first. The page matches a release when every file it ran is listed
   with the same hash and every inline script hash is listed.
4. No release at all: STALE. No release matches: MISMATCH against the newest live release.
5. Matched release from a revoked signer: KEY_REVOKED. Revoked: REVOKED.
6. Approvals are the release's creator plus the creators of `approval` entities for it, distinct,
   bound, unrevoked. Fewer than the threshold: PENDING.
7. A newer release supersedes the match only if it is itself approved, unrevoked and from an unrevoked
   key. Inside the newer release's `grace`: VERIFIED. After: STALE.
8. Otherwise VERIFIED.

Signing: VERIFIED and unbound origins pass. STALE and Arkiv-unreachable ask the user first.
PENDING, MISMATCH, REVOKED, KEY_REVOKED and SIGNER_CHANGED block.

## Wallets that create entities

| Role | Address | Creates |
|---|---|---|
| Publisher (CI) | `0x1830F524dF9CE6D347189dF08C1054edDB89fd81` | releases, heartbeats |
| Maintainer A | `0x69a1F684ED2E7c958B9aE4808a81DBCE8f5bec84` | approvals |
| Maintainer B | `0x0E0B69eCB7D11C9b67717D6513D6DD1881468EA4` | approvals, revocations |
| Recovery | `0x5b1dCa11839297ba5047f8a058f04b86C10C14e6` | key revocations |
| Watcher | `0xE94f0a5D30f06CbAEbe2dc8b0c7f5BfFEAD863df` | observations |
| Forger (demo attacker) | `0xFf6d752c31A871d630349001B87aA0cBE5e64645` | the forged release |
| Replay | `0x9f85E7401b69eaBE3d6eD0b9ED99864C3A46d3A8` | the Bybit reconstruction release |

All data is synthetic and on testnet. No personal data, keys or secrets are written to Arkiv.
