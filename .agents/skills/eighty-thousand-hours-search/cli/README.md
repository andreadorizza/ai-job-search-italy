# eighty-thousand-hours-cli

CLI for the [80,000 Hours job board](https://jobs.80000hours.org): high-impact,
non-profit and AI-safety roles. It reads the board's own public search index,
with no account, no scraping of rendered pages and zero runtime dependencies.

```bash
bun install
bun run typecheck
bun run test                                             # offline, every test stubs fetch
PORTAL_LIVE_TESTS=1 bun run test tests/live.test.ts      # 4 live requests
```

```bash
bun run src/cli.ts search -q "machine learning" --remote --jobage 14 --format table
bun run src/cli.ts search -q "AI safety" -l "Remote, Global;Europe (ex UK)" --format table
bun run src/cli.ts detail 20437 --format plain
```

See `../url-reference.md` for the endpoint, where the public search key comes
from, and why `detail` is a filtered search. See `../SKILL.md` for the output
contract and the summary-only caveat.
