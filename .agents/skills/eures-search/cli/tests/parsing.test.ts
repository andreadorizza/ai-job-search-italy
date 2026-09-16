import { describe, expect, test } from "bun:test"
import {
  buildSearchBody,
  cleanText,
  detailUrl,
  locationFromMap,
  toIsoDate,
  toJobCard,
  toJobDetail,
  toLocationCodes,
  withinJobAge,
  type EuresRaw,
} from "../src/helpers.js"

describe("toLocationCodes", () => {
  test("maps Italian region names to NUTS-2 codes", () => {
    expect(toLocationCodes("Lombardia")).toEqual(["ITC4"])
    expect(toLocationCodes("Emilia-Romagna")).toEqual(["ITH5"])
  })

  test("is insensitive to case, accents and punctuation", () => {
    expect(toLocationCodes("valle d'aosta")).toEqual(["ITC2"])
    expect(toLocationCodes("FRIULI VENEZIA GIULIA")).toEqual(["ITH4"])
  })

  test("splits on commas and trims", () => {
    expect(toLocationCodes(" Lombardia , Veneto ")).toEqual(["ITC4", "ITH3"])
  })

  test("passes country and NUTS codes through untouched", () => {
    expect(toLocationCodes("it")).toEqual(["it"])
    expect(toLocationCodes("ITC4C")).toEqual(["ITC4C"])
  })

  test("passes an unknown place through rather than dropping it", () => {
    // Dropping it would widen the search instead of narrowing it, which is
    // the more dangerous failure: you would silently get all of the EU.
    expect(toLocationCodes("Atlantis")).toEqual(["Atlantis"])
  })

  test("an empty location means no filter at all", () => {
    expect(toLocationCodes("")).toEqual([])
    expect(toLocationCodes("  ")).toEqual([])
  })
})

describe("locationFromMap", () => {
  test("resolves a NUTS-3 code via its NUTS-2 parent", () => {
    expect(locationFromMap({ IT: ["ITH54"] })).toBe("Emilia-Romagna (IT)")
  })

  test("de-duplicates provinces that share a region", () => {
    expect(locationFromMap({ IT: ["ITC4A", "ITC4C"] })).toBe("Lombardia (IT)")
  })

  test("keeps an unknown code verbatim", () => {
    expect(locationFromMap({ DE: ["DE21"] })).toBe("DE21 (DE)")
  })

  test("falls back to the country when no codes are given", () => {
    expect(locationFromMap({ FR: [] })).toBe("FR")
  })

  test("returns null for missing input", () => {
    expect(locationFromMap(null)).toBeNull()
    expect(locationFromMap(undefined)).toBeNull()
  })
})

describe("toIsoDate", () => {
  test("converts epoch milliseconds to YYYY-MM-DD", () => {
    expect(toIsoDate(1789466591560)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(toIsoDate(0)).toBe("1970-01-01")
  })

  test("returns null for anything unusable", () => {
    expect(toIsoDate(null)).toBeNull()
    expect(toIsoDate(undefined)).toBeNull()
    expect(toIsoDate(NaN)).toBeNull()
  })
})

describe("cleanText", () => {
  test("strips tags and decodes entities", () => {
    expect(cleanText("<p>Ciao&nbsp;&amp; benvenuto</p>")).toBe("Ciao & benvenuto")
  })

  test("preserves Italian accented characters", () => {
    expect(cleanText("opportunità lavorativa perché più")).toBe(
      "opportunità lavorativa perché più",
    )
  })

  test("decodes numeric entities, decimal and hex", () => {
    expect(cleanText("caff&#232; e citt&#xE0;")).toBe("caffè e città")
  })

  test("turns <br> into newlines and collapses runs of blank lines", () => {
    expect(cleanText("a<br>b<br/>c")).toBe("a\nb\nc")
    expect(cleanText("a</p><p>b")).toBe("a\n\nb")
  })

  test("returns null for empty or missing input", () => {
    expect(cleanText("")).toBeNull()
    expect(cleanText(null)).toBeNull()
    expect(cleanText("   ")).toBeNull()
  })
})

const RAW: EuresRaw = {
  id: "OTkyMTM2IDE3",
  title: "tecnico di attrezzature",
  description: "Descrizione dell'<b>offerta</b>",
  creationDate: 1789466591560,
  lastModificationDate: 1789509737707,
  numberOfPosts: 2,
  locationMap: { IT: ["ITH54"] },
  positionOfferingCode: "temporary",
  availableLanguages: ["it"],
  employer: { name: "GI GROUP S.P.A.", website: null },
}

describe("toJobCard", () => {
  test("maps every contract field", () => {
    const card = toJobCard(RAW)!
    expect(card.id).toBe("OTkyMTM2IDE3")
    expect(card.title).toBe("tecnico di attrezzature")
    expect(card.company).toBe("GI GROUP S.P.A.")
    expect(card.location).toBe("Emilia-Romagna (IT)")
    expect(card.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(card.url).toBe(detailUrl("OTkyMTM2IDE3"))
    expect(card.description).toBe("Descrizione dell'offerta")
  })

  test("emits null rather than omitting an unknown field", () => {
    const card = toJobCard({ id: "x", title: "t" })!
    for (const key of ["company", "companyUrl", "location", "date", "deadline", "description"]) {
      expect(Object.hasOwn(card, key)).toBe(true)
      expect(card[key as keyof typeof card]).toBeNull()
    }
  })

  test("rejects a record with no id or no title", () => {
    expect(toJobCard({ title: "t" })).toBeNull()
    expect(toJobCard({ id: "x" })).toBeNull()
    expect(toJobCard({})).toBeNull()
  })
})

describe("toJobDetail", () => {
  test("adds the detail-only fields on top of the card", () => {
    const d = toJobDetail(RAW)!
    expect(d.numberOfPosts).toBe(2)
    expect(d.contractType).toBe("temporary")
    expect(d.languages).toEqual(["it"])
    expect(d.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test("defaults languages to an empty array", () => {
    expect(toJobDetail({ id: "x", title: "t" })!.languages).toEqual([])
  })
})

describe("withinJobAge", () => {
  const card = (date: string | null) => ({ ...toJobCard(RAW)!, date })

  test("keeps recent vacancies and drops old ones", () => {
    const today = new Date().toISOString().slice(0, 10)
    const old = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)
    const kept = withinJobAge([card(today), card(old)], 14)
    expect(kept).toHaveLength(1)
    expect(kept[0]!.date).toBe(today)
  })

  test("keeps a vacancy with no date rather than guessing it is stale", () => {
    expect(withinJobAge([card(null)], 1)).toHaveLength(1)
  })

  test("the default window filters nothing", () => {
    const old = new Date(Date.now() - 5000 * 86400000).toISOString().slice(0, 10)
    expect(withinJobAge([card(old)], 9999)).toHaveLength(1)
  })
})

describe("buildSearchBody", () => {
  const body = buildSearchBody({
    query: "data engineer",
    page: 2,
    perPage: 20,
    locationCodes: ["it"],
    sort: "MOST_RECENT",
  })

  test("sends every field the API's schema validator requires", () => {
    // The endpoint answers a bare {"key":"invalid-json"} if any is missing,
    // so this list is the contract - do not prune it.
    for (const key of [
      "resultsPerPage", "page", "sortSearch", "keywords", "publicationPeriod",
      "occupationUris", "skillUris", "requiredExperienceCodes", "positionScheduleCodes",
      "sectorCodes", "educationAndQualificationLevelCodes", "positionOfferingCodes",
      "locationCodes", "euresFlagCodes", "otherBenefitsCodes", "requiredLanguages",
      "minNumberPost", "sessionId", "requestLanguage",
    ]) {
      expect(Object.hasOwn(body, key)).toBe(true)
    }
  })

  test("uses the only specificSearchCode the API accepts", () => {
    // ID / JV_ID / REFERENCE are all rejected by the enum validator.
    expect(body.keywords).toEqual([{ keyword: "data engineer", specificSearchCode: "EVERYWHERE" }])
  })

  test("carries paging, sort and location through", () => {
    expect(body.page).toBe(2)
    expect(body.resultsPerPage).toBe(20)
    expect(body.sortSearch).toBe("MOST_RECENT")
    expect(body.locationCodes).toEqual(["it"])
  })
})
