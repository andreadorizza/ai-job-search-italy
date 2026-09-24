import { afterEach, describe, expect, test } from "bun:test"
import { ApiError, JOBS_PATH, apiPost } from "../src/helpers.js"

// The portal contract requires exponential backoff with jitter on 429/5xx.
// A stubbed fetch counts attempts; a stubbed setTimeout fires immediately so
// the exhaustion case does not sleep through the real 500ms -> 8s schedule.

const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout
const APP = "unit-test-appname"

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
    const state = stubFetch([() => new Response("", { status: 429 }), () => ok({ totalCount: 1 })])
    const data = await apiPost<{ totalCount: number }>(JOBS_PATH, {}, APP)
    expect(data?.totalCount).toBe(1)
    expect(state.calls).toBe(2)
  })

  test("retries a 503 as well as a 429", async () => {
    instantTimers()
    const state = stubFetch([() => new Response("", { status: 503 }), () => ok({ data: [] })])
    await apiPost(JOBS_PATH, {}, APP)
    expect(state.calls).toBe(2)
  })

  test("backs off exponentially and caps the delay", async () => {
    const delays = instantTimers()
    stubFetch([() => new Response("", { status: 500 })])
    await expect(apiPost(JOBS_PATH, {}, APP)).rejects.toThrow(/ReliefWeb request failed: 500/)

    expect(delays).toHaveLength(6)
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]!).toBeGreaterThan(delays[i - 1]! - 500)
    }
    expect(Math.max(...delays)).toBeLessThanOrEqual(8000 + 500)
  })

  test("gives up after a bounded number of attempts, flagging the daily quota", async () => {
    instantTimers()
    const state = stubFetch([() => new Response("", { status: 429 })])
    const err = await apiPost(JOBS_PATH, {}, APP).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe("RATE_LIMITED")
    expect(state.calls).toBe(7) // 1 initial + 6 retries
  })

  test("does not retry a 403 (unapproved appname) - retrying cannot fix it", async () => {
    instantTimers()
    const state = stubFetch([() => new Response('{"status":403,"error":{"message":"nope"}}', { status: 403 })])
    const err = await apiPost(JOBS_PATH, {}, APP).catch((e) => e)
    expect((err as ApiError).code).toBe("INVALID_CREDENTIALS")
    expect(state.calls).toBe(1)
  })

  test("does not retry a 400", async () => {
    instantTimers()
    const state = stubFetch([() => new Response("", { status: 400 })])
    await expect(apiPost(JOBS_PATH, {}, APP)).rejects.toThrow(/ReliefWeb request failed: 400/)
    expect(state.calls).toBe(1)
  })

  test("404 returns null instead of throwing", async () => {
    stubFetch([() => new Response("", { status: 404 })])
    expect(await apiPost(JOBS_PATH, {}, APP)).toBeNull()
  })

  test("an HTML body (block page) is an error, not a JSON crash", async () => {
    stubFetch([() => new Response("<html>not available</html>", { status: 200 })])
    await expect(apiPost(JOBS_PATH, {}, APP)).rejects.toThrow(/HTML instead of JSON/)
  })

  test("error messages never echo the appname", async () => {
    instantTimers()
    stubFetch([
      () =>
        new Response(`{"error":{"message":"bad request for appname=${APP}"}}`, {
          status: 400,
          statusText: "Bad Request",
        }),
    ])
    const err = await apiPost(JOBS_PATH, {}, APP).catch((e) => e)
    expect(String((err as Error).message)).toContain("bad request for appname=<appname>")
    expect(String((err as Error).message)).not.toContain(APP)
  })
})

describe("apiPost network failures", () => {
  function timeoutError(): Error {
    const e = new Error("The operation timed out.")
    e.name = "TimeoutError"
    return e
  }

  test("a timeout is retried and can still succeed", async () => {
    instantTimers()
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      if (calls === 1) throw timeoutError()
      return ok({ totalCount: 2 })
    }) as unknown as typeof fetch
    const data = await apiPost<{ totalCount: number }>(JOBS_PATH, {}, APP)
    expect(data?.totalCount).toBe(2)
    expect(calls).toBe(2)
  })

  test("a hung API gives up after 3 attempts with a readable message", async () => {
    instantTimers()
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      throw timeoutError()
    }) as unknown as typeof fetch
    const err = await apiPost(JOBS_PATH, {}, APP).catch((e) => e)
    expect(calls).toBe(3)
    expect((err as ApiError).code).toBe("API_ERROR")
    expect((err as Error).message).toMatch(/did not answer within 20s \(3 attempts\)/)
  })

  test("a connection error that quotes the URL is scrubbed of the appname", async () => {
    instantTimers()
    globalThis.fetch = (async (url: string) => {
      throw new Error(`Unable to connect to ${url}`)
    }) as unknown as typeof fetch
    const err = await apiPost(JOBS_PATH, {}, APP).catch((e) => e)
    expect((err as Error).message).toContain("appname=<appname>")
    expect((err as Error).message).not.toContain(APP)
  })
})

describe("apiPost request shape", () => {
  test("sends an honest User-Agent, never a browser impersonation", async () => {
    const state = stubFetch([() => ok({ data: [] })])
    await apiPost(JOBS_PATH, {}, APP)
    const headers = state.init[0]!.headers as Record<string, string>
    expect(headers["User-Agent"]).toBe("Mozilla/5.0 (compatible; reliefweb-cli/1.0)")
    expect(headers["User-Agent"]).not.toContain("Chrome")
  })

  test("POSTs a JSON body", async () => {
    const state = stubFetch([() => ok({ data: [] })])
    await apiPost(JOBS_PATH, { limit: 1 }, APP)
    expect(state.init[0]!.method).toBe("POST")
    expect(state.init[0]!.body).toBe(JSON.stringify({ limit: 1 }))
  })

  test("sets a hard per-attempt timeout", async () => {
    const state = stubFetch([() => ok({ data: [] })])
    await apiPost(JOBS_PATH, {}, APP)
    expect(state.init[0]!.signal).toBeInstanceOf(AbortSignal)
  })
})
