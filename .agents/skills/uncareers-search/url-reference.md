# UN Careers (careers.un.org) — data source reference

Recorded during `/add-portal` Step 2 (2026-09-24) by reading the portal's own
JavaScript bundle (`main-*.js`) and probing its public API with a few dozen
small requests. No account, no session cookie, no impersonation. User-Agent
throughout: `Mozilla/5.0 (compatible; uncareers-cli/1.0)`.

## Architecture

`https://careers.un.org` is an Angular single-page app. Its HTML holds no job
list. The search page builds a filter object and POSTs it to a public JSON
API under `/api/public/`. Any unknown path, including `/robots.txt`, returns
the app's HTML shell with status 200.

The bundle's API service defines these public calls (relevant ones only):

| Call | Used by the CLI | Notes |
|---|---|---|
| `POST /api/public/opening/jo/list/filteredV2/{lang}` | yes: `search`, `detail` | The search page's list call. |
| `GET /api/public/opening/jo-filter/list/v2/{lang}` | yes: `-l` only | The search page's filter vocabularies. |
| `GET /api/public/opening/jo/{id}/{lang}` | **never** | Per-job read for the posting page. |
| `PUT /api/public/opening/jo/{id}/{lang}` | **never** | `updateJobOpeningViewCount` in the bundle. |
| `GET /api/public/opening/joV2/{id}/{lang}` | **never** | Alternative per-job read. |

The per-job endpoints are avoided on purpose: the posting page pairs its read
with a view-count update, and a CLI lookup should not register as a candidate
viewing a posting. Every list item already carries the full posting HTML, so
nothing is lost.

## Search

```
POST https://careers.un.org/api/public/opening/jo/list/filteredV2/en
Content-Type: application/json
```

Body sent by the CLI (`listBody` + `buildFilterConfig`):

```json
{
  "filterConfig": { "keyword": "data", "recrtype": ["C", "I"], "ds": ["Geneva", "VIENNA"], "jn": ["ITECNET"], "span": ["7"] },
  "pagination": { "page": 0, "itemPerPage": 20, "sortBy": "jobId", "sortDirection": -1 }
}
```

Response envelope: `{ "status": 1, "message": "Success.", "data": { "list": [...], "count": 467 } }`.
An error envelope has `status: 0` and a `message`.

### `filterConfig` keys (verified live 2026-09-24)

Values inside one key are OR'ed; keys are AND'ed. **The server silently
ignores a value it does not recognise.** An unknown `ds`, `jc` or `jobId` key
returned the whole board (467). The CLI therefore validates every value first.

| Key | CLI flag | Behaviour |
|---|---|---|
| `keyword` | `-q` | Portal-side match (see below). `keyword: "<jobId>"` returns exactly that posting; `detail` relies on this. |
| `ds` | `-l` | Location **codes** from the filter list's `jl` vocabulary (`ROME`, `Geneva`, `NEWYORK`). **Case-sensitive** (`geneva` was ignored). Inspira duty-station codes (`5750`) were ignored. A code whose entry has no duty stations (`TURIN`) was ignored, so alone it returned the whole board. `OTHER` is a catch-all of ~2,500 duty stations (460 of 467 results). |
| `recrtype` | `--category` | Recruitment type codes. Honours `keyword`. |
| `jn` | `--network` | Job network codes. Honours `keyword`. Only staff openings carry `jn`. |
| `span` | `--jobage` | Only `"1"`, `"7"`, `"30"`. `"7"` returned publication dates 2026-09-18 to 2026-09-24 on 2026-09-24: today plus 6 days, by New York date. Exactly the same 142 postings as a client-side cut on `startDate`. |
| `jc` | — not used | Category (`CON`, `INT`, `PD`, `GS`, `FS`, `NPO`). **Makes the server drop `keyword`:** `jc:["CON"]` + `keyword:"zzqqxx"` returned all 124 consultancies, and `jc:["CON"]` + `keyword:"data"` + `ds` Geneva/Vienna returned all 13 consultancies there. This is why `--category` uses `recrtype`. |
| `ct` | — not used | Contract type. `CON` (117) honours `keyword`, but `IN` (internship) returned 0, so it cannot cover internships. |
| `aoe`, `aoi`, `el`, `jf`, `jle`, `dept` | — not used | Exist in the site's filter list; not needed. |

### Recruitment types (`recrtype`) and the `--category` mapping

The 14 codes partition the board exactly. At recon: C+I 117, N 60, staff 272,
H+V 18 = 467.

| `--category` | Codes | Portal names |
|---|---|---|
| `consultant` | `C`, `I` | Consultant; Individual Contractor |
| `internship` | `N` | Intern |
| `staff` | `F`, `P`, `R`, `S`, `Y`, `G`, `T`, `L`, `E` | Position Specific (Fixed Term Limited); Position Specific; Recruit from Roster (FTL); Recruit from Roster; Young Professionals Programme; Generic (for rostering); Temporary Opportunities; Language; Competitive Exams for language position |
| `pool` | `H`, `V` | Candidate Pool - Consultant / Individual Contractor; Candidate Pool - Intern |

The list is fixed in `helpers.ts → CATEGORIES`. If the filter list
(`data.recrtype.values`) grows a new code, add it here and there.

### Job networks (`jn`)

`DEVNET` Economic, Social and Development; `ITECNET` Information and
Telecommunication Technology; `SAFETYNET` Internal Security and Safety;
`LEGALNET` Legal; `LOGNET` Logistics, Transportation and Supply Chain; `MAGNET`
Management and Administration; `POLNET` Political, Peace and Humanitarian;
`INFONET` Public Information and Conference Management; `SCINET` Science.

### Keyword matching

Opaque and uneven. Observations at recon:

- `software` → 16. For 4 of them no returned field contained "software", and
  for others only `jobDescription` did.
- `data` → 36; `data scientist` → 1 (title); `learning` → 2 (titles).
- `machine learning` → 0, although it appears in at least 5 descriptions.
- `home` → 0, `based` → 0, `home based` → 0, `home-based` → 0, although 34 of
  the 124 consultancies say "home-based" in their text.
- `AI` → 262 of 467 (it matches inside words such as "Affairs").

### Sorting and pagination

`pagination.page` is 0-indexed. The site sorts by `startDate` descending,
but every posting of a day shares one timestamp (`T04:00:00.000Z`, midnight
New York), and the server does not break ties. The same posting was seen on
page 0 and page 1 of one query. `sortBy: "jobId"` is honoured and unique, so
the CLI uses it: page 1 at size 3 equalled items 4–6 of page 0 at size 6.
`itemPerPage` up to 200 worked; the CLI uses 20.

### Response fields per list item

| Field | Example | Maps to |
|---|---|---|
| `jobId` | `285249` | `id` (string) |
| `postingTitle` | `"INFORMATION SYSTEMS OFFICER, P3"` | `title` (fallback `jobTitle`) |
| `jobTitle`, `jobCodeTitle` | `"INFORMATION SYSTEMS OFFICER"` | `jobCodeTitle` (detail) |
| `dept.name` | `"United Nations Joint Staff Pension Fund - Pension Administration"` | `company` |
| `dutyStation[].description` | `"NEW YORK"`, `"HQ Amman"`, `"PORT-AU-PRINCE - LOCAL"` | `location` (joined `; `; one per item at recon) |
| `startDate` | `"2026-09-22T04:00:00.000Z"` | `date` (New York date) |
| `endDate` | `"2026-10-07T03:59:59.000Z"` | `deadline` (New York date: 2026-10-06) |
| `jobLevel` | `"P-3"`, `"NO-C"`, `"G-5"`, `"CON"`, `"I-1"` | `level` |
| `jc.code` / `jc.name` | `"PD"` / `"Professional and Higher Categories"` | `categoryCode` / `category` (absent on 5 of 150; `categoryCode` then falls back to top-level `categoryCode`, e.g. `"RLG"` for UNRWA local posts) |
| `jn.name` | `"Information and Telecommunication Technology"` | `jobNetwork` (staff only) |
| `jf.Name` (capitalised keys) | `"Information Management Systems and Technology"` | `jobFamily` (some consultancies carry the bare code, e.g. `"HST"`) |
| `recrttype.name` | `"Consultant"` | `recruitmentType` |
| `jobDescription` | HTML, ~20 KB | `sections`, `description`, `summary`, `workLocation`, `duration` |
| `language` | `"EN"` on every item | not used; some postings are still written in Spanish or French |

**Deadline.** The posting text itself says openings "will be removed at 11:59
p.m. (New York time) on the deadline date". The bundle renders `endDate`
through a `formatDate` helper that calls `.tz(date, "America/New_York")` and an
`nyDate` template pipe, so the CLI converts with the same zone.

### Posting HTML

```html
<div class='jobPostingDetail'>
<div class='jobPostingItem'><div class='jobPostingItemTitle'>Responsibilities</div><div class='jobPostingItemContent'>…</div></div>
…
<div class='jobPostingItem'><div class='jobPostingItemTitle'>No Fee</div><div class='jobImportant'>…</div></div></div>
```

Section titles seen (150 postings): staff openings have Org. Setting and
Reporting, Responsibilities, Competencies, Education, Job - Specific
Qualification, Work Experience, Languages, Assessment, Special Notice, United
Nations Considerations, No Fee. Consultancies and internships have Result of
Service, **Work Location**, **Expected duration**, Duties and
Responsibilities, Qualifications/special skills, Languages, Additional
Information, No Fee (internships add Intern Specific text).

The source text has lost its line breaks. Paragraphs survive only as runs of
2–4 spaces, list items as inline `•`. The Languages section of staff openings
embeds a `<style>` block and a `<table class='headtable'>` of required
levels. Stray `‎` marks occur. No HTML entities were seen, but the CLI
decodes them anyway. `parseSections` splits on the item divs; `htmlToText`
rebuilds lines (3+ spaces or 2+ after `.:;!?` → new line, `•` → `- `, table
rows → `a | b`).

## Filter list (for `-l`)

```
GET https://careers.un.org/api/public/opening/jo-filter/list/v2/en
```

About 850 KB. `data.jl.values` (hidden "Job Locations" filter, 441 entries):

```json
{ "name": "Rome", "code": "ROME", "countryName": "Italy",
  "inspiraDutyStations": [ { "code": "2220", "name": "ROME" } ] }
```

The CLI matches a `-l` term against `name`, `code` or `countryName`, and only
if nothing matches, against `inspiraDutyStations[].name`. It sends the
matching entries' `code` as `ds`. Excluded: the `OTHER` entry (`countryName:
"ALL"`), which never matches. Entries with no duty stations (`Turin` and 5
others) are matched but not sent. Placeholder countries `"-"` (Gaza) and
`"ALL"` are not country names. Italy at recon: Rome, Brindisi, Turin (no duty
station).

Other vocabularies in the same response: `aoe`, `jn`, `aoi`, `el`, `ct`, `jf`,
`jt`, `jc`, `dept` (69 offices), `recrtype` (14), `span`.

## Detail

`detail <id>` sends `{"filterConfig": {"keyword": "<id>"}, ...}` to the list
endpoint and accepts only the item whose `jobId` equals the id. Ids must be
1–9 digits, so nothing else reaches the request. Closed postings drop out of
the list, so `detail` on a closed id returns `NOT_FOUND`.

## Public posting URL

```
https://careers.un.org/jobSearchDescription/<jobId>?language=en
```

The app's route is `jobSearchDescription/:id`. `detail` also accepts it without
the query string, and a legacy `?id=<id>` form, from host `careers.un.org`
only. Only the id is kept. Opening this URL in a browser is an ordinary view
of the posting (the page calls the per-job endpoints), which is the point.

## Access

- **robots.txt**: none. `https://careers.un.org/robots.txt` returns 200
  `text/html`, the SPA shell (checked 2026-09-24), so no crawl rules apply.
- **Terms of use**: the portal's footer "Terms of Use" link points to
  `https://www.un.org/{lang}/about-us/terms-of-use`. The in-app `/terms-of-use`
  route loads CMS page `terms-of-use`, which returned `"Page not exist"` for
  `lang=en` and `lang=en-US`. The un.org page (fetched 2026-09-24), clause (a),
  lets users download and copy the site's materials "for the User’s personal,
  non-commercial use", "without any right to resell or redistribute them",
  and without the right to compile or create derivative works from them. It
  has **no clause on automated access, scraping, crawling or robots** (a text
  search for automat, robot, scrap, crawl and spider found nothing). Its other
  rules concern forums and disclaimers.
- **Verdict**: `access: open`, personal non-commercial use only, no
  redistribution. That is recorded in `SKILL.md`.
- **Login**: not required for anything the CLI reads.
- **Load**: one request per `search` or `detail`, plus one filter-list request
  when `-l` is used. Exponential backoff with jitter on 429/5xx (max 6
  retries, 20 s per-attempt timeout).

## If it breaks

1. `PARSE_ERROR ... did not return JSON`: the SPA shell came back, so the
   API path moved. Fetch `https://careers.un.org/`, download the `main-*.js`
   it references, and search it for `opening/jo/list`.
2. Results suddenly ignore a filter (counts equal the whole board): the
   portal renamed a filter key or its values. Compare with
   `GET /api/public/opening/jo-filter/list/v2/en` and the search page's
   `filterConfig` in the bundle.
3. `description` without sections: the `jobPostingItem` markup changed.
   `toJobDetail` falls back to converting the whole HTML, so text still
   comes through. Update `parseSections`.
4. `UNKNOWN_LOCATION` for a real city: check `data.jl.values` for its
   spelling; the vocabulary is the portal's, not the CLI's.
