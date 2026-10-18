# @imprimatur/core

Verify that the scripts a page ran are the release its team signed onto Arkiv. Browser and Node.

```ts
import { createArkivReader, findBinding, resourcesInHtml, observeResources, verify, describe, GATE } from "@imprimatur/core"

const url = "https://imprimatur-tampered.vercel.app/"
const html = await (await fetch(url)).text()
const observed = await observeResources(resourcesInHtml(html, url), url, async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer()))
const origin = new URL(url).host
const { decision } = await verify({ reader: createArkivReader(), origin, binding: findBinding(origin), observed })

describe(decision)      // "index-CI7WBpgv.js hash 2ffa05…d053 is not in release v1.4.2 signed by 0x1830…fd81. Signing blocked."
GATE[decision.verdict]  // "block"
```

- `decide()` is a pure function of the observed hashes and the Arkiv records; every sentence comes from `describe()` on the same `Decision`.
- One query per page (`verdictPredicate`), or one for many origins (`multiOriginPredicate`).
- `watchBinding()` re-checks on WebSocket events from bound keys only.

The data contract is in [`/arkiv/schema.md`](../../arkiv/schema.md). MIT.
