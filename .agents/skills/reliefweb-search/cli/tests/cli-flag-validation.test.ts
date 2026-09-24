import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers.js"

// Every case here must fail (or print help) before any network request. The
// appname is removed from the child's environment, so a case that wrongly got
// past validation would stop at MISSING_CREDENTIALS rather than hit the API.
const NO_APPNAME = { RELIEFWEB_APPNAME: undefined }

function errorOf(stderr: string): { error: string; code: string } {
  return JSON.parse(stderr.trim().split("\n").pop()!)
}

async function run(args: string[]) {
  return runCLI(args, NO_APPNAME)
}

describe("unknown flags are rejected, never silently dropped", () => {
  test("search rejects a bogus flag", async () => {
    const r = await run(["search", "-q", "x", "--nope", "1"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("UNKNOWN_FLAG")
    expect(r.stdout).toBe("")
  })

  test("a typo'd real flag is still unknown", async () => {
    const r = await run(["search", "-q", "x", "--jobages", "7"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("detail rejects a search-only flag", async () => {
    const r = await run(["detail", "123", "--limit", "5"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("UNKNOWN_FLAG")
  })
})

describe("required arguments", () => {
  test("search with no query and no filter fails with MISSING_REQUIRED", async () => {
    const r = await run(["search"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("MISSING_REQUIRED")
  })

  test("a whitespace-only query is treated as missing", async () => {
    const r = await run(["search", "-q", "   "])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("MISSING_REQUIRED")
  })

  test("detail without an id fails with MISSING_REQUIRED", async () => {
    const r = await run(["detail"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("MISSING_REQUIRED")
  })
})

describe("the appname is required and never taken from a flag", () => {
  test("a valid search without RELIEFWEB_APPNAME exits 1 with MISSING_CREDENTIALS", async () => {
    const r = await run(["search", "-q", "data", "--remote", "-c", "ict"])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe("")
    const e = errorOf(r.stderr)
    expect(e.code).toBe("MISSING_CREDENTIALS")
    expect(e.error).toContain("RELIEFWEB_APPNAME")
  })

  test("detail without RELIEFWEB_APPNAME exits 1 with MISSING_CREDENTIALS", async () => {
    const r = await run(["detail", "4221508"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("MISSING_CREDENTIALS")
  })

  test("--appname is not a flag (it would leak into shell history)", async () => {
    const r = await run(["search", "-q", "x", "--appname", "abc"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("UNKNOWN_FLAG")
  })
})

describe("numeric flags reject non-integers instead of truncating", () => {
  for (const [flag, value] of [
    ["--jobage", "0.5"],
    ["--jobage", "abc"],
    ["--jobage", "0"],
    ["--page", "-1"],
    ["--page", "0"],
    ["--limit", "1.5"],
  ] as const) {
    test(`${flag} ${value}`, async () => {
      const r = await run(["search", "-q", "x", flag, value])
      expect(r.exitCode).toBe(1)
      expect(errorOf(r.stderr).code).toBe("BAD_ARG")
    })
  }
})

describe("enum and value validation", () => {
  test("an unsupported sort mode fails", async () => {
    const r = await run(["search", "-q", "x", "--sort", "cheapest"])
    expect(errorOf(r.stderr).code).toBe("BAD_ARG")
  })

  test("an unsupported format fails", async () => {
    const r = await run(["search", "-q", "x", "--format", "xml"])
    expect(errorOf(r.stderr).code).toBe("BAD_ARG")
  })

  test("an unknown career category fails and lists the valid ones", async () => {
    const r = await run(["search", "-c", "astronomy"])
    expect(r.exitCode).toBe(1)
    const e = errorOf(r.stderr)
    expect(e.code).toBe("BAD_ARG")
    expect(e.error).toContain("Information and Communications Technology")
  })

  test("a two-letter country code fails instead of silently matching nothing", async () => {
    const r = await run(["search", "-l", "it"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("BAD_ARG")
  })

  test("--remote takes no free-text value", async () => {
    const r = await run(["search", "--remote", "maybe"])
    expect(errorOf(r.stderr).code).toBe("BAD_ARG")
  })
})

describe("detail input validation happens before any request", () => {
  test("a non-reliefweb URL fails with BAD_ID", async () => {
    const r = await run(["detail", "https://evil.example/job/4221508/x"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("BAD_ID")
  })

  test("a path-traversal id fails with BAD_ID", async () => {
    const r = await run(["detail", "../../secrets"])
    expect(errorOf(r.stderr).code).toBe("BAD_ID")
  })
})

describe("command surface", () => {
  test("an unknown command fails with BAD_CMD", async () => {
    const r = await run(["frobnicate"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("BAD_CMD")
  })

  test("no arguments prints help and exits 1", async () => {
    const r = await run([])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toContain("USAGE")
  })

  test("--help exits 0 and documents both commands and the setup step", async () => {
    const r = await run(["search", "--help"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("detail")
    expect(r.stdout).toContain("RELIEFWEB_APPNAME")
  })

  test("errors go to stderr, never stdout", async () => {
    const r = await run(["search", "-q", "x", "--nope"])
    expect(r.stdout).toBe("")
    expect(r.stderr.length).toBeGreaterThan(0)
  })
})
