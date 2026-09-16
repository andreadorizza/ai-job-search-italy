# eures-cli

CLI for the EURES public job-vacancy search API (European Commission /
European Labour Authority). No account, no API key, zero runtime dependencies.

```bash
bun install
bun run typecheck
bun test            # offline — every test stubs fetch
```

```bash
bun run src/cli.ts search -q "data engineer" -l it --limit 5 --format table
bun run src/cli.ts detail "OTkyMTM2IDE3" --format plain
```

Endpoint details, the request-schema gotchas, and why `detail` is implemented
as an id-keyword search are in `../url-reference.md`. Output contract and the
ESCO-title caveat are in `../SKILL.md`.
