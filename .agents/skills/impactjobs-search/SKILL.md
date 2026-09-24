---
name: impactjobs-search
version: 1.0.0
description: >
  Search Impact Jobs (impactjobs.org), a social-impact and non-profit job board
  run by Green Jobs Network: non-profits, foundations, charities, social
  enterprises, education, health, civic tech and climate organisations, mostly
  US employers, with a remote filter. Reads the job data the board embeds in
  its own public pages. Use for: Impact Jobs, impactjobs.org, impact jobs,
  social impact jobs, nonprofit jobs, non-profit jobs, remote nonprofit jobs,
  remote non-profit jobs, charity jobs, mission-driven jobs, jobs for good,
  remote data jobs at a non-profit, remote software engineer at a nonprofit,
  remote AI or ML role for good. Italiano: lavoro ad impatto sociale, lavoro a
  impatto sociale, lavoro non profit da remoto, lavoro nel non profit, lavoro
  nel terzo settore, lavoro da remoto per il sociale, lavoro in una ONG, full
  remote non profit.
context: fork
enabled: false  # impact/non-profit portal - ships opt-in; set true to have /scrape use it
access: open    # robots.txt disallows only /rss/ (Crawl-delay: 1, honoured); the board publishes no terms (/terms, /privacy 404); JBoard's terms cover jboard.io only
allowed-tools: Bash(bun run .agents/skills/impactjobs-search/cli/src/cli.ts *)
---

# Impact Jobs Search

[Impact Jobs](https://impactjobs.org) is a board for social-impact and
non-profit roles, run by Green Jobs Network since 2008. Most employers are US
non-profits, foundations and social enterprises. About 650 of its roughly
7,300 listings were marked remote at recon. Postings are in English. It fits
a remote data, software or AI/ML profile that wants mission-driven work. It is not a
source of Italy-local roles.

The board renders its result pages on the server and embeds each page's jobs
as JSON. The CLI loads the same `/jobs` page a browser loads, with the filters
in the URL, and reads that JSON. It never touches `/rss/`, which robots.txt
disallows. One request per call. **Zero runtime dependencies**: it runs with
nothing but `bun`.

**Ships disabled.** `enabled: false` keeps `/scrape` from using it until you
set `enabled: true` in the frontmatter above.

**Terms.** `robots.txt` disallows only `/rss/` and asks for
`Crawl-delay: 1`. The CLI waits at least 1 second between requests, across
separate runs too. The board publishes no terms of use, and the JBoard platform
terms cover jboard.io itself, not the boards it hosts. Nothing prohibits
automated access. Keep it to your own job search and keep volume low: run
queries one after another, not in parallel.

## Usage

```bash
# Remote data roles, newest first, as a table
bun run .agents/skills/impactjobs-search/cli/src/cli.ts search -q "data" --remote --format table

# Remote engineering roles posted in the last 30 days, as JSON for /scrape
bun run .agents/skills/impactjobs-search/cli/src/cli.ts search -q "engineer" --remote --jobage 30 --limit 20

# Remote AI roles (matches "AI" as a word in titles, e.g. "Transformative AI")
bun run .agents/skills/impactjobs-search/cli/src/cli.ts search -q "AI" --remote --format table

# Remote software-development roles
bun run .agents/skills/impactjobs-search/cli/src/cli.ts search -q "developer" --remote --format table

# Everything remote posted in the last 30 days (no keyword), second page
bun run .agents/skills/impactjobs-search/cli/src/cli.ts search --remote --jobage 30 --page 2 --format table

# One role, by id or job URL, with the full description
bun run .agents/skills/impactjobs-search/cli/src/cli.ts detail 658739199 --format plain
```

## Commands

### `search`

| Flag | Meaning |
|---|---|
| `--query`, `-q` | Keywords, matched by the board against **title, employer and tags only**, not the description. So `-q python` finds almost nothing: search for role words (`data`, `engineer`, `developer`, `analyst`, `AI`). Optional: omit it to list the newest roles. |
| `--location`, `-l` | Free-text place, matched loosely by the board. US cities and states work (`-l "New York"`). Outside the US it is unreliable (`Italy` returned Naples FL and Fiji), so use `--remote` instead. |
| `--remote` | Only jobs the employer marked remote. This includes region-locked remote (see Notes). |
| `--jobage <days>` | Only jobs posted within N days. Filtered by the board; any whole number works. |
| `--page <n>` | 1-indexed, 25 results per page (the board's fixed size). Default 1. |
| `--limit`, `-n <n>` | Cap results emitted (client-side, within the page). |
| `--format` | `json` (default), `table`, `plain`. |

Results are always newest first.

JSON output:

```json
{ "meta": { "count": 1, "page": 1, "perPage": 25, "pages": 1, "hasNext": false, "skipped": 0,
            "searchUrl": "https://impactjobs.org/jobs?filters%5B12450%5D=engineer&filters%5B12455%5D=1&order=posted_at",
            "source": "Impact Jobs (https://impactjobs.org)" },
  "results": [ { "id": "658739199", "title": "Senior Site Reliability Engineer, Data Persistence",
                 "company": "Wikimedia Foundation", "location": "Remote", "remote": true,
                 "date": "2026-09-02", "posted": "2026-09-02T04:22:31.000Z",
                 "url": "https://impactjobs.org/jobs/658739199-senior-site-reliability-engineer-data-persistence",
                 "applyUrl": "https://boards.greenhouse.io/wikimedia/jobs/7972965",
                 "salary": null, "salaryMin": null, "salaryMax": null, "salaryCurrency": null, "salaryPeriod": null,
                 "jobType": null, "category": null, "tags": [],
                 "description": "Summary\n\nThe Wikimedia Foundation is looking for ... …",
                 "descriptionTruncated": true } ] }
```

Every field is always present: unknown values are `null` and unknown lists are
`[]`, never omitted. `pages` is the page count from the board's pager (`null`
when a page is empty and the pager is gone). `skipped` counts embedded jobs
that could not be read; it should be 0. `salary` is formatted from the raw
numbers, for example `"USD 140,000-150,000 / year"`.

### `detail <id|url>`

Takes a numeric `id` from `search`, or a job URL
`https://impactjobs.org/jobs/<id>-<slug>`. One request to the job page. It
returns the same record with the **full** description (`descriptionTruncated:
false`) plus `status` (`active`), `validThrough` (the date the listing ends),
`applicantLocation` (where applicants may live, e.g. `["Any"]`), `updated`,
`companyWebsite` and `companyDescription`.

Errors go to stderr as `{"error": "...", "code": "..."}` with exit 1. Codes:
`MISSING_REQUIRED`, `BAD_ARG`, `BAD_ID`, `NOT_FOUND` (the job was removed),
`FILTERS_CHANGED` (the board renumbered its search filters; see
`url-reference.md`), `PARSE_ERROR`, `API_ERROR`, `UNKNOWN_FLAG`, `BAD_CMD`,
`INTERNAL_ERROR`.

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default: programmatic use, `/scrape`, passing ids to `detail` |
| `table` | Quick scanning: title, organisation, location, remote, date, id |
| `plain` | Reading: one block per role with salary when stated; with `detail`, the full posting |

## Notes

- **Always scope with `--jobage`.** The board keeps old postings live: a plain
  `-q "machine learning"` returned Stanford roles posted in July 2025. Fresh
  volume is modest. In the 30 days before 2026-09-24 there were 6 pages (at
  most 150) of remote roles, many imported in one batch on 2026-09-02, and none
  in the last 14 days. So the 14-day window `/scrape` uses can return nothing.
  Widen to 30 or 60 days before concluding the board has nothing.
- **Remote is the employer's flag, not a promise of worldwide hiring.** A
  remote job with no place shows `location: "Remote"`. A remote job with a place
  (`Oregon`, `Washington, DC`) is usually limited to that state or country.
  Most employers are American, so expect US-only remote. Check `detail`'s
  `applicantLocation` and the description before judging fit from Italy.
- **Tech roles are a small slice.** At recon, `-q "machine learning" --remote`
  and `-q "software" --remote --jobage 60` returned nothing, while `data`,
  `engineer`, `developer` and `AI` did. Use short role words, and treat this
  board as a complement to the tech-heavy impact boards, not a replacement.
- **`date` can be older than the listing.** Imported jobs keep the source's
  posting date, so a job listed this month can show a date years back
  (`Senior Full Stack Developer`, dated 2021-02-03, sat among September 2026
  imports). `--jobage` filters on that same date.
- **Recruiter postings name the recruiter as the company.** For example
  `company: "NRG Consulting Group"` on
  `"Friends of the Earth: VP Programs, Climate & Biodiversity"`. The real
  employer is often the title prefix before `-` or `:`.
- **Salary is rare** (1 of about 150 jobs seen). When present it is gross, in
  the stated currency and period. It is never RAL, so label it as the posting
  does.
- **The search description is a 500-character excerpt.** The board embeds the
  full posting, and `detail` returns all of it. Some postings exported from
  Workday run words together (`dataaren't`), because the source HTML has no
  spaces between its fragments. Browsers show the same text.
- **`applyUrl`** is the employer's own application page (Greenhouse, Workday,
  Personio and similar), taken from the posting.
- **No category or job-type flag.** Almost no jobs carry a category, and the
  job type is in the output (`jobType`) for client-side filtering.
- **One request per call, at least 1 second apart** (robots.txt
  `Crawl-delay: 1`), enforced across separate runs through a timestamp file in
  the OS temp directory. Back-to-back calls from `/scrape` therefore take about
  a second each.
