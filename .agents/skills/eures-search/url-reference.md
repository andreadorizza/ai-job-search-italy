# EURES API reference

Recorded during `/add-portal` Step 2 by probing the live API and reading the
portal's own request shape. No credentials, no session cookie, no impersonation.

## Search

```
POST https://europa.eu/eures/api/jv-searchengine/public/jv-search/search
Content-Type: application/json
```

The endpoint validates the **whole body** against an enum-checked schema and
answers `400 {"key":"invalid-json","message":"The provided JSON is not correct"}`
on any mismatch — including a *missing* field, not just a wrong one. Send every
key below, empty arrays included:

```json
{
  "resultsPerPage": 20,
  "page": 1,
  "sortSearch": "MOST_RECENT",
  "keywords": [{ "keyword": "data engineer", "specificSearchCode": "EVERYWHERE" }],
  "publicationPeriod": null,
  "occupationUris": [], "skillUris": [], "requiredExperienceCodes": [],
  "positionScheduleCodes": [], "sectorCodes": [],
  "educationAndQualificationLevelCodes": [], "positionOfferingCodes": [],
  "locationCodes": ["it"],
  "euresFlagCodes": [], "otherBenefitsCodes": [], "requiredLanguages": [],
  "minNumberPost": null,
  "sessionId": "eures-search-cli",
  "requestLanguage": "en"
}
```

Gotchas found the hard way:

- `euresFlagCodes` — plural, an array. `euresFlag` (boolean) is rejected.
- `sessionId` and `requestLanguage` are **required**; omitting either yields the
  same opaque `invalid-json` as a malformed body.
- `specificSearchCode` accepts a fixed enum. `EVERYWHERE` works; `ID`, `JV_ID`
  and `REFERENCE` are all rejected.
- `sortSearch`: `MOST_RECENT` and `BEST_MATCH`.
- `locationCodes` takes lowercase country codes (`it`) and NUTS codes (`ITC4`).
  An empty array searches all participating countries.

### Response

```json
{ "numberRecords": 1051, "jvs": [ … ], "facets": { … } }
```

Each `jvs` entry: `id`, `title`, `description`, `creationDate`,
`lastModificationDate`, `numberOfPosts`, `locationMap`, `euresFlag`,
`jobCategoriesCodes`, `positionScheduleCodes`, `positionOfferingCode`,
`employer` (`name`, `legalID`, `website`, …), `availableLanguages`, `score`,
`translationType`, `translations`.

- **Dates are epoch milliseconds.**
- **`locationMap`** is `{"IT": ["ITH54"]}` — country to NUTS-3 codes. The first
  four characters of a NUTS-3 code are its NUTS-2 parent, which is how
  `helpers.ts` resolves `ITH54` to "Emilia-Romagna" from a 21-entry table
  instead of enumerating every province.
- **`id` is base64 of `"<number> <number>"`** — so it contains a **space** and
  must be percent-encoded in any URL.
- **`title` is an ESCO occupation label**, not the employer's title, and the
  mapping is frequently loose. See the caveat in `SKILL.md`.

## Detail

**There is no per-vacancy REST endpoint.** Every plausible path returns 404:

```
/jv-searchengine/public/jv-search/detail/<id>      404
/jv-searchengine/public/jv-details/<id>            404
/jv-searchengine/public/getJvDetails(/<id>)        404   (GET and POST)
/jv-searchengine/public/jv/<id>                    404
/jv-searchengine/public/permanent-jv/<id>          404
```

The public vacancy page returns 200 but is an Angular SPA shell — its HTML
contains no vacancy content at all (`<title>` is even empty), so parsing it is
not an option either.

None of that matters, because **search already returns the complete record**,
description included, and searching for a vacancy's own base64 id with
`specificSearchCode: EVERYWHERE` matches exactly that vacancy:

```bash
# keyword = the id itself -> numberRecords: 1
curl -s -X POST .../jv-search/search -d '{… "keywords":[{"keyword":"OTkyMTM2IDE3","specificSearchCode":"EVERYWHERE"}] …}'
```

So `detail` costs one request, the same as a dedicated endpoint would have.

## Public vacancy URL

```
https://europa.eu/eures/portal/jv-se/jv-details/<percent-encoded id>?lang=en
```

This is the only URL shape `detail` accepts as input, and the host must be
`europa.eu` or a subdomain. The id is re-extracted from it and the request
rebuilt from the id, so a supplied URL can never steer the fetch.

## Access

`robots.txt` permits `https://europa.eu/eures/`. EURES is an official EU public
service publishing open data; there is no ToS restriction on programmatic
reading. The CLI still backs off on 429/5xx and identifies itself honestly as
`Mozilla/5.0 (compatible; eures-search-cli/1.0)`.
