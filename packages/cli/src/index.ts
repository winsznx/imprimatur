#!/usr/bin/env node
import { parseArgs } from "node:util"
import { approve, beat, type Flags, publish, replay, revoke, revokeKey, verifyUrl, watch } from "./commands"
import { CliError } from "./env"

const USAGE = `imprimatur <command> [options]

  publish <build-dir> --origin <host> --version <v>   sign a release onto Arkiv
          [--commit <sha>] [--base /] [--extern <url,...>] [--grace-minutes 60]
  approve --origin <host> [--release <key>]           add this key's approval to a release
  revoke  --origin <host> [--release <key>] [--reason compromised|bug]
  revoke-key --origin <host> --signer <address>       run with the recovery key
  heartbeat --origin <host>                           renew the lease on this key's releases
  verify  <url> [--at-block <n>]                      check a deployed page from outside
  watch   [--origins <host,...>] [--interval 60] [--once]
  replay  [--publish]                                 the Bybit file, from the Wayback Machine

  --key-env <VAR>   environment variable holding the signing key (default IMPRIMATUR_PK)
  --signers, --threshold, --recovery, --watchers     binding for origins outside the preload list
  --json            machine-readable output`

const STRING_OPTIONS = [
  "origin", "version", "commit", "base", "extern", "grace-minutes", "framework", "note", "release",
  "reason", "signer", "signers", "threshold", "recovery", "watchers", "key-env", "at-block",
  "origins", "interval",
] as const

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      ...Object.fromEntries(STRING_OPTIONS.map((name) => [name, { type: "string" as const }])),
      json: { type: "boolean" },
      once: { type: "boolean" },
      publish: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  })
  const [command, ...rest] = positionals
  const flags = values as Flags

  switch (command) {
    case "publish":
      return publish(rest, flags)
    case "approve":
      return approve(flags)
    case "revoke":
      return revoke(flags)
    case "revoke-key":
      return revokeKey(flags)
    case "heartbeat":
      return beat(flags)
    case "verify":
      return verifyUrl(rest, flags)
    case "watch":
      return watch(flags)
    case "replay":
      return replay(flags)
    default:
      console.log(USAGE)
      if (command && !values.help) process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof CliError ? `imprimatur: ${error.message}` : error)
  process.exitCode = 1
})
