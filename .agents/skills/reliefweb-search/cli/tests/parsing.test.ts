import { describe, expect, test } from "bun:test"
import {
  buildSearchBody,
  escapeQuery,
  htmlToText,
  isoDaysAgo,
  markdownToText,
  parseIdInput,
  readAppname,
  resolveCategories,
  resolveCountries,
  toIsoDate,
  toJobCard,
} from "../src/helpers.js"

describe("resolveCategories", () => {
  test("maps shorthands to ReliefWeb's exact category names", () => {
    expect(resolveCategories("ict").names).toEqual(["Information and Communications Technology"])
    expect(resolveCategories("im").names).toEqual(["Information Management"])
    expect(resolveCategories("pm").names).toEqual(["Program/Project Management"])
    expect(resolveCategories("M&E").names).toEqual(["Monitoring and Evaluation"])
  })

  test("matches full names regardless of case and punctuation", () => {
    expect(resolveCategories("program / project management").names).toEqual(["Program/Project Management"])
    expect(resolveCategories("INFORMATION AND COMMUNICATIONS TECHNOLOGY").names).toEqual([
      "Information and Communications Technology",
    ])
  })

  test("splits on commas, de-duplicates, and keeps numeric ids apart", () => {
    const r = resolveCategories("ict, it , 6866, im")
    expect(r.names).toEqual(["Information and Communications Technology", "Information Management"])
    expect(r.ids).toEqual([6866])
    expect(r.unknown).toEqual([])
  })

  test("reports unknown values instead of dropping them", () => {
    expect(resolveCategories("astronomy").unknown).toEqual(["astronomy"])
  })
})

describe("resolveCountries", () => {
  test("three-letter tokens are ISO3 codes, uppercased", () => {
    expect(resolveCountries("ita, che")).toEqual({ names: [], iso3: ["ITA", "CHE"], bad: [] })
  })

  test("longer tokens are country names, kept verbatim", () => {
    expect(resolveCountries("Italy,South Sudan").names).toEqual(["Italy", "South Sudan"])
  })

  test("two-letter codes are flagged, not sent as a name that matches nothing", () => {
    expect(resolveCountries("it").bad).toEqual(["it"])
  })
})

describe("escapeQuery", () => {
  test("escapes Lucene operators that appear in ordinary job-search text", () => {
    expect(escapeQuery("Program/Project")).toBe("Program\\/Project")
    expect(escapeQuery("M&E")).toBe("M\\&E")
    expect(escapeQuery("C++ (senior)")).toBe("C\\+\\+ \\(senior\\)")
  })

  test("keeps balanced quotes so phrase search works, escapes a stray one", () => {
    expect(escapeQuery('"information management"')).toBe('"information management"')
    expect(escapeQuery('data"')).toBe('data\\"')
  })
})

describe("buildSearchBody", () => {
  const base = { remote: false, page: 1, perPage: 20, sort: "recent" as const }

  test("query only: AND-joined words, newest first, open postings only", () => {
    expect(buildSearchBody({ ...base, query: "data analyst" })).toMatchObject({
      query: { value: "data analyst", operator: "AND" },
      preset: "latest",
      sort: ["date.created:desc"],
      limit: 20,
      offset: 0,
    })
    expect(buildSearchBody({ ...base, query: "x" }).filter).toBeUndefined()
  })

  test("--remote alone filters on the absence of a country", () => {
    expect(buildSearchBody({ ...base, remote: true }).filter).toEqual({ field: "country", negate: true })
  })

  test("--remote with -l means those countries OR no country", () => {
    const body = buildSearchBody({ ...base, remote: true, countries: resolveCountries("Italy,CHE") })
    expect(body.filter).toEqual({
      operator: "OR",
      conditions: [
        { field: "country.name", value: ["Italy"], operator: "OR" },
        { field: "country.iso3", value: ["CHE"], operator: "OR" },
        { field: "country", negate: true },
      ],
    })
  })

  test("location, category and jobage are AND-ed together", () => {
    const now = Date.parse("2026-09-24T12:00:00Z")
    const body = buildSearchBody({
      ...base,
      countries: resolveCountries("ITA"),
      categories: resolveCategories("ict"),
      jobage: 7,
      now,
    })
    expect(body.filter).toEqual({
      operator: "AND",
      conditions: [
        { field: "country.iso3", value: ["ITA"], operator: "OR" },
        {
          field: "career_categories.name",
          value: ["Information and Communications Technology"],
          operator: "OR",
        },
        { field: "date.created", value: { from: "2026-09-17T12:00:00+00:00" } },
      ],
    })
  })

  test("sort modes", () => {
    expect(buildSearchBody({ ...base, sort: "relevance" }).sort).toEqual(["score:desc", "date.created:desc"])
    expect(buildSearchBody({ ...base, sort: "closing" }).sort).toEqual(["date.closing:asc", "date.created:desc"])
  })
})

describe("isoDaysAgo / toIsoDate", () => {
  test("formats with an explicit +00:00 offset and no milliseconds", () => {
    expect(isoDaysAgo(1, Date.parse("2026-09-24T08:30:15.123Z"))).toBe("2026-09-23T08:30:15+00:00")
  })

  test("reduces an API timestamp to YYYY-MM-DD, null when unusable", () => {
    expect(toIsoDate("2026-07-15T10:09:12+00:00")).toBe("2026-07-15")
    expect(toIsoDate("not a date")).toBeNull()
    expect(toIsoDate(undefined)).toBeNull()
  })
})

describe("markdownToText", () => {
  test("strips headings, emphasis and escapes but keeps structure", () => {
    const md = "## Duties\n\n**Lead** the *team*.\n\n* one\n+ two\n- three \\- dash\n\n---\n\nEnd"
    expect(markdownToText(md)).toBe("Duties\n\nLead the team.\n\n- one\n- two\n- three - dash\n\nEnd")
  })

  test("links keep text and target; bare autolinks and mailto collapse", () => {
    expect(markdownToText("See [the ToR](https://x.org/tor.pdf).")).toBe("See the ToR (https://x.org/tor.pdf).")
    expect(markdownToText("[https://x.org](https://x.org)")).toBe("https://x.org")
    expect(markdownToText("[jobs@x.org](mailto:jobs@x.org)")).toBe("jobs@x.org")
    expect(markdownToText("<https://x.org/apply>")).toBe("https://x.org/apply")
  })

  test("leaves single underscores alone (emails, URLs)", () => {
    expect(markdownToText("Write to data_team@wfp.org or __now__")).toBe("Write to data_team@wfp.org or now")
  })

  test("decodes entities and strips leaked HTML", () => {
    expect(markdownToText("R&amp;D &#233;quipe &#x2013; <b>bold</b><br>next")).toBe("R&D équipe – bold\nnext")
  })

  test("empty input is null", () => {
    expect(markdownToText("")).toBeNull()
    expect(markdownToText("   ")).toBeNull()
    expect(markdownToText(undefined)).toBeNull()
  })
})

describe("htmlToText", () => {
  test("turns list items into bullets and paragraphs into breaks", () => {
    expect(htmlToText("<p>Intro</p><ul><li>a</li><li>b</li></ul>")).toBe("Intro\n\n- a\n- b")
  })
})

describe("toJobCard", () => {
  test("requires a numeric id and a title", () => {
    expect(toJobCard({ id: 1, fields: { title: "" } })).toBeNull()
    expect(toJobCard({ fields: { id: undefined, title: "x" } })).toBeNull()
    expect(toJobCard({ id: "abc", fields: { title: "x" } })).toBeNull()
    expect(toJobCard({ id: 7, fields: { title: "x" } })?.id).toBe("7")
  })

  test("multi-country jobs list every country", () => {
    const card = toJobCard({
      id: 5,
      fields: { title: "Roving", country: [{ name: "Kenya" }, { name: "Somalia" }] },
    })
    expect(card?.location).toBe("Kenya; Somalia")
    expect(card?.locationUnspecified).toBe(false)
  })
})

describe("parseIdInput", () => {
  test("accepts ids and reliefweb.int job/node URLs", () => {
    expect(parseIdInput("4221508")).toBe(4221508)
    expect(parseIdInput("https://reliefweb.int/job/4221508/program-manager")).toBe(4221508)
    expect(parseIdInput("https://reliefweb.int/node/4221508")).toBe(4221508)
    expect(parseIdInput("https://m.reliefweb.int/job/4221508")).toBe(4221508)
  })

  test("rejects other hosts, other paths and junk", () => {
    expect(parseIdInput("https://evil.example/job/4221508/x")).toBeNull()
    expect(parseIdInput("https://reliefweb.int.evil.example/job/1/x")).toBeNull()
    expect(parseIdInput("https://reliefweb.int/report/4221508/x")).toBeNull()
    expect(parseIdInput("../../etc/passwd")).toBeNull()
    expect(parseIdInput("")).toBeNull()
  })
})

describe("readAppname", () => {
  test("trims, and treats blank as unset", () => {
    expect(readAppname({ RELIEFWEB_APPNAME: "  my-app-abc  " })).toBe("my-app-abc")
    expect(readAppname({ RELIEFWEB_APPNAME: " " })).toBeNull()
    expect(readAppname({})).toBeNull()
  })
})
