# ReliefWeb API reference

Recorded during `/add-portal` Step 2 (2026-09-24). Sources: the API docs at
<https://apidoc.reliefweb.int/> (`/parameters`, `/fields-tables`,
`/result-structure`, `/faq`) and the OpenAPI 3.1 spec served at
`https://api.reliefweb.int/v2/swagger/api/api.yml`. Live probes used the
honest UA `Mozilla/5.0 (compatible; reliefweb-cli/1.0)`.

## Access verdict

| Surface | Finding |
|---|---|
| API terms | "Anyone can use the ReliefWeb API." Content belongs to the posting organizations, so respect their IP. ReliefWeb may log calls. |
| appname | **Mandatory, and must be pre-approved since 1 Nov 2025.** Request it via the Google Form linked at `/parameters#appname`. ReliefWeb reviews it and replies by email. Format: "(organization) name, purpose and random characters". Unapproved: `403 AccessDeniedHttpException "You are not using an approved appname..."`. Missing: `400 "Missing appname parameter"`. |
| Quotas | 1000 entries per call, 1000 calls per day. |
| `api.reliefweb.int/robots.txt` | `User-agent: * / Disallow: /`. This is a crawler/indexing opt-out on a host whose only purpose is programmatic access, and the documented terms invite that access with an approved appname. So the skill is recorded as `access: open`. It is **not** a scraper of a site that has said no. |
| `reliefweb.int` (website) | Non-browser UAs get `"The humanitarian website that you requested is not available for scraping."` (HTTP 444 on `/jobs/rss.xml`). `robots.txt` also has `Disallow: /*/rss.xml` and `Disallow: /*&page=*`. **The site and its feeds are not used.** |

## Endpoint

```
POST https://api.reliefweb.int/v2/jobs?appname=<RELIEFWEB_APPNAME>
Content-Type: application/json
```

The appname always goes in the **URL query**, for both GET and POST. That is
why the CLI keeps the URL out of every error message.

### Search body (as built by `buildSearchBody`)

```json
{
  "preset": "latest",
  "limit": 20,
  "offset": 0,
  "fields": { "include": ["id","title","url","url_alias","status","date.created","date.closing",
                          "source.name","source.shortname","country.name","city.name","type.name",
                          "experience.name","career_categories.name","theme.name"] },
  "sort": ["date.created:desc"],
  "query": { "value": "data", "operator": "AND" },
  "filter": { "operator": "AND", "conditions": [
    { "operator": "OR", "conditions": [
      { "field": "country.iso3", "value": ["ITA"], "operator": "OR" },
      { "field": "country", "negate": true } ] },
    { "field": "career_categories.name", "value": ["Information and Communications Technology"], "operator": "OR" },
    { "field": "date.created", "value": { "from": "2026-09-17T12:00:00+00:00" } } ] }
}
```

| CLI flag | API mapping |
|---|---|
| `-q` | `query.value` (Lucene syntax: the CLI escapes `+ - & \| ! ( ) { } [ ] ^ ~ * ? : \ /`, and also `"` when unbalanced), `operator: AND` |
| `-l` names | filter `country.name` (English name, e.g. `Italy`) |
| `-l` ISO3 | filter `country.iso3`, uppercased |
| `--remote` | existence filter `{field: "country", negate: true}`. The spec says `country` is "empty if the job location is unspecified (remote location, roster/roving, location to be determined)". |
| `--category` | filter `career_categories.name` (exact name) or `career_categories.id` |
| `--jobage N` | range filter `date.created >= now - N days` |
| `--page` | `offset = (page-1) * 20`, `limit = 20` |
| `--sort` | `recent` → `date.created:desc`, `relevance` → `score:desc`, `closing` → `date.closing:asc` |
| (always) | `preset: latest` gives open postings only. Expired jobs are only reachable under `preset: analysis`. |

Career category names (ReliefWeb's own per-category job-list pages, found by
web search; not re-read from the API, which needs an approved appname):
Administration/Finance, Advocacy/Communications, Donor Relations/Grants
Management, Human Resources, Information and Communications Technology,
Information Management, Logistics/Procurement, Monitoring and Evaluation,
Program/Project Management. The reference list with ids is at
`GET /v2/references/career-categories?appname=...`. It also needs an appname.

### Response

```json
{ "time": 12, "href": "...", "links": {"self": {...}, "next": {...}},
  "totalCount": 57, "count": 20,
  "data": [ { "id": "4221508", "score": 1, "href": "...",
              "fields": { "id": 4221508, "title": "...", "url": "https://reliefweb.int/node/4221508",
                          "url_alias": "https://reliefweb.int/job/4221508/<slug>", "status": "published",
                          "date": { "created": "2026-07-15T10:09:12+00:00", "changed": "...", "closing": "2026-08-03T00:00:00+00:00" },
                          "source": [{ "name": "...", "shortname": "..." }],
                          "country": [{ "name": "Kenya", "primary": true }],
                          "city": [{ "name": "Nairobi" }],
                          "type": [{ "name": "Job" }], "experience": [{ "name": "10+ years" }],
                          "career_categories": [{ "name": "Program/Project Management" }],
                          "theme": [{ "name": "..." }] } } ] }
```

- References (`source`, `country`, `type`, ...) are **arrays** of `{name, ...}`.
  `source`, `type`, `experience` and `career_categories` have exactly one item.
  `theme` has up to 3.
- Dates are ISO-8601 with an offset. The CLI emits `YYYY-MM-DD`.
- `url_alias` is the human URL. `url` is the permanent `/node/<id>` form.
- Errors: `{"status": 403, "time": 15, "error": {"type": "...", "message": "..."}}`.

## Detail

```json
POST /v2/jobs?appname=...
{ "filter": { "field": "id", "value": 4221508 }, "profile": "full", "preset": "analysis", "limit": 1 }
```

`GET /v2/jobs/{id}` exists, but it is reported to answer 404 for **expired**
jobs (per the open-source `cyanheads/reliefweb-mcp-server` client; not
re-verified here, see "Live observations"). An id-filtered list query under `preset: analysis` reaches open and expired
postings alike, and it is still a single request. `profile: full` adds
`body` / `body-html` and `how_to_apply` / `how_to_apply-html`. The CLI
converts the Markdown versions to plain text (`markdownToText`) and falls
back to the HTML versions.

## Accepted `detail` input

- A numeric id, `4221508`
- `https://reliefweb.int/job/<id>/<slug>`, `https://reliefweb.int/node/<id>`, or
  any `*.reliefweb.int` host with those paths

The id is re-extracted and the request rebuilt from it, so a URL supplied
by the user cannot steer the fetch.

## Live observations

**No approved appname was available when this skill was built**, so no request
has returned real job data yet. The request shapes follow the documentation
and OpenAPI spec above. They are pinned by offline fixture tests, and
`cli/tests/live.test.ts` runs automatically once `RELIEFWEB_APPNAME` is set.

- 2026-09-24: every request with an unapproved appname got `403` within
  about 2-4 s. `GET /v2/references/...` without an appname got `400 Missing appname`.
- 2026-09-24: during a short degraded period, POSTs got a Varnish `503 Backend
  fetch failed` or hung for more than 20 s. Minutes later the same requests
  answered in under 2 s. This is why hung requests are retried (up to 3
  attempts, 20 s each).
