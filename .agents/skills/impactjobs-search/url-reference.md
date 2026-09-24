# Impact Jobs — data source reference

Recorded during `/add-portal` Step 2 (2026-09-24). About 25 requests to
impactjobs.org, each at least 1 second apart: `robots.txt`, the home page,
`/jobs` with each filter, two pages of remote results, three job pages, the
FAQ and contact pages, and seven guessed terms/privacy URLs (all 404). No
account, no session cookie, no impersonation.

## Platform

`https://impactjobs.org` is a **JBoard** board (hosted job-board SaaS,
`app.jboard.io`), run by Green Jobs Network ("A service of Green Jobs Network,
serving job seekers and employers since 2008"). Every page carries
`window.$jBoard = {"team":{"id":3046,"name":"Impact Jobs","slug":"impactjobs","domain":"impactjobs.org"}, ...}`.

Pages are Laravel-rendered HTML (`server: Caddy`, `cache-control: no-store`).
Each response sets `XSRF-TOKEN` and `jboard_tenant_session` cookies. The CLI
ignores them: nothing it reads needs a session. JBoard labels visitors
(`window.$actingVisitorIsBot`). With the CLI's honest User-Agent it was `false`,
and the pages were identical to a browser's.

At recon the board held 292 pages of 25 jobs (about 7,300; the page's own meta
description says "more than 10,000"). The remote filter gave 27 pages (about
650 jobs), 6 pages of them posted in the last 30 days.

## Search

```
GET https://impactjobs.org/jobs?filters%5B12450%5D=<text>&filters%5B12453%5D=<days>
    &filters%5B12454%5D%5Blocation%5D=<place>&filters%5B12455%5D=1&order=posted_at&page=<n>
```

The parameters are the fields of the page's own filter form
(`<form action="/jobs" class="filter-form" method="get">`):

| Form field | Element id (the CLI's guard marker) | CLI flag | Notes |
|---|---|---|---|
| `filters[12450]` text "Skill, employer, tag ..." | `text_search_filter_12450` | `-q` | Matched against **title, employer and tags only**, not the description: `-q python --remote` gave 0 results while remote descriptions mention Python. Word-like: `AI` matched "Transformative AI" but not "Chair". |
| `filters[12451]` category `<select>` | `job_category_filter_12451` | — | Not exposed: 6 of 151 jobs seen carried a category. Values: 93177 Children & Youth, 93184 Civil Rights, 93180 Community & Economic Development, 93186 Environment & Climate Change, 93175 Education, 93181 Food / Hunger / Agriculture, 93176 Health & Wellness, 93179 Homelessness, 93178 Housing, 93182 Immigration, 93188 International Development, 93187 Law & Justice, 93183 Philanthropy, 93185 Social Entrepreneurship, 241143 Social Services & Public Benefits, 93189 Technology, 177688 Transportation, 113048 Fair Trade, 116971 Humanitarian Aid, 177689 Veterans, 177690 Workforce Development. |
| `filters[12452]` job type `<select>` | `job_type_filter_12452` | — | Not exposed. 13377 Full-time, 13378 Part-time, 13379 Contract, 13380 Internship, 35079 Temporary, 26909 Volunteer, and 13 more. |
| `filters[12453]` "Posted At" `<select>` | `date_filter_12453` | `--jobage` | The form offers 1, 3, 7, 14, 30, but **any whole number works server-side**: 7 gave 2 jobs, 10 gave 9, 14 gave 12, and every date fell inside the window. A non-listed value is not echoed back as selected. |
| `filters[12454][location]` free text | `location_filter_12454` | `-l` | Echoed back as `value="New York"`. Matched loosely by the board: `New York` gave 22 pages of New York City, Brooklyn and Bronx jobs, but `Italy` gave Naples FL, Naples (USO) and Fiji. Useful for US places only. |
| `filters[12454][location_id]` hidden | — | — | Filled by the browser's place autocomplete. Not needed: the text alone filters. |
| `filters[12454][search_radius]` | — | — | Miles, default 25. Not exposed. |
| `filters[12455]` checkbox "Only remote jobs" | `checkbox_filter_12455` | `--remote` | Value `1`. Echoed back `checked="checked"`. Every result had `remote: true`. |
| `order` | — | (fixed) | `posted_at` (newest first) or `relevance` (the default). The CLI always sends `posted_at`. |
| `page` | — | `--page` | 1-indexed, 25 per page, fixed. |

**The numbers are this board's filter ids.** They are JBoard database ids, not a
platform constant. If the board's owner rebuilds the filter form, they change,
and the board silently ignores unknown `filters[...]` keys, so a search would
come back unfiltered. The CLI guards against that: after each search it checks
that the response still renders the element id of every filter it sent (column
2), and fails with `FILTERS_CHANGED` if one is missing.

### Pagination

A `<nav>` pager with `?page=N` links (`&amp;`-escaped). It always links the
first pages, the current window and the **last two pages**, so the highest
page number linked is the page count. `<link rel="next">` in `<head>` (and a
`rel="next"` pager anchor) means there is another page. With 25 or fewer
results there is no pager. An empty result renders `concat([])`.

There is no total count anywhere on the page. `meta.pages` is the page count
from the pager, `meta.hasNext` the next link.

### Response: the embedded job list

Inside `<div class="container">`, before `<section id="job-listings">`:

```html
<script>
    window.jobsList = window.jobsList || [];
    window.jobsList = window.jobsList.concat([{"id":716264444,"title":"CACF - Director of ...",
        "description":"<br \/><img ...", ...}, ...]);
    window.employerDefaultLogo = "https:\/\/jboard-tenant.s3.us-west-1.amazonaws.com\/default\/employers\/no-logo.png";
</script>
```

The JSON escapes `<`, `>` and `/` (`<`, `\/`), so it cannot close the
`<script>` early. The home page embeds 50 jobs, `/jobs` 25 per page. A job
page embeds its 10 related jobs the same way.

The cards below it (`<div data-jobId="716264444">`, `<h3>` title, employer
link, job-type link, location link) duplicate the same data. The CLI does not
parse them.

**Parsing.** `extractJobChunks` finds every `window.jobsList = window.jobsList.concat([`
and walks the array with a string-aware bracket scanner (`splitJsonArray`),
cutting it into one source string per top-level object. Each chunk is
`JSON.parse`d and mapped on its own (`parseJobs`). A chunk that fails to parse,
or has no numeric id or title, is counted in `meta.skipped` and the rest are
kept. The one failure it cannot contain is a broken bracket that swallows the
jobs after it, which a JSON-escaped server payload does not produce.

### Per-job fields

| JSON field | Example | Maps to |
|---|---|---|
| `id` | `716264444` | `id` (string). Must be 1-12 digits or the job is skipped. |
| `title` | `"CACF - Director of Development and Communications"` | `title` |
| `employer.name` | `"NRG Consulting Group"` | `company` |
| `employer.website`, `employer.description` | `"wikimediafoundation.org"`, HTML | `companyWebsite`, `companyDescription` (detail) |
| `location` | `"New York, NY"`, often `""` for remote jobs | `location` |
| `job_location.name` | `"New York, New York, United States"` (list pages only) | `location` fallback |
| `remote` | `true` / `false` | `remote` (and `location: "Remote"` when there is no place) |
| `posted_at` | `"2026-09-21T00:00:00.000000Z"` (microseconds) | `date` (YYYY-MM-DD), `posted` (ISO). Cut to milliseconds before parsing. |
| `job_details_path` | `"/jobs/716264444-cacf-director-of-development-and-communications"` | `url` |
| `apply_by`, `apply_to` | `"by_link"`, employer ATS URL | `applyUrl` (http(s) only; `by_link` on all 151 seen) |
| `min_compensation`, `max_compensation` | `"140000.00"` or `null` | `salaryMin`, `salaryMax`, `salary` ("USD 140,000-150,000 / year"). Set on 1 of 151 jobs seen. |
| `compensation_currency`, `compensation_time_frame` | `"usd"`, `"annually"` | `salaryCurrency`, `salaryPeriod`. Defaults present on every job, so reported only next to an amount. |
| `job_type.title` | `"Full-time"` (list pages only) | `jobType` |
| `category.name` | `"Education"` | `category` |
| `tags` | `[]` on every job seen | `tags` (names) |
| `description` | HTML, the **full posting** | `description`: search keeps a 500-character text excerpt (`descriptionTruncated: true`), detail keeps all of it |
| `status` | `"active"` | `status` (detail) |
| `updated_at` | ISO | `updated` (detail) |

Present but unused: `category_id`, `employer_id`, `product_id`,
`employer_product_id`, `draft`, `confirmation_status`, `location_id`,
`country_id`, `region_id`, `featured`, `pin_to_top`, `job_expires_in_days`,
`job_type_id`, `product_not_purchased`, `apply_through_reg_wall`,
`employer.logo`, `employer.cover_image`.

## Detail

```
GET https://impactjobs.org/jobs/<id>-<slug>
```

- `/jobs/<id>` with no slug is a **404**. `/jobs/<id>-<anything>` answers
  **301** to the canonical slug. So `detail <id>` requests `/jobs/<id>-job` and
  follows the redirect, and `detail <url>` uses the URL's own slug. Only the id
  and slug are kept from a supplied URL, and only hosts `impactjobs.org` and
  `www.impactjobs.org` are accepted.
- The page embeds the job as `window.job =  {...} ;`. It has the same fields
  as a list row except `job_type`, `job_location` and `category`. The CLI
  checks that its `id` equals the requested id. It never reports a different
  job.
- A `<script type="application/ld+json">` **JobPosting** block adds
  `validThrough` (posting date + listing period, e.g. 30 days), `employmentType`
  (`FULL_TIME`), `jobLocation.address` (`addressLocality`, `addressRegion`,
  `addressCountry`), `jobLocationType: "TELECOMMUTE"` for remote jobs,
  `applicantLocationRequirements` (`{"@type":"Country","name":"Any"}` on the
  remote job seen) and `baseSalary`. The CLI uses these as `validThrough`,
  `applicantLocation`, and fallbacks for `jobType`, `location` and `remote`.
- A removed job answers 404 (`NOT_FOUND`).

## Access

- **robots.txt** (`https://impactjobs.org/robots.txt`), in full:
  ```
  User-agent: *
  Disallow: /rss/
  Crawl-delay: 1
  Sitemap: https://impactjobs.org/sitemap.xml
  ```
  `/jobs` and `/jobs/<id>-<slug>` are allowed. The CLI never requests `/rss/`
  (the RSS feed the footer links to), and waits at least 1 second between
  requests, across CLI runs too (a timestamp file in the OS temp directory).
- **Terms: none published.** The footer links only "RSS", "Jobs" and
  "Contact Us". `/terms`, `/terms-of-service`, `/terms-and-conditions`,
  `/privacy`, `/privacy-policy`, `/tos` and `/legal` all return 404. The FAQ
  covers posting prices and listing length, nothing on use. The operator's site
  (`greenjobs.net`, "Green Jobs Network is a service of Green Economy Media")
  links no terms either.
- **JBoard's own terms** (`https://jboard.io/terms`, last updated August 08,
  2021) define "Website refers to https://jboard.io". They govern JBoard's own
  site and its paying board owners, not visitors to boards it hosts. They
  contain no clause on scraping, crawling or automated access anyway.
- **Login**: not required for anything the CLI reads.
- The CLI identifies itself as `Mozilla/5.0 (compatible; impactjobs-cli/1.0)`,
  makes **one request per call**, and backs off exponentially with jitter on
  429/5xx (from 1 s, capped at 16 s, max 6 retries, honouring `Retry-After`,
  20 s per-attempt timeout).

Verdict: `access: open`. Nothing prohibits automated access. Keep it personal
and low volume anyway.

## Same platform elsewhere

**theimpactjob.com** (`https://www.theimpactjob.com/`) is also a JBoard board
(`window.$jBoard.team` = id 12937, "The Impact Job"), and its home page embeds
the same `window.jobsList` JSON. The parser in `helpers.ts` should read it
as-is. Its filter ids are its own, though: `FILTERS` and `ORIGIN` would need
that board's values from its `/jobs` form, and its robots.txt and terms need
their own check. It is **not** covered by this skill.

## If it breaks

1. `PARSE_ERROR ... no longer embeds window.jobsList`: fetch
   `https://impactjobs.org/jobs` and search the HTML for `jobsList`. If JBoard
   moved the data (for example into a JSON endpoint the page fetches), point
   `extractJobChunks` there. Do not fall back to `/rss/`: robots.txt disallows it.
2. `FILTERS_CHANGED`: open `https://impactjobs.org/jobs`, read the
   `<form action="/jobs" class="filter-form">` field names and element ids,
   and update `FILTERS` in `helpers.ts` and the table above.
3. `detail` 404s on every id: check whether `/jobs/<id>-<anything>` still
   redirects to the canonical slug. If not, `detail <url>` with the full job
   URL still works.
4. Titles fine but `company` null everywhere: check whether `employer` was
   renamed in the embedded JSON.
