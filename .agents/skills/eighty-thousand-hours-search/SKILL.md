---
name: eighty-thousand-hours-search
version: 1.0.0
description: >
  Search the 80,000 Hours job board (jobs.80000hours.org), a curated global
  board of high-impact roles at non-profits, AI safety labs, AI policy think
  tanks, global health, biosecurity and animal welfare organisations, many of
  them remote. Use for: 80,000 Hours, 80k jobs, high-impact jobs, impact
  careers, effective altruism jobs, EA jobs, AI safety jobs, AI governance
  jobs, AI policy jobs, non-profit jobs, nonprofit jobs, charity jobs,
  mission-driven jobs, social impact careers, remote AI safety engineer.
  Italiano: lavoro non profit, lavoro nel non profit, lavoro ad alto impatto,
  carriera ad alto impatto, lavoro a impatto sociale, terzo settore, lavoro
  nel terzo settore, altruismo efficace, lavoro sicurezza IA, lavoro da
  remoto non profit, ONG.
context: fork
enabled: false  # impact/non-profit portal - ships opt-in; set true to have /scrape use it
access: open    # robots.txt allows all; ToS has no automated-access clause (personal, non-commercial use); board's own public search-only key
allowed-tools: Bash(bun run .agents/skills/eighty-thousand-hours-search/cli/src/cli.ts *)
---

# 80,000 Hours Job Board Search

The [80,000 Hours job board](https://jobs.80000hours.org) lists roughly a
thousand hand-picked roles aimed at pressing global problems: AI safety and
policy (about two thirds of the board), biosecurity, global health, animal
welfare, nuclear security, and effective-altruism organisations. Postings are
in English and global, with a large remote share. That makes it a good fit for a
remote AI/ML engineer and a poor fit for Italy-local roles.

The board is a JavaScript app. Its job list comes from a search index that the
board's own page queries with a public, search-only key it ships to every
visitor. This CLI makes the same two calls a browser makes, with an honest
User-Agent, so there is no scraping of rendered pages and no browser
impersonation. **Zero runtime dependencies**: it runs with nothing but `bun`.

**Ships disabled.** `enabled: false` keeps `/scrape` from using it until you
set `enabled: true` in the frontmatter above.

**Terms.** `robots.txt` allows everything, and the 80,000 Hours terms of use
contain no clause against automated access. They do limit use to personal,
non-commercial career purposes, so keep it to your own job search and keep
volume low. Each `search` or `detail` call makes two requests.

## Usage

```bash
# Remote ML roles posted in the last two weeks
bun run .agents/skills/eighty-thousand-hours-search/cli/src/cli.ts search -q "machine learning" --remote --jobage 14 --format table

# AI safety roles open to someone based in Italy (global remote, European remote, continental Europe)
bun run .agents/skills/eighty-thousand-hours-search/cli/src/cli.ts search -q "AI safety" -l "Remote, Global;Remote, Europe;Europe (ex UK)" --format table

# Remote software-engineering roles from the last week, as JSON for /scrape
bun run .agents/skills/eighty-thousand-hours-search/cli/src/cli.ts search -q "software engineer" --remote --jobage 7 --limit 20

# Research engineer roles in London
bun run .agents/skills/eighty-thousand-hours-search/cli/src/cli.ts search -q "research engineer" -l "London, UK" --format table

# Browse everything remote that is new in the last 3 days (no keyword)
bun run .agents/skills/eighty-thousand-hours-search/cli/src/cli.ts search --remote --jobage 3 --format table

# One role, by id or board URL
bun run .agents/skills/eighty-thousand-hours-search/cli/src/cli.ts detail 20437 --format plain
```

## Commands

### `search`

| Flag | Meaning |
|---|---|
| `--query`, `-q` | Keywords, matched against title, organisation, summary and tags. Optional: omit it to browse the newest roles. |
| `--location`, `-l` | The board's own location tags, case-insensitive. Separate several with **`;`** (the tags themselves contain commas), for example `"Remote, Global;Europe (ex UK)"`. Several tags are OR'ed. |
| `--remote` | Only roles tagged remote. This **includes region-locked remote** such as `Remote, USA`, so check `location`. |
| `--jobage <days>` | Only roles posted within N days. Filtered on the server. |
| `--page <n>` | 1-indexed, 20 results per page. Default 1. |
| `--limit`, `-n <n>` | Cap results emitted (client-side). |
| `--format` | `json` (default), `table`, `plain`. |

Useful location tags (the full list is on the board's *Country / Region* and
*City* filters): `Remote, Global`, `Remote, Europe`, `Remote, USA`,
`Remote, UK`, `Europe (ex UK)`, `Europe`, `UK`, `USA`, `Global`, and cities such
as `London, UK`, `Berlin, Germany`, `Amsterdam, Netherlands`. No tag names Italy
at the moment. Continental European cities also carry `Europe (ex UK)`, so that
is the tag to use for on-site roles reachable from Italy. An unknown tag
returns zero results, never an error.

JSON output:

```json
{ "meta": { "count": 2, "page": 1, "perPage": 20, "total": 45, "pages": 3 },
  "results": [ { "id": "20437", "title": "Machine Learning Engineer", "company": "Gray Swan",
                 "location": "Pittsburgh, PA; Remote, Global; Remote, USA", "remote": true,
                 "date": "2026-08-03", "deadline": null,
                 "url": "https://jobs.80000hours.org/jobs?jobPk=20437",
                 "applyUrl": "https://jobs.ashbyhq.com/...", "salary": "$160,000 - $257,000",
                 "areas": ["AI safety & policy"], "skills": ["Research", "Software engineering"],
                 "roleTypes": ["Full-time"], "experience": ["Mid (5-9 years experience)"],
                 "description": "- In this role, you'll design and deploy ..." } ] }
```

Every field is always present: unknown scalars are `null` and unknown lists
are `[]`, never omitted. `location` joins several places with `; `.

### `detail <id|url>`

Takes a numeric id from `search`, or a board URL
`https://jobs.80000hours.org/jobs?jobPk=<id>` (the older `/?jobPk=<id>` form
also works). It adds `locations` (every location tag), `degree`, `updated`,
`companyUrl` and `companyDescription`.

Errors go to stderr as `{"error": "...", "code": "..."}` with exit 1. Codes:
`MISSING_REQUIRED`, `BAD_ARG`, `BAD_ID`, `NOT_FOUND`, `CONFIG_NOT_FOUND`,
`PARSE_ERROR`, `API_ERROR`, `UNKNOWN_FLAG`, `BAD_CMD`, `INTERNAL_ERROR`.

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default: programmatic use, `/scrape`, passing ids to `detail` |
| `table` | Quick scanning: id, title, organisation, location, date |
| `plain` | Reading: summary lines per role; with `detail`, the full record |

## Notes

- **The board holds a summary, not the full posting.** `description` is the
  board's own short bullet summary. The full posting (and
  the application form) lives at `applyUrl`, usually the employer's ATS
  (Ashby, Greenhouse, Lever). Read it before judging fit on requirements.
  `detail` returns the same summary plus the organisation blurb, so it rarely
  adds much for triage.
- **Salary is free text** in the employer's currency (`$`, `£`, `€`),
  usually gross annual. It is never RAL, so label it as the posting does.
  Many roles state none (`null`).
- **`deadline` is `null` for rolling applications**, which are most roles.
- **Role types include non-jobs**: fellowships, internships, courses, funding
  and volunteering sit alongside full-time roles. Check `roleTypes`.
- **Results come in the board's own order**, which is newest-first. Use
  `--jobage` rather than relying on position to scope by recency.
- **Two requests per call.** The CLI first loads the board page to read the
  current search key (see `url-reference.md`), then queries the index. If the
  board is redesigned and the key moves, the CLI fails with `CONFIG_NOT_FOUND`.
  It never guesses.
