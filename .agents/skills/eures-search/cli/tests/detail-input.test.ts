import { describe, expect, test } from "bun:test"
import { detailUrl, parseIdInput } from "../src/helpers.js"

describe("parseIdInput - bare ids", () => {
  test("accepts a base64 EURES id, spaces and padding included", () => {
    expect(parseIdInput("OTkyMTM2IDE3")).toBe("OTkyMTM2IDE3")
    expect(parseIdInput("OTkyMTM2 IDE3==")).toBe("OTkyMTM2 IDE3==")
  })

  test("trims surrounding whitespace", () => {
    expect(parseIdInput("  OTkyMTM2IDE3  ")).toBe("OTkyMTM2IDE3")
  })

  test("rejects an empty id", () => {
    expect(parseIdInput("")).toBeNull()
    expect(parseIdInput("   ")).toBeNull()
  })

  test("rejects characters that cannot appear in a EURES id", () => {
    expect(parseIdInput("../../etc/passwd")).toBeNull()
    expect(parseIdInput("id;rm -rf /")).toBeNull()
  })
})

describe("parseIdInput - URLs are host- and path-gated", () => {
  test("accepts the canonical vacancy URL and extracts the id", () => {
    expect(parseIdInput("https://europa.eu/eures/portal/jv-se/jv-details/OTkyMTM2IDE3?lang=en")).toBe(
      "OTkyMTM2IDE3",
    )
  })

  test("percent-decodes an encoded id", () => {
    expect(parseIdInput("https://europa.eu/eures/portal/jv-se/jv-details/OTky%20MTM2")).toBe("OTky MTM2")
  })

  test("tolerates a trailing slash", () => {
    expect(parseIdInput("https://europa.eu/eures/portal/jv-se/jv-details/ABC/")).toBe("ABC")
  })

  test("rejects another host entirely", () => {
    // The whole point of the gate: an attacker-supplied URL must never steer
    // the fetch. The id is re-extracted and the request URL rebuilt from it.
    expect(parseIdInput("https://evil.example/eures/portal/jv-se/jv-details/ABC")).toBeNull()
  })

  test("rejects a host that merely embeds europa.eu", () => {
    expect(parseIdInput("https://europa.eu.evil.example/eures/portal/jv-se/jv-details/ABC")).toBeNull()
  })

  test("rejects a different path on the right host", () => {
    expect(parseIdInput("https://europa.eu/eures/api/jv-searchengine/public/jv-search/search")).toBeNull()
    expect(parseIdInput("https://europa.eu/")).toBeNull()
  })

  test("rejects a non-http scheme", () => {
    expect(parseIdInput("file:///etc/passwd")).toBeNull()
    expect(parseIdInput("javascript:alert(1)")).toBeNull()
  })

  test("rejects a malformed URL", () => {
    expect(parseIdInput("https://")).toBeNull()
  })

  test("accepts a europa.eu subdomain", () => {
    expect(parseIdInput("https://ec.europa.eu/eures/portal/jv-se/jv-details/ABC")).toBe("ABC")
  })
})

describe("detailUrl", () => {
  test("percent-encodes the id so the space in it stays valid", () => {
    expect(detailUrl("OTky MTM2")).toBe(
      "https://europa.eu/eures/portal/jv-se/jv-details/OTky%20MTM2?lang=en",
    )
  })

  test("round-trips through parseIdInput", () => {
    const id = "OTkyMTM2IDE3"
    expect(parseIdInput(detailUrl(id))).toBe(id)
  })
})
