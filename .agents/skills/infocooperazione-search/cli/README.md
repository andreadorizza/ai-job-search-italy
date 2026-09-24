# infocooperazione-cli

CLI for the jobs section ("Lavoro") of [Info Cooperazione](https://www.info-cooperazione.it),
the Italian international-cooperation and NGO site. It parses the site's public,
server-rendered pages card by card, with no account, no browser impersonation
and zero runtime dependencies.

```bash
bun install
bun run typecheck
bun run test                                             # offline, every test stubs fetch
PORTAL_LIVE_TESTS=1 bun run test tests/live.test.ts      # 2 live requests
```

```bash
bun run src/cli.ts search -q "informatica" --format table
bun run src/cli.ts search -q "analisi dati" -l Italia --format table
bun run src/cli.ts detail 2026/9/<slug> --format plain
```

Content on the site is CC BY-NC-SA 4.0: personal, non-commercial use, with the
`source` attribution that every record carries. See `../url-reference.md` for
the endpoints, parsing anchors and licence wording, and `../SKILL.md` for the
output contract and the month-precision `--jobage` caveat.
