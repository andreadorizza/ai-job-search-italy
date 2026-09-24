---
name: uncareers-search
version: 1.0.0
description: >
  Search UN Careers (careers.un.org), the United Nations Secretariat job
  portal: staff positions (P, G, NO and FS levels), consultancies, individual
  contractor roles and internships at UN departments, regional commissions,
  UNEP, UN-Habitat, UNODC, UNCTAD, ITC and peace operations, worldwide and
  home-based, including duty stations in Italy (Rome, Brindisi). Use for: UN
  jobs, United Nations jobs, United Nations careers, UN careers, careers.un.org,
  UN Secretariat jobs, inspira, international organisations, international
  organizations jobs, intergovernmental organisation jobs, UN consultancy, UN
  consultant jobs, home-based consultancy, remote UN consultancy, UN
  internship, UN ICT jobs, UN data jobs, UN jobs in Geneva, Vienna, New York,
  Nairobi, Rome, Brindisi. Italiano: lavoro ONU, lavorare all'ONU, lavoro
  Nazioni Unite, offerte di lavoro Nazioni Unite, carriere Nazioni Unite,
  organizzazioni internazionali, lavoro nelle organizzazioni internazionali,
  consulenze ONU, consulente ONU, consulenza da remoto ONU, tirocinio ONU,
  stage Nazioni Unite, lavoro ONU a Brindisi, lavoro ONU a Roma.
context: fork
enabled: false  # impact/non-profit portal - ships opt-in; set true to have /scrape use it
access: open    # no robots.txt (the SPA answers /robots.txt with its HTML shell); un.org terms allow personal, non-commercial use and have no automated-access clause; portal's own public JSON endpoint, no login
allowed-tools: Bash(bun run .agents/skills/uncareers-search/cli/src/cli.ts *)
---

# UN Careers Search

[UN Careers](https://careers.un.org) is the job portal of the United Nations
Secretariat. It lists about 470 open postings at any time: staff job openings
(Professional, General Service, National Officer and Field Service levels),
consultancies and individual-contractor roles, and internships. The posting
offices include UN departments, the regional commissions (ECA, ECE, ECLAC,
ESCAP, ESCWA), UNEP, UN-Habitat, UNODC, UNCTAD, ITC, peace operations and the
Pension Fund. About a quarter of the board is consultancies, and many of them
are home-based. Italian duty stations are Rome and Brindisi (the UN Global
Service Centre, whose postings come from the Department of Operational
Support).

**What it does not cover.** Agencies, funds and programmes such as UNDP,
UNICEF, UNHCR, WFP, FAO, IFAD, WHO, ILO and UNESCO recruit on their own
portals. Rome-based FAO, WFP and IFAD roles are not here.

The portal is a JavaScript app. Its search page sends a filter object to a
public JSON endpoint. This CLI makes that same call with an honest User-Agent,
so there is no scraping of rendered pages and no browser impersonation.
**Zero runtime dependencies**: it runs with nothing but `bun`.

**Ships disabled.** `enabled: false` keeps `/scrape` from using it until you
set `enabled: true` in the frontmatter above.

## Personal use only

The site has no `robots.txt`. The un.org
[terms of use](https://www.un.org/en/about-us/terms-of-use), linked from the
portal's footer, contain no clause against automated access. They do limit use
of the site's materials to the user's "personal, non-commercial use", with no
right to redistribute them or create derivative works. So:

- use it for **your own job search only**, at human volume (one request per
  `search` or `detail`, plus one for a `-l` lookup);
- do not republish, share or resell what it returns, and do not build a
  public job feed or dataset from it.

Applications go through the UN's inspira system from the posting page, which
needs your own account. The CLI never applies or logs in.

## Usage

```bash
# ICT roles (the Information and Telecommunication Technology job network)
bun run .agents/skills/uncareers-search/cli/src/cli.ts search --network ict --format table

# Data and AI work across the board, published in the last 14 days
bun run .agents/skills/uncareers-search/cli/src/cli.ts search -q data --jobage 14 --format table

# Home-based consultancies (check workLocation before trusting the flag)
bun run .agents/skills/uncareers-search/cli/src/cli.ts search --category consultant --home-based --format table

# Data consultancies in Geneva or Vienna, as JSON for /scrape
bun run .agents/skills/uncareers-search/cli/src/cli.ts search -q data --category consultant -l "Geneva;Vienna"

# Everything in Italy (Rome and Brindisi)
bun run .agents/skills/uncareers-search/cli/src/cli.ts search -l Italy --format table

# One posting's full text, by id or posting URL
bun run .agents/skills/uncareers-search/cli/src/cli.ts detail 285249 --format plain
```

## Commands

### `search`

| Flag | Meaning |
|---|---|
| `--query`, `-q` | Keyword, matched by the portal. Optional: omit it to browse the newest postings. See the keyword notes below. |
| `--location`, `-l` | Duty stations or countries, several separated by `;` or `,` (OR'ed): `Geneva`, `New York`, `Nairobi`, `Rome`, `Italy`, `Kenya`. Case- and accent-insensitive. An unknown place exits 1 with `UNKNOWN_LOCATION` and suggestions. |
| `--category`, `-c` | `consultant` (consultants and individual contractors), `internship`, `staff` (every staff job opening), `pool` (open-ended candidate pools). Several separated by `,`. |
| `--network` | Job network: `ict` (ITECNET), `development` (DEVNET), `science` (SCINET), `management` (MAGNET), `political` (POLNET), `information` (INFONET), `legal`, `logistics`, `security`, or the codes. **Staff openings only**: consultancies and internships carry no job network. |
| `--home-based` | Only postings whose *Work Location* reads home-based or remote. Filters the fetched page (see notes). |
| `--jobage <days>` | Only postings published within N days, by New York date (today counts as day 1). |
| `--page <n>` | 1-indexed, 20 results per page. Default 1. |
| `--limit`, `-n <n>` | Cap results emitted (client-side). |
| `--format` | `json` (default), `table`, `plain`. |

JSON output:

```json
{ "meta": { "count": 1, "page": 1, "perPage": 20, "total": 6, "pages": 1, "locations": null },
  "results": [ { "id": "285226", "title": "the development of national Open-Source Software policy in Palestine",
                 "company": "Economic and Social Commission for Western Asia",
                 "location": "BEIRUT", "date": "2026-09-23", "deadline": "2026-10-06",
                 "url": "https://careers.un.org/jobSearchDescription/285226?language=en",
                 "level": "CON", "category": "Affiliate Personnel – Consultants/Individual Contractors",
                 "categoryCode": "CON", "jobNetwork": null,
                 "jobFamily": "Information Management Systems and Technology",
                 "recruitmentType": "Consultant", "workLocation": "Remote", "duration": "16 weeks",
                 "homeBased": true, "summary": "GENERAL SCOPE Open-source software policies provide ..." } ] }
```

Every field is always present; unknown values are `null`, never omitted.
`company` is the hiring department or office. `location` is the duty station
as the portal spells it (often upper case; several joined with `; `).
`deadline` is the last day to apply: postings close at 11:59 p.m. New York
time on that date. `meta.total` is the portal's count before any client-side
trim (`--jobage`, `--home-based`). `meta.locations` lists the places a `-l`
resolved to.

### `detail <id|url>`

Takes a numeric id from `search`, or a posting URL
`https://careers.un.org/jobSearchDescription/<id>`. It returns every search
field plus `jobCodeTitle`, the full `description` as plain text, and
`sections` (`[{title, text}]`: Org. Setting and Reporting, Responsibilities,
Competencies, Education, Work Experience, Languages, and for consultancies
Work Location, Expected duration, Duties and Responsibilities,
Qualifications/special skills). It only finds **open** postings.

Errors go to stderr as `{"error": "...", "code": "..."}` with exit 1. Codes:
`MISSING_REQUIRED`, `BAD_ARG`, `BAD_ID`, `UNKNOWN_LOCATION`, `NOT_FOUND`,
`PARSE_ERROR`, `API_ERROR`, `UNKNOWN_FLAG`, `BAD_CMD`, `INTERNAL_ERROR`.

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default: programmatic use, `/scrape`, passing ids to `detail` |
| `table` | Quick scanning: id, title, department, duty station, posted, deadline |
| `plain` | Reading: a summary per posting; with `detail`, the full posting text |

## Notes

- **Keyword search is the portal's own and it is uneven.** It matches titles
  and some of the posting text, not all of it. At recon, `software` found 16
  postings, including some that mention it only in the description. But
  `machine learning` found none, although several postings mention it, and
  `home` found none, although dozens say "Home-based". Short terms match
  inside words: `AI` matched 262 of 467 postings. So use one distinctive word
  (`data`, `software`, `statistics`, `GIS`, `evaluation`), prefer
  `--network` and `--category`, and remember the whole board is only about
  470 postings, so browsing a category is cheap.
- **`--category` uses the portal's recruitment type, not its "category".**
  The portal ignores the keyword whenever its category filter is set, so
  `category = consultants` plus any keyword returned every consultancy. The
  recruitment-type filter covers the same ground and keeps the keyword. The
  four categories split the board with no overlap. `consultant` leaves out
  the 7 open-ended candidate pools the portal files under consultants; use
  `pool` for those.
- **The portal ignores filter values it does not know.** An unknown
  category, network or duty station would return the whole board. The CLI
  checks every value before it sends it, and fails instead of widening the
  search.
- **`-l` loads the portal's filter list** (one extra request, about 850 KB)
  to map places to its location codes. "Italy" becomes Rome and Brindisi.
  Turin is in that list but has no duty station behind it, so `-l Turin`
  returns nothing without a search. Home-based work is not a location on this
  portal; use `--home-based`.
- **`--home-based` is a heuristic on free text.** Only consultancies and
  internships have a *Work Location* section. `homeBased` is `true` when it
  starts with "Remote" or says "home-based" anywhere. "Paris with remote
  possible" and "Lusaka (Remote within the work location)" count as `false`.
  It is `null` for staff openings. The filter runs on the fetched page, so a
  page can show fewer than 20 results. Page on with `--page` for more.
- **`--jobage` beyond the portal's windows.** The portal only filters by
  1, 7 or 30 days. The CLI asks for the smallest window that covers your
  number and trims to the exact day count itself. Above 30 days there is no
  server filter.
- **Results are ordered by job id, newest first.** The portal's own order
  (publication date) has many ties, and the server does not break them, so
  one posting can appear on two pages. Job ids are unique, so pages never
  overlap. The order is close to newest-published but not exact.
- **Dates are New York dates**, as the portal shows them. A UTC reading would
  put every deadline one day late.
- **`detail` never opens the per-job page API.** That endpoint counts views
  of each posting, and a CLI lookup is not a candidate reading it. The list
  endpoint already carries the full text, so `detail` searches for the id and
  accepts only an exact match: one request, the same cost.
- **Some postings are in French or Spanish** (for example ECLAC, UNODC and
  field-office consultancies and internships). The title and text come as
  written.
- **No salary data.** UN pay follows published scales by grade (`level`,
  e.g. `P-3`, `NO-C`), and consultancy fees are set per contract. None of it
  is RAL. Do not state a salary the posting does not give.
- **Applying needs inspira.** The posting URL opens the job on the portal,
  which links to inspira. Opening it there is a normal page view.
