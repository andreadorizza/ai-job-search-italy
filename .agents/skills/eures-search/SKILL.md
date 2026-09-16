---
name: eures-search
version: 1.0.0
description: >
  Search EU job vacancies through the EURES public API (European Commission /
  European Labour Authority). Covers Italy and every other EU/EEA country with
  no account, no API key and no scraping. Use for: cerca lavoro, offerte di
  lavoro, annunci di lavoro, posizioni aperte, lavoro in Italia, lavoro
  Lombardia, lavoro Milano, EU jobs, jobs in Italy, EURES, European job
  vacancies, cross-border jobs, work in Europe.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
access: open   # robots.txt permits it; public-sector open data, no credentials
allowed-tools: Bash(bun run .agents/skills/eures-search/cli/src/cli.ts *)
---

# EURES Job Search

EURES is the European Commission / European Labour Authority job mobility
portal. Its search endpoint is a plain JSON POST that the portal's own site
calls, it needs no credentials, and `robots.txt` permits it — so this skill
does no scraping and no browser impersonation.

**Zero runtime dependencies.** It runs with nothing but `bun`.

## Usage

```bash
# Italy, most recent first
bun run .agents/skills/eures-search/cli/src/cli.ts search -q "data engineer" -l it --limit 10 --format table

# Filter by Italian region, by name or NUTS code
bun run .agents/skills/eures-search/cli/src/cli.ts search -q infermiere -l "Lombardia,Veneto" --jobage 14

# All of the EU
bun run .agents/skills/eures-search/cli/src/cli.ts search -q "python developer" -l "" --format json

# One vacancy, by id or by its public URL
bun run .agents/skills/eures-search/cli/src/cli.ts detail "OTkyMTM2IDE3" --format plain
```

## Commands

### `search`

| Flag | Meaning |
|---|---|
| `--query`, `-q` | Keywords, matched against title **and** description. **Required.** |
| `--location`, `-l` | Comma-separated. Country code (`it`), NUTS code (`ITC4`), or Italian region name (`Lombardia`). Default `it`. `""` searches the whole EU. |
| `--jobage <days>` | Keep only vacancies published within N days. |
| `--page <n>` | 1-indexed, 20 results per page. Default 1. |
| `--limit`, `-n <n>` | Cap results emitted. |
| `--sort` | `recent` (default) or `relevance`. |
| `--format` | `json` (default), `table`, `plain`. |

JSON output:

```json
{ "meta": { "total": 1051, "page": 1, "perPage": 20 },
  "results": [ { "id": "...", "title": "...", "company": "...", "companyUrl": null,
                 "location": "Emilia-Romagna (IT)", "date": "2026-09-15",
                 "deadline": null, "url": "https://europa.eu/...", "description": "..." } ] }
```

Every field is always present; unknown values are `null`, never omitted.

### `detail <id|url>`

Takes a EURES id or a `https://europa.eu/eures/portal/jv-se/jv-details/<id>`
URL. Adds `lastModified`, `numberOfPosts`, `contractType` and `languages`.

Errors go to stderr as `{"error": "...", "code": "..."}` with exit 1. Codes:
`MISSING_REQUIRED`, `BAD_ARG`, `BAD_ID`, `NOT_FOUND`, `PARSE_ERROR`,
`API_ERROR`, `UNKNOWN_FLAG`, `BAD_CMD`.

## Two things to know before trusting the output

**Titles are ESCO occupation labels, not the employer's job title.** EURES
normalises every vacancy onto the EU's ESCO taxonomy, and the mapping is often
loose: a posting whose description is plainly a `SOFTWARE ENGINEER` role can
come back titled `geologo/geologa`. **Always read `description` before judging
relevance** — filtering on `title` alone will both discard good matches and keep
irrelevant ones. This is a property of EURES, not a bug in this CLI.

**Coverage skews to staffing agencies.** Many Italian vacancies arrive via
agencies (Gi Group, Randstad, Adecco) rather than employers directly, so
`company` is frequently the agency. The description usually names the sector
but rarely the end client.

Upside worth noting: Italian descriptions routinely state the **CCNL** and a
**RAL** range, which is better salary signal than most portals give.

## Notes

- `description` comes back in full on `search`, so `/scrape` rarely needs `detail`.
- The API has no application-deadline field; `deadline` is always `null`.
- `--jobage` is applied client-side on the publication date, because the API's
  own publication filter does not accept an arbitrary day count.
