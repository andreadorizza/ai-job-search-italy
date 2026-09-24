import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers.js"

// Every case here fails before any request is made, so the suite needs no network.

function errorOf(stderr: string): { error: string; code: string } {
  return JSON.parse(stderr.trim().split("\n").pop()!)
}

describe("unknown flags are rejected, never silently dropped", () => {
  test("search rejects a bogus flag", async () => {
    const r = await runCLI(["search", "-q", "dati", "--nope", "1"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("UNKNOWN_FLAG")
    expect(r.stdout).toBe("")
  })

  test("a typo'd real flag is still unknown", async () => {
    const r = await runCLI(["search", "-q", "dati", "--jobages", "7"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("detail rejects a search-only flag", async () => {
    const r = await runCLI(["detail", "2026/9/x", "--jobage", "7"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("UNKNOWN_FLAG")
  })
})

describe("required arguments", () => {
  test("detail without an id fails with MISSING_REQUIRED", async () => {
    const r = await runCLI(["detail"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("MISSING_REQUIRED")
  })

  test("-q given without a value fails instead of browsing everything", async () => {
    const r = await runCLI(["search", "-q"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("MISSING_REQUIRED")
  })

  test("-l given without a value fails instead of dropping the filter", async () => {
    const r = await runCLI(["search", "-q", "dati", "-l"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("MISSING_REQUIRED")
  })
})

describe("flag values are validated", () => {
  for (const [flag, value] of [
    ["--jobage", "0.5"],
    ["--jobage", "abc"],
    ["--jobage", "0"],
    ["--page", "-1"],
    ["--limit", "1.5"],
    ["--format", "xml"],
  ] as const) {
    test(`${flag} ${value}`, async () => {
      const r = await runCLI(["search", "-q", "dati", flag, value])
      expect(r.exitCode).toBe(1)
      expect(errorOf(r.stderr).code).toBe("BAD_ARG")
    })
  }

  test("a query shorter than 3 characters is refused, since the site returns nothing for it", async () => {
    const r = await runCLI(["search", "-q", "IT"])
    expect(r.exitCode).toBe(1)
    const e = errorOf(r.stderr)
    expect(e.code).toBe("BAD_ARG")
    expect(e.error).toContain("informatica")
  })

  test("detail --format table is not a detail format", async () => {
    const r = await runCLI(["detail", "2026/9/x", "--format", "table"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("BAD_ARG")
  })
})

describe("detail input validation happens before any request", () => {
  test("a URL on another host fails with BAD_ID", async () => {
    const r = await runCLI(["detail", "https://evil.example/2026/9/x"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("BAD_ID")
  })

  test("a path that is not <year>/<month>/<slug> fails with BAD_ID", async () => {
    const r = await runCLI(["detail", "Category/Search"])
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

  test("--help exits 0 and documents both commands and the licence", async () => {
    const r = await runCLI(["search", "--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("search")
    expect(r.stdout).toContain("detail")
    expect(r.stdout).toContain("CC BY-NC-SA 4.0")
  })

  test("errors go to stderr, never stdout", async () => {
    const r = await runCLI(["search", "-q", "dati", "--nope"])
    expect(r.stdout).toBe("")
    expect(r.stderr.length).toBeGreaterThan(0)
  })
})
