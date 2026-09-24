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
    const r = await runCLI(["detail", "some-job-org", "--jobage", "7"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("--location is refused with a pointer to --query, not ignored", async () => {
    const r = await runCLI(["search", "-q", "engineer", "-l", "Italy"])
    expect(r.exitCode).toBe(1)
    const e = errorOf(r.stderr)
    expect(e.code).toBe("UNSUPPORTED_FLAG")
    expect(e.error).toContain("--query")
  })
})

describe("required arguments", () => {
  test("detail without an id fails with MISSING_REQUIRED", async () => {
    const r = await runCLI(["detail"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("MISSING_REQUIRED")
  })

  test("-q given without a value fails instead of listing everything", async () => {
    const r = await runCLI(["search", "-q"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("MISSING_REQUIRED")
  })

  test("-c given without a value fails instead of dropping the filter", async () => {
    const r = await runCLI(["search", "-q", "x", "-c"])
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
    ["--category", "../api"],
    ["--category", "a,b,c,d,e,f"],
  ] as const) {
    test(`${flag} ${value}`, async () => {
      const r = await runCLI(["search", "-q", "x", flag, value])
      expect(r.exitCode).toBe(1)
      expect(errorOf(r.stderr).code).toBe("BAD_ARG")
    })
  }

  test("detail --format table is not a detail format", async () => {
    const r = await runCLI(["detail", "some-job-org", "--format", "table"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("BAD_ARG")
  })
})

describe("detail input validation happens before any request", () => {
  test("a URL on another host fails with BAD_ID", async () => {
    const r = await runCLI(["detail", "https://evil.example/jobs/x/"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("BAD_ID")
  })

  test("a non-slug id fails with BAD_ID", async () => {
    const r = await runCLI(["detail", "Some Title"])
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

  test("--help exits 0, documents both commands and lists category slugs", async () => {
    const r = await runCLI(["search", "--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("search")
    expect(r.stdout).toContain("detail")
    expect(r.stdout).toContain("ai-safety")
    expect(r.stdout).toContain("effective-altruism")
  })

  test("errors go to stderr, never stdout", async () => {
    const r = await runCLI(["search", "-q", "x", "--nope"])
    expect(r.stdout).toBe("")
    expect(r.stderr.length).toBeGreaterThan(0)
  })
})
