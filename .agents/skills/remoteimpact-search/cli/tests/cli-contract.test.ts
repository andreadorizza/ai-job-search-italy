import { afterEach, describe, expect, test } from "bun:test"
import { runSearch, type SearchOpts } from "../src/commands/search.js"
import { runDetail } from "../src/commands/detail.js"
import {
  CLIMATE_ITEM,
  ML_ITEM,
  NOW_MS,
  OLD_ITEM,
  captureStderr,
  captureStdout,
  feedXml,
  rss,
  stubFeeds,
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

const baseOpts: SearchOpts = { query: "", categories: [], page: 1, format: "json", nowMs: NOW_MS }

const AI_FEED = "https://remoteimpact.org/feed/jobs/category/ai-safety/"
const TECH_FEED = "https://remoteimpact.org/feed/jobs/category/technology/"

describe("search JSON output contract", () => {
  test("emits {meta:{count,page,...}, results:[...]} with attribution", async () => {
    stubFeeds()
    const out = captureStdout()
    expect(await runSearch(baseOpts)).toBe(0)

    const parsed = JSON.parse(out())
    expect(parsed.meta.count).toBe(3)
    expect(parsed.meta.page).toBe(1)
    expect(parsed.meta.total).toBe(3)
    expect(parsed.meta.pages).toBe(1)
    expect(parsed.meta.scanned).toBe(3)
    expect(parsed.meta.coverage).toEqual({ from: "2026-08-24", to: "2026-09-23" })
    expect(parsed.meta.feeds).toEqual(["https://remoteimpact.org/feed/jobs/"])
    expect(parsed.meta.source).toContain("Remote Impact (https://remoteimpact.org)")
    expect(Array.isArray(parsed.results)).toBe(true)
  })

  test("every result carries the fields /scrape reads", async () => {
    stubFeeds()
    const out = captureStdout()
    await runSearch(baseOpts)

    const job = JSON.parse(out()).results[0]
    for (const key of ["id", "title", "company", "location", "date", "url", "source"]) {
      expect(Object.hasOwn(job, key)).toBe(true)
    }
    expect(job.id).toBe("senior-machine-learning-engineer-far-ai")
    expect(job.company).toBe("Far.Ai")
    expect(job.location).toBe("Remote")
    expect(job.url).toBe("https://remoteimpact.org/jobs/senior-machine-learning-engineer-far-ai/")
  })

  test("-q and --jobage filter on the client, newest first", async () => {
    stubFeeds()
    const out = captureStdout()
    await runSearch({ ...baseOpts, query: "data", jobage: 7 })
    const parsed = JSON.parse(out())
    expect(parsed.results.map((r: { id: string }) => r.id)).toEqual(["data-analyst-land-power-clean-data-co"])
    expect(parsed.meta.total).toBe(1)
    expect(parsed.meta.scanned).toBe(3)
  })

  test("--page slices 20 per page and an out-of-range page is empty, exit 0", async () => {
    const many = Array.from({ length: 45 }, (_, i) => ({
      ...OLD_ITEM,
      slug: `role-${i}-org`,
      title: `Role ${i} at Org`,
      pubDate: new Date(NOW_MS - i * 3_600_000).toUTCString(),
    }))
    stubFeeds({}, () => rss(feedXml(many)))
    const out = captureStdout()
    await runSearch({ ...baseOpts, page: 3 })
    const p3 = JSON.parse(out())
    expect(p3.meta).toMatchObject({ count: 5, page: 3, total: 45, pages: 3 })
    expect(p3.results[0].id).toBe("role-40-org")

    const out2 = captureStdout()
    expect(await runSearch({ ...baseOpts, page: 9 })).toBe(0)
    expect(JSON.parse(out2()).results).toEqual([])
  })

  test("--limit caps the emitted results", async () => {
    stubFeeds()
    const out = captureStdout()
    await runSearch({ ...baseOpts, limit: 2 })
    expect(JSON.parse(out()).results).toHaveLength(2)
  })

  test("table and plain output carry the attribution line", async () => {
    stubFeeds()
    const table = captureStdout()
    await runSearch({ ...baseOpts, format: "table" })
    expect(table()).toContain("Source: Remote Impact (https://remoteimpact.org)")
    const plain = captureStdout()
    await runSearch({ ...baseOpts, format: "plain" })
    expect(plain()).toContain("Source: Remote Impact (https://remoteimpact.org)")
  })
})

describe("search request", () => {
  test("without --category it reads only the site-wide feed, with an honest UA", async () => {
    const calls = stubFeeds()
    captureStdout()
    await runSearch({ ...baseOpts, query: "machine learning", jobage: 7, page: 2 })
    expect(calls.map((c) => c.url)).toEqual(["https://remoteimpact.org/feed/jobs/"])
    const headers = calls[0]!.init!.headers as Record<string, string>
    expect(headers["User-Agent"]).toBe("Mozilla/5.0 (compatible; remoteimpact-cli/1.0)")
  })

  test("--category reads one feed per slug, never the /api/, and merges them", async () => {
    const calls = stubFeeds({
      [AI_FEED]: () => rss(feedXml([ML_ITEM])),
      [TECH_FEED]: () => rss(feedXml([ML_ITEM, CLIMATE_ITEM])),
    })
    const out = captureStdout()
    await runSearch({ ...baseOpts, categories: ["ai-safety", "technology"] })
    expect(calls.map((c) => c.url)).toEqual([AI_FEED, TECH_FEED])
    expect(calls.every((c) => !c.url.includes("/api/"))).toBe(true)

    const parsed = JSON.parse(out())
    expect(parsed.results).toHaveLength(2)
    expect(parsed.results[0].categories).toEqual(["ai-safety", "technology"])
    expect(parsed.meta.feeds).toEqual([AI_FEED, TECH_FEED])
  })
})

describe("search failure contract", () => {
  test("an unknown category exits 1 with BAD_CATEGORY and nothing on stdout", async () => {
    stubFeeds({ [AI_FEED]: () => new Response("<html>Page Not Found</html>", { status: 404 }) })
    const out = captureStdout()
    const err = captureStderr()
    expect(await runSearch({ ...baseOpts, categories: ["ai-safety"] })).toBe(1)
    expect(out()).toBe("")
    expect(JSON.parse(err().trim()).code).toBe("BAD_CATEGORY")
  })

  test("a non-RSS body exits 1 with PARSE_ERROR", async () => {
    stubFeeds({}, () => new Response("<html>redesigned</html>", { status: 200 }))
    const err = captureStderr()
    captureStdout()
    expect(await runSearch(baseOpts)).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("PARSE_ERROR")
  })

  test("a 403 exits 1 with API_ERROR", async () => {
    stubFeeds({}, () => new Response("forbidden", { status: 403 }))
    const err = captureStderr()
    captureStdout()
    expect(await runSearch(baseOpts)).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("API_ERROR")
  })
})

describe("detail contract", () => {
  test("returns the matching job from the site-wide feed", async () => {
    const calls = stubFeeds()
    const out = captureStdout()
    expect(await runDetail({ id: "data-analyst-land-power-clean-data-co", categories: [], format: "json" })).toBe(0)
    const d = JSON.parse(out())
    expect(d.id).toBe("data-analyst-land-power-clean-data-co")
    expect(d.title).toBe("Data Analyst, Land & Power")
    expect(d.description).toBe("About Us\n\nWe fund open-source climate tools & data.")
    expect(d.foundIn).toBe("https://remoteimpact.org/feed/jobs/")
    expect(calls).toHaveLength(1)
  })

  test("checks the given category feed first and stops at the first match", async () => {
    const calls = stubFeeds({ [AI_FEED]: () => rss(feedXml([ML_ITEM])) }, () => rss(feedXml([])))
    const out = captureStdout()
    expect(
      await runDetail({
        id: "https://remoteimpact.org/jobs/senior-machine-learning-engineer-far-ai/",
        categories: ["ai-safety"],
        format: "plain",
      }),
    ).toBe(0)
    expect(calls.map((c) => c.url)).toEqual([AI_FEED])
    expect(out()).toContain("500-character excerpt")
    expect(out()).toContain("Source: Remote Impact")
  })

  test("a job in no checked feed exits 1 with NOT_FOUND naming the job page", async () => {
    const calls = stubFeeds({ [AI_FEED]: () => rss(feedXml([])) }, () => rss(feedXml([])))
    const err = captureStderr()
    expect(await runDetail({ id: "gone-job-org", categories: ["ai-safety"], format: "json" })).toBe(1)
    const e = JSON.parse(err().trim())
    expect(e.code).toBe("NOT_FOUND")
    expect(e.error).toContain("https://remoteimpact.org/jobs/gone-job-org/")
    expect(calls.map((c) => c.url)).toEqual([AI_FEED, "https://remoteimpact.org/feed/jobs/"])
  })

  test("a bad id is rejected before any request", async () => {
    const calls = stubFeeds()
    const err = captureStderr()
    expect(await runDetail({ id: "https://evil.example/jobs/x/", categories: [], format: "json" })).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("BAD_ID")
    expect(calls).toHaveLength(0)
  })
})
