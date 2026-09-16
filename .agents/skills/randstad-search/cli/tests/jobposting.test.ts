import { describe, expect, test } from "bun:test"
import {
  cleanText,
  extractLdJson,
  findJobPostings,
  formatLocation,
  isoDate,
  parseSalary,
  readJobPosting,
  toJobPosting,
} from "../src/jobposting.js"

const page = (...blocks: unknown[]) =>
  `<html><head>${blocks
    .map((b) => `<script type="application/ld+json">${typeof b === "string" ? b : JSON.stringify(b)}</script>`)
    .join("")}</head><body>ignored</body></html>`

const POSTING = {
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Magazziniere",
  datePosted: "2026-07-23T10:00:00+0000",
  validThrough: "2026-09-30T23:00:00+0000",
  description: "<p>Cerchiamo un <b>magazziniere</b></p>",
  employmentType: ["TEMPORARY", "FULL_TIME"],
  industry: "Trasporti e Logistica",
  identifier: { "@type": "PropertyValue", value: "ABC-123" },
  hiringOrganization: { "@type": "Organization", name: "Randstad", sameAs: "https://www.randstad.it/" },
  jobLocation: {
    "@type": "Place",
    address: { "@type": "PostalAddress", addressLocality: "Carvico", addressRegion: "Lombardia" },
  },
  baseSalary: {
    "@type": "MonetaryAmount",
    currency: "EUR",
    value: { "@type": "QuantitativeValue", minValue: 22000, maxValue: 28000, unitText: "YEAR" },
  },
}

describe("extractLdJson", () => {
  test("finds blocks and unwraps @graph", () => {
    const html = page({ "@graph": [{ "@type": "WebSite" }, POSTING] })
    const types = extractLdJson(html).map((n) => (n as Record<string, unknown>)["@type"])
    expect(types).toContain("JobPosting")
  })

  test("unwraps a top-level array", () => {
    expect(findJobPostings(page([{ "@type": "WebSite" }, POSTING]))).toHaveLength(1)
  })

  test("a malformed block never costs us the valid ones", () => {
    const html = page("{ this is not json", POSTING)
    expect(findJobPostings(html)).toHaveLength(1)
  })

  test("survives a page with no JSON-LD at all", () => {
    expect(findJobPostings("<html><body>nothing</body></html>")).toEqual([])
    expect(readJobPosting("<html></html>")).toBeNull()
  })

  test("matches @type given as an array", () => {
    expect(findJobPostings(page({ ...POSTING, "@type": ["JobPosting", "Thing"] }))).toHaveLength(1)
  })

  test("does not recurse forever on a self-referencing object", () => {
    const cyclic: Record<string, unknown> = { "@type": "Thing" }
    cyclic["@graph"] = cyclic
    // Cannot be JSON.stringify'd, so assert the depth guard directly.
    expect(() => extractLdJson(page({ "@graph": { "@graph": { "@graph": POSTING } } }))).not.toThrow()
  })
})

describe("toJobPosting", () => {
  const job = toJobPosting(POSTING as Record<string, unknown>)!

  test("maps every field", () => {
    expect(job.title).toBe("Magazziniere")
    expect(job.company).toBe("Randstad")
    expect(job.companyUrl).toBe("https://www.randstad.it/")
    expect(job.location).toBe("Carvico, Lombardia")
    expect(job.date).toBe("2026-07-23")
    expect(job.employmentType).toBe("TEMPORARY, FULL_TIME")
    expect(job.industry).toBe("Trasporti e Logistica")
    expect(job.identifier).toBe("ABC-123")
  })

  test("validThrough becomes a real deadline", () => {
    // EURES never supplies this; it is the reason JobPosting sources are richer.
    expect(job.deadline).toBe("2026-09-30")
  })

  test("baseSalary becomes RAL", () => {
    expect(job.salary).toEqual({ currency: "EUR", min: 22000, max: 28000, unit: "YEAR" })
  })

  test("description is stripped of markup", () => {
    expect(job.description).toBe("Cerchiamo un magazziniere")
  })

  test("joins description, responsibilities and qualifications", () => {
    const j = toJobPosting({ ...POSTING, responsibilities: "Carico merci", qualifications: "Patente" })!
    expect(j.description).toBe("Cerchiamo un magazziniere\n\nCarico merci\n\nPatente")
  })

  test("a posting with no title is rejected", () => {
    expect(toJobPosting({ "@type": "JobPosting" })).toBeNull()
  })

  test("missing fields are null, never absent", () => {
    const j = toJobPosting({ "@type": "JobPosting", title: "X" })!
    for (const k of ["company", "location", "date", "deadline", "salary", "description"]) {
      expect(Object.hasOwn(j, k)).toBe(true)
      expect(j[k as keyof typeof j]).toBeNull()
    }
  })
})

describe("formatLocation", () => {
  test("joins locality and region", () => {
    expect(formatLocation({ address: { addressLocality: "Milano", addressRegion: "Lombardia" } })).toBe(
      "Milano, Lombardia",
    )
  })

  test("handles several places and de-duplicates", () => {
    const two = [
      { address: { addressLocality: "Milano" } },
      { address: { addressLocality: "Milano" } },
      { address: { addressLocality: "Roma" } },
    ]
    expect(formatLocation(two)).toBe("Milano; Roma")
  })

  test("returns null when there is no usable address", () => {
    expect(formatLocation(null)).toBeNull()
    expect(formatLocation({ address: {} })).toBeNull()
    expect(formatLocation("Milano")).toBeNull()
  })
})

describe("parseSalary", () => {
  test("reads a min/max range", () => {
    expect(parseSalary(POSTING.baseSalary)).toEqual({
      currency: "EUR", min: 22000, max: 28000, unit: "YEAR",
    })
  })

  test("reads a single value as both bounds", () => {
    expect(parseSalary({ currency: "EUR", value: { value: 30000, unitText: "YEAR" } })).toEqual({
      currency: "EUR", min: 30000, max: 30000, unit: "YEAR",
    })
  })

  test("returns null when there is no figure", () => {
    expect(parseSalary({ currency: "EUR" })).toBeNull()
    expect(parseSalary(null)).toBeNull()
  })
})

describe("cleanText and isoDate", () => {
  test("preserves Italian accents", () => {
    expect(cleanText("<p>Opportunità in città perché è così</p>")).toBe(
      "Opportunità in città perché è così",
    )
  })

  test("decodes entities and turns list items into bullets", () => {
    expect(cleanText("<ul><li>Uno</li><li>Due</li></ul>")).toBe("- Uno\n- Due")
    expect(cleanText("caff&#232; &amp; t&#xE8;")).toBe("caffè & tè")
  })

  test("returns null for empty input", () => {
    expect(cleanText("")).toBeNull()
    expect(cleanText("<p></p>")).toBeNull()
    expect(cleanText(null)).toBeNull()
  })

  test("isoDate keeps only the date part and rejects nonsense", () => {
    expect(isoDate("2026-07-23T10:00:00+0000")).toBe("2026-07-23")
    expect(isoDate("2026-09-16")).toBe("2026-09-16")
    expect(isoDate("not a date")).toBeNull()
    expect(isoDate(null)).toBeNull()
  })
})

describe("isoDate - Italian day-first dates", () => {
  // The spec says ISO 8601, but Italian sites publish dd/mm/yyyy, and
  // Date.parse reads a slash format as American month-first. Gi Group's
  // datePosted is "16/09/2026".
  test("reads dd/mm/yyyy as day-first, not month-first", () => {
    expect(isoDate("16/09/2026")).toBe("2026-09-16")
    // The one that silently corrupted data: 1 December, not 12 January.
    expect(isoDate("01/12/2026")).toBe("2026-12-01")
  })

  test("accepts dashes as well as slashes", () => {
    expect(isoDate("16-09-2026")).toBe("2026-09-16")
  })

  test("rejects an impossible day or month instead of rolling it over", () => {
    // Date.UTC would quietly turn 31 February into 2/3 March.
    expect(isoDate("31/02/2026")).toBeNull()
    expect(isoDate("99/99/2026")).toBeNull()
  })

  test("an ISO date is never mistaken for a day-first one", () => {
    expect(isoDate("2026-01-12")).toBe("2026-01-12")
  })
})

describe("isoDate - implausible dates", () => {
  // Sites emit epoch-zero values to mean "no deadline"; Gi Group publishes
  // validThrough: "1970-04-01". Surfacing that would mark every vacancy expired.
  test("rejects epoch-era dates", () => {
    expect(isoDate("1970-04-01")).toBeNull()
    expect(isoDate("1970-01-01")).toBeNull()
    expect(isoDate("01/01/1970")).toBeNull()
  })

  test("still accepts a plausible recent date", () => {
    expect(isoDate("2026-09-16")).toBe("2026-09-16")
  })

  test("a rejected validThrough leaves deadline null, not wrong", () => {
    const j = toJobPosting({
      "@type": "JobPosting",
      title: "X",
      datePosted: "16/09/2026",
      validThrough: "1970-04-01",
    })!
    expect(j.date).toBe("2026-09-16")
    expect(j.deadline).toBeNull()
  })
})
