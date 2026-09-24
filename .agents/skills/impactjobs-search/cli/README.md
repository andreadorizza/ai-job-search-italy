# impactjobs-cli

CLI for [Impact Jobs](https://impactjobs.org): social-impact and non-profit
roles, mostly US, with a remote filter. It loads the board's own public `/jobs`
and job pages and reads the job JSON they embed (`window.jobsList`,
`window.job`). No account, no RSS (robots.txt disallows `/rss/`), one request
per call at least 1 second apart (robots.txt `Crawl-delay: 1`), zero runtime
dependencies.

```bash
bun install
bun run typecheck
bun run test                                             # offline, every test stubs fetch
PORTAL_LIVE_TESTS=1 bun run test tests/live.test.ts      # 2 live requests
```

```bash
bun run src/cli.ts search -q "data" --remote --format table
bun run src/cli.ts search -q "engineer" --remote --jobage 30 --limit 20
bun run src/cli.ts detail 658739199 --format plain
```

The crawl delay holds across separate runs: the time of the last request is
kept in `impactjobs-cli.last-request` in the OS temp directory.

See `../url-reference.md` for the search parameters (the board's filter ids),
the embedded JSON fields and what to do when the board changes. See
`../SKILL.md` for the output contract and caveats.
