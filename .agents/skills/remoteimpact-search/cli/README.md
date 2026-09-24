# remoteimpact-cli

CLI for [Remote Impact](https://remoteimpact.org): remote jobs at climate,
AI-safety, global-health, effective-altruism and other impact organisations. It
reads only the board's public RSS feeds, which the board offers for reuse with
attribution. No account, no HTML scraping, zero runtime dependencies.

```bash
bun install
bun run typecheck
bun run test                                             # offline, every test stubs fetch
PORTAL_LIVE_TESTS=1 bun run test tests/live.test.ts      # 2 live requests
```

```bash
bun run src/cli.ts search -q "machine learning" -c ai-safety,technology --format table
bun run src/cli.ts search -q "software engineer" -c technology --jobage 14
bun run src/cli.ts detail job-at-farai-farai-22 -c ai-safety --format plain
```

Each feed holds only its newest 50 roles and ignores query parameters, so
keyword, age and page filters run on the client. The description is the feed's
500-character excerpt; the full posting is at each result's `url`. Keep the
"Remote Impact" source line and the links when you share results.

See `../url-reference.md` for the feeds, the field mapping and the access
verdict. See `../SKILL.md` for the output contract and the category slugs.
