import { describe, expect, test } from "bun:test"
import { parseJSON, runCLI } from "./helpers.js"

// Live smoke test against the real ReliefWeb API. It needs an approved
// appname, so it is skipped unless RELIEFWEB_APPNAME is set - CI and fresh
// clones stay green and offline. Two requests per run; keep it that way.
const HAS_APPNAME = Boolean(process.env.RELIEFWEB_APPNAME?.trim())

interface Result {
  id: string | null
  title: string | null
  url: string | null
}

describe.skipIf(!HAS_APPNAME)("live ReliefWeb API", () => {
  test("search returns real jobs, and detail returns clean text for one of them", async () => {
    const search = await runCLI(["search", "-q", "data", "--remote", "--limit", "5"])
    const parsed = parseJSON<{ meta: { count: number }; results: Result[] }>(search)
    expect(parsed.results.length).toBeGreaterThanOrEqual(1)
    for (const r of parsed.results) {
      expect(r.id).toMatch(/^\d+$/)
      expect(r.title).toBeTruthy()
      expect(r.url).toContain("reliefweb.int")
    }

    const detail = await runCLI(["detail", parsed.results[0]!.id!])
    const d = parseJSON<{ id: string; description: string | null }>(detail)
    expect(d.id).toBe(parsed.results[0]!.id!)
    expect(d.description ?? "").not.toMatch(/<\/?(p|div|br|li)\b/i)
  })
})
