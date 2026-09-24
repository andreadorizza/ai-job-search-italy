import { describe, expect, test } from "bun:test"
import { parseJSON, runCLI } from "./helpers.js"

// Live smoke test against the real site. Skipped unless PORTAL_LIVE_TESTS=1,
// so CI and ordinary `bun run test` stay offline. Two requests in total: one
// listing page, one posting page.
//
//   PORTAL_LIVE_TESTS=1 bun run test tests/live.test.ts

const live = process.env.PORTAL_LIVE_TESTS === "1"

interface SearchOut {
  meta: { count: number; page: number; attribution: { license: string } }
  results: Array<{
    id: string | null
    title: string | null
    company: string | null
    url: string | null
    publishedMonth: string | null
    source: string | null
  }>
}

describe.skipIf(!live)("live: www.info-cooperazione.it", () => {
  let firstId = ""

  test("search returns real results with id, title, company and url", async () => {
    // "dati" appears in almost every posting's privacy line, so it always has hits.
    const out = parseJSON<SearchOut>(await runCLI(["search", "-q", "dati", "--limit", "5"]))
    expect(out.meta.page).toBe(1)
    expect(out.meta.attribution.license).toBe("CC BY-NC-SA 4.0")
    expect(out.results.length).toBeGreaterThanOrEqual(1)
    for (const r of out.results) {
      expect(r.id).toMatch(/^\d{4}\/\d{1,2}\/[A-Za-z0-9-]+$/)
      expect(r.title).toBeTruthy()
      expect(r.title).not.toMatch(/<[a-z/][^>]*>|&[a-z]+;/i)
      expect(r.company).toBeTruthy()
      expect(r.url).toStartWith("https://www.info-cooperazione.it/")
      expect(r.publishedMonth).toMatch(/^\d{4}-\d{2}$/)
      expect(r.source).toContain("info-cooperazione.it")
    }
    firstId = out.results[0]!.id!
  })

  test("detail returns the same posting with a clean description and exact date", async () => {
    expect(firstId).not.toBe("")
    const d = parseJSON<{ id: string; title: string; date: string | null; description: string | null }>(
      await runCLI(["detail", firstId]),
    )
    expect(d.id).toBe(firstId)
    expect(d.title).toBeTruthy()
    expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect((d.description ?? "").length).toBeGreaterThan(200)
    expect(d.description ?? "").not.toMatch(/<[a-z/][^>]*>|&[a-z]+;/i)
  })
})
