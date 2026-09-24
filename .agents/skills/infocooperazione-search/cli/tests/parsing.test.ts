import { describe, expect, test } from "bun:test"
import {
  buildSearchUrl,
  decodeEntities,
  extractDiv,
  hasNextPage,
  htmlToText,
  matchCountry,
  monthFromId,
  parseCountryOptions,
  parseDetail,
  parseIdInput,
  parseItalianDate,
  parseJobCards,
  parseSlashDate,
  parseSummaryFacts,
  roleFromHeadline,
  withinJobage,
} from "../src/helpers.js"
import { CARD_A, DETAIL_HTML, DETAIL_ID, LISTING_HTML, listingPage } from "./fixtures.js"

describe("parseJobCards", () => {
  const cards = parseJobCards(LISTING_HTML)

  test("parses every well-formed card, skips the broken one and the sidebar teaser", () => {
    expect(cards.map((c) => c.id)).toEqual([
      "2026/9/ong-esempio-data-officer-italia",
      "2026/8/fondazione-prova-head-of-programmes-roster-paesi-vari",
    ])
  })

  test("reads every field of a card", () => {
    expect(cards[0]).toEqual({
      id: "2026/9/ong-esempio-data-officer-italia",
      title: "Data & Digital Officer",
      headline: "ONG ESEMPIO - Data & Digital Officer - Italia",
      roleCategory: "Data Officer",
      company: "ONG ESEMPIO",
      location: "Italia",
      date: null,
      publishedMonth: "2026-09",
      deadline: "2026-10-07",
      contractType: "Tempo det.",
      duration: "12 mesi",
      summary:
        "ONG ESEMPIO ETS sta selezionando un/a Data & Digital Officer da inserire nella sua operatività in Italia. " +
        "Durata 12 mesi. Tipo contratto: Tempo det. Scadenza candidature 07/10/2026 Sede: Roma",
      url: "https://www.info-cooperazione.it/2026/9/ong-esempio-data-officer-italia",
      source: "www.info-cooperazione.it – La community italiana della Cooperazione Internazionale",
    })
  })

  test("a role containing ' - ' keeps it; an empty duration is null, not 'mesi'", () => {
    expect(cards[1]!.title).toBe("Head of Programmes - Roster")
    expect(cards[1]!.roleCategory).toBe("Project Manager")
    expect(cards[1]!.location).toBe("Più paesi")
    expect(cards[1]!.deadline).toBe("2026-09-01")
    expect(cards[1]!.duration).toBeNull()
    expect(cards[1]!.contractType).toBe("Co.co.co.")
  })

  test("a duplicate card is emitted once", () => {
    expect(parseJobCards(listingPage([CARD_A, CARD_A]))).toHaveLength(1)
  })

  test("an empty or foreign page yields no cards rather than throwing", () => {
    expect(parseJobCards("")).toEqual([])
    expect(parseJobCards("<html><body>redesigned</body></html>")).toEqual([])
  })
})

describe("pagination", () => {
  test("detects a Next link", () => {
    expect(hasNextPage(LISTING_HTML)).toBe(true)
    expect(hasNextPage(listingPage([CARD_A]))).toBe(false)
  })
})

describe("roleFromHeadline", () => {
  test("strips the organisation and the place", () => {
    expect(roleFromHeadline("ONG - Project Manager - Kenya", "ONG")).toBe("Project Manager")
    expect(roleFromHeadline("ong - Project Manager - Kenya", "ONG")).toBe("Project Manager")
  })
  test("falls back to the first segment when the short name differs", () => {
    expect(roleFromHeadline("ISTITUTO X - Logista - Mozambico", "X")).toBe("Logista")
  })
  test("returns null when there is no ORG - Role structure", () => {
    expect(roleFromHeadline("Solo un titolo", null)).toBeNull()
  })
})

describe("dates", () => {
  test("Italian long dates", () => {
    expect(parseItalianDate("07 ottobre 2026")).toBe("2026-10-07")
    expect(parseItalianDate("1 Settembre 2026")).toBe("2026-09-01")
    expect(parseItalianDate("31 settembre 2026")).toBeNull()
    expect(parseItalianDate("presto")).toBeNull()
  })
  test("dd/mm/yyyy, never mm/dd", () => {
    expect(parseSlashDate("08/09/2026")).toBe("2026-09-08")
    expect(parseSlashDate("13/13/2026")).toBeNull()
  })
  test("publication month from the path", () => {
    expect(monthFromId("2026/9/x")).toBe("2026-09")
    expect(monthFromId("2025/12/x")).toBe("2025-12")
    expect(monthFromId("2026/13/x")).toBeNull()
  })
})

describe("withinJobage (month precision)", () => {
  const now = Date.UTC(2026, 8, 24) // 2026-09-24
  test("keeps the current month and the month the window starts in", () => {
    expect(withinJobage({ publishedMonth: "2026-09" }, 7, now)).toBe(true)
    expect(withinJobage({ publishedMonth: "2026-08" }, 30, now)).toBe(true)
  })
  test("drops months wholly before the window", () => {
    expect(withinJobage({ publishedMonth: "2026-08" }, 7, now)).toBe(false)
    expect(withinJobage({ publishedMonth: "2025-12" }, 60, now)).toBe(false)
  })
  test("keeps a card whose month is unknown", () => {
    expect(withinJobage({ publishedMonth: null }, 1, now)).toBe(true)
  })
})

describe("parseSummaryFacts", () => {
  test("reads duration, contract type and deadline from the site's generated sentence", () => {
    expect(
      parseSummaryFacts("X sta selezionando un/a Y. Durata 6 mesi. Tipo contratto: Stage/Tirocinio Scadenza candidature 07/10/2026 ..."),
    ).toEqual({ duration: "6 mesi", contractType: "Stage/Tirocinio", deadline: "2026-10-07" })
  })
  test("missing pieces are null", () => {
    expect(parseSummaryFacts("testo libero")).toEqual({ duration: null, contractType: null, deadline: null })
  })
})

describe("text cleaning", () => {
  test("decodes Italian entities case-sensitively", () => {
    expect(decodeEntities("perch&eacute; &Egrave; citt&agrave; &#x27;x&#x27; &amp;")).toBe("perché È città 'x' &")
  })

  test("htmlToText keeps paragraphs and bullets, merges one-item lists, never re-creates tags", () => {
    const text = htmlToText("<p>Uno</p>\n<ul><li>a</li></ul>\n<ul><li>b &lt;b&gt;</li></ul><p>Due<br>tre</p>")
    expect(text).toBe("Uno\n\n- a\n- b <b>\n\nDue\ntre")
  })

  test("extractDiv balances nested divs", () => {
    expect(extractDiv('<div class="a"><div>x</div>y</div><div>z</div>', /<div class="a">/)).toBe("<div>x</div>y")
    expect(extractDiv("<p>none</p>", /<div class="a">/)).toBeNull()
  })
})

describe("parseDetail", () => {
  const d = parseDetail(DETAIL_HTML, DETAIL_ID)!

  test("reads the header fields, including the exact publication date", () => {
    expect(d.title).toBe("Data & Digital Officer")
    expect(d.headline).toBe("ONG ESEMPIO - Data & Digital Officer - Italia")
    expect(d.roleCategory).toBe("Data Officer")
    expect(d.company).toBe("ONG ESEMPIO")
    expect(d.location).toBe("Italia")
    expect(d.date).toBe("2026-09-08")
    expect(d.publishedMonth).toBe("2026-09")
    expect(d.deadline).toBe("2026-10-07")
    expect(d.contractType).toBe("Tempo det.")
    expect(d.duration).toBe("12 mesi")
    expect(d.applyUrl).toBe("https://jobs.example.org/data-officer")
    expect(d.license).toBe("CC BY-NC-SA 4.0")
    expect(d.source).toContain("www.info-cooperazione.it")
  })

  test("the description is clean, readable text", () => {
    const text = d.description!
    expect(text).toContain("L’associazione è nata nel 1990.")
    expect(text).toContain("Sede: Roma – ibrido")
    expect(text).toContain("- Gestione del CRM donatori.\n- Analisi dei dati <b>di monitoraggio</b>.")
    expect(text).toContain("\n\n")
    expect(text).not.toMatch(/&[a-z]+;|&n bsp;/i)
    expect(text).not.toContain("LINK ALLA VACANCY")
  })

  test("returns null for a page with no title", () => {
    expect(parseDetail("<html><body>404</body></html>", DETAIL_ID)).toBeNull()
  })
})

describe("parseIdInput", () => {
  test("accepts an id, a leading-slash path, and site URLs", () => {
    expect(parseIdInput("2026/9/ong-x-italia")).toBe("2026/9/ong-x-italia")
    expect(parseIdInput("/2026/09/ong-x-italia/")).toBe("2026/9/ong-x-italia")
    expect(parseIdInput("https://www.info-cooperazione.it/2026/9/ong-x-italia")).toBe("2026/9/ong-x-italia")
    expect(parseIdInput("https://info-cooperazione.it/2026/9/ong-x-italia?utm=1")).toBe("2026/9/ong-x-italia")
  })
  test("rejects other hosts, other paths and injection attempts", () => {
    expect(parseIdInput("https://evil.example/2026/9/ong-x")).toBeNull()
    expect(parseIdInput("https://www.info-cooperazione.it/Category/lavoro")).toBeNull()
    expect(parseIdInput("2026/9/../../etc")).toBeNull()
    expect(parseIdInput("2026/9/a b")).toBeNull()
    expect(parseIdInput("12345")).toBeNull()
  })
})

describe("search URL and countries", () => {
  test("builds the listing URL with the site's own parameters", () => {
    const u = new URL(buildSearchUrl({ query: "program manager", page: 2, paeseId: "85" }))
    expect(u.origin + u.pathname).toBe("https://www.info-cooperazione.it/Category/Search")
    expect(u.searchParams.get("Cat")).toBe("3")
    expect(u.searchParams.get("s")).toBe("program manager")
    expect(u.searchParams.get("paese_id")).toBe("85")
    expect(u.searchParams.get("lavoro_non_scaduti")).toBe("True")
    expect(u.searchParams.get("page")).toBe("2")
  })

  test("omits empty filters", () => {
    const u = new URL(buildSearchUrl({ query: "", page: 1 }))
    expect(u.searchParams.has("s")).toBe(false)
    expect(u.searchParams.has("paese_id")).toBe(false)
  })

  test("reads the country list and matches names case- and accent-insensitively", () => {
    const countries = parseCountryOptions(LISTING_HTML)
    expect(countries).toHaveLength(5)
    expect(matchCountry(countries, "ITALIA")?.id).toBe("85")
    expect(matchCountry(countries, "Italy")?.id).toBe("85")
    expect(matchCountry(countries, "peru")?.id).toBe("130")
    expect(matchCountry(countries, "costa d’avorio")?.id).toBe("42")
    expect(matchCountry(countries, "paesi vari")?.id).toBe("188")
    expect(matchCountry(countries, "Atlantide")).toBeNull()
  })
})
