import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers.js"

// Every case here fails before any request is made, so the suite needs no network.

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
    const r = await runCLI(["detail", "21083", "--remote"])
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
    const r = await runCLI(["search", "-q", "x", "-l"])
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
      const r = await runCLI(["search", "-q", "x", flag, value])
      expect(r.exitCode).toBe(1)
      expect(errorOf(r.stderr).code).toBe("BAD_ARG")
    })
  }

  test("--remote does not swallow a stray word", async () => {
    const r = await runCLI(["search", "--remote", "engineer"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("BAD_ARG")
  })

  test("detail --format table is not a detail format", async () => {
    const r = await runCLI(["detail", "21083", "--format", "table"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("BAD_ARG")
  })
})

describe("detail input validation happens before any request", () => {
  test("a URL on another host fails with BAD_ID", async () => {
    const r = await runCLI(["detail", "https://evil.example/jobs?jobPk=1"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("BAD_ID")
  })

  test("a non-numeric id fails with BAD_ID", async () => {
    const r = await runCLI(["detail", "1 OR objectID:2"])
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
