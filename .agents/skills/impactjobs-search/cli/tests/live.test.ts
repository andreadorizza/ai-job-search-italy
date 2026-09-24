import { describe, expect, test } from "bun:test"
import { parseJSON, runCLI } from "./helpers.js"

// Live smoke test against the real board. Skipped unless PORTAL_LIVE_TESTS=1,
// so CI and ordinary `bun run test` stay offline. Two requests in total, one
// second apart (the CLI honours robots.txt Crawl-delay: 1 across runs).
//
//   PORTAL_LIVE_TESTS=1 bun run test tests/live.test.ts

const live = process.env.PORTAL_LIVE_TESTS === "1"

interface SearchOut {
  meta: { count: number; page: number; skipped: number }
  results: Array<{
    id: string | null
    title: string | null
    company: string | null
    url: string | null
    date: string | null
    remote: boolean | null
  }>
}

describe.skipIf(!live)("live: impactjobs.org", () => {
  let firstId = ""

  test("search returns real remote results with id, title and url", async () => {
    const out = parseJSON<SearchOut>(await runCLI(["search", "-q", "data", "--remote", "--limit", "5"]))
    expect(out.meta.page).toBe(1)
    expect(out.meta.skipped).toBe(0)
    expect(out.results.length).toBeGreaterThanOrEqual(1)
    for (const r of out.results) {
      expect(r.id).toMatch(/^\d+$/)
      expect(r.title).toBeTruthy()
      expect(r.title).not.toMatch(/<[a-z/][^>]*>|&[a-z]+;/i)
      expect(r.company).toBeTruthy()
      expect(r.url).toStartWith(`https://impactjobs.org/jobs/${r.id}-`)
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(r.remote).toBe(true)
    }
    firstId = out.results[0]!.id!
  })

  test("detail returns the same job with a clean full description", async () => {
    expect(firstId).not.toBe("")
    const d = parseJSON<{ id: string; title: string; description: string | null; descriptionTruncated: boolean }>(
      await runCLI(["detail", firstId]),
    )
    expect(d.id).toBe(firstId)
    expect(d.title).toBeTruthy()
    expect(d.descriptionTruncated).toBe(false)
    expect((d.description ?? "").length).toBeGreaterThan(100)
    expect(d.description ?? "").not.toMatch(/<[a-z/][^>]*>|&[a-z]+;|\\u003C/i)
  })
})
