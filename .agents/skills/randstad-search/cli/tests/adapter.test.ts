import { describe, expect, test } from "bun:test"
import {
  buildSearchUrl,
  canonicalHasLocation,
  canonicalHasQuery,
  extractDetailUrls,
  idFromUrl,
  parseDetailInput,
  parseDetailPage,
  readCanonical,
  readTotal,
  slugify,
} from "../src/helpers.js"

const UUID = "29a8f88f-5de2-42d0-aeb4-c24e34629ee3"
const PATH = `/offerte-lavoro/magazziniere_carvico_${UUID}/`
const URL_ = `https://www.randstad.it${PATH}`

describe("buildSearchUrl - filters are path segments, not query params", () => {
  test("query becomes a q- segment", () => {
    expect(buildSearchUrl({ query: "data engineer" })).toBe(
      "https://www.randstad.it/offerte-lavoro/q-data-engineer/",
    )
  })

  test("location comes before the query", () => {
    expect(buildSearchUrl({ query: "magazziniere", location: "Lombardia" })).toBe(
      "https://www.randstad.it/offerte-lavoro/lombardia/q-magazziniere/",
    )
  })

  test("page 1 adds no segment; later pages do", () => {
    expect(buildSearchUrl({ query: "x", page: 1 })).toBe("https://www.randstad.it/offerte-lavoro/q-x/")
    expect(buildSearchUrl({ query: "x", page: 3 })).toBe(
      "https://www.randstad.it/offerte-lavoro/q-x/page-3/",
    )
  })

  test("no filters gives the bare listing", () => {
    expect(buildSearchUrl({})).toBe("https://www.randstad.it/offerte-lavoro/")
  })
})

describe("slugify", () => {
  test("folds accents and collapses separators", () => {
    expect(slugify("Emilia-Romagna")).toBe("emilia-romagna")
    expect(slugify("Città di Castello")).toBe("citta-di-castello")
    expect(slugify("  Data   Engineer  ")).toBe("data-engineer")
    expect(slugify("Valle d'Aosta")).toBe("valle-d-aosta")
  })
})

describe("extractDetailUrls", () => {
  const html = `
    <a href="/offerte-lavoro/">all</a>
    <a href="/offerte-lavoro/page-2/">next</a>
    <a href="/offerte-lavoro/jt-tempo-determinato/">facet</a>
    <a href="${PATH}">job</a>
    <a href="${PATH}">job again</a>
    <a href="/offerte-lavoro/altro_roma_11111111-2222-3333-4444-555555555555/">job 2</a>`

  test("returns only vacancy URLs, de-duplicated", () => {
    expect(extractDetailUrls(html)).toEqual([
      URL_,
      "https://www.randstad.it/offerte-lavoro/altro_roma_11111111-2222-3333-4444-555555555555/",
    ])
  })

  test("ignores facet and pagination links", () => {
    expect(extractDetailUrls(html).join()).not.toContain("page-2")
    expect(extractDetailUrls(html).join()).not.toContain("jt-")
  })

  test("returns nothing for a page with no vacancies", () => {
    expect(extractDetailUrls("<html></html>")).toEqual([])
  })
})

describe("canonical guard against silent widening", () => {
  // Randstad answers 200 with the unfiltered national listing when it does not
  // recognise a filter. The canonical URL is the only in-page evidence of what
  // it actually applied.
  test("reads the canonical href", () => {
    const html = `<link rel="canonical" href="https://www.randstad.it/offerte-lavoro/re-lombardia/"/>`
    expect(readCanonical(html)).toBe("https://www.randstad.it/offerte-lavoro/re-lombardia/")
  })

  test("recognises an applied region or city facet", () => {
    expect(canonicalHasLocation("https://www.randstad.it/offerte-lavoro/re-lombardia/")).toBe(true)
    expect(canonicalHasLocation("https://www.randstad.it/offerte-lavoro/re-lombardia/ci-milano/")).toBe(true)
  })

  test("an unfiltered canonical means the location was ignored", () => {
    expect(canonicalHasLocation("https://www.randstad.it/offerte-lavoro/")).toBe(false)
    expect(canonicalHasLocation(null)).toBe(false)
  })

  test("recognises an applied query facet", () => {
    expect(canonicalHasQuery("https://www.randstad.it/offerte-lavoro/q-magazziniere/")).toBe(true)
    expect(canonicalHasQuery("https://www.randstad.it/offerte-lavoro/")).toBe(false)
  })

  test("a job-type facet alone is not a location", () => {
    expect(canonicalHasLocation("https://www.randstad.it/offerte-lavoro/jt-tempo-determinato/")).toBe(false)
  })
})

describe("readTotal", () => {
  test("reads the count from the heading", () => {
    expect(readTotal("<h1>2680 offerte di lavoro lombardia</h1>")).toBe(2680)
  })

  test("copes with a thousands separator", () => {
    expect(readTotal("<h1>9.681 offerte di lavoro</h1>")).toBe(9681)
  })

  test("returns null when the heading carries no count", () => {
    expect(readTotal("<h1>offerte di lavoro</h1>")).toBeNull()
    expect(readTotal("<html></html>")).toBeNull()
  })
})

describe("parseDetailInput - host and path gated", () => {
  test("accepts a randstad vacancy URL", () => {
    expect(parseDetailInput(URL_)).toEqual({ url: URL_, id: UUID })
  })

  test("accepts a subdomain", () => {
    const u = `https://www.randstad.it${PATH}`
    expect(parseDetailInput(u)?.id).toBe(UUID)
  })

  test("rejects another host", () => {
    expect(parseDetailInput(`https://evil.example${PATH}`)).toBeNull()
  })

  test("rejects a host that merely embeds randstad.it", () => {
    expect(parseDetailInput(`https://randstad.it.evil.example${PATH}`)).toBeNull()
  })

  test("rejects a non-vacancy path on the right host", () => {
    expect(parseDetailInput("https://www.randstad.it/offerte-lavoro/")).toBeNull()
    expect(parseDetailInput("https://www.randstad.it/")).toBeNull()
  })

  test("rejects a bare id, because the slug is part of the path", () => {
    expect(parseDetailInput(UUID)).toBeNull()
  })

  test("rejects non-http schemes and junk", () => {
    expect(parseDetailInput("file:///etc/passwd")).toBeNull()
    expect(parseDetailInput("javascript:alert(1)")).toBeNull()
    expect(parseDetailInput("")).toBeNull()
    expect(parseDetailInput("../../etc")).toBeNull()
  })
})

describe("idFromUrl / parseDetailPage", () => {
  test("takes the trailing uuid", () => {
    expect(idFromUrl(PATH)).toBe(UUID)
    expect(idFromUrl("/offerte-lavoro/no-uuid/")).toBeNull()
  })

  test("parseDetailPage returns null when the page has no JobPosting", () => {
    expect(parseDetailPage("<html><body>nope</body></html>", URL_)).toBeNull()
  })

  test("parseDetailPage falls back to the URL uuid when identifier is absent", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting",
      title: "Magazziniere",
    })}</script>`
    const card = parseDetailPage(html, URL_)!
    expect(card.id).toBe(UUID)
    expect(card.url).toBe(URL_)
  })
})
