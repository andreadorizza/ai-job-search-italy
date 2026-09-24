import { afterEach, describe, expect, test } from "bun:test"
import { runSearch, type SearchOpts } from "../src/commands/search.js"
import { runDetail } from "../src/commands/detail.js"
import { FILTERS_URL, LIST_URL } from "../src/helpers.js"
import {
  CONSULTANCY,
  STAFF,
  bodyOf,
  captureStderr,
  captureStdout,
  json,
  listResponse,
  stubPortal,
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

// 2026-09-24 12:00 New York time.
const NOW = Date.parse("2026-09-24T16:00:00Z")

const baseOpts: SearchOpts = {
  query: "software",
  locations: [],
  recruitmentTypes: [],
  networks: [],
  homeBased: false,
  page: 1,
  format: "json",
  nowMs: NOW,
}

describe("search JSON output contract", () => {
  test("emits {meta:{count,page,...}, results:[...]}", async () => {
    stubPortal({ list: () => json(listResponse([CONSULTANCY, STAFF], 41)) })
    const out = captureStdout()
    expect(await runSearch(baseOpts)).toBe(0)

    const parsed = JSON.parse(out())
    expect(parsed.meta).toEqual({ count: 2, page: 1, perPage: 20, total: 41, pages: 3, locations: null })
    expect(Array.isArray(parsed.results)).toBe(true)
  })

  test("every result carries the fields /scrape reads, company = department/office", async () => {
    stubPortal()
    const out = captureStdout()
    await runSearch(baseOpts)

    const [con, staff] = JSON.parse(out()).results
    for (const key of ["id", "title", "company", "location", "date", "url"]) {
      expect(Object.hasOwn(con, key)).toBe(true)
    }
    expect(con.id).toBe("285226")
    expect(con.company).toBe("Economic and Social Commission for Western Asia")
    expect(con.location).toBe("BEIRUT")
    expect(con.date).toBe("2026-09-23")
    // endDate 2026-10-07T03:59:59Z is 23:59:59 on 6 October in New York.
    expect(con.deadline).toBe("2026-10-06")
    expect(con.url).toBe("https://careers.un.org/jobSearchDescription/285226?language=en")
    expect(con.categoryCode).toBe("CON")
    expect(con.workLocation).toBe("Home-based")
    expect(con.duration).toBe("16 weeks")
    expect(con.homeBased).toBe(true)
    expect(con.summary).toStartWith("GENERAL SCOPE")

    expect(staff.title).toBe("INFORMATION SYSTEMS OFFICER, P3")
    expect(staff.level).toBe("P-3")
    expect(staff.jobNetwork).toBe("Information and Telecommunication Technology")
    expect(staff.workLocation).toBeNull()
    expect(staff.homeBased).toBeNull()
    // Search results stay small: the full text is detail-only.
    expect(Object.hasOwn(staff, "description")).toBe(false)
  })

  test("a null field is present as null, not omitted", async () => {
    stubPortal({ list: () => json(listResponse([{ jobId: 7, postingTitle: "Researcher" }])) })
    const out = captureStdout()
    await runSearch(baseOpts)

    const job = JSON.parse(out()).results[0]
    for (const key of [
      "company",
      "location",
      "date",
      "deadline",
      "level",
      "category",
      "categoryCode",
      "jobNetwork",
      "jobFamily",
      "recruitmentType",
      "workLocation",
      "duration",
      "homeBased",
      "summary",
    ]) {
      expect(Object.hasOwn(job, key)).toBe(true)
      expect(job[key]).toBeNull()
    }
  })

  test("one malformed item is skipped, not fatal for the batch", async () => {
    stubPortal({ list: () => json(listResponse([{ jobId: 1 }, { postingTitle: "no id" }, null, STAFF], 4)) })
    const out = captureStdout()
    expect(await runSearch(baseOpts)).toBe(0)
    expect(JSON.parse(out()).results.map((r: { id: string }) => r.id)).toEqual(["285249"])
  })

  test("--limit caps the emitted results", async () => {
    stubPortal()
    const out = captureStdout()
    await runSearch({ ...baseOpts, limit: 1 })
    expect(JSON.parse(out()).results).toHaveLength(1)
  })

  test("an empty result set is still valid JSON, exit 0", async () => {
    stubPortal({ list: () => json(listResponse([], 0)) })
    const out = captureStdout()
    expect(await runSearch(baseOpts)).toBe(0)
    expect(JSON.parse(out()).results).toEqual([])
  })

  test("table and plain formats render without raw HTML", async () => {
    stubPortal()
    let out = captureStdout()
    await runSearch({ ...baseOpts, format: "table" })
    expect(out()).toContain("285226")
    expect(out()).toContain("BEIRUT (home)")
    out = captureStdout()
    await runSearch({ ...baseOpts, format: "plain" })
    expect(out()).toContain("work location: Home-based")
    expect(out()).not.toMatch(/<[a-z/][^>]*>/i)
  })
})

describe("search request", () => {
  test("posts the portal's own filter object, 0-indexed page, stable jobId sort", async () => {
    const calls = stubPortal()
    captureStdout()
    await runSearch({ ...baseOpts, recruitmentTypes: ["C", "I"], networks: ["ITECNET"], page: 3 })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(LIST_URL)
    expect(calls[0]!.init!.method).toBe("POST")
    expect((calls[0]!.init!.headers as Record<string, string>)["User-Agent"]).toBe(
      "Mozilla/5.0 (compatible; uncareers-cli/1.0)",
    )
    expect(bodyOf(calls[0]!)).toEqual({
      // Never `jc`: the server drops the keyword whenever `jc` is set.
      filterConfig: { keyword: "software", recrtype: ["C", "I"], jn: ["ITECNET"] },
      pagination: { page: 2, itemPerPage: 20, sortBy: "jobId", sortDirection: -1 },
    })
  })

  test("no query sends no keyword (browse)", async () => {
    const calls = stubPortal()
    captureStdout()
    await runSearch({ ...baseOpts, query: "" })
    expect(bodyOf(calls[0]!).filterConfig).toEqual({})
  })
})

describe("--jobage", () => {
  test("sends the covering server span and trims to the exact window", async () => {
    const old = { ...STAFF, jobId: 100, startDate: "2026-09-20T04:00:00.000Z" }
    const calls = stubPortal({ list: () => json(listResponse([CONSULTANCY, STAFF, old], 3)) })
    const out = captureStdout()
    await runSearch({ ...baseOpts, jobage: 2 })

    expect(bodyOf(calls[0]!).filterConfig.span).toEqual(["7"])
    // Today is 09-24 (NY): 2 days = 09-24 and 09-23 only.
    expect(JSON.parse(out()).results.map((r: { id: string }) => r.id)).toEqual(["285226"])
  })

  test("beyond 30 days there is no server filter, only the client trim", async () => {
    const calls = stubPortal()
    captureStdout()
    await runSearch({ ...baseOpts, jobage: 60 })
    expect(bodyOf(calls[0]!).filterConfig.span).toBeUndefined()
  })
})

describe("--home-based", () => {
  test("keeps only postings whose Work Location reads home-based", async () => {
    stubPortal()
    const out = captureStdout()
    await runSearch({ ...baseOpts, homeBased: true })
    expect(JSON.parse(out()).results.map((r: { id: string }) => r.id)).toEqual(["285226"])
  })
})

describe("--location", () => {
  test("a country resolves to its duty stations via the portal's own filter list", async () => {
    const calls = stubPortal()
    const out = captureStdout()
    expect(await runSearch({ ...baseOpts, locations: ["italy"] })).toBe(0)

    expect(calls.map((c) => c.url)).toEqual([FILTERS_URL, LIST_URL])
    // Turin has no duty station behind it, so it is matched but not sent.
    expect(bodyOf(calls[1]!).filterConfig.ds).toEqual(["ROME", "BRINDISI"])
    expect(JSON.parse(out()).meta.locations).toEqual(["Rome", "Brindisi", "Turin"])
  })

  test("names match case- and accent-insensitively, several OR'ed", async () => {
    const calls = stubPortal()
    captureStdout()
    await runSearch({ ...baseOpts, locations: ["GENEVA", "new york", "cote d'ivoire"] })
    expect(bodyOf(calls[1]!).filterConfig.ds).toEqual(["Geneva", "NEWYORK", "ABIDJAN"])
  })

  test("a duty-station spelling from the results is a fallback match", async () => {
    const calls = stubPortal()
    captureStdout()
    await runSearch({ ...baseOpts, locations: ["PORT-AU-PRINCE - LOCAL"] })
    expect(bodyOf(calls[1]!).filterConfig.ds).toEqual(["PORTAUPRINCE"])
  })

  test("the OTHER catch-all bucket is never matched", async () => {
    const calls = stubPortal()
    const out = captureStdout()
    await runSearch({ ...baseOpts, locations: ["Turin"] })
    // Turin alone is unfilterable: answered empty, and the list is never asked
    // (a request without `ds` would return the whole board).
    expect(calls.map((c) => c.url)).toEqual([FILTERS_URL])
    const parsed = JSON.parse(out())
    expect(parsed.results).toEqual([])
    expect(parsed.meta.locations).toEqual(["Turin"])
  })

  test("an unknown place exits 1 with UNKNOWN_LOCATION and never queries the list", async () => {
    const calls = stubPortal()
    const out = captureStdout()
    const err = captureStderr()
    expect(await runSearch({ ...baseOpts, locations: ["Genev"] })).toBe(1)
    expect(out()).toBe("")
    const e = JSON.parse(err().trim())
    expect(e.code).toBe("UNKNOWN_LOCATION")
    expect(e.error).toContain("Geneva")
    expect(calls.map((c) => c.url)).toEqual([FILTERS_URL])
  })

  test("Zurich only exists inside the catch-all, so it is unknown", async () => {
    stubPortal()
    const err = captureStderr()
    captureStdout()
    expect(await runSearch({ ...baseOpts, locations: ["Zurich"] })).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("UNKNOWN_LOCATION")
  })
})

describe("search failure contract", () => {
  test("an error envelope exits 1 with API_ERROR on stderr and nothing on stdout", async () => {
    stubPortal({ list: () => json({ status: 0, message: "Something went wrong" }) })
    const out = captureStdout()
    const err = captureStderr()
    expect(await runSearch(baseOpts)).toBe(1)
    expect(out()).toBe("")
    const e = JSON.parse(err().trim())
    expect(e.code).toBe("API_ERROR")
    expect(e.error).toContain("Something went wrong")
  })

  test("the SPA's HTML shell instead of JSON exits 1 with PARSE_ERROR", async () => {
    stubPortal({ list: () => new Response("<!doctype html><html></html>", { status: 200 }) })
    const err = captureStderr()
    captureStdout()
    expect(await runSearch(baseOpts)).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("PARSE_ERROR")
  })

  test("a 404 exits 1 with API_ERROR", async () => {
    stubPortal({ list: () => new Response("", { status: 404 }) })
    const err = captureStderr()
    captureStdout()
    expect(await runSearch(baseOpts)).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("API_ERROR")
  })
})

describe("detail contract", () => {
  test("looks the id up through the list endpoint only - never the per-job endpoint", async () => {
    const calls = stubPortal({ list: () => json(listResponse([STAFF], 1)) })
    const out = captureStdout()
    expect(await runDetail({ id: "285249", format: "json" })).toBe(0)

    expect(calls.map((c) => c.url)).toEqual([LIST_URL])
    expect(bodyOf(calls[0]!).filterConfig).toEqual({ keyword: "285249" })
    const d = JSON.parse(out())
    expect(d.id).toBe("285249")
    expect(d.jobCodeTitle).toBe("INFORMATION SYSTEMS OFFICER")
    expect(d.sections.map((s: { title: string }) => s.title)).toEqual([
      "Org. Setting and Reporting",
      "Responsibilities",
      "Languages",
    ])
    expect(d.description).toContain("Language | Reading\nEnglish | UN Level III")
    expect(d.description).not.toMatch(/<[a-z/][^>]*>|&[a-z]+;|headtable/i)
  })

  test("accepts a posting URL and looks up only its id", async () => {
    const calls = stubPortal({ list: () => json(listResponse([CONSULTANCY], 1)) })
    const out = captureStdout()
    expect(await runDetail({ id: "https://careers.un.org/jobSearchDescription/285226?language=en", format: "plain" })).toBe(0)
    expect(bodyOf(calls[0]!).filterConfig).toEqual({ keyword: "285226" })
    expect(out()).toContain("Work location:      Home-based\n")
    expect(out()).toContain("- Draft the policy & annexes.")
  })

  test("a different posting is never returned as a match", async () => {
    stubPortal({ list: () => json(listResponse([STAFF], 1)) })
    const err = captureStderr()
    expect(await runDetail({ id: "1234", format: "json" })).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("NOT_FOUND")
  })

  test("a bad id is rejected before any request", async () => {
    const calls = stubPortal()
    const err = captureStderr()
    expect(await runDetail({ id: "https://evil.example/jobSearchDescription/1", format: "json" })).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("BAD_ID")
    expect(calls).toHaveLength(0)
  })
})
