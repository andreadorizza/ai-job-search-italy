import { describe, expect, test } from "bun:test"
import { parseJSON, runCLI } from "./helpers.js"

// Live smoke test against the real portal. Skipped unless PORTAL_LIVE_TESTS=1,
// so CI and ordinary `bun run test` stay offline. Two requests in total, both
// to the public list endpoint (detail never calls the per-job endpoint).
//
//   PORTAL_LIVE_TESTS=1 bun run test tests/live.test.ts

const live = process.env.PORTAL_LIVE_TESTS === "1"

interface SearchOut {
  meta: { count: number; page: number; total: number | null }
  results: Array<{
    id: string | null
    title: string | null
    company: string | null
    url: string | null
    date: string | null
    deadline: string | null
  }>
}

describe.skipIf(!live)("live: careers.un.org", () => {
  let firstId = ""

  test("search returns real results with id, title, department and url", async () => {
    const out = parseJSON<SearchOut>(await runCLI(["search", "-q", "software", "--limit", "5"]))
    expect(out.meta.page).toBe(1)
    expect(out.results.length).toBeGreaterThanOrEqual(1)
    for (const r of out.results) {
      expect(r.id).toMatch(/^\d+$/)
      expect(r.title).toBeTruthy()
      expect(r.company).toBeTruthy()
      expect(r.url).toStartWith("https://careers.un.org/jobSearchDescription/")
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(r.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    firstId = out.results[0]!.id!
  })

  test("detail returns the same posting with clean text", async () => {
    expect(firstId).not.toBe("")
    const d = parseJSON<{ id: string; title: string; description: string | null; sections: unknown[] }>(
      await runCLI(["detail", firstId]),
    )
    expect(d.id).toBe(firstId)
    expect(d.title).toBeTruthy()
    expect(d.sections.length).toBeGreaterThan(0)
    expect(d.description ?? "").not.toMatch(/<[a-z/][^>]*>|&[a-z]+;/i)
  })
})
