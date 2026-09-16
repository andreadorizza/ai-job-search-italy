import { afterEach, describe, expect, test } from "bun:test"
import { SEARCH_PATH, apiPost } from "../src/helpers.js"

// The portal contract requires exponential backoff with jitter on 429/5xx.
// These tests pin the retry loop offline: a stubbed fetch counts attempts, and
// a stubbed setTimeout fires immediately so the exhaustion case does not sleep
// through the real 500ms -> 8s schedule.

const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.setTimeout = originalSetTimeout
})

function instantTimers(): number[] {
  const delays: number[] = []
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    delays.push(ms ?? 0)
    return originalSetTimeout(fn, 0)
  }) as unknown as typeof setTimeout
  return delays
}

function stubFetch(responses: Array<() => Response>): { calls: number; init: RequestInit[] } {
  const state = { calls: 0, init: [] as RequestInit[] }
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const i = Math.min(state.calls, responses.length - 1)
    state.calls++
    state.init.push(init)
    return responses[i]!()
  }) as unknown as typeof fetch

  return state
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })

describe("apiPost retry/backoff", () => {
  test("retries a 429 and succeeds on the next attempt", async () => {
    instantTimers()
    const state = stubFetch([
      () => new Response("", { status: 429 }),
      () => ok({ numberRecords: 1, jvs: [] }),
    ])

    const data = await apiPost<{ numberRecords: number }>(SEARCH_PATH, {})
    expect(data.numberRecords).toBe(1)
    expect(state.calls).toBe(2)
  })

  test("retries a 503 as well as a 429", async () => {
    instantTimers()
    const state = stubFetch([
      () => new Response("", { status: 503 }),
      () => ok({ jvs: [] }),
    ])
    await apiPost(SEARCH_PATH, {})
    expect(state.calls).toBe(2)
  })

  test("backs off exponentially and caps the delay", async () => {
    const delays = instantTimers()
    stubFetch([() => new Response("", { status: 500 })])
    await expect(apiPost(SEARCH_PATH, {})).rejects.toThrow(/Request failed: 500/)

    // 6 retries after the first attempt, each waiting base + up to 500ms jitter.
    expect(delays).toHaveLength(6)
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]!).toBeGreaterThan(delays[i - 1]! - 500)
    }
    expect(Math.max(...delays)).toBeLessThanOrEqual(8000 + 500)
  })

  test("gives up after a bounded number of attempts", async () => {
    instantTimers()
    const state = stubFetch([() => new Response("", { status: 429 })])
    await expect(apiPost(SEARCH_PATH, {})).rejects.toThrow()
    expect(state.calls).toBe(7) // 1 initial + 6 retries
  })

  test("does not retry a 4xx that is not 429", async () => {
    instantTimers()
    const state = stubFetch([() => new Response("", { status: 400 })])
    await expect(apiPost(SEARCH_PATH, {})).rejects.toThrow(/Request failed: 400/)
    expect(state.calls).toBe(1)
  })
})

describe("apiPost request shape", () => {
  test("sends an honest User-Agent, never a browser impersonation", async () => {
    const state = stubFetch([() => ok({ jvs: [] })])
    await apiPost(SEARCH_PATH, {})
    const headers = state.init[0]!.headers as Record<string, string>
    expect(headers["User-Agent"]).toBe("Mozilla/5.0 (compatible; eures-search-cli/1.0)")
    expect(headers["User-Agent"]).not.toContain("Chrome")
    expect(headers["User-Agent"]).not.toContain("Safari")
  })

  test("POSTs JSON and asks for Italian first", async () => {
    const state = stubFetch([() => ok({ jvs: [] })])
    await apiPost(SEARCH_PATH, { a: 1 })
    const init = state.init[0]!
    expect(init.method).toBe("POST")
    expect(init.body).toBe(JSON.stringify({ a: 1 }))
    const headers = init.headers as Record<string, string>
    expect(headers["Content-Type"]).toBe("application/json")
    expect(headers["Accept-Language"]).toContain("it-IT")
  })

  test("sets a hard per-attempt timeout so a hung server cannot stall a scrape", async () => {
    const state = stubFetch([() => ok({ jvs: [] })])
    await apiPost(SEARCH_PATH, {})
    expect(state.init[0]!.signal).toBeInstanceOf(AbortSignal)
  })
})
