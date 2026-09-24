---
name: remoteimpact-search
version: 1.0.0
description: >
  Search Remote Impact (remoteimpact.org), a remote-only job board for
  impact-focused organisations: climate and clean energy, AI safety and
  governance, global health, biosecurity, animal welfare, effective altruism,
  education, humanitarian and non-profit roles, worldwide. Reads the board's
  public RSS feeds. Use for: Remote Impact, remoteimpact.org, remote impact
  jobs, remote AI safety jobs, AI safety jobs, AI governance jobs, remote
  climate jobs, remote non-profit jobs, nonprofit remote jobs, effective
  altruism jobs, EA jobs, social impact jobs, mission-driven remote work,
  remote ML engineer at a non-profit, remote software engineer for good.
  Italiano: lavoro da remoto non profit, lavoro ad alto impatto, lavoro a
  impatto sociale, lavoro da remoto nel clima, lavoro sicurezza IA, lavoro
  nel terzo settore da remoto, altruismo efficace, full remote ONG, smart
  working non profit.
context: fork
enabled: false  # impact/non-profit portal - ships opt-in; set true to have /scrape use it
access: open    # robots.txt allows /feed/ (disallows only /api/, /admin/, /accounts/, /checkout/); the board offers its RSS feed for reuse with attribution; the CLI reads only the feeds
allowed-tools: Bash(bun run .agents/skills/remoteimpact-search/cli/src/cli.ts *)
---

# Remote Impact Search

[Remote Impact](https://remoteimpact.org) lists only **remote** roles at
impact-focused organisations: climate and energy (the largest share), AI safety
and governance, global health, biosecurity, animal welfare, effective altruism,
education, humanitarian work and non-profits. Postings are in English and mostly
from US and European employers. It fits a remote AI/ML or software profile that
wants mission-driven work. It is not a source of Italy-local roles.

The CLI reads only the board's **public RSS feeds**: the site-wide feed and one
feed per impact category. It never loads the HTML job pages and never calls
`/api/`. Keyword, age and page filters run on your machine. **Zero runtime
dependencies**: it runs with nothing but `bun`.

**Ships disabled.** `enabled: false` keeps `/scrape` from using it until you
set `enabled: true` in the frontmatter above.

## Terms and attribution

- `robots.txt` allows everything except `/admin/`, `/accounts/`, `/api/` and
  `/checkout/`. The feeds are at `/feed/jobs/`, which is allowed.
- The Terms of Service ask users to "Not scrape, spam, or abuse our platform".
  The board's own sharing page offers the RSS feed for reuse in "a newsletter,
  Slack workflow, career-center page, or community digest" and asks you to
  "keep the Remote Impact link and source attribution when republishing". This
  CLI reads that feed as offered. It does not scrape the site's pages.
- **Keep the attribution.** Every result carries `source: "remoteimpact.org"`
  and a link to its Remote Impact job page. JSON `meta.source` and the last
  line of `table`/`plain` output name the source. If you pass results on (a
  shortlist, a Notion page, a message), keep the name and the links.
- Keep volume low and personal. One request per feed, at most 6 per call,
  with a 1-second pause between feeds.

## Usage

```bash
# Remote ML / AI roles in the AI-safety and technology feeds, as a table
bun run .agents/skills/remoteimpact-search/cli/src/cli.ts search -q "machine learning" -c ai-safety,technology --format table

# Research-engineer roles at AI-safety organisations, posted in the last 14 days
bun run .agents/skills/remoteimpact-search/cli/src/cli.ts search -q "research engineer" -c ai-safety --jobage 14 --format table

# Remote software-engineering roles for good, as JSON for /scrape
bun run .agents/skills/remoteimpact-search/cli/src/cli.ts search -q "software engineer" -c technology,effective-altruism --limit 20

# Data roles in climate and energy
bun run .agents/skills/remoteimpact-search/cli/src/cli.ts search -q "data" -c climate-environment,energy --jobage 7 --format table

# Everything new on the whole board since yesterday (site-wide feed, no keyword)
bun run .agents/skills/remoteimpact-search/cli/src/cli.ts search --jobage 1 --format table

# One role, by id or job URL (pass the category you found it in)
bun run .agents/skills/remoteimpact-search/cli/src/cli.ts detail job-at-farai-farai-22 -c ai-safety --format plain
```

## Commands

### `search`

| Flag | Meaning |
|---|---|
| `--query`, `-q` | Keywords, matched against title, organisation and the description excerpt. Every term must match. Terms match at the start of a word (`engineer` finds `engineering`). Terms of 3 letters or fewer must be whole words (`AI` does not find `aid`). `"quoted phrases"` stay together. Case and accents are ignored. Optional: omit it to list the newest roles. |
| `--category`, `-c` | Read these category feeds instead of the site-wide feed. Comma-separated slugs, max 5 (table below). Results are merged, de-duplicated and sorted newest first. |
| `--jobage <days>` | Only roles published within N days. Filtered on the client, so it cannot reach past the feed's window (see Notes). |
| `--page <n>` | 1-indexed, 20 results per page. Default 1. |
| `--limit`, `-n <n>` | Cap results emitted (client-side). |
| `--format` | `json` (default), `table`, `plain`. |

**No `--location`.** Every role is remote and the feed has no region field, so
`-l` fails with `UNSUPPORTED_FLAG`. To prefer a region, put it in `--query`
(`-q "engineer Europe"`). This only matches roles that name the region in the
title or the first 500 characters of the description.

JSON output:

```json
{ "meta": { "count": 2, "page": 1, "perPage": 20, "total": 30, "pages": 2, "scanned": 50,
            "coverage": { "from": "2026-09-10", "to": "2026-09-23" },
            "feeds": ["https://remoteimpact.org/feed/jobs/category/ai-safety/"],
            "source": "Remote Impact (https://remoteimpact.org) - public RSS feed" },
  "results": [ { "id": "job-at-farai-farai-22", "title": "Research Scientist, Applied White-Box Methods",
                 "company": "Far.Ai", "location": "Remote", "remote": true, "date": "2026-09-23",
                 "published": "2026-09-23T13:22:25.000Z",
                 "url": "https://remoteimpact.org/jobs/job-at-farai-farai-22/",
                 "categories": ["ai-safety"], "description": "About Us\n\nFAR.AI is a non-profit ... …",
                 "descriptionTruncated": true, "source": "remoteimpact.org" } ] }
```

Every field is always present: unknown values are `null` and unknown lists are
`[]`, never omitted. `total` counts matches in the feeds read. `scanned` is how
many distinct jobs those feeds held. `coverage` is the date range they span.

### `detail <id|url>`

Takes an `id` (the job slug) from `search`, or a job URL
`https://remoteimpact.org/jobs/<slug>/`. It looks the job up in the feeds: first
the `--category` feeds you pass, then the site-wide feed. It returns the same
record plus `foundIn` (the feed it came from). If you found the job with
`--category`, pass the same `--category`. An older job may no longer be in the
site-wide feed.

Errors go to stderr as `{"error": "...", "code": "..."}` with exit 1. Codes:
`MISSING_REQUIRED`, `BAD_ARG`, `BAD_ID`, `BAD_CATEGORY`, `NOT_FOUND`,
`PARSE_ERROR`, `API_ERROR`, `UNKNOWN_FLAG`, `UNSUPPORTED_FLAG`, `BAD_CMD`,
`INTERNAL_ERROR`.

### Category slugs

Found on `https://remoteimpact.org/domains/` on 2026-09-24. `--help` prints the
same list. An unknown slug fails with `BAD_CATEGORY`.

| Slug | Category |
|---|---|
| `ai-safety` | AI Safety & Governance |
| `technology` | Technology & Engineering |
| `effective-altruism` | Effective Altruism |
| `biosecurity` | Biosecurity & Pandemic Preparedness |
| `nuclear-security` | Nuclear Security |
| `climate-environment` | Climate & Environment (largest, about 40% of the board) |
| `energy` | Energy |
| `global-health` | Global Health |
| `education` | Education & Research |
| `animal-welfare` | Animal Welfare |
| `humanitarian` | Humanitarian & Disaster Relief |
| `nonprofit-charity` | Nonprofit & Charity |
| `poverty-development` | Poverty & Economic Development |
| `human-rights` | Human Rights & Justice |
| `policy-advocacy`, `advocacy-or-policy` | Policy & Advocacy (two slugs on the site) |
| `communications`, `media-journalism` | Communications & Media, Media & Journalism |
| `operations` | Operations & Administration |
| `capital` | Impact investing and sustainable finance |
| others | `buildings`, `children-youth`, `civic-engagement`, `coastal-ocean-sinks`, `community-development`, `disability`, `food-agriculture-land-use`, `gender-equality-social-inclusion`, `impact-careers`, `materials-manufacturing`, `mental-health`, `transportation`, `other` |

For a remote AI/ML or software profile, start with `ai-safety,technology`, then
add `effective-altruism` or `biosecurity`.

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default: programmatic use, `/scrape`, passing ids to `detail` |
| `table` | Quick scanning: title, organisation, date, id |
| `plain` | Reading: one block per role; with `detail`, the record and its excerpt |

## Notes

- **Each feed holds only its newest 50 roles.** The board lists about 6,800
  roles. The site-wide feed covers less than a day (16 hours at recon), and a
  category feed reaches further back (about 2 weeks for `ai-safety` at recon).
  `meta.coverage` shows the real window of each run. `--jobage 30` cannot find
  anything older than that window. Use `--category` to reach further back, and
  run it often rather than deep.
- **The description is a 500-character excerpt, not the full posting.** The
  feed cuts it, often mid-sentence. `descriptionTruncated: true` marks this, and
  the text ends with ` …`. `detail` returns the same excerpt, because the CLI
  never loads the HTML job page. Before you judge fit, read the full posting at
  `url`, which links on to the employer's application page.
- **`location` is always `"Remote"`.** The board lists remote roles only, but
  many are region-locked (US-only, one country, a time zone), and some
  aggregated roles are not truly remote. The feed carries no region, so check
  the title and description. In the recon sample, *ESG Analyst (UAE)* and
  *Regional Technical Sales Consultant - US Southeast Region* named their region
  only in the title.
- **`date` is when Remote Impact published the role** (the RSS `pubDate`, UTC).
  The employer may have posted it earlier.
- **Titles are split on the last `" at "`**: the feed title reads
  `<role> at <organisation>`. A title with no `" at "` keeps `company: null`.
- **Near-duplicates are common.** The board aggregates from several sources, so
  the same role can appear under two slugs with a different spelling of the
  organisation (`FAR AI`, `Far.Ai`, `FAR.AI`). `/scrape` dedupes by URL and
  company+title. Expect a few duplicates anyway.
- **No salary, deadline or employment type** in the feed. They are on the job
  page only.
- Some descriptions are Markdown rather than HTML (the board rewrites some
  with AI). The CLI removes `##` and `**` markers so the text reads cleanly.
