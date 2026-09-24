import { describe, expect, test } from "bun:test"
import { parseJSON, runCLI } from "./helpers.js"

// Live smoke test against the real board. Skipped unless PORTAL_LIVE_TESTS=1,
// so CI and ordinary `bun run test` stay offline. Four requests in total:
// two for search (board page + index), two for detail.
//
//   PORTAL_LIVE_TESTS=1 bun run test tests/live.test.ts

const live = process.env.PORTAL_LIVE_TESTS === "1"

interface SearchOut {
  meta: { count: number; page: number }
  results: Array<{ id: string | null; title: string | null; url: string | null; date: string | null }>
}

describe.skipIf(!live)("live: jobs.80000hours.org", () => {
  let firstId = ""

  test("search returns real results with id, title and url", async () => {
    const out = parseJSON<SearchOut>(await runCLI(["search", "-q", "machine learning", "--limit", "5"]))
    expect(out.meta.page).toBe(1)
    expect(out.results.length).toBeGreaterThanOrEqual(1)
    for (const r of out.results) {
      expect(r.id).toMatch(/^\d+$/)
      expect(r.title).toBeTruthy()
      expect(r.url).toStartWith("https://jobs.80000hours.org/jobs?jobPk=")
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    firstId = out.results[0]!.id!
  })

  test("detail returns the same job with a clean summary", async () => {
    expect(firstId).not.toBe("")
    const d = parseJSON<{ id: string; title: string; description: string | null }>(
      await runCLI(["detail", firstId]),
    )
    expect(d.id).toBe(firstId)
    expect(d.title).toBeTruthy()
    expect(d.description ?? "").not.toMatch(/<[a-z/][^>]*>|&[a-z]+;/i)
  })
})
