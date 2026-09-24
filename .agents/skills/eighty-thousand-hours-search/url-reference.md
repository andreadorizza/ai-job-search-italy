# 80,000 Hours job board — data source reference

Recorded during `/add-portal` Step 2 (2026-09-24) by reading the board's own
page and probing its search index with a handful of requests. No account, no
session cookie, no impersonation.

## Architecture

`https://jobs.80000hours.org` is a Nuxt (Vue) single-page app. Its HTML holds no
job list. The browser queries an **Algolia** search index directly from the
page, the same way any Algolia InstantSearch site works. The page preconnects to
`https://W6KM1UDIB3-dsn.algolia.net`.

## Where the search key comes from

The board ships its public config to every visitor inline in the landing page,
in `window.__NUXT__.config.public`:

```js
window.__NUXT__.config = { public: {
  apiBase: "https://backend.eawork.org/api",        // newsletter/alerts only; not used here
  algoliaApplicationId: "W6KM1UDIB3",
  algoliaApiKey: "<32 hex chars>",                  // public search-only key
  algoliaJobsIndex: "jobs_prod",                    // default board ordering
  algoliaJobsIndexClosing: "jobs_prod_closing_date",
  algoliaJobsIndexSuperRanked: "jobs_prod_super_ranked",
  algoliaStrictIndex: "jobs_prod_strict",
  algoliaCompaniesIndex: "companies_prod",
  algoliaTagsIndex: "tags_prod",
  ...
}}
```

The key value is **deliberately not recorded here or anywhere in this repo**.
`helpers.ts → loadBoardConfig()` fetches `https://jobs.80000hours.org/` on each
run and extracts `algoliaApplicationId`, `algoliaApiKey` and `algoliaJobsIndex`
with a regex (`parseBoardConfig`). This means:

- a key rotation by the board is picked up automatically;
- a public repo never carries an Algolia-shaped key string (which would trip
  GitHub secret scanning and could alert the key's owner for no reason);
- each value is shape-checked before use. The app id becomes part of a
  hostname, so it must match `^[A-Z0-9]{6,20}$`, and the index name must match
  `^[A-Za-z0-9_-]{1,64}$`.

**The key is search-only.** Algolia's own key-introspection endpoint
(`GET /1/keys/<key>` with the key itself) returned `acl: ["search"]`, with no
index restriction, no referer restriction and no per-IP rate cap. It cannot
write, browse or read settings. This is the key the board intends every browser
to use.

## Search

```
POST https://<appId>-dsn.algolia.net/1/indexes/<jobsIndex>/query
X-Algolia-Application-Id: <appId>
X-Algolia-API-Key: <key>
Content-Type: application/json
```

Body sent by the CLI (`buildSearchParams`):

```json
{
  "analytics": false,
  "attributesToHighlight": [], "attributesToSnippet": [],
  "query": "machine learning",
  "page": 0,
  "hitsPerPage": 20,
  "facetFilters": [["tags_location_80k:Remote, Global", "tags_location_80k:Europe (ex UK)"],
                   ["tags_location_type:Remote"]],
  "numericFilters": ["posted_at>=1789000000"],
  "attributesToRetrieve": ["objectID", "post_pk", "title", "company_name", "..."]
}
```

| CLI flag | Algolia parameter | Notes |
|---|---|---|
| `-q` | `query` | Empty string browses everything. |
| `-l` | `facetFilters` on `tags_location_80k` | Values OR'ed inside one inner array. **Case-insensitive** (verified: `remote, global` and `Remote, Global` both gave 173 hits). A leading `-` would negate, so the CLI escapes it. |
| `--remote` | `facetFilters` `tags_location_type:Remote` | Only value of that facet. 258 of 969 roles at recon. |
| `--jobage` | `numericFilters` `posted_at>=<epoch s>` | Verified to filter server-side. |
| `--page` | `page` | Algolia is 0-indexed; CLI is 1-indexed. |
| — | `hitsPerPage` | Fixed at 20. |
| — | `analytics: false` | Keeps CLI queries out of the board's search analytics. |

**Ordering.** `jobs_prod` returns newest-first for an empty query. The other
indexes are replicas with different ranking (closing date, "super ranked").

**Pagination limit.** Algolia's default `paginationLimitedTo` is 1000. The whole
board was 969 roles at recon, so this never binds.

### Facet vocabularies (at recon, 2026-09-24)

- `tags_location_80k` (146 values): regions (`Remote, Global` 173,
  `Global` 195, `Remote, USA` 72, `Europe (ex UK)` 62, `Remote, UK` 15,
  `Europe` 9, `Remote, Europe` 4, ...) plus cities (`London, UK`,
  `Amsterdam, Netherlands`, ...). No `Italy` tag.
- `tags_country` (51): `USA`, `Remote, Global`, `UK`, `Europe (ex UK)`, ...
- `tags_area` (11): `AI safety & policy` 632, `Other policy-focused`,
  `Biosecurity & pandemic preparedness`, `Technical`,
  `Global health & development`, `Building effective altruism`,
  `Animal welfare`, `Nuclear security`, `Macrostrategy`, `Climate change`,
  `Career development`.
- `tags_skill` (13): `Research`, `Software engineering` 246, `Operations`,
  `Policy`, `Information security`, `Strategy`, `Management`, ...
- `tags_role_type` (8): `Full-time` 709, `Fellowship`, `Internship`,
  `Part-time`, `Funding`, `Volunteering`, `Course`, `Other`.

### Response

```json
{ "hits": [ ... ], "nbHits": 61, "page": 0, "nbPages": 4, "hitsPerPage": 20, ... }
```

Per hit, the fields the CLI uses:

| Field | Type | Maps to |
|---|---|---|
| `objectID` / `post_pk` | `"21083"` / `21083` | `id` (identical at recon) |
| `title` | string | `title` |
| `company_name` | string | `company` |
| `card_locations` | string[] | `location` (joined `; `), falling back to `tags_location_80k` |
| `tags_location_80k` | string[] | `locations` (detail) |
| `tags_location_type` | `["Remote"]` or `[]` | `remote` |
| `posted_at` | epoch **seconds** | `date` |
| `closes_at` | epoch seconds or `null` | `deadline` (`null` = rolling) |
| `updated_at` | epoch seconds | `updated` (detail) |
| `url_external` | employer URL with `utm_source=80000hours` | `applyUrl` |
| `salary` | free text, `""` when absent | `salary` |
| `tags_area`, `tags_skill`, `tags_role_type`, `tags_exp_required`, `tags_degree_required` | string[] | `areas`, `skills`, `roleTypes`, `experience`, `degree` |
| `description` | HTML, **empty on every hit seen** | `description` if non-empty |
| `description_short` | HTML `<ul><li>` summary, about 500 chars | `description` fallback |
| `company_url`, `company_description` | string, HTML | `companyUrl`, `companyDescription` (detail) |

Fields present but unused: `salary_type`, `salary_limit`, `experience_min/avg`,
`repost`, `evergreen`, `highlighted`, `daily_ranking`, `super_ranked_score`,
`visas` (e.g. `["not us", "not uk"]`, semantics undocumented),
`id_external_80_000_hours` (Airtable record id), `company_logo_url`.

## Detail

There is no per-job endpoint, and the job URL renders client-side. When the
board is opened on `?jobPk=<id>`, its page runs one search with
`filters: "objectID:<id>"` and shows the first hit. `detail` does the same:

```json
{ "query": "", "filters": "objectID:20437", "hitsPerPage": 1, "attributesToRetrieve": [ ... ] }
```

The CLI then accepts the hit only if its `objectID` equals the requested id.
Input ids must be digits (`^\d{1,12}$`), so nothing else can be injected into
the filter string.

## Public job URL

```
https://jobs.80000hours.org/jobs?jobPk=<id>
```

Verified 200. The board's router also rewrites `/?jobPk=<id>` to `/jobs?jobPk=<id>`
client-side, and `detail` accepts both. URLs are accepted only from host
`jobs.80000hours.org`, and only the numeric id is kept.

## Access

- **robots.txt** (`https://jobs.80000hours.org/robots.txt`): `User-agent: *` with
  an empty `Disallow:`, so everything is allowed.
- **Terms of use** (`https://80000hours.org/terms-of-use/`, "Last Updated:
  March 2025", linked from the board footer): no clause on scraping, crawling
  or automated access. Relevant limits: use must be "personal, non-commercial";
  do not "overburden" their or their providers' servers; do not "interfere with
  or circumvent the security features". The CLI reads only what the board
  sends every browser and uses the key exactly as the board does, so it
  circumvents nothing. Two requests per call keeps the load at human level.
- **Login**: not required for anything the CLI reads.
- The CLI identifies itself as `Mozilla/5.0 (compatible; 80000hours-search-cli/1.0)`
  and backs off exponentially with jitter on 429/5xx (max 6 retries, 15 s
  per-attempt timeout).

## If it breaks

1. `CONFIG_NOT_FOUND`: fetch `https://jobs.80000hours.org/` and search for
   `algolia` in the HTML. If the config moved into `/_payload.json` or a JS
   chunk under `/_nuxt/`, point `loadBoardConfig` there.
2. `API_ERROR ... rejected the board's public search key`: the key was
   restricted, for example by referer. Stop, don't work around it, and
   re-check the terms.
3. Empty `description`: check whether `description_short` was renamed. Query
   one hit without `attributesToRetrieve` to see every field.
