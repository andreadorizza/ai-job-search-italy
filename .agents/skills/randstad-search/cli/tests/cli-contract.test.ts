import { afterEach, describe, expect, test } from "bun:test"
import { runSearch } from "../src/commands/search.js"
import { runDetail } from "../src/commands/detail.js"

// Stubbed offline: the suite must pass with no network, per the portal contract.

const originalFetch = globalThis.fetch
const originalOut = process.stdout.write
const originalErr = process.stderr.write

afterEach(() => {
  globalThis.fetch = originalFetch
  process.stdout.write = originalOut
  process.stderr.write = originalErr
})

const UUID = "29a8f88f-5de2-42d0-aeb4-c24e34629ee3"
const PATH = `/offerte-lavoro/magazziniere_carvico_${UUID}/`
const URL_ = `https://www.randstad.it${PATH}`

const POSTING = {
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Magazziniere",
  datePosted: "2026-07-23T10:00:00+0000",
  validThrough: "2026-09-30T23:00:00+0000",
  description: "Descrizione",
  employmentType: ["TEMPORARY"],
  hiringOrganization: { name: "Randstad", sameAs: "https://www.randstad.it/" },
  jobLocation: { address: { addressLocality: "Carvico", addressRegion: "Lombardia" } },
  baseSalary: {
    currency: "EUR",
    value: { minValue: 22000, maxValue: 28000, unitText: "YEAR" },
  },
}

function listingHtml(canonical: string, hrefs: string[]): string {
  return `<html><head><link rel="canonical" href="${canonical}"/></head>
    <body><h1>2680 offerte di lavoro</h1>${hrefs.map((h) => `<a href="${h}">j</a>`).join("")}</body></html>`
}

const detailHtml = `<html><head><script type="application/ld+json">${JSON.stringify(
  POSTING,
)}</script></head><body></body></html>`

/** Serve the listing for listing URLs and the vacancy page for vacancy URLs. */
function stubSite(canonical: string, hrefs: string[], detail = detailHtml) {
  globalThis.fetch = (async (url: string) =>
    new Response(/_[0-9a-f-]{36}\/$/.test(String(url)) ? detail : listingHtml(canonical, hrefs), {
      status: 200,
      headers: { "Content-Type": "text/html" },
    })) as unknown as typeof fetch
}

function capture(stream: "stdout" | "stderr"): () => string {
  let buf = ""
  const target = stream === "stdout" ? process.stdout : process.stderr
  target.write = ((chunk: string) => {
    buf += chunk
    return true
  }) as typeof target.write
  return () => buf
}

const opts = {
  query: "magazziniere",
  jobage: 9999,
  page: 1,
  format: "json" as const,
}

describe("search JSON output contract", () => {
  test("emits {meta, results} with the fields /scrape reads", async () => {
    stubSite("https://www.randstad.it/offerte-lavoro/q-magazziniere/", [PATH])
    const out = capture("stdout")
    expect(await runSearch(opts)).toBe(0)

    const parsed = JSON.parse(out())
    expect(parsed.meta.total).toBe(2680)
    expect(parsed.meta.page).toBe(1)
    const job = parsed.results[0]
    for (const k of ["id", "title", "company", "location", "date", "url"]) {
      expect(Object.hasOwn(job, k)).toBe(true)
    }
    expect(job.title).toBe("Magazziniere")
    expect(job.company).toBe("Randstad")
    expect(job.location).toBe("Carvico, Lombardia")
    expect(job.url).toBe(URL_)
  })

  test("carries the deadline and salary that make this source worth having", async () => {
    stubSite("https://www.randstad.it/offerte-lavoro/q-magazziniere/", [PATH])
    const out = capture("stdout")
    await runSearch(opts)
    const job = JSON.parse(out()).results[0]
    expect(job.deadline).toBe("2026-09-30")
    expect(job.salary).toEqual({ currency: "EUR", min: 22000, max: 28000, unit: "YEAR" })
  })

  test("--limit caps how many vacancy pages are fetched", async () => {
    let fetched = 0
    const paths = [PATH, `/offerte-lavoro/a_b_11111111-2222-3333-4444-555555555555/`]
    globalThis.fetch = (async (url: string) => {
      const isDetail = /_[0-9a-f-]{36}\/$/.test(String(url))
      if (isDetail) fetched++
      return new Response(
        isDetail ? detailHtml : listingHtml("https://www.randstad.it/offerte-lavoro/q-magazziniere/", paths),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    capture("stdout")
    await runSearch({ ...opts, limit: 1 })
    expect(fetched).toBe(1)
  })

  test("one unreadable vacancy page does not kill the batch", async () => {
    const paths = [PATH, `/offerte-lavoro/a_b_11111111-2222-3333-4444-555555555555/`]
    globalThis.fetch = (async (url: string) => {
      const s = String(url)
      if (/11111111/.test(s)) throw new Error("connection reset")
      return new Response(
        /_[0-9a-f-]{36}\/$/.test(s)
          ? detailHtml
          : listingHtml("https://www.randstad.it/offerte-lavoro/q-magazziniere/", paths),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const out = capture("stdout")
    expect(await runSearch(opts)).toBe(0)
    expect(JSON.parse(out()).results).toHaveLength(1)
  })

  test("an empty listing is still valid JSON, exit 0", async () => {
    stubSite("https://www.randstad.it/offerte-lavoro/q-magazziniere/", [])
    const out = capture("stdout")
    expect(await runSearch(opts)).toBe(0)
    expect(JSON.parse(out()).results).toEqual([])
  })
})

describe("silent-widening guard", () => {
  // Randstad answers 200 with the unfiltered national listing for a filter it
  // does not recognise. Returning those as matches would be the worst outcome.
  test("an ignored location fails instead of returning national results", async () => {
    stubSite("https://www.randstad.it/offerte-lavoro/", [PATH])
    const out = capture("stdout")
    const err = capture("stderr")
    expect(await runSearch({ ...opts, location: "zzz-not-a-region" })).toBe(1)
    expect(out()).toBe("")
    expect(JSON.parse(err().trim()).code).toBe("BAD_ARG")
  })

  test("an ignored query fails too", async () => {
    stubSite("https://www.randstad.it/offerte-lavoro/", [PATH])
    const err = capture("stderr")
    expect(await runSearch(opts)).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("BAD_ARG")
  })

  test("a correctly applied location passes the guard", async () => {
    stubSite("https://www.randstad.it/offerte-lavoro/re-lombardia/q-magazziniere/", [PATH])
    capture("stdout")
    expect(await runSearch({ ...opts, location: "Lombardia" })).toBe(0)
  })
})

describe("detail contract", () => {
  test("returns the vacancy with its structured fields", async () => {
    stubSite("x", [])
    const out = capture("stdout")
    expect(await runDetail({ id: URL_, format: "json" })).toBe(0)
    const d = JSON.parse(out())
    expect(d.id).toBe(UUID)
    expect(d.employmentType).toBe("TEMPORARY")
    expect(d.deadline).toBe("2026-09-30")
  })

  test("a page without JobPosting markup exits 1 with PARSE_ERROR", async () => {
    globalThis.fetch = (async () =>
      new Response("<html><body>not a vacancy</body></html>", { status: 200 })) as unknown as typeof fetch
    const err = capture("stderr")
    expect(await runDetail({ id: URL_, format: "json" })).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("PARSE_ERROR")
  })

  test("a 404 exits 1 with NOT_FOUND", async () => {
    globalThis.fetch = (async () => new Response("", { status: 404 })) as unknown as typeof fetch
    const err = capture("stderr")
    expect(await runDetail({ id: URL_, format: "json" })).toBe(1)
    expect(JSON.parse(err().trim()).code).toBe("NOT_FOUND")
  })

  test("a bad URL is rejected before any request is made", async () => {
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response("", { status: 200 })
    }) as unknown as typeof fetch
    const err = capture("stderr")
    expect(await runDetail({ id: "https://evil.example/x/", format: "json" })).toBe(1)
    expect(called).toBe(false)
    expect(JSON.parse(err().trim()).code).toBe("BAD_ID")
  })
})
