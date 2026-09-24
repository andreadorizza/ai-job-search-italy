import { afterEach, describe, expect, test } from "bun:test"
import { runSearch, type SearchOpts } from "../src/commands/search.js"
import { runDetail } from "../src/commands/detail.js"
import { FAKE_APP_ID, FAKE_KEY, HIT, captureStderr, captureStdout, json, stubBoard } from "./fixtures.js"

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

const baseOpts: SearchOpts = {
  query: "machine learning",
  locations: [],
  remote: false,
  page: 1,
  format: "json",
}

describe("search JSON output contract", () => {
  test("emits {meta:{count,page,...}, results:[...]}", async () => {
    stubBoard()
    const out = captureStdout()
    expect(await runSearch(baseOpts)).toBe(0)

    const parsed = JSON.parse(out())
    expect(parsed.meta).toEqual({ count: 1, page: 1, perPage: 20, total: 61, pages: 4 })
    expect(Array.isArray(parsed.results)).toBe(true)
  })

  test("every result carries the fields /scrape reads", async () => {
    stubBoard()
    const out = captureStdout()
    await runSearch(baseOpts)

    const job = JSON.parse(out()).results[0]
    for (const key of ["id", "title", "company", "location", "date", "url"]) {
      expect(Object.hasOwn(job, key)).toBe(true)
    }
    expect(job.id).toBe("20437")
    expect(job.company).toBe("Gray Swan")
    expect(job.location).toBe("Pittsburgh, PA; Remote, Global")
    expect(job.remote).toBe(true)
    expect(job.date).toBe("2026-08-03")
    expect(job.url).toBe("https://jobs.80000hours.org/jobs?jobPk=20437")
    expect(job.description).toBe("- Design and deploy ML models & evals.\n- Lead adversarial testing.")
  })

  test("a null field is present as null, not omitted", async () => {
    stubBoard({ algolia: () => json({ nbHits: 1, hits: [{ objectID: "7", title: "Researcher" }] }) })
    const out = captureStdout()
    await runSearch(baseOpts)

    const job = JSON.parse(out()).results[0]
    for (const key of ["company", "location", "date", "deadline", "applyUrl", "salary", "description"]) {
      expect(Object.hasOwn(job, key)).toBe(true)
      expect(job[key]).toBeNull()
    }
    expect(job.areas).toEqual([])
    expect(job.remote).toBe(false)
  })

  test("one malformed record is skipped, not fatal for the batch", async () => {
    stubBoard({ algolia: () => json({ nbHits: 3, hits: [{ objectID: "1" }, { title: "no id" }, HIT] }) })
    const out = captureStdout()
    expect(await runSearch(baseOpts)).toBe(0)
    expect(JSON.parse(out()).results).toHaveLength(1)
  })

  test("--limit caps the emitted results", async () => {
    stubBoard({ algolia: () => json({ nbHits: 3, hits: [HIT, { ...HIT, objectID: "2" }, { ...HIT, objectID: "3" }] }) })
    const out = captureStdout()
    await runSearch({ ...baseOpts, limit: 2 })
    expect(JSON.parse(out()).results).toHaveLength(2)
  })

  test("an empty result set is still valid JSON, exit 0", async () => {
    stubBoard({ algolia: () => json({ nbHits: 0, nbPages: 0, hits: [] }) })
    const out = captureStdout()
    expect(await runSearch(baseOpts)).toBe(0)
    expect(JSON.parse(out()).results).toEqual([])
  })
})

describe("search request", () => {
  test("reads the key from the board page and sends it to the right index", async () => {
    const calls = stubBoard()
    captureStdout()
    await runSearch({ ...baseOpts, locations: ["Remote, Global"], remote: true, jobage: 7, page: 2 })

    expect(calls).toHaveLength(2)
    expect(calls[0]!.url).toBe("https://jobs.80000hours.org/")
    expect(calls[1]!.url).toBe(`https://${FAKE_APP_ID}-dsn.algolia.net/1/indexes/jobs_prod/query`)
    const headers = calls[1]!.init!.headers as Record<string, string>
    expect(headers["X-Algolia-Application-Id"]).toBe(FAKE_APP_ID)
    expect(headers["X-Algolia-API-Key"]).toBe(FAKE_KEY)

    const body = JSON.parse(String(calls[1]!.init!.body))
    expect(body.query).toBe("machine learning")
    expect(body.page).toBe(1) // Algolia is 0-indexed
    expect(body.hitsPerPage).toBe(20)
    expect(body.facetFilters).toEqual([["tags_location_80k:Remote, Global"], ["tags_location_type:Remote"]])
    expect(body.numericFilters[0]).toMatch(/^posted_at>=\d+$/)
    expect(body.analytics).toBe(false)
  })
})

describe("search failure contract", () => {
  test("a rejected key exits 1 with API_ERROR on stderr and nothing on stdout", async () => {
    stubBoard({ algolia: () => json({ message: "Invalid API key" }, 403) })
    const out = captureStdout()
    const err = captureStderr()
    expect(await runSearch(baseOpts)).toBe(1)
    expect(out()).toBe("")
    const e = JSON.parse(err().trim())
    expect(e.code).toBe("API_ERROR")
    expect(e.error).toContain("rejected")
  })

  test("a board page without the search config exits 1 with CONFIG_NOT_FOUND", async () => {
    const calls = stubBoard({ html: () => new Response("<html>redesigned</html>", { status: 200 }) })
    const err = captureStderr()
    captureStdout()
    expect(await runSearch(baseOpts)).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("CONFIG_NOT_FOUND")
    expect(calls).toHaveLength(1) // never queried the index without a key
  })
})

describe("detail contract", () => {
  test("returns the matching job with its detail-only fields", async () => {
    const calls = stubBoard({ algolia: () => json({ nbHits: 1, hits: [HIT] }) })
    const out = captureStdout()
    expect(await runDetail({ id: "20437", format: "json" })).toBe(0)

    const d = JSON.parse(out())
    expect(d.id).toBe("20437")
    expect(d.companyUrl).toBe("https://www.grayswan.ai/")
    expect(d.companyDescription).toBe("Gray Swan is an AI security company.")
    expect(d.degree).toEqual(["Undergraduate degree or less"])
    expect(d.locations).toContain("USA")
    expect(JSON.parse(String(calls[1]!.init!.body)).filters).toBe("objectID:20437")
  })

  test("accepts a board URL and looks up only its id", async () => {
    const calls = stubBoard({ algolia: () => json({ nbHits: 1, hits: [HIT] }) })
    captureStdout()
    expect(await runDetail({ id: "https://jobs.80000hours.org/?jobPk=20437", format: "plain" })).toBe(0)
    expect(JSON.parse(String(calls[1]!.init!.body)).filters).toBe("objectID:20437")
  })

  test("an id the index does not return exits 1 with NOT_FOUND", async () => {
    stubBoard({ algolia: () => json({ nbHits: 0, hits: [] }) })
    const err = captureStderr()
    expect(await runDetail({ id: "999999", format: "json" })).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("NOT_FOUND")
  })

  test("a different record is never returned as a match", async () => {
    stubBoard({ algolia: () => json({ nbHits: 1, hits: [HIT] }) })
    const err = captureStderr()
    expect(await runDetail({ id: "1234", format: "json" })).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("NOT_FOUND")
  })

  test("a bad id is rejected before any request", async () => {
    const calls = stubBoard()
    const err = captureStderr()
    expect(await runDetail({ id: "https://evil.example/?jobPk=1", format: "json" })).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("BAD_ID")
    expect(calls).toHaveLength(0)
  })
})
