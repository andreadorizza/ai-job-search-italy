import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { runSearch, type SearchOpts } from "../src/commands/search.js"
import { runDetail } from "../src/commands/detail.js"
import { APPNAME_ENV } from "../src/helpers.js"
import { ITALY_JOB, LIST_RESPONSE, REMOTE_JOB } from "./fixtures.js"

// The /scrape contract: `search` emits {meta, results} on stdout with every
// field present (null, never omitted), and failures go to stderr with a code.
// Stubbed offline, so the suite passes with no network and no appname.

const originalFetch = globalThis.fetch
const originalWrite = process.stdout.write
const originalErrWrite = process.stderr.write
const originalAppname = process.env[APPNAME_ENV]

beforeEach(() => {
  process.env[APPNAME_ENV] = "test-appname-xyz"
})

afterEach(() => {
  globalThis.fetch = originalFetch
  process.stdout.write = originalWrite
  process.stderr.write = originalErrWrite
  if (originalAppname === undefined) delete process.env[APPNAME_ENV]
  else process.env[APPNAME_ENV] = originalAppname
})

function stubFetch(body: unknown, status = 200): { calls: number; urls: string[]; bodies: unknown[] } {
  const state = { calls: 0, urls: [] as string[], bodies: [] as unknown[] }
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    state.calls++
    state.urls.push(url)
    state.bodies.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  }) as unknown as typeof fetch
  return state
}

function capture(stream: "stdout" | "stderr"): () => string {
  let out = ""
  const fn = ((chunk: string) => {
    out += chunk
    return true
  }) as typeof process.stdout.write
  if (stream === "stdout") process.stdout.write = fn
  else process.stderr.write = fn
  return () => out
}

const baseOpts: SearchOpts = { query: "data", remote: false, page: 1, sort: "recent", format: "json" }

describe("search JSON output contract", () => {
  test("emits {meta:{count,page,perPage,total}, results:[...]}", async () => {
    stubFetch(LIST_RESPONSE)
    const out = capture("stdout")
    expect(await runSearch(baseOpts)).toBe(0)

    const parsed = JSON.parse(out())
    expect(parsed.meta).toEqual({ count: 2, page: 1, perPage: 20, total: 57 })
    expect(parsed.results).toHaveLength(2)
  })

  test("every result carries the fields /scrape reads, with real values", async () => {
    stubFetch(LIST_RESPONSE)
    const out = capture("stdout")
    await runSearch(baseOpts)

    const job = JSON.parse(out()).results[0]
    for (const key of ["id", "title", "company", "location", "date", "url"]) {
      expect(Object.hasOwn(job, key)).toBe(true)
    }
    expect(job).toMatchObject({
      id: "4221508",
      title: "Data Management Specialist (Consultant) - Rome",
      company: "World Food Programme",
      companyShort: "WFP",
      location: "Rome, Italy",
      countries: ["Italy"],
      locationUnspecified: false,
      date: "2026-09-15",
      deadline: "2026-10-03",
      url: "https://reliefweb.int/job/4221508/data-management-specialist-consultant-rome",
      type: "Consultancy",
      experience: "5-9 years",
      categories: ["Information Management"],
    })
  })

  test("a job with no country is reported as location-unspecified, not null", async () => {
    stubFetch(LIST_RESPONSE)
    const out = capture("stdout")
    await runSearch(baseOpts)

    const job = JSON.parse(out()).results[1]
    expect(job.id).toBe("4230001")
    expect(job.locationUnspecified).toBe(true)
    expect(job.location).toMatch(/remote/i)
    expect(job.countries).toEqual([])
  })

  test("missing values are present as null, not omitted", async () => {
    stubFetch({ totalCount: 1, data: [{ id: 1, fields: { id: 1, title: "t" } }] })
    const out = capture("stdout")
    await runSearch(baseOpts)

    const job = JSON.parse(out()).results[0]
    for (const key of ["company", "companyShort", "date", "deadline", "type", "experience"]) {
      expect(Object.hasOwn(job, key)).toBe(true)
      expect(job[key]).toBeNull()
    }
    expect(job.url).toBe("https://reliefweb.int/node/1")
  })

  test("one malformed job is skipped, not fatal for the batch", async () => {
    stubFetch({ totalCount: 3, data: [{ id: 9 }, { fields: { title: "no id" } }, ITALY_JOB] })
    const out = capture("stdout")
    expect(await runSearch(baseOpts)).toBe(0)
    expect(JSON.parse(out()).results).toHaveLength(1)
  })

  test("--limit caps the emitted results and meta.count follows", async () => {
    stubFetch(LIST_RESPONSE)
    const out = capture("stdout")
    await runSearch({ ...baseOpts, limit: 1 })
    const parsed = JSON.parse(out())
    expect(parsed.results).toHaveLength(1)
    expect(parsed.meta.count).toBe(1)
  })

  test("an empty result set is still valid JSON, exit 0", async () => {
    stubFetch({ totalCount: 0, count: 0, data: [] })
    const out = capture("stdout")
    expect(await runSearch(baseOpts)).toBe(0)
    expect(JSON.parse(out()).results).toEqual([])
  })

  test("--page turns into an offset of 20 per page", async () => {
    const state = stubFetch(LIST_RESPONSE)
    capture("stdout")
    await runSearch({ ...baseOpts, page: 3 })
    expect(state.bodies[0]).toMatchObject({ limit: 20, offset: 40 })
  })

  test("the appname rides in the URL query, as the API requires", async () => {
    const state = stubFetch(LIST_RESPONSE)
    capture("stdout")
    await runSearch(baseOpts)
    expect(state.urls[0]).toBe("https://api.reliefweb.int/v2/jobs?appname=test-appname-xyz")
  })

  test("table output shows title, organization, location and url", async () => {
    stubFetch(LIST_RESPONSE)
    const out = capture("stdout")
    await runSearch({ ...baseOpts, format: "table" })
    expect(out()).toContain("World Food Programme | Rome, Italy")
    expect(out()).toContain("https://reliefweb.int/job/4230001/remote-gis-data-analyst")
  })
})

describe("credential contract", () => {
  test("no RELIEFWEB_APPNAME: exit 1, MISSING_CREDENTIALS, and no request at all", async () => {
    delete process.env[APPNAME_ENV]
    const state = stubFetch(LIST_RESPONSE)
    const out = capture("stdout")
    const err = capture("stderr")
    expect(await runSearch(baseOpts)).toBe(1)
    expect(state.calls).toBe(0)
    expect(out()).toBe("")
    const e = JSON.parse(err().trim())
    expect(e.code).toBe("MISSING_CREDENTIALS")
    expect(e.error).toContain(APPNAME_ENV)
    expect(e.error).toContain("apidoc.reliefweb.int")
  })

  test("a blank RELIEFWEB_APPNAME counts as unset", async () => {
    process.env[APPNAME_ENV] = "   "
    const state = stubFetch(LIST_RESPONSE)
    const err = capture("stderr")
    expect(await runDetail({ id: "4221508", format: "json" })).toBe(1)
    expect(state.calls).toBe(0)
    expect(JSON.parse(err().trim()).code).toBe("MISSING_CREDENTIALS")
  })

  test("an unapproved appname (403) maps to INVALID_CREDENTIALS without leaking it", async () => {
    process.env[APPNAME_ENV] = "secret-appname-123"
    stubFetch(
      {
        status: 403,
        error: { type: "AccessDeniedHttpException", message: "You are not using an approved appname." },
      },
      403,
    )
    const out = capture("stdout")
    const err = capture("stderr")
    expect(await runSearch(baseOpts)).toBe(1)
    expect(out()).toBe("")
    const e = JSON.parse(err().trim())
    expect(e.code).toBe("INVALID_CREDENTIALS")
    expect(e.error).toContain("not using an approved appname")
    expect(e.error).not.toContain("secret-appname-123")
  })
})

describe("search failure contract", () => {
  test("a 400 exits 1 with ReliefWeb's own message on stderr and nothing on stdout", async () => {
    stubFetch({ status: 400, error: { type: "BadRequestHttpException", message: "Invalid filter field" } }, 400)
    const out = capture("stdout")
    const err = capture("stderr")
    expect(await runSearch(baseOpts)).toBe(1)
    expect(out()).toBe("")
    const e = JSON.parse(err().trim())
    expect(e.code).toBe("API_ERROR")
    expect(e.error).toContain("Invalid filter field")
  })
})

describe("detail contract", () => {
  test("returns the job with clean description and how-to-apply text", async () => {
    const state = stubFetch({ totalCount: 1, count: 1, data: [ITALY_JOB] })
    const out = capture("stdout")
    expect(await runDetail({ id: "4221508", format: "json" })).toBe(0)

    expect(state.bodies[0]).toEqual({
      filter: { field: "id", value: 4221508 },
      profile: "full",
      preset: "analysis",
      limit: 1,
    })
    const d = JSON.parse(out())
    expect(d.id).toBe("4221508")
    expect(d.status).toBe("published")
    expect(d.isActive).toBe(true)
    expect(d.lastModified).toBe("2026-09-16")
    expect(d.description).toContain("About the role")
    expect(d.description).not.toMatch(/\*\*|##|\\-/)
    expect(d.description).toContain("- Build dashboards for country offices (https://www.wfp.org/countries)")
    expect(d.howToApply).toBe("Apply via WFP careers (https://www.wfp.org/careers) before 3 October 2026.")
  })

  test("accepts a reliefweb.int job URL", async () => {
    const state = stubFetch({ totalCount: 1, data: [REMOTE_JOB] })
    capture("stdout")
    expect(
      await runDetail({ id: "https://reliefweb.int/job/4230001/remote-gis-data-analyst", format: "plain" }),
    ).toBe(0)
    expect((state.bodies[0] as { filter: { value: number } }).filter.value).toBe(4230001)
  })

  test("an id the API does not return exits 1 with NOT_FOUND", async () => {
    stubFetch({ totalCount: 0, data: [] })
    const err = capture("stderr")
    expect(await runDetail({ id: "999", format: "json" })).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("NOT_FOUND")
  })

  test("a different job in the response is not accepted as a match", async () => {
    stubFetch({ totalCount: 1, data: [ITALY_JOB] })
    const err = capture("stderr")
    expect(await runDetail({ id: "12345", format: "json" })).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("NOT_FOUND")
  })
})
