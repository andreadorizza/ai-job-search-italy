import { afterEach, describe, expect, test } from "bun:test"
import { runSearch, type SearchOpts } from "../src/commands/search.js"
import { runDetail } from "../src/commands/detail.js"
import {
  FILTER_FORM,
  REMOTE_JOB,
  captureStderr,
  captureStdout,
  detailPage,
  html,
  jobObj,
  jobsPage,
  stubFetch,
} from "./fixtures.js"

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

const baseOpts: SearchOpts = { query: "", location: "", remote: false, page: 1, format: "json" }

function errOf(read: () => string): { error: string; code: string } {
  return JSON.parse(read().trim())
}

describe("search JSON output contract", () => {
  test("emits {meta:{count,page,...}, results:[...]}", async () => {
    stubFetch(() => html(jobsPage({ pageLinks: [2, 3, 26, 27], next: true })))
    const out = captureStdout()
    expect(await runSearch(baseOpts)).toBe(0)

    const parsed = JSON.parse(out())
    expect(parsed.meta).toEqual({
      count: 3,
      page: 1,
      perPage: 25,
      pages: 27,
      hasNext: true,
      skipped: 0,
      searchUrl: "https://impactjobs.org/jobs?order=posted_at",
      source: "Impact Jobs (https://impactjobs.org)",
    })
    expect(Array.isArray(parsed.results)).toBe(true)
  })

  test("every result carries the fields /scrape reads, null rather than omitted", async () => {
    stubFetch()
    const out = captureStdout()
    await runSearch(baseOpts)

    const results = JSON.parse(out()).results
    for (const job of results) {
      for (const key of ["id", "title", "company", "location", "date", "url", "remote", "salary", "applyUrl", "description"]) {
        expect(Object.hasOwn(job, key)).toBe(true)
      }
    }
    const remote = results.find((r: { id: string }) => r.id === "658739199")
    expect(remote).toMatchObject({ location: "Remote", remote: true, salary: null, jobType: null })
    expect(results[0].salary).toBe("USD 140,000-150,000 / year")
  })

  test("--limit caps the emitted results", async () => {
    stubFetch()
    const out = captureStdout()
    await runSearch({ ...baseOpts, limit: 2 })
    const parsed = JSON.parse(out())
    expect(parsed.results).toHaveLength(2)
    expect(parsed.meta.count).toBe(2)
  })

  test("a page with no jobs is an empty result, exit 0", async () => {
    stubFetch(() => html(jobsPage({ jobs: [] })))
    const out = captureStdout()
    expect(await runSearch({ ...baseOpts, query: "nothing", page: 9 })).toBe(0)
    const parsed = JSON.parse(out())
    expect(parsed.results).toEqual([])
    expect(parsed.meta.pages).toBeNull()
  })

  test("a malformed job is counted in meta.skipped and the rest are returned", async () => {
    const body = `${JSON.stringify(jobObj())},{"id":7,"title":"x" "broken":1}`
    stubFetch(() => html(jobsPage({ jobs: body })))
    const out = captureStdout()
    expect(await runSearch(baseOpts)).toBe(0)
    const parsed = JSON.parse(out())
    expect(parsed.results).toHaveLength(1)
    expect(parsed.meta.skipped).toBe(1)
  })

  test("table and plain output are readable text", async () => {
    stubFetch()
    const table = captureStdout()
    await runSearch({ ...baseOpts, format: "table" })
    expect(table()).toContain("TITLE")
    expect(table()).toContain("Wikimedia Foundation")
    const plain = captureStdout()
    await runSearch({ ...baseOpts, format: "plain" })
    expect(plain()).toContain("salary: USD 140,000-150,000 / year")
    expect(plain()).toContain("https://impactjobs.org/jobs/658739199-senior-site-reliability-engineer-data-persistence")
  })
})

describe("search request", () => {
  test("one GET to /jobs with every filter, an honest UA, and never /rss/", async () => {
    const calls = stubFetch()
    captureStdout()
    await runSearch({ ...baseOpts, query: "data", location: "New York", remote: true, jobage: 14, page: 2 })
    expect(calls).toHaveLength(1)
    const url = new URL(calls[0]!.url)
    expect(url.pathname).toBe("/jobs")
    expect(url.searchParams.get("filters[12450]")).toBe("data")
    expect(url.searchParams.get("filters[12453]")).toBe("14")
    expect(url.searchParams.get("filters[12454][location]")).toBe("New York")
    expect(url.searchParams.get("filters[12455]")).toBe("1")
    expect(url.searchParams.get("page")).toBe("2")
    expect(calls[0]!.url).not.toContain("/rss")
    const headers = calls[0]!.init!.headers as Record<string, string>
    expect(headers["User-Agent"]).toBe("Mozilla/5.0 (compatible; impactjobs-cli/1.0)")
  })
})

describe("search failure contract", () => {
  test("a renumbered filter exits 1 with FILTERS_CHANGED and nothing on stdout", async () => {
    stubFetch(() => html(jobsPage({ form: FILTER_FORM.replace(/12455/g, "99999") })))
    const out = captureStdout()
    const err = captureStderr()
    expect(await runSearch({ ...baseOpts, remote: true })).toBe(1)
    expect(out()).toBe("")
    expect(errOf(err).code).toBe("FILTERS_CHANGED")
  })

  test("the renumbered filter does not matter when the search does not use it", async () => {
    stubFetch(() => html(jobsPage({ form: FILTER_FORM.replace(/12455/g, "99999") })))
    captureStdout()
    expect(await runSearch({ ...baseOpts, query: "data" })).toBe(0)
  })

  test("a page without the embedded list exits 1 with PARSE_ERROR", async () => {
    stubFetch(() => html(jobsPage({ noList: true })))
    const err = captureStderr()
    captureStdout()
    expect(await runSearch(baseOpts)).toBe(1)
    expect(errOf(err).code).toBe("PARSE_ERROR")
  })

  test("a 403 exits 1 with API_ERROR", async () => {
    stubFetch(() => html("forbidden", 403))
    const err = captureStderr()
    captureStdout()
    expect(await runSearch(baseOpts)).toBe(1)
    expect(errOf(err).code).toBe("API_ERROR")
  })

  test("a 404 on /jobs exits 1 with API_ERROR", async () => {
    stubFetch(() => html("gone", 404))
    const err = captureStderr()
    captureStdout()
    expect(await runSearch(baseOpts)).toBe(1)
    expect(errOf(err).code).toBe("API_ERROR")
  })

  test("a redirect off the board exits 1 with API_ERROR", async () => {
    stubFetch(() => html(jobsPage(), 200, "https://elsewhere.example/jobs"))
    const err = captureStderr()
    captureStdout()
    expect(await runSearch(baseOpts)).toBe(1)
    expect(errOf(err).code).toBe("API_ERROR")
  })
})

describe("detail contract", () => {
  test("a bare id fetches /jobs/<id>-job (the board redirects it) and returns the full record", async () => {
    const calls = stubFetch(() =>
      html(detailPage(), 200, "https://impactjobs.org/jobs/658739199-senior-site-reliability-engineer-data-persistence"),
    )
    const out = captureStdout()
    expect(await runDetail({ id: "658739199", format: "json" })).toBe(0)
    expect(calls.map((c) => c.url)).toEqual(["https://impactjobs.org/jobs/658739199-job"])

    const d = JSON.parse(out())
    expect(d).toMatchObject({
      id: "658739199",
      title: "Senior Site Reliability Engineer, Data Persistence",
      company: "Wikimedia Foundation",
      location: "Remote",
      remote: true,
      jobType: "Full-time", // from the JSON-LD: window.job has no job_type
      status: "active",
      validThrough: "2026-10-02",
      applicantLocation: ["Any"],
      companyWebsite: "wikimediafoundation.org",
      descriptionTruncated: false,
    })
    expect(d.description).toBe("Summary\n\nKeep Wikipedia up.")
    for (const key of ["salary", "category", "companyDescription", "updated"]) expect(Object.hasOwn(d, key)).toBe(true)
  })

  test("a board URL keeps its slug, so there is no redirect", async () => {
    const calls = stubFetch(() => html(detailPage(jobObj())))
    const out = captureStdout()
    expect(
      await runDetail({ id: "https://impactjobs.org/jobs/716264444-cacf-director-of-development-and-communications", format: "plain" }),
    ).toBe(0)
    expect(calls[0]!.url).toBe("https://impactjobs.org/jobs/716264444-cacf-director-of-development-and-communications")
    expect(out()).toContain("Salary:        USD 140,000-150,000 / year")
    expect(out()).toContain("About CACF")
    expect(out()).toContain("- Lead fundraising")
  })

  test("the place comes from the JSON-LD when window.job has none", async () => {
    const ld = {
      "@type": "JobPosting",
      jobLocation: { "@type": "Place", address: { addressLocality: "Denver", addressRegion: "CO", addressCountry: "United States" } },
    }
    stubFetch(() => html(detailPage(jobObj({ location: "" }), ld)))
    const out = captureStdout()
    await runDetail({ id: "716264444", format: "json" })
    expect(JSON.parse(out()).location).toBe("Denver, CO, United States")
  })

  test("a 404 exits 1 with NOT_FOUND", async () => {
    stubFetch(() => html("Not Found", 404))
    const err = captureStderr()
    expect(await runDetail({ id: "123", format: "json" })).toBe(1)
    expect(errOf(err).code).toBe("NOT_FOUND")
  })

  test("a page showing a different job exits 1 with PARSE_ERROR, never the wrong job", async () => {
    stubFetch(() => html(detailPage(REMOTE_JOB)))
    const out = captureStdout()
    const err = captureStderr()
    expect(await runDetail({ id: "716264444", format: "json" })).toBe(1)
    expect(out()).toBe("")
    expect(errOf(err).code).toBe("PARSE_ERROR")
  })

  test("a page without window.job exits 1 with PARSE_ERROR", async () => {
    stubFetch(() => html(jobsPage()))
    const err = captureStderr()
    expect(await runDetail({ id: "716264444", format: "json" })).toBe(1)
    expect(errOf(err).code).toBe("PARSE_ERROR")
  })

  test("a bad id is rejected before any request", async () => {
    const calls = stubFetch()
    const err = captureStderr()
    expect(await runDetail({ id: "https://evil.example/jobs/1-x", format: "json" })).toBe(1)
    expect(errOf(err).code).toBe("BAD_ID")
    expect(calls).toHaveLength(0)
  })
})
