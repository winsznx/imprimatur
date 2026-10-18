# Imprimatur extension (Chrome MV3)

Load unpacked: `pnpm --filter @imprimatur/extension build`, then load `apps/extension/dist` from
`chrome://extensions` with Developer mode on. A built zip is served at
https://imprimatur-checkpoint.vercel.app/imprimatur-extension.zip.

- `inpage.ts` wraps `request` on `window.ethereum` and every EIP-6963 provider at `document_start`.
  The verdict comes back over `externally_connectable`, never `window.postMessage`, so a page can't forge it.
- `content.ts` hashes what the tab ran, reading same-origin files through the HTTP cache. It does nothing on
  sites outside the preload list.
- `background.ts` runs one Arkiv query per page, re-checks on WebSocket events, opens its own window for
  warnings, and blocks `eth_sendTransaction`, `eth_signTypedData*`, `personal_sign`, `eth_sign` and
  `wallet_sendCalls` when the verdict blocks.

The build is unminified so anyone can read what it does to their pages. MIT.
