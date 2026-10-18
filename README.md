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
3. The extension: download [`imprimatur-extension.zip`](https://imprimatur-checkpoint.vercel.app/imprimatur-extension.zip),
   unzip, open `chrome://extensions`, turn on Developer mode, "Load unpacked". Or build it:
   `pnpm --filter @imprimatur/extension build` and load `apps/extension/dist`. Open a demo site and press Sign. On
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

### The demo, live on Tiramisu

Verdicts from `imprimatur verify` and, independently, from `examples/independent-check.mjs` (no SDK, no
code from this repo). Both agree on every site. Entities and transactions: [`/arkiv/evidence.md`](arkiv/evidence.md).

| Site | Verdict | What the user reads |
|---|---|---|
| clean | VERIFIED | 2 files match release v1.4.3 signed by 0x1830…fd81, 2 of 2 approvals. (v1.4.2 was revoked on camera and the same bytes re-signed) |
| tampered | MISMATCH | index-CI7WBpgv.js hash 2ffa05…d053 is not in release v1.4.2 signed by 0x1830…fd81. Signing blocked. |
| forged | MISMATCH | …Signing blocked. 1 forged release from 0xFf6d…4645 ignored. |
| stolen-key | PENDING | Release v1.4.3 has 1 of 2 approvals. Signing blocked until another signer approves it. |
| this Checkpoint (real build) | VERIFIED | 2 files match release v0.1.0+38cce77 signed by 0x1830…fd81, 2 of 2 approvals. |
| Safe `_app` chunk, Feb 14 2025 copy | VERIFIED | against the reconstructed release |
| Safe `_app` chunk, Feb 19 2025 copy | MISMATCH | _app-52c9031bfa03da47.js hash fbd5e3…864d is not in release v1.50.3-reconstructed. Signing blocked. |

### Tamper campaign: 22 cases, 2 known misses

[`proof/campaign.ts`](proof/campaign.ts) publishes real releases under fresh origins and checks each
tampered build the way the watcher does. The tampering is generated by
[`proof/variants.mjs`](proof/variants.mjs), which imports nothing from the verifier. Two builds: the Vite
demo and a hand-written HTML site with a CDN script and a lazy chunk.

| Case | Vite | HTML |
|---|---|---|
| clean build | VERIFIED | VERIFIED |
| one byte flipped in the entry chunk | MISMATCH | MISMATCH |
| injected `<script src>` | MISMATCH | MISMATCH |
| injected inline script | MISMATCH | MISMATCH |
| lazy chunk swapped (not loaded until Sign) | MISMATCH | MISMATCH |
| stylesheet swapped | MISMATCH | MISMATCH |
| CDN script swapped to another version | | MISMATCH |
| rebuild of the same commit | VERIFIED | |
| release forged by another wallet, every field copied | MISMATCH | |
| the same check filtering by attributes instead of `$creator` | VERIFIED: the forgery passes | |
| changed build released with the CI key alone | PENDING | |
| release revoked | REVOKED | |
| signer key revoked by the recovery key | KEY_REVOKED | |
| release whose lease lapsed | STALE | |
| **miss:** dependency poisoned before the build, signed by the team | VERIFIED | |
| **miss:** signed code that runs text it fetches at runtime | | VERIFIED |

All 22 came out as expected, including the two misses. The run was cut by a 429 from Arkiv's keyless
budget after 20 cases and resumed with an access key: [`part1`](proof/results/campaign-2026-10-18-part1.json),
[`part2`](proof/results/campaign-2026-10-18-part2.json).

### Revocation reaches an open tab in about 4 seconds

[`proof/revocation-latency.ts`](proof/revocation-latency.ts) runs the extension's live path from core
(`watchBinding` over a WebSocket, then `verify`) on a fresh origin, revokes from another key, and times
send to verdict REVOKED. 5 runs: median 3,877 ms, max 4,058 ms, 5 of 5 flipped. In 3 runs the tab knew
before the CLI got its own receipt (viem polls receipts every 4 s on this chain; see friction #10).

### A watcher has been re-hashing the demo sites every minute since Oct 18 06:25 UTC

`imprimatur watch --interval 60` runs as a systemd service on a separate server. Each pass re-fetches
every bound site's page and every file its release lists, decides locally against records it read from
Arkiv once (and re-reads only when a WebSocket event says a bound key wrote something), and writes one
burned `observation` per changed file per day from the watcher key
[`0xE94f…63df`](https://tiramisu.explorer.arkiv.network/address/0xE94f0a5D30f06CbAEbe2dc8b0c7f5BfFEAD863df).
A pass over five sites takes about 5 seconds and costs no Arkiv queries.

The Safe file was wrong on app.safe.global from Feb 19 15:29:43 UTC to Feb 21 14:15:32 UTC, 46 hours 46
minutes. A watcher on this loop would have flagged it about 2,800 times before the theft, and written
the first observation within a minute of the swap.

### Would real dapps pass? 15 production frontends, loaded twice

Before asking any team to pin its scripts, we checked whether real dapp frontends serve the same bytes
twice. [`proof/scan-dapps.mjs`](proof/scan-dapps.mjs) loaded Uniswap, Safe, Aave, Curve, Balancer,
Revoke, 1inch, Compound, Lido, ENS, PancakeSwap, Jupiter, Morpho, Across and Euler in fresh browser
profiles, 6 minutes apart, and hashed the bytes the browser received for every script and stylesheet.
Oct 18 2026, Chromium 156.

| | Count |
|---|---|
| Script and stylesheet files seen | 2,247 |
| Same bytes on both loads | 2,199 |
| Different bytes under the same URL | 8 |
| Body unreadable in one load (not counted either way) | 35 |
| Inline scripts on the first load | 52, of which 10 differed on the second |
| Same-origin files re-read through the HTTP cache, as the extension does | 1,333 of 1,366 matched the bytes the page ran |

All 8 changed files are third-party scripts injected by infrastructure: five Cloudflare bot-challenge
scripts (`/cdn-cgi/challenge-platform/…`) and three Google Tag Manager scripts. None of the dapps' own
bundles changed. So the bundles are pinnable today, and a team adopting Imprimatur has two real costs:
signing pages can't load per-request third-party scripts like these, and inline scripts that change per
load (10 of 52 here) have to move into files. Our first run of this scan reported 51 changed files; that
was our bug (unreadable bodies counted as changes), kept in
[`proof/results/superseded`](proof/results/superseded).

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
  [`/arkiv/evidence.md`](arkiv/evidence.md) and `packages/cli/scripts/publish-demo.ts` writes them again.

## Licence

MIT. Demo sites use synthetic addresses on the Tiramisu testnet.
