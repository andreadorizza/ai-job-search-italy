import { afterEach, describe, expect, test } from "bun:test"
import { fetchWithRetry } from "../src/helpers.js"

// The portal contract requires exponential backoff with jitter on 429/5xx.
// These tests pin the retry loop offline: a stubbed fetch counts attempts, and
// a stubbed setTimeout fires immediately so the exhaustion case does not sleep
// through the real 500ms -> 8s schedule.

const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout
const URL_ = "https://remoteimpact.org/feed/jobs/"

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

describe("fetchWithRetry", () => {
  test("retries a 429 and succeeds on the next attempt", async () => {
    instantTimers()
    const state = stubFetch([() => new Response("", { status: 429 }), () => new Response("ok")])
    const res = await fetchWithRetry(URL_)
    expect(await res!.text()).toBe("ok")
    expect(state.calls).toBe(2)
  })

  test("retries a 503 as well as a 429", async () => {
    instantTimers()
    const state = stubFetch([() => new Response("", { status: 503 }), () => new Response("ok")])
    await fetchWithRetry(URL_)
    expect(state.calls).toBe(2)
  })

  test("backs off exponentially, caps the delay, and gives up after 6 retries", async () => {
    const delays = instantTimers()
    const state = stubFetch([() => new Response("", { status: 500 })])
    await expect(fetchWithRetry(URL_)).rejects.toThrow(/Request failed: 500/)
    expect(state.calls).toBe(7) // 1 initial + 6 retries
    expect(delays).toHaveLength(6)
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]!).toBeGreaterThan(delays[i - 1]! - 500)
    }
    expect(Math.max(...delays)).toBeLessThanOrEqual(8000 + 500)
  })

  test("does not retry a 4xx that is not 429", async () => {
    instantTimers()
    const state = stubFetch([() => new Response("", { status: 403 })])
    const res = await fetchWithRetry(URL_)
    expect(res!.status).toBe(403)
    expect(state.calls).toBe(1)
  })

  test("returns null on 404 instead of throwing", async () => {
    stubFetch([() => new Response("", { status: 404 })])
    expect(await fetchWithRetry(URL_)).toBeNull()
  })
})

describe("request shape", () => {
  test("sends an honest User-Agent, never a browser impersonation", async () => {
    const state = stubFetch([() => new Response("ok")])
    await fetchWithRetry(URL_)
    const headers = state.init[0]!.headers as Record<string, string>
    expect(headers["User-Agent"]).toBe("Mozilla/5.0 (compatible; remoteimpact-cli/1.0)")
    expect(headers["User-Agent"]).not.toContain("Chrome")
    expect(headers["User-Agent"]).not.toContain("Safari")
  })

  test("sets a hard per-attempt timeout so a hung server cannot stall a scrape", async () => {
    const state = stubFetch([() => new Response("ok")])
    await fetchWithRetry(URL_)
    expect(state.init[0]!.signal).toBeInstanceOf(AbortSignal)
  })
})
