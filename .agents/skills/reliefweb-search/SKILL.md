---
name: reliefweb-search
version: 1.0.0
description: >
  Search humanitarian, development, NGO and UN jobs on ReliefWeb Jobs (UN OCHA),
  worldwide and remote, through the official ReliefWeb API. Filters by country
  (Italy included), remote/home-based, career category (ICT, information
  management, program/project management, M&E...) and posting age. Use for:
  humanitarian jobs, NGO jobs, UN jobs, aid jobs, development sector jobs,
  non-profit jobs, international development, ReliefWeb, remote NGO jobs,
  lavoro ONG, lavoro nelle ONG, cooperazione internazionale, lavoro umanitario,
  lavoro non profit, lavoro terzo settore, lavoro ONU, lavoro Nazioni Unite,
  offerte di lavoro cooperazione.
context: fork
enabled: false  # impact/non-profit portal - ships opt-in; set true to have /scrape use it
access: open    # official UN OCHA API whose terms let anyone use it; needs a free pre-approved appname (RELIEFWEB_APPNAME)
allowed-tools: Bash(bun run .agents/skills/reliefweb-search/cli/src/cli.ts *)
---

# ReliefWeb Jobs Search

[ReliefWeb](https://reliefweb.int/jobs) is the UN Office for the Coordination of
Humanitarian Affairs (OCHA) information service. Its job board is the main
listing for humanitarian, development, NGO and UN vacancies worldwide: field
posts, headquarters roles (FAO, WFP and IFAD in Rome, for example),
consultancies and home-based contracts.

This skill reads the **official ReliefWeb API v2**. It does no scraping and no
browser impersonation. **Zero runtime dependencies**: it runs with nothing but `bun`.

It ships **disabled** (`enabled: false`). It is an opt-in impact-sector portal.
Set `enabled: true` in the frontmatter after the setup below, and `/scrape`
then includes it.

## Setup (required once): get an approved appname

Since 1 November 2025 the ReliefWeb API answers **only pre-approved appnames**.
An unapproved name gets `403 "You are not using an approved appname"`. The
appname is free, but a person at ReliefWeb reviews each request:

1. Fill in the short request form linked from
   <https://apidoc.reliefweb.int/parameters#appname>. ReliefWeb asks for an
   appname that combines your (organization) name, purpose and random
   characters, e.g. `jdoe-jobsearch-k7q2x`.
2. Wait for ReliefWeb's approval email.
3. Export it in your shell profile. The CLI reads it **only** from the
   environment and never from a flag, so it does not go into shell history:
   ```bash
   export RELIEFWEB_APPNAME=<your-approved-appname>
   ```

4. **Before you set `enabled: true`, run one live check.** When this skill was
   built, no approved appname was available. The request format follows
   ReliefWeb's API documentation and OpenAPI spec, and the offline tests cover
   it, but no live result has been seen yet:
   ```bash
   cd .agents/skills/reliefweb-search/cli && bun install && bun run test   # includes the live smoke test when the variable is set
   bun run src/cli.ts search -q "data" --remote --limit 5 --format table
   ```

If the variable is not set, every command exits 1 with
`{"code": "MISSING_CREDENTIALS"}` and sends no request. If ReliefWeb rejects
the appname, the code is `INVALID_CREDENTIALS`. The API allows **1000 calls
per day** per appname. Normal use is far below this.

## Commands

### `search`

```bash
bun run .agents/skills/reliefweb-search/cli/src/cli.ts search [flags]
```

Give at least one of `-q`, `-l`, `--remote` or `--category`.

| Flag | Meaning |
|---|---|
| `--query`, `-q <text>` | Keywords. All words must match (title, description, organization...). `"Quoted phrases"` work. Other search syntax (`/ : ( ) -` ...) is escaped, so `-q "M&E"` is safe. |
| `--location`, `-l <list>` | Comma-separated countries: an English name (`Italy`) or an ISO3 code (`ITA`). Two-letter codes (`it`) are rejected, not silently ignored. |
| `--remote` | Postings with **no country**. ReliefWeb uses this for remote/home-based, roving and location-TBD jobs. With `-l`, the search returns those countries **or** no country. |
| `--category`, `-c <list>` | Career category, comma-separated: full name or shorthand (table below). Numeric ReliefWeb ids are also accepted. |
| `--jobage <days>` | Only jobs posted within N days. The API filters on `date.created`. |
| `--page <n>` | 1-indexed, 20 results per page. |
| `--limit`, `-n <n>` | Maximum number of results to show (applied client-side). |
| `--sort <mode>` | `recent` (default), `relevance`, or `closing` (soonest deadline first). |
| `--format` | `json` (default), `table`, `plain`. |

The search returns **open postings only**.

Career categories (`--category`):

| Shorthand | ReliefWeb category |
|---|---|
| `ict`, `it` | Information and Communications Technology |
| `im` | Information Management (data, GIS, reporting) |
| `pm`, `program`, `project` | Program/Project Management |
| `me`, `m&e`, `mel`, `meal` | Monitoring and Evaluation |
| `admin`, `finance` | Administration/Finance |
| `hr` | Human Resources |
| `logistics`, `procurement` | Logistics/Procurement |
| `advocacy`, `communications` | Advocacy/Communications |
| `donor`, `grants` | Donor Relations/Grants Management |

### `detail <id|url>`

Accepts a numeric id or a `https://reliefweb.int/job/<id>/<slug>` URL. It also
finds **expired** postings. It adds `description` and `howToApply` (Markdown
converted to plain text), `themes`, `status`, `isActive` and `lastModified`.

## Usage examples

```bash
# Remote / home-based ICT roles about data
bun run .agents/skills/reliefweb-search/cli/src/cli.ts search -q "data" --remote -c ict --format table

# AI / machine learning roles, anywhere, newest first
bun run .agents/skills/reliefweb-search/cli/src/cli.ts search -q "artificial intelligence" --jobage 30 --format table

# Everything based in Italy (Rome UN agencies, Turin, Brindisi, Florence), last 30 days
bun run .agents/skills/reliefweb-search/cli/src/cli.ts search -l Italy --jobage 30 --format table

# Information-management roles in Italy OR home-based
bun run .agents/skills/reliefweb-search/cli/src/cli.ts search -c im -l ITA --remote --format table

# Program/project management in Italy or Switzerland, soonest deadline first
bun run .agents/skills/reliefweb-search/cli/src/cli.ts search -c pm -l "ITA,CHE" --sort closing --format table

# Full posting, readable
bun run .agents/skills/reliefweb-search/cli/src/cli.ts detail 4221508 --format plain
```

## Output

```json
{ "meta": { "count": 2, "page": 1, "perPage": 20, "total": 57 },
  "results": [ { "id": "4221508", "title": "...", "company": "World Food Programme",
                 "companyShort": "WFP", "location": "Rome, Italy", "countries": ["Italy"],
                 "locationUnspecified": false, "date": "2026-09-15", "deadline": "2026-10-03",
                 "url": "https://reliefweb.int/job/4221508/...", "type": "Consultancy",
                 "experience": "5-9 years", "categories": ["Information Management"],
                 "themes": ["Food and Nutrition"] } ] }
```

Every field is always present. Unknown values are `null` (or `[]`) and are never
left out. `company` is the posting organization. `deadline` is the closing date.
When `locationUnspecified` is `true`, `location` reads
`Unspecified (remote/home-based, roving or TBD)`.

| Format | Best for |
|--------|----------|
| `json` | Default - `/scrape`, passing ids to `detail` |
| `table` | Quick scanning: title, organization, location, dates, category |
| `plain` | Reading one posting in full (`detail`) |

Errors go to **stderr** as `{"error": "...", "code": "..."}` and the process exits with 1.
Codes: `MISSING_CREDENTIALS`, `INVALID_CREDENTIALS`, `RATE_LIMITED`,
`MISSING_REQUIRED`, `BAD_ARG`, `BAD_ID`, `NOT_FOUND`, `API_ERROR`,
`PARSE_ERROR`, `UNKNOWN_FLAG`, `BAD_CMD`.

## Notes

- **"Remote" on ReliefWeb means "no country"**. The API has no separate
  remote flag. A job without a country can be home-based, roving, or not
  yet placed. Read `detail` before you assume a posting is home-based.
- **Many postings are consultancies, internships or volunteer roles**, not
  staff jobs. Check `type` before you evaluate fit.
- **UN grade and contract** (P-3, NOC, SSA, IICA...) are usually only in the
  description. `experience` is ReliefWeb's own band (`0-2`, `3-4`, `5-9`,
  `10+ years`).
- **Salary is rarely stated**. Where it is, it is usually a UN scale or a
  daily rate in USD/EUR, not an Italian RAL.
- The website itself (reliefweb.int) refuses non-browser clients, and
  `robots.txt` disallows its RSS feeds. The API is the only sanctioned way
  for a program to read the listings. See `url-reference.md`.
- The API occasionally has short outages (Varnish `503`, hung requests). The
  CLI retries 429/5xx with backoff and a hung request up to 3 times (20 s each),
  then exits 1 with `API_ERROR`.
