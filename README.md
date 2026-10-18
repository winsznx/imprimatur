# Imprimatur

Your wallet won't sign when a dapp's JavaScript isn't the build its team signed.

**Checkpoint (no install, no wallet):** https://imprimatur-checkpoint.vercel.app

## Feb 21 2025, 14:13 UTC

Bybit's signers approved a routine transfer from their Ethereum cold wallet through the Safe{Wallet}
web app. Ben Zhou, an hour later: "all the signers saw the musked UI which showed the correct address
and the URL was from @safe." The transaction they signed handed the wallet to an attacker. About
$1.5B left.

Two days earlier, at 15:29:43 UTC on Feb 19, someone holding a Safe developer's AWS session had
replaced one file in Safe's S3 bucket: `_app-52c9031bfa03da47.js`. The new file behaved normally for
everyone except two Safe addresses. Its name is a hash of its contents, so for 46 hours the name was a
lie, and the HTML loaded it with no `integrity=` attribute. 117 seconds after the theft the original
file was back. Safe's review later found nothing wrong "in the Safe smart contracts or source code of
the frontend". The source was fine. The bytes the signers ran weren't built from it, and nothing in
their browsers could tell.

Safe makes owners collect several signatures before money moves. The code that showed them what they
were signing needed none.

## What Imprimatur does

A dapp team signs each frontend release onto [Arkiv](https://arkiv.network) with keys the web host
never holds. In the user's browser, Imprimatur hashes every script and stylesheet the tab actually
ran, finds the release created by that team's keys, and refuses to pass a signing request to the
wallet if anything differs. The page names the file and the release it doesn't match.

- **Checkpoint**, a static page on its own origin: checks any of the demo sites from outside the site
  and runs the Bybit replay. The judge path. [`apps/checkpoint`](apps/checkpoint)
- **Extension** (Chrome MV3): gates `eth_sendTransaction`, `eth_signTypedData*`, `personal_sign`,
  `eth_sign`, `wallet_sendCalls` on every injected and EIP-6963 provider. [`apps/extension`](apps/extension)
- **CLI and GitHub Action**: `publish`, `approve`, `revoke`, `revoke-key`, `heartbeat`, `verify`,
  `watch`, `replay`. [`packages/cli`](packages/cli), [`action.yml`](action.yml)
- **`@imprimatur/core`**: hashing, the one Arkiv query, and `decide()`, a pure function every surface
  shares. [`packages/core`](packages/core)
- **The data contract** in [`/arkiv/schema.md`](arkiv/schema.md), plus a second client written from it
  alone with no SDK: [`examples/independent-check.mjs`](examples/independent-check.mjs).

## Try it

1. Open the [Checkpoint](https://imprimatur-checkpoint.vercel.app). Four copies of the same Treasury
   Demo, one team, two approvals required:
   - [clean](https://imprimatur-clean.vercel.app): the release the team signed.
   - [tampered](https://imprimatur-tampered.vercel.app): one file changed after release, same filename.
   - [forged](https://imprimatur-forged.vercel.app): the changed file plus a release for it from another
     wallet with every field copied.
   - [stolen-key](https://imprimatur-stolen-key.vercel.app): the changed build released with the team's
     real CI key, nobody else approving.

   Press "Try to sign" on each. The changed sites are labelled simulations.
2. The Bybit card checks the two archived copies of Safe's file against a release we reconstructed.
   Wayback doesn't allow cross-origin reads, so verify the hashes yourself:

   ```sh
   curl -s 'https://web.archive.org/web/20250214190721id_/https://app.safe.global/_next/static/chunks/pages/_app-52c9031bfa03da47.js' | shasum -a 256
   # b93eeeb2063e69101c78eb218991c82f9228191794a4d289ba1403b076c5eef2  (clean, 3,744,304 bytes)
   curl -s 'https://web.archive.org/web/20250219172905id_/https://app.safe.global/_next/static/chunks/pages/_app-52c9031bfa03da47.js' | shasum -a 256
   # fbd5e3eb17ef62f2ecf7890108a3af9bcc229aaa51820a6e5ec08a56864d864d  (tampered, 3,746,298 bytes)
   ```

   Both MD5s equal the S3 ETags the Wayback Machine recorded, so these are the bytes Safe's bucket
   served. We hash them. We never run them.
3. The extension: download `imprimatur-extension.zip` from the latest release, unzip, open
   `chrome://extensions`, turn on Developer mode, "Load unpacked". Open a demo site and press Sign. On
   the tampered site the wallet popup never opens. Without a wallet installed, the demo uses a wallet
   built into the page that shows only a message hash, like the blind-signing setup on Feb 21.

From a terminal:

```sh
git clone https://github.com/winsznx/imprimatur && cd imprimatur && pnpm install
pnpm --filter @imprimatur/cli dev verify https://imprimatur-tampered.vercel.app/
pnpm --filter @imprimatur/cli dev replay
node examples/independent-check.mjs https://imprimatur-stolen-key.vercel.app/
```

## How it uses Arkiv

The verdict comes from one query per site. Trust is in its `$creator` terms. Everything else in it is a
lookup field anyone can write.

| Arkiv feature | Where | What the user sees |
|---|---|---|
| `$creator` in an `or()` predicate | [`core/src/query.ts`](packages/core/src/query.ts) | "signed by 0x1830…", "1 forged release from 0xFf6d… ignored" |
| Compound predicate, range on `at` | [`core/src/query.ts`](packages/core/src/query.ts) | one request decides a page, recent watcher reports included |
| Attributes vs payload | [`cli/src/arkiv.ts`](packages/cli/src/arkiv.ts) | lookup by origin and seq; the file list is read only from the release that matched |
| `readonly` | [`cli/src/arkiv.ts`](packages/cli/src/arkiv.ts) | "contents fixed since block N" |
| Entity Expiration per type | [`core/src/schema.ts`](packages/core/src/schema.ts) | releases 7 d, observations 30 d, revocations 400 d |
| `extendEntity` as a lease | `heartbeat` in [`cli/src/arkiv.ts`](packages/cli/src/arkiv.ts) | a team that stops renewing goes STALE by itself |
| `permissionlessExtension` | approvals, revocations | the CI heartbeat renews maintainers' approvals it can't forge; anyone keeps a revocation alive |
| `executeBatch` + `predictEntityKeys` + ownership transfer | `createBurned` in [`cli/src/arkiv.ts`](packages/cli/src/arkiv.ts) | a revocation is owned by `0x…dEaD` from the block it exists, so a stolen key can't delete it |
| WebSocket `watchEntityEvents`, no `fromBlock` | [`core/src/live.ts`](packages/core/src/live.ts) | revoke from the CLI and open tabs turn red without a reload |

What stays off Arkiv on purpose: the code itself (the host serves it, Arkiv holds hashes), anything
about the person using the app (the extension only reads), keys, and the origin-to-signers binding,
which ships in the extension's preload list so it's a separate channel from both the host and Arkiv.

## Why Arkiv

| Instead of Arkiv | What breaks |
|---|---|
| Postgres or the team's own API | The hash list lives in the cloud account attackers take. Pushing a revocation to open tabs needs a socket service someone runs |
| IPFS | No "newest release by these keys for this origin" query, no revocation stream, no lease |
| A subgraph | A contract plus an indexer someone runs. The indexer becomes the thing you trust |
| EAS on an L2 | `expirationTime` is fixed at attest, so "the team is still here" means re-attesting. Lookup by attester and field goes through EAS's GraphQL indexer, a trusted service |
| Its own chain (WEBCAT runs a CometBFT chain for enrollment) | Someone has to run it. Arkiv already has queries by creator, leases and push |

## Who's harmed today, and what changes

Security: anyone signing through a web frontend, multisig signers most. Their UIs are generic (Safe
sends to arbitrary addresses), so address allowlists can't help, and transaction scanners check the
transaction, which the Bybit UI showed as benign. With Imprimatur, a bucket swap, a swapped CDN chunk or
a DNS hijack on a preloaded origin no longer gets a signature, and the user is told which file and which
release.

Open source: people trust a frontend because its source is public, but can't check that the bytes in
their tab were built from it. Each release carries its commit, the data contract is public, and a
second client built from it alone reaches the same verdicts.

## Results

Measured, with denominators and the misses. Raw output in [`proof/results`](proof/results).

## Limitations

- Imprimatur proves the code in your tab is the code the team signed. It can't tell you the team signed
  good code: a dependency poisoned at build time (the Sept 2025 npm `chalk`/`debug` hijack) gets signed
  like everything else.
- The extension wraps the wallet's provider from the page's own world. A page written to defeat
  Imprimatur can talk to a wallet's content script directly. The Bybit code used the normal provider,
  but the strong form of this check belongs inside the wallet, which is why `@imprimatur/core` is a
  standalone package.
- Binding comes from a preload list. A first-time visitor to a site outside it has nothing to check
  against. Pinning a page's own declaration on first use and a DNS record are next.
- A CDN loader with a floating version (Ledger Connect Kit pulled `@1` from jsDelivr) is blocked for
  every unlisted version, including legitimate upstream updates, until the team publishes a release
  that lists it.
- Not checked: web workers, service workers, WASM, code fetched and `eval`ed at runtime.
- The RPC node sees which preloaded origins you check. Unlisted sites are never queried.
- Tiramisu is a testnet. Entities can be wiped; creation transactions are listed in
  [`/arkiv/evidence.md`](arkiv/evidence.md) and `pnpm --filter @imprimatur/cli dev` can recreate them.

## Licence

MIT. Demo sites use synthetic addresses on the Tiramisu testnet.
