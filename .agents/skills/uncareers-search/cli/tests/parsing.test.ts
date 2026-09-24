import { describe, expect, test } from "bun:test"
import {
  htmlToText,
  isHomeBased,
  nyDate,
  parseCategories,
  parseIdInput,
  parseLocationVocabulary,
  parseNetworks,
  parseSections,
  resolveLocations,
  spanFor,
  splitLocations,
  summarize,
  toJobCard,
  toJobDetail,
  withinDays,
} from "../src/helpers.js"
import { CONSULTANCY, FILTERS_RESPONSE, STAFF } from "./fixtures.js"

describe("htmlToText", () => {
  test("rebuilds bullets from inline '•' and paragraphs from runs of spaces", () => {
    expect(htmlToText("Duties:     • One thing.  • Another thing.")).toBe("Duties:\n- One thing.\n- Another thing.")
    expect(htmlToText("First paragraph.  Second paragraph.   Third")).toBe("First paragraph.\nSecond paragraph.\nThird")
  })

  test("keeps a double space mid-sentence as one space", () => {
    expect(htmlToText("a  b")).toBe("a b")
  })

  test("renders table rows as 'a | b' lines and drops style blocks", () => {
    expect(
      htmlToText("<style>.t{x:1}</style><table><tr><th>Language</th><th>Reading</th></tr><tr><td><b>English</b></td><td>UN Level II</td></tr></table>"),
    ).toBe("Language | Reading\nEnglish | UN Level II")
  })

  test("decodes entities and strips zero-width and direction marks", () => {
    expect(htmlToText("R&amp;D &ndash; section ‎2.2 &#x2192; caf&eacute;")).toBe("R&D – section 2.2 → café")
  })

  test("leaves unknown entities untouched rather than dropping text", () => {
    expect(htmlToText("a &unknownthing; b")).toBe("a &unknownthing; b")
  })

  test("returns null for empty input", () => {
    expect(htmlToText("")).toBeNull()
    expect(htmlToText("<div> </div>")).toBeNull()
    expect(htmlToText(undefined)).toBeNull()
  })
})

describe("parseSections", () => {
  test("splits a posting into titled sections, including the jobImportant block", () => {
    const s = parseSections(CONSULTANCY.jobDescription)
    expect(s.map((x) => x.title)).toEqual([
      "Result of Service",
      "Work Location",
      "Expected duration",
      "Duties and Responsibilities",
      "Languages",
      "No Fee",
    ])
    expect(s[3]!.text).toBe(
      "GENERAL SCOPE Open-source software policies provide a framework.\nDUTIES The consultant shall:\n- Review practices;\n- Draft the policy & annexes.",
    )
  })

  test("returns [] for markup without sections", () => {
    expect(parseSections("<p>just text</p>")).toEqual([])
    expect(parseSections(null)).toEqual([])
  })
})

describe("summarize", () => {
  test("prefers duties, flattens lines, cuts on a word boundary", () => {
    const s = summarize(parseSections(CONSULTANCY.jobDescription), 60)!
    expect(s.endsWith("…")).toBe(true)
    expect(s.length).toBeLessThanOrEqual(61)
    expect(s).not.toContain("\n")
    expect(s).toStartWith("GENERAL SCOPE")
  })

  test("falls back to the organisational setting", () => {
    expect(summarize([{ title: "Org. Setting and Reporting", text: "The office." }])).toBe("The office.")
  })
})

describe("isHomeBased", () => {
  for (const [text, want] of [
    ["Home-based", true],
    ["Home based with travel", true],
    ["HOME BASED WITH TRAVEL", true],
    ["Home-based (remote)", true],
    ["Remote", true],
    ["Remote/Home Based", true],
    ["Home-based in Asunción, Paraguay and MADES Offices (Hybrid format)", true],
    ["Paris with remote possible.", false],
    ["Bangkok and/or remotely", false],
    ["Lusaka, Zambia (Remote within the work location)", false],
    ["Remote within the duty station", false],
    ["Vienna HQ; no travel required", false],
  ] as const) {
    test(`${JSON.stringify(text)} -> ${want}`, () => {
      expect(isHomeBased(text)).toBe(want)
    })
  }

  test("no Work Location section -> null", () => {
    expect(isHomeBased(null)).toBeNull()
  })
})

describe("nyDate / withinDays / spanFor", () => {
  test("uses New York dates: a 03:59:59Z deadline is the previous day", () => {
    expect(nyDate("2026-10-07T03:59:59.000Z")).toBe("2026-10-06")
    expect(nyDate("2026-09-23T04:00:00.000Z")).toBe("2026-09-23")
    // Winter (EST, UTC-5).
    expect(nyDate("2026-12-10T04:59:59.000Z")).toBe("2026-12-09")
    expect(nyDate("2026-12-10T05:00:00.000Z")).toBe("2026-12-10")
  })

  test("returns null for missing or bad timestamps", () => {
    expect(nyDate(undefined)).toBeNull()
    expect(nyDate("not a date")).toBeNull()
  })

  test("withinDays counts today as day 1, like the portal's own filter", () => {
    const now = Date.parse("2026-09-24T16:00:00Z")
    expect(withinDays("2026-09-24", 1, now)).toBe(true)
    expect(withinDays("2026-09-23", 1, now)).toBe(false)
    expect(withinDays("2026-09-18", 7, now)).toBe(true)
    expect(withinDays("2026-09-17", 7, now)).toBe(false)
    expect(withinDays(null, 7, now)).toBe(false)
  })

  test("spanFor picks the smallest covering server window", () => {
    expect([1, 2, 7, 8, 30, 31].map(spanFor)).toEqual(["1", "7", "7", "30", "30", null])
  })
})

describe("categories and networks", () => {
  test("categories map to recruitment-type codes, OR'ed and deduped", () => {
    expect(parseCategories("consultant")).toEqual(["C", "I"])
    expect(parseCategories("Consultancy,internship,con")).toEqual(["C", "I", "N"])
    expect(parseCategories("staff")).toEqual(["F", "P", "R", "S", "Y", "G", "T", "L", "E"])
    expect(parseCategories("pool")).toEqual(["H", "V"])
  })

  test("the four categories partition the recruitment types with no overlap", () => {
    const all = ["consultant", "internship", "staff", "pool"].flatMap((c) => parseCategories(c))
    expect(new Set(all).size).toBe(all.length)
    expect(all.sort()).toEqual(["C", "E", "F", "G", "H", "I", "L", "N", "P", "R", "S", "T", "V", "Y"])
  })

  test("networks accept friendly names and codes, dedupe, uppercase", () => {
    expect(parseNetworks("ict, scinet, ITECNET")).toEqual(["ITECNET", "SCINET"])
  })

  test("reject unknown values instead of sending them (the server would ignore them)", () => {
    expect(() => parseCategories("volunteer")).toThrow(/unknown value "volunteer"/)
    // The old jc codes are not accepted: sending jc would drop the keyword.
    expect(() => parseCategories("PD")).toThrow(/unknown value/)
    expect(() => parseNetworks("ITNET")).toThrow(/unknown value/)
  })
})

describe("locations", () => {
  const vocab = parseLocationVocabulary(FILTERS_RESPONSE)!

  test("parses the portal's jl vocabulary", () => {
    expect(vocab.find((e) => e.code === "ROME")).toEqual({
      name: "Rome",
      code: "ROME",
      country: "Italy",
      dutyStations: ["ROME"],
    })
    expect(parseLocationVocabulary({ data: {} })).toBeNull()
  })

  test("splitLocations accepts ';' and ','", () => {
    expect(splitLocations("Rome; Geneva,New York")).toEqual(["Rome", "Geneva", "New York"])
  })

  test("resolves by name, code, country; the catch-all never matches", () => {
    expect(resolveLocations(["rome"], vocab).codes).toEqual(["ROME"])
    expect(resolveLocations(["NEWYORK"], vocab).codes).toEqual(["NEWYORK"])
    expect(resolveLocations(["Italy"], vocab)).toEqual({ codes: ["ROME", "BRINDISI"], matched: ["Rome", "Brindisi", "Turin"] })
    expect(resolveLocations(["Turin"], vocab)).toEqual({ codes: [], matched: ["Turin"] })
    expect(() => resolveLocations(["OTHER"], vocab)).toThrow(/not a UN Careers duty station/)
    expect(() => resolveLocations(["ALL"], vocab)).toThrow(/not a UN Careers duty station/)
  })
})

describe("record mapping", () => {
  test("toJobCard maps a real-shaped item", () => {
    const c = toJobCard(STAFF)!
    expect(c).toMatchObject({
      id: "285249",
      title: "INFORMATION SYSTEMS OFFICER, P3",
      company: "United Nations Joint Staff Pension Fund - Pension Administration",
      location: "NEW YORK",
      date: "2026-09-22",
      deadline: "2026-10-06",
      level: "P-3",
      category: "Professional and Higher Categories",
      categoryCode: "PD",
      jobFamily: "Information Management Systems and Technology",
      recruitmentType: "Position Specific Job Openings",
    })
  })

  test("several duty stations are joined with '; '", () => {
    const c = toJobCard({ ...STAFF, dutyStation: [{ description: "GENEVA" }, { description: "VIENNA" }] })!
    expect(c.location).toBe("GENEVA; VIENNA")
  })

  test("falls back to jobTitle, skips items with no id or title", () => {
    expect(toJobCard({ jobId: 5, jobTitle: "Clerk" })!.title).toBe("Clerk")
    expect(toJobCard({ jobId: 5 })).toBeNull()
    expect(toJobCard({ postingTitle: "x" })).toBeNull()
    expect(toJobCard({ jobId: -1, postingTitle: "x" })).toBeNull()
  })

  test("toJobDetail builds a sectioned plain-text description", () => {
    const d = toJobDetail(STAFF)!
    expect(d.description).toStartWith("Org. Setting and Reporting\nThe Fund was established in 1949.\nThis position")
    expect(d.description).toContain("Responsibilities\nThe officer will:\n- Manage projects.\n- Develop specifications.")
  })

  test("toJobDetail falls back to whole-text conversion when sections are missing", () => {
    expect(toJobDetail({ jobId: 9, postingTitle: "X", jobDescription: "<p>Plain &amp; simple</p>" })!.description).toBe(
      "Plain & simple",
    )
  })
})

describe("parseIdInput", () => {
  test("accepts ids and careers.un.org posting URLs only", () => {
    expect(parseIdInput("285103")).toBe("285103")
    expect(parseIdInput(" 285103 ")).toBe("285103")
    expect(parseIdInput("https://careers.un.org/jobSearchDescription/285103?language=en")).toBe("285103")
    expect(parseIdInput("https://careers.un.org/jobSearchDescription/285103")).toBe("285103")
    expect(parseIdInput("https://careers.un.org/lbw/jobdetail.aspx?id=285103")).toBe("285103")
  })

  test("rejects other hosts, non-numeric ids and junk", () => {
    expect(parseIdInput("https://careers.un.org.evil.example/jobSearchDescription/1")).toBeNull()
    expect(parseIdInput("https://evil.example/jobSearchDescription/1")).toBeNull()
    expect(parseIdInput("abc")).toBeNull()
    expect(parseIdInput("1234567890")).toBeNull()
    expect(parseIdInput("https://careers.un.org/jobopening")).toBeNull()
  })
})
