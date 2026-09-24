import { afterEach, describe, expect, test } from "bun:test"
import { runSearch, type SearchOpts } from "../src/commands/search.js"
import { runDetail } from "../src/commands/detail.js"
import { CARD_A, captureStderr, captureStdout, html, listingPage, stubSite } from "./fixtures.js"

// The /scrape contract: `search` emits {meta, results} on stdout with every
// field present (null, never omitted), and failures go to stderr with a code.
// Stubbed offline so the suite passes in CI with no network.

const originalFetch = globalThis.fetch
const originalWrite = process.stdout.write
const originalErrWrite = process.stderr.write

afterEach(() => {
  globalThis.fetch = originalFetch
  process.stdout.write = originalWrite
  process.stderr.write = originalErrWrite
})

const baseOpts: SearchOpts = { query: "dati", page: 1, format: "json" }

describe("search JSON output contract", () => {
  test("emits {meta:{count,page,...}, results:[...]} with attribution", async () => {
    stubSite()
    const out = captureStdout()
    expect(await runSearch(baseOpts)).toBe(0)

    const parsed = JSON.parse(out())
    expect(parsed.meta.count).toBe(2)
    expect(parsed.meta.page).toBe(1)
    expect(parsed.meta.perPage).toBe(20)
    expect(parsed.meta.hasNext).toBe(true)
    expect(parsed.meta.country).toBeNull()
    expect(parsed.meta.attribution.license).toBe("CC BY-NC-SA 4.0")
    expect(parsed.meta.attribution.licenseUrl).toBe("https://creativecommons.org/licenses/by-nc-sa/4.0/deed.it")
    expect(Array.isArray(parsed.results)).toBe(true)
  })

  test("every result carries the fields /scrape reads, plus a source", async () => {
    stubSite()
    const out = captureStdout()
    await runSearch(baseOpts)

    const job = JSON.parse(out()).results[0]
    for (const key of ["id", "title", "company", "location", "date", "url", "source"]) {
      expect(Object.hasOwn(job, key)).toBe(true)
    }
    expect(job.id).toBe("2026/9/ong-esempio-data-officer-italia")
    expect(job.title).toBe("Data & Digital Officer")
    expect(job.company).toBe("ONG ESEMPIO")
    expect(job.location).toBe("Italia")
    expect(job.date).toBeNull() // the listing carries no publication day
    expect(job.publishedMonth).toBe("2026-09")
    expect(job.url).toBe("https://www.info-cooperazione.it/2026/9/ong-esempio-data-officer-italia")
    expect(job.source).toContain("www.info-cooperazione.it")
  })

  test("a missing field is present as null, not omitted", async () => {
    const bare = `<div class="post-block-wrapper post-list-view clearfix">
      <h2 class="post-title title-large"><a href="/2026/9/solo-titolo">Solo titolo</a></h2></div>`
    stubSite({ listing: () => html(listingPage([bare])) })
    const out = captureStdout()
    await runSearch(baseOpts)

    const job = JSON.parse(out()).results[0]
    for (const key of ["roleCategory", "company", "location", "date", "deadline", "contractType", "duration", "summary"]) {
      expect(Object.hasOwn(job, key)).toBe(true)
      expect(job[key]).toBeNull()
    }
    expect(job.title).toBe("Solo titolo")
  })

  test("--limit caps the emitted results", async () => {
    stubSite()
    const out = captureStdout()
    await runSearch({ ...baseOpts, limit: 1 })
    expect(JSON.parse(out()).results).toHaveLength(1)
  })

  test("--jobage drops months wholly before the window", async () => {
    const old = CARD_A.replaceAll("/2026/9/ong-esempio-data-officer-italia", "/2020/1/ong-esempio-vecchio")
    stubSite({ listing: () => html(listingPage([CARD_A, old])) })
    const out = captureStdout()
    await runSearch({ ...baseOpts, jobage: 30 })
    const ids = JSON.parse(out()).results.map((r: { id: string }) => r.id)
    expect(ids).not.toContain("2020/1/ong-esempio-vecchio")
  })

  test("an empty result page is still valid JSON, exit 0", async () => {
    stubSite({ listing: () => html(listingPage([])) })
    const out = captureStdout()
    expect(await runSearch(baseOpts)).toBe(0)
    const parsed = JSON.parse(out())
    expect(parsed.results).toEqual([])
    expect(parsed.meta.hasNext).toBe(false)
  })

  test("table and plain output carry the attribution line", async () => {
    stubSite()
    const out = captureStdout()
    await runSearch({ ...baseOpts, format: "table" })
    expect(out()).toContain("Fonte: www.info-cooperazione.it")
    expect(out()).toContain("CC BY-NC-SA 4.0")
  })
})

describe("search request", () => {
  test("sends the query and page to the jobs category, open postings only", async () => {
    const calls = stubSite()
    captureStdout()
    await runSearch({ ...baseOpts, query: "program manager", page: 3 })

    expect(calls).toHaveLength(1)
    const u = new URL(calls[0]!.url)
    expect(u.hostname).toBe("www.info-cooperazione.it")
    expect(u.pathname).toBe("/Category/Search")
    expect(u.searchParams.get("Cat")).toBe("3")
    expect(u.searchParams.get("s")).toBe("program manager")
    expect(u.searchParams.get("lavoro_non_scaduti")).toBe("True")
    expect(u.searchParams.get("page")).toBe("3")
  })

  test("a country name is resolved through the site's own list, then sent as paese_id", async () => {
    const calls = stubSite()
    const out = captureStdout()
    expect(await runSearch({ ...baseOpts, location: "italia" })).toBe(0)

    expect(calls).toHaveLength(2)
    expect(new URL(calls[0]!.url).searchParams.has("page")).toBe(false) // the country-list lookup
    expect(new URL(calls[1]!.url).searchParams.get("paese_id")).toBe("85")
    expect(JSON.parse(out()).meta.country).toEqual({ id: "85", name: "Italia" })
  })

  test("a numeric paese_id skips the lookup", async () => {
    const calls = stubSite()
    captureStdout()
    await runSearch({ ...baseOpts, location: "87" })
    expect(calls).toHaveLength(1)
    expect(new URL(calls[0]!.url).searchParams.get("paese_id")).toBe("87")
  })
})

describe("search failure contract", () => {
  test("an unknown country exits 1 with BAD_ARG and never runs the search", async () => {
    const calls = stubSite()
    const out = captureStdout()
    const err = captureStderr()
    expect(await runSearch({ ...baseOpts, location: "Atlantide" })).toBe(1)
    expect(out()).toBe("")
    expect(JSON.parse(err().trim()).code).toBe("BAD_ARG")
    expect(calls).toHaveLength(1)
  })

  test("a server error exits 1 with API_ERROR on stderr and nothing on stdout", async () => {
    stubSite({ listing: () => html("nope", 403) })
    const out = captureStdout()
    const err = captureStderr()
    expect(await runSearch(baseOpts)).toBe(1)
    expect(out()).toBe("")
    expect(JSON.parse(err().trim()).code).toBe("API_ERROR")
  })

  test("a missing search page (404) exits 1 with API_ERROR", async () => {
    stubSite({ listing: () => html("", 404) })
    const err = captureStderr()
    captureStdout()
    expect(await runSearch(baseOpts)).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("API_ERROR")
  })
})

describe("detail contract", () => {
  test("returns the posting with its exact date, description and licence", async () => {
    const calls = stubSite()
    const out = captureStdout()
    expect(await runDetail({ id: "2026/9/ong-esempio-data-officer-italia", format: "json" })).toBe(0)

    const d = JSON.parse(out())
    expect(calls[0]!.url).toBe("https://www.info-cooperazione.it/2026/9/ong-esempio-data-officer-italia")
    expect(d.id).toBe("2026/9/ong-esempio-data-officer-italia")
    expect(d.date).toBe("2026-09-08")
    expect(d.applyUrl).toBe("https://jobs.example.org/data-officer")
    expect(d.description).toContain("Gestione del CRM donatori.")
    expect(d.license).toBe("CC BY-NC-SA 4.0")
    for (const key of ["id", "title", "company", "location", "date", "url", "source"]) {
      expect(Object.hasOwn(d, key)).toBe(true)
    }
  })

  test("accepts a site URL and fetches only the rebuilt posting URL", async () => {
    const calls = stubSite()
    const out = captureStdout()
    expect(
      await runDetail({ id: "https://info-cooperazione.it/2026/9/ong-esempio-data-officer-italia?x=1", format: "plain" }),
    ).toBe(0)
    expect(calls[0]!.url).toBe("https://www.info-cooperazione.it/2026/9/ong-esempio-data-officer-italia")
    expect(out()).toContain("Fonte: www.info-cooperazione.it")
  })

  test("a posting that 404s exits 1 with NOT_FOUND", async () => {
    stubSite({ detail: () => html("", 404) })
    const err = captureStderr()
    expect(await runDetail({ id: "2026/9/non-esiste", format: "json" })).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("NOT_FOUND")
  })

  test("a page without a title exits 1 with PARSE_ERROR", async () => {
    stubSite({ detail: () => html("<html><body>redesigned</body></html>") })
    const err = captureStderr()
    expect(await runDetail({ id: "2026/9/x", format: "json" })).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("PARSE_ERROR")
  })

  test("a bad id is rejected before any request", async () => {
    const calls = stubSite()
    const err = captureStderr()
    expect(await runDetail({ id: "https://evil.example/2026/9/x", format: "json" })).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("BAD_ID")
    expect(calls).toHaveLength(0)
  })
})
