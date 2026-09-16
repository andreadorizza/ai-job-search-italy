# randstad-cli

CLI for Randstad Italia vacancies, read from their `schema.org/JobPosting`
markup. No account, no API key, zero runtime dependencies.

```bash
bun install
bun run typecheck
bun test            # offline — every test stubs fetch
```

```bash
bun run src/cli.ts search -q magazziniere -l Lombardia --limit 5 --format table
bun run src/cli.ts detail "https://www.randstad.it/offerte-lavoro/<slug>_<city>_<uuid>/" --format plain
```

`src/jobposting.ts` is the **source-agnostic** JobPosting reader; `src/helpers.ts`
is the only Randstad-specific part. Endpoint details and the silent-widening
trap are documented in `../url-reference.md`.
