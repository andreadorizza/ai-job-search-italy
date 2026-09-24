import { describe, expect, test } from "bun:test"
import { parseJSON, runCLI } from "./helpers.js"

// Live smoke test against the real feed. Skipped unless PORTAL_LIVE_TESTS=1,
// so CI and ordinary `bun run test` stay offline. Two requests in total: one
// category feed for search, the same feed again for detail.
//
//   PORTAL_LIVE_TESTS=1 bun run test tests/live.test.ts

const live = process.env.PORTAL_LIVE_TESTS === "1"

interface SearchOut {
  meta: { count: number; page: number; source: string }
  results: Array<{ id: string | null; title: string | null; company: string | null; url: string | null; date: string | null }>
}

describe.skipIf(!live)("live: remoteimpact.org feed", () => {
  let firstId = ""

  test("search returns real results with id, title and url", async () => {
    const out = parseJSON<SearchOut>(await runCLI(["search", "-q", "research", "-c", "ai-safety", "--limit", "5"]))
    expect(out.meta.page).toBe(1)
    expect(out.meta.source).toContain("remoteimpact.org")
    expect(out.results.length).toBeGreaterThanOrEqual(1)
    for (const r of out.results) {
      expect(r.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(r.title).toBeTruthy()
      expect(r.title).not.toMatch(/<[a-z/][^>]*>|&[a-z]+;/i)
      expect(r.url).toStartWith("https://remoteimpact.org/jobs/")
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    firstId = out.results[0]!.id!
  })

  test("detail returns the same job with a clean description", async () => {
    expect(firstId).not.toBe("")
    const d = parseJSON<{ id: string; title: string; description: string | null }>(
      await runCLI(["detail", firstId, "-c", "ai-safety"]),
    )
    expect(d.id).toBe(firstId)
    expect(d.title).toBeTruthy()
    expect(d.description ?? "").not.toMatch(/<[a-z/][^>]*>|&[a-z]+;/i)
  })
})
