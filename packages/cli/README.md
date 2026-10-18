# @imprimatur/cli

```sh
imprimatur publish dist --origin app.example.org --version 1.4.2 --key-env RELEASE_PK
imprimatur approve --origin app.example.org --key-env MAINTAINER_PK
imprimatur heartbeat --origin app.example.org --key-env RELEASE_PK      # daily, keeps the 7-day lease
imprimatur revoke --origin app.example.org --reason compromised --key-env MAINTAINER_PK
imprimatur revoke-key --origin app.example.org --signer 0x… --key-env RECOVERY_PK
imprimatur verify https://app.example.org/                              # exit 2 when signing would be blocked
imprimatur watch --interval 60 --key-env WATCHER_PK                       # re-hash bound sites, write observations
imprimatur replay                                                         # the Feb 2025 Safe file, from the Wayback Machine
```

Keys are read from the named environment variable, never from flags. Set `ARKIV_ACCESS_KEY` for
server-side use; Arkiv's keyless budget is about 100 queries per IP. Revocations, key revocations and
observations are created and handed to `0x…dEaD` in one batch, so no key can delete them. MIT.
