import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers.js"

function errorOf(stderr: string): { error: string; code: string } {
  return JSON.parse(stderr.trim().split("\n").pop()!)
}

describe("unknown flags are rejected, never silently dropped", () => {
  test("search rejects a bogus flag", async () => {
    const r = await runCLI(["search", "-q", "x", "--nope", "1"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("UNKNOWN_FLAG")
    expect(r.stdout).toBe("")
  })

  test("a typo'd real flag is still unknown", async () => {
    const r = await runCLI(["search", "-q", "x", "--jobages", "7"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("detail rejects a search-only flag", async () => {
    const r = await runCLI(["detail", "ABC", "--limit", "5"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("UNKNOWN_FLAG")
  })
})

describe("required arguments", () => {
  test("search without --query fails with MISSING_REQUIRED", async () => {
    const r = await runCLI(["search"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("MISSING_REQUIRED")
  })

  test("a whitespace-only query is treated as missing", async () => {
    const r = await runCLI(["search", "-q", "   "])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("MISSING_REQUIRED")
  })

  test("detail without an id fails with MISSING_REQUIRED", async () => {
    const r = await runCLI(["detail"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("MISSING_REQUIRED")
  })
})

describe("numeric flags reject non-integers instead of truncating", () => {
  for (const [flag, value] of [
    ["--jobage", "0.5"],
    ["--jobage", "abc"],
    ["--jobage", "0"],
    ["--page", "-1"],
    ["--limit", "1.5"],
  ] as const) {
    test(`${flag} ${value}`, async () => {
      const r = await runCLI(["search", "-q", "x", flag, value])
      expect(r.exitCode).toBe(1)
      expect(errorOf(r.stderr).code).toBe("BAD_ARG")
    })
  }
})

describe("--sort is validated against its enum", () => {
  test("an unsupported sort mode fails", async () => {
    const r = await runCLI(["search", "-q", "x", "--sort", "cheapest"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("BAD_ARG")
  })
})

describe("detail input validation happens before any request", () => {
  test("a non-europa.eu URL fails with BAD_ID", async () => {
    const r = await runCLI(["detail", "https://evil.example/eures/portal/jv-se/jv-details/A"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("BAD_ID")
  })

  test("a path-traversal id fails with BAD_ID", async () => {
    const r = await runCLI(["detail", "../../secrets"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("BAD_ID")
  })
})

describe("command surface", () => {
  test("an unknown command fails with BAD_CMD", async () => {
    const r = await runCLI(["frobnicate"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("BAD_CMD")
  })

  test("no arguments prints help and exits 1", async () => {
    const r = await runCLI([])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toContain("USAGE")
  })

  test("--help exits 0 and documents both commands", async () => {
    const r = await runCLI(["search", "--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("search")
    expect(r.stdout).toContain("detail")
  })

  test("errors go to stderr, never stdout", async () => {
    const r = await runCLI(["search", "-q", "x", "--nope"])
    expect(r.stdout).toBe("")
    expect(r.stderr.length).toBeGreaterThan(0)
  })
})
