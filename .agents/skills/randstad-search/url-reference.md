# Randstad Italia reference

Recorded during `/add-portal` Step 2 by probing the live site. No credentials,
no session cookie, no impersonation. `robots.txt` permits `/offerte-lavoro/`.

## Search URLs are paths, not query strings

Randstad's job search is a Next.js app whose route is
`[locale]/job-search/[[...searchParams]]` — filters are **path segments**:

```
https://www.randstad.it/offerte-lavoro/[<location>/][q-<slug>/][page-<n>/]
```

Verified behaviour:

| URL | Result |
|---|---|
| `/offerte-lavoro/` | 30 vacancies, national |
| `/offerte-lavoro/q-infermiere/` | 30 vacancies, all nursing |
| `/offerte-lavoro/lombardia/q-magazziniere/` | narrower still (11 of 30 shared with the national `q-` set) |
| `/offerte-lavoro/q-magazziniere/page-2/` | 30 more, **zero overlap** with page 1 |
| `/offerte-lavoro/?q=data+engineer` | **silently ignored** — byte-identical to the bare listing |
| `/offerte-lavoro/?keywords=...` | **silently ignored** likewise |

## The silent-widening trap, and how to detect it

An unrecognised segment does **not** 404:

```
/offerte-lavoro/zzz-not-a-region/   ->  HTTP 200, the unfiltered national listing
```

The only in-page evidence of what was actually applied is the canonical link,
which Randstad renders in its own internal vocabulary:

| Requested | `<link rel="canonical">` |
|---|---|
| `lombardia` | `/offerte-lavoro/re-lombardia/` |
| `milano` | `/offerte-lavoro/re-lombardia/ci-milano/` |
| `zzz-not-a-region` | `/offerte-lavoro/` ← no facet: the filter was dropped |

So `helpers.ts` checks the canonical for an `re-`/`ci-`/`pr-` segment when a
location was requested, and for a `q-` segment always, and fails `BAD_ARG`
rather than returning national results. This costs no extra request.

The `<h1>` also carries the result count (`2680 offerte di lavoro lombardia`),
which is used for `meta.total`.

## Vacancy URLs

```
/offerte-lavoro/<title-slug>_<city-slug>_<uuid>/
```

The trailing UUID is the id. Because the slugs are part of the path, **an id
alone cannot be turned back into a URL** — `detail` therefore requires the full
URL and says so explicitly instead of guessing.

## Vacancy data: schema.org/JobPosting

Every vacancy page carries a complete JobPosting block:

```
title, datePosted, validThrough, description, responsibilities, qualifications,
employmentType, industry, directApply, identifier,
hiringOrganization { name, sameAs, logo },
jobLocation { address { addressLocality, addressRegion, postalCode } },
baseSalary { currency: "EUR", value { minValue, maxValue, unitText: "YEAR" } }
```

`baseSalary` in EUR per year **is RAL**, and `validThrough` is a genuine
application deadline — neither is available from EURES.

This markup exists so job aggregators can machine-read postings (it is what
Google for Jobs consumes), which makes it both a legitimate target and a more
stable one than CSS selectors: a redesign rarely breaks it, because breaking it
costs the site its Google for Jobs traffic.

The reader lives in `cli/src/jobposting.ts` and knows nothing about Randstad —
it is the shared core for any future JobPosting-based portal in this fork.
