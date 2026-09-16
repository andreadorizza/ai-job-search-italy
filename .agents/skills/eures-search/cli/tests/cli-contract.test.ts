import { afterEach, describe, expect, test } from "bun:test"
import { runSearch } from "../src/commands/search.js"
import { runDetail } from "../src/commands/detail.js"

// The /scrape contract: `search` emits {meta, results} on stdout with every
// field present (null, never omitted), and failures go to stderr with a code.
// Stubbed offline so the suite passes with no network, as the contract requires.

const originalFetch = globalThis.fetch
const originalWrite = process.stdout.write
const originalErrWrite = process.stderr.write

afterEach(() => {
  globalThis.fetch = originalFetch
  process.stdout.write = originalWrite
  process.stderr.write = originalErrWrite
})

function stubFetch(body: unknown, status = 200) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch
}

function captureStdout(): () => string {
  let out = ""
  process.stdout.write = ((chunk: string) => {
    out += chunk
    return true
  }) as typeof process.stdout.write
  return () => out
}

function captureStderr(): () => string {
  let out = ""
  process.stderr.write = ((chunk: string) => {
    out += chunk
    return true
  }) as typeof process.stderr.write
  return () => out
}

const RESPONSE = {
  numberRecords: 42,
  jvs: [
    {
      id: "OTkyMTM2IDE3",
      title: "sviluppatore software",
      description: "Descrizione",
      creationDate: 1789466591560,
      lastModificationDate: 1789509737707,
      numberOfPosts: 1,
      locationMap: { IT: ["ITC4C"] },
      positionOfferingCode: "permanent",
      availableLanguages: ["it"],
      employer: { name: "ACME S.R.L.", website: null },
    },
  ],
}

const baseOpts = {
  query: "sviluppatore",
  location: "it",
  jobage: 9999,
  page: 1,
  sort: "MOST_RECENT" as const,
  format: "json" as const,
}

describe("search JSON output contract", () => {
  test("emits {meta:{total,page,perPage}, results:[...]}", async () => {
    stubFetch(RESPONSE)
    const out = captureStdout()
    expect(await runSearch(baseOpts)).toBe(0)

    const parsed = JSON.parse(out())
    expect(parsed.meta).toEqual({ total: 42, page: 1, perPage: 20 })
    expect(Array.isArray(parsed.results)).toBe(true)
  })

  test("every result carries the fields /scrape reads", async () => {
    stubFetch(RESPONSE)
    const out = captureStdout()
    await runSearch(baseOpts)

    const job = JSON.parse(out()).results[0]
    for (const key of ["id", "title", "company", "location", "date", "url"]) {
      expect(Object.hasOwn(job, key)).toBe(true)
    }
    expect(job.title).toBe("sviluppatore software")
    expect(job.company).toBe("ACME S.R.L.")
    expect(job.location).toBe("Lombardia (IT)")
    expect(job.url).toContain("europa.eu/eures/portal/jv-se/jv-details/")
  })

  test("a null field is present as null, not omitted", async () => {
    stubFetch({ numberRecords: 1, jvs: [{ id: "A", title: "t" }] })
    const out = captureStdout()
    await runSearch(baseOpts)

    const job = JSON.parse(out()).results[0]
    expect(job.company).toBeNull()
    expect(job.location).toBeNull()
    expect(job.date).toBeNull()
    expect(Object.hasOwn(job, "deadline")).toBe(true)
  })

  test("one malformed vacancy is skipped, not fatal for the batch", async () => {
    stubFetch({
      numberRecords: 2,
      jvs: [{ id: "A" }, RESPONSE.jvs[0]], // first has no title
    })
    const out = captureStdout()
    expect(await runSearch(baseOpts)).toBe(0)
    expect(JSON.parse(out()).results).toHaveLength(1)
  })

  test("--limit caps the emitted results", async () => {
    stubFetch({ numberRecords: 3, jvs: [RESPONSE.jvs[0], RESPONSE.jvs[0], RESPONSE.jvs[0]] })
    const out = captureStdout()
    await runSearch({ ...baseOpts, limit: 2 })
    expect(JSON.parse(out()).results).toHaveLength(2)
  })

  test("an empty result set is still valid JSON, exit 0", async () => {
    stubFetch({ numberRecords: 0, jvs: [] })
    const out = captureStdout()
    expect(await runSearch(baseOpts)).toBe(0)
    expect(JSON.parse(out()).results).toEqual([])
  })
})

describe("search failure contract", () => {
  test("an API error exits 1 with {error,code} on stderr and nothing on stdout", async () => {
    stubFetch({}, 400)
    const out = captureStdout()
    const err = captureStderr()
    expect(await runSearch(baseOpts)).toBe(1)
    expect(out()).toBe("")
    expect(JSON.parse(err().trim()).code).toBe("API_ERROR")
  })
})

describe("detail contract", () => {
  test("returns the matching vacancy with its detail-only fields", async () => {
    stubFetch(RESPONSE)
    const out = captureStdout()
    expect(await runDetail({ id: "OTkyMTM2IDE3", format: "json" })).toBe(0)

    const d = JSON.parse(out())
    expect(d.id).toBe("OTkyMTM2IDE3")
    expect(d.contractType).toBe("permanent")
    expect(d.numberOfPosts).toBe(1)
    expect(d.languages).toEqual(["it"])
  })

  test("an id the API does not return exits 1 with NOT_FOUND", async () => {
    stubFetch({ numberRecords: 0, jvs: [] })
    const err = captureStderr()
    expect(await runDetail({ id: "MISSING", format: "json" })).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("NOT_FOUND")
  })

  test("a near-miss id is not accepted as a match", async () => {
    // The lookup searches by id keyword, so the response can contain other
    // vacancies; only an exact id match may be returned.
    stubFetch(RESPONSE)
    const err = captureStderr()
    expect(await runDetail({ id: "DIFFERENT", format: "json" })).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("NOT_FOUND")
  })
})
