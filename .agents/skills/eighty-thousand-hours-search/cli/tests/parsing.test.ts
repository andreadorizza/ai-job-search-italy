import { describe, expect, test } from "bun:test"
import {
  buildSearchParams,
  htmlToText,
  parseBoardConfig,
  parseIdInput,
  splitLocations,
  toIsoDate,
  toJobCard,
} from "../src/helpers.js"
import { BOARD_HTML, FAKE_APP_ID, FAKE_KEY, HIT } from "./fixtures.js"

describe("parseBoardConfig", () => {
  test("reads app id, key and jobs index from the Nuxt config literal", () => {
    expect(parseBoardConfig(BOARD_HTML)).toEqual({ appId: FAKE_APP_ID, apiKey: FAKE_KEY, jobsIndex: "jobs_prod" })
  })

  test("does not confuse algoliaJobsIndex with its longer-named siblings", () => {
    const html = BOARD_HTML.replace('algoliaJobsIndex:"jobs_prod"', 'algoliaJobsIndex:"jobs_main"')
    expect(parseBoardConfig(html)?.jobsIndex).toBe("jobs_main")
  })

  test("also accepts JSON-quoted keys", () => {
    const html = `{"algoliaApplicationId":"${FAKE_APP_ID}","algoliaApiKey":"${FAKE_KEY}","algoliaJobsIndex":"jobs_prod"}`
    expect(parseBoardConfig(html)?.appId).toBe(FAKE_APP_ID)
  })

  test("returns null when the config is gone", () => {
    expect(parseBoardConfig("<html><body>new site</body></html>")).toBeNull()
  })

  test("rejects an app id that could steer the request to another host", () => {
    for (const bad of ["evil.example/x", "ABC-DEF.GH", "abc123lower"]) {
      const html = BOARD_HTML.replace(`algoliaApplicationId:"${FAKE_APP_ID}"`, `algoliaApplicationId:"${bad}"`)
      expect(parseBoardConfig(html)).toBeNull()
    }
  })
})

describe("htmlToText", () => {
  test("turns list items into one '- ' line each, with no blank lines between", () => {
    expect(htmlToText("<ul>\n<li>One</li>\n<li>Two</li>\n</ul>")).toBe("- One\n- Two")
  })

  test("keeps paragraphs apart and strips links", () => {
    expect(htmlToText('<p>First <a href="https://x.example">link</a>.</p><p>Second.</p>')).toBe(
      "First link.\n\nSecond.",
    )
  })

  test("decodes named and numeric entities", () => {
    expect(htmlToText("R&amp;D &ndash; you&#39;ll &#x2192; caf&eacute; &rsquo;")).toBe("R&D \u2013 you'll \u2192 caf\u00e9 \u2019")
  })

  test("leaves unknown entities untouched rather than dropping text", () => {
    expect(htmlToText("a &unknownthing; b")).toBe("a &unknownthing; b")
  })

  test("returns null for empty input", () => {
    expect(htmlToText("")).toBeNull()
    expect(htmlToText("<ul></ul>")).toBeNull()
    expect(htmlToText(null)).toBeNull()
  })
})

describe("toIsoDate", () => {
  test("epoch seconds become YYYY-MM-DD", () => {
    expect(toIsoDate(1790035260)).toBe("2026-09-22")
  })
  test("null, zero and junk become null", () => {
    expect(toIsoDate(null)).toBeNull()
    expect(toIsoDate(0)).toBeNull()
    expect(toIsoDate(Number.NaN)).toBeNull()
  })
})

describe("toJobCard", () => {
  test("prefers the long description, falls back to the summary", () => {
    expect(toJobCard({ ...HIT, description: "<p>Full text</p>" })?.description).toBe("Full text")
    expect(toJobCard(HIT)?.description).toContain("- Design and deploy")
  })

  test("falls back to the location tags when the card has none", () => {
    expect(toJobCard({ ...HIT, card_locations: [] })?.location).toBe("Pittsburgh, PA; Remote, Global; USA")
  })

  test("uses post_pk when objectID is missing", () => {
    const { objectID: _drop, ...rest } = HIT
    expect(toJobCard(rest)?.id).toBe("20437")
  })

  test("a record without id or title is rejected", () => {
    expect(toJobCard({ title: "x" })).toBeNull()
    expect(toJobCard({ objectID: "1", title: "  " })).toBeNull()
  })

  test("a deadline is emitted when the board has one", () => {
    expect(toJobCard({ ...HIT, closes_at: 1791158400 })?.deadline).toBe("2026-10-05")
  })
})

describe("buildSearchParams", () => {
  test("pages are 1-indexed for the user, 0-indexed for the index", () => {
    expect(buildSearchParams({ query: "", page: 3, locations: [], remote: false }).page).toBe(2)
  })

  test("locations are OR'ed within one group, remote is AND'ed as another", () => {
    const p = buildSearchParams({ query: "", page: 1, locations: ["Remote, Global", "UK"], remote: true })
    expect(p.facetFilters).toEqual([["tags_location_80k:Remote, Global", "tags_location_80k:UK"], ["tags_location_type:Remote"]])
  })

  test("a leading '-' in a location is escaped so it cannot negate the filter", () => {
    const p = buildSearchParams({ query: "", page: 1, locations: ["-UK"], remote: false })
    expect(p.facetFilters).toEqual([["tags_location_80k:\\-UK"]])
  })

  test("jobage becomes a posted_at lower bound in epoch seconds", () => {
    const nowMs = Date.UTC(2026, 8, 24)
    const p = buildSearchParams({ query: "", page: 1, locations: [], remote: false, jobage: 7, nowMs })
    expect(p.numericFilters).toEqual([`posted_at>=${nowMs / 1000 - 7 * 86400}`])
  })

  test("no filters means empty filter arrays", () => {
    const p = buildSearchParams({ query: "x", page: 1, locations: [], remote: false })
    expect(p.facetFilters).toEqual([])
    expect(p.numericFilters).toEqual([])
  })
})

describe("splitLocations", () => {
  test("splits on ';' so tags that contain commas survive", () => {
    expect(splitLocations(" Remote, Global ;Europe (ex UK);; ")).toEqual(["Remote, Global", "Europe (ex UK)"])
  })
})

describe("parseIdInput", () => {
  test("accepts a numeric id", () => {
    expect(parseIdInput(" 21083 ")).toBe("21083")
  })
  test("accepts both board URL shapes", () => {
    expect(parseIdInput("https://jobs.80000hours.org/jobs?jobPk=21083")).toBe("21083")
    expect(parseIdInput("https://jobs.80000hours.org/?jobPk=21083&utm_source=x")).toBe("21083")
  })
  test("rejects other hosts, missing or non-numeric ids, and filter injection", () => {
    for (const bad of [
      "https://evil.example/jobs?jobPk=1",
      "https://jobs.80000hours.org.evil.example/?jobPk=1",
      "https://jobs.80000hours.org/jobs",
      "https://jobs.80000hours.org/?jobPk=1%20OR%20objectID:2",
      "1 OR objectID:2",
      "../../etc",
      "",
    ]) {
      expect(parseIdInput(bad)).toBeNull()
    }
  })
})
