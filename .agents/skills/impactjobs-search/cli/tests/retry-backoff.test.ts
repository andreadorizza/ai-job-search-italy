import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fetchWithRetry, politeWait, settings } from "../src/helpers.js"

// The portal contract requires exponential backoff with jitter on 429/5xx, and
// robots.txt asks for a 1-second crawl delay. These tests pin both offline: a
// stubbed fetch counts attempts, and a stubbed setTimeout fires immediately
// while recording the delay it was asked for.

const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout
const originalSettings = { ...settings }
const URL_ = "https://impactjobs.org/jobs?order=posted_at"

settings.crawlDelayMs = 0

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.setTimeout = originalSetTimeout
  settings.crawlDelayMs = 0
  settings.stampFile = originalSettings.stampFile
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

  test("backs off exponentially from at least the crawl delay, caps it, and gives up after 6 retries", async () => {
    const delays = instantTimers()
    const state = stubFetch([() => new Response("", { status: 500 })])
    await expect(fetchWithRetry(URL_)).rejects.toThrow(/Request failed: 500/)
    expect(state.calls).toBe(7) // 1 initial + 6 retries
    expect(delays).toHaveLength(6)
    expect(delays[0]!).toBeGreaterThanOrEqual(1000)
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]!).toBeGreaterThan(delays[i - 1]! - 500)
    }
    expect(Math.max(...delays)).toBeLessThanOrEqual(16000 + 500)
  })

  test("waits at least as long as a Retry-After header asks", async () => {
    const delays = instantTimers()
    stubFetch([() => new Response("", { status: 429, headers: { "Retry-After": "20" } }), () => new Response("ok")])
    await fetchWithRetry(URL_)
    expect(delays[0]!).toBeGreaterThanOrEqual(20000)
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
    expect(headers["User-Agent"]).toBe("Mozilla/5.0 (compatible; impactjobs-cli/1.0)")
    expect(headers["User-Agent"]).not.toContain("Chrome")
    expect(headers["User-Agent"]).not.toContain("Safari")
  })

  test("sets a hard per-attempt timeout so a hung server cannot stall a scrape", async () => {
    const state = stubFetch([() => new Response("ok")])
    await fetchWithRetry(URL_)
    expect(state.init[0]!.signal).toBeInstanceOf(AbortSignal)
  })
})

describe("crawl delay (robots.txt Crawl-delay: 1)", () => {
  function useStamp(): string {
    const file = join(tmpdir(), `impactjobs-cli-test-${process.pid}-${Math.random().toString(36).slice(2)}`)
    settings.stampFile = file
    settings.crawlDelayMs = 1000
    return file
  }

  test("the first request ever does not wait, and records its time", async () => {
    const file = useStamp()
    const delays = instantTimers()
    await politeWait(1_000_000)
    expect(delays).toEqual([])
    expect(readFileSync(file, "utf8")).toBe("1000000")
    rmSync(file)
  })

  test("a request 300 ms after the last one waits the remaining 700 ms", async () => {
    const file = useStamp()
    writeFileSync(file, "1000000")
    const delays = instantTimers()
    await politeWait(1_000_300)
    expect(delays).toEqual([700])
    expect(readFileSync(file, "utf8")).toBe("1001000")
    rmSync(file)
  })

  test("a request long after the last one does not wait", async () => {
    const file = useStamp()
    writeFileSync(file, "1000000")
    const delays = instantTimers()
    await politeWait(1_005_000)
    expect(delays).toEqual([])
    rmSync(file)
  })

  test("a stamp from the future (clock change) is ignored rather than obeyed", async () => {
    const file = useStamp()
    writeFileSync(file, String(9_000_000_000))
    const delays = instantTimers()
    await politeWait(1_000_000)
    expect(delays).toEqual([])
    rmSync(file)
  })

  test("an unwritable stamp location never blocks the request", async () => {
    settings.crawlDelayMs = 1000
    settings.stampFile = join(tmpdir(), "no-such-dir-impactjobs", "nested", "stamp")
    instantTimers()
    await politeWait(1_000_000)
    expect(existsSync(settings.stampFile)).toBe(false)
  })

  test("fetchWithRetry waits out the crawl delay before each attempt", async () => {
    const file = useStamp()
    writeFileSync(file, String(Date.now()))
    const delays = instantTimers()
    stubFetch([() => new Response("ok")])
    await fetchWithRetry(URL_)
    expect(delays).toHaveLength(1)
    expect(delays[0]!).toBeGreaterThan(900)
    expect(delays[0]!).toBeLessThanOrEqual(1000)
    rmSync(file)
  })
})
