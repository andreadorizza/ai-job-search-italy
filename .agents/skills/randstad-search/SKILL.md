---
name: randstad-search
version: 1.0.0
description: >
  Search Randstad Italia job vacancies, read from their schema.org/JobPosting
  structured data. Covers all of Italy with salary (RAL) and application
  deadlines. Use for: offerte di lavoro, annunci di lavoro, cerca lavoro,
  lavoro Milano, lavoro Lombardia, agenzia per il lavoro, somministrazione,
  magazziniere, impiegato, operaio, infermiere, Randstad, Italian jobs,
  jobs in Italy, temp work Italy.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
access: open   # robots.txt permits /offerte-lavoro/; no credentials, no impersonation
allowed-tools: Bash(bun run .agents/skills/randstad-search/cli/src/cli.ts *)
---

# Randstad Italia Job Search

Randstad is one of the largest staffing agencies in Italy, and it publishes
complete **`schema.org/JobPosting`** markup on every vacancy page. That means
this skill reads *structured data*, not scraped HTML — and gets two fields most
Italian sources never provide:

- **`baseSalary`** — a EUR range per year, i.e. **RAL**
- **`validThrough`** — a real application deadline

**Zero runtime dependencies.** Runs with nothing but `bun`.

## Usage

```bash
# Region or city, most relevant first
bun run .agents/skills/randstad-search/cli/src/cli.ts search -q magazziniere -l Lombardia --limit 10 --format table

# All of Italy, recent only
bun run .agents/skills/randstad-search/cli/src/cli.ts search -q infermiere --jobage 14 --limit 20

# One vacancy
bun run .agents/skills/randstad-search/cli/src/cli.ts detail "https://www.randstad.it/offerte-lavoro/<slug>_<city>_<uuid>/" --format plain
```

## Commands

### `search`

| Flag | Meaning |
|---|---|
| `--query`, `-q` | Keywords. **Required.** |
| `--location`, `-l` | Italian region or city (`Lombardia`, `Milano`, `Emilia-Romagna`). Omit for all of Italy. |
| `--jobage <days>` | Keep only vacancies published within N days. |
| `--page <n>` | 1-indexed listing page, ~30 vacancies each. Default 1. |
| `--limit`, `-n <n>` | Cap vacancies fetched and emitted. **Recommended** — each result costs one page fetch. |
| `--format` | `json` (default), `table`, `plain`. |

JSON output adds `deadline`, `salary`, `employmentType` and `industry` to the
standard contract fields. Every field is always present; unknown values are
`null`, never omitted.

### `detail <url>`

Takes a full Randstad vacancy URL. **A bare id will not work** — the title and
city slugs are part of the path, so an id alone cannot be turned back into a
URL. The CLI says so rather than guessing.

Errors go to stderr as `{"error": "...", "code": "..."}` with exit 1. Codes:
`MISSING_REQUIRED`, `BAD_ARG`, `BAD_ID`, `NOT_FOUND`, `PARSE_ERROR`,
`API_ERROR`, `UNKNOWN_FLAG`, `BAD_CMD`.

## The one thing to know

**Randstad's filters are path segments, not query parameters**, and an
unrecognised filter does not error — it returns **HTTP 200 with the unfiltered
national listing**. `?q=data+engineer` is silently ignored entirely.

Handing back thousands of unrelated vacancies as if they matched would be worse
than any error, so this CLI reads the page's `<link rel="canonical">` — which
reflects the filters Randstad *actually* applied — and **fails with `BAD_ARG`
if your query or location was dropped**. No extra request is needed.

If you get that error for a real place, try the region instead of the town.

## Cost

One fetch for the listing plus one per vacancy, four at a time. Always pass
`--limit` for interactive use; `/scrape`'s default of ~20 is fine.

## Notes

- `company` is almost always "Randstad" rather than the end client — that is how
  staffing agencies publish. The description usually names the sector and town.
- Italian descriptions routinely state the **CCNL** and contract level, which
  `10-mercato-italiano.md` explains how to read.
- The JSON-LD reader in `cli/src/jobposting.ts` is deliberately
  **source-agnostic**. Another portal that publishes JobPosting markup should
  import it rather than copy it, so a schema fix lands once.
