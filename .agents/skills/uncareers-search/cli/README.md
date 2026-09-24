# uncareers-cli

CLI for [UN Careers](https://careers.un.org), the United Nations Secretariat
job portal: staff openings, consultancies, individual-contractor roles and
internships. It calls the portal's own public JSON list endpoint, with no
account, no scraping of rendered pages and zero runtime dependencies.

```bash
bun install
bun run typecheck
bun run test                                             # offline, every test stubs fetch
PORTAL_LIVE_TESTS=1 bun run test tests/live.test.ts      # 2 live requests
```

```bash
bun run src/cli.ts search --network ict --format table
bun run src/cli.ts search -q data --category consultant -l "Geneva;Vienna" --format table
bun run src/cli.ts search --category consultant --home-based --format table
bun run src/cli.ts detail 285249 --format plain
```

See `../url-reference.md` for the endpoint, the filter keys the server
honours or silently ignores, and why `detail` is a filtered list query rather
than the per-job endpoint. See `../SKILL.md` for the output contract, the
personal-use terms and the keyword caveats.
