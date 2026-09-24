#!/usr/bin/env bun
// Self-contained CLI for the 80,000 Hours job board (jobs.80000hours.org): a
// curated global board of high-impact roles - AI safety and policy, global
// health, biosecurity, animal welfare, effective-altruism organisations.
// It reads the board's own public search index the way the board's page does.
// No account, no browser impersonation, zero runtime dependencies.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { splitLocations, writeError } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

/**
 * A negative number is a value, not a flag name. Without this, `--page -1`
 * parses as the boolean flag `--page` plus an unknown flag `-1`, and the user
 * gets "unknown flag --1" instead of the real complaint about --page.
 */
function isValue(token: string | undefined): token is string {
  return token !== undefined && (!token.startsWith("-") || /^-\d*\.?\d+$/.test(token))
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a.startsWith("-") && !/^-\d*\.?\d+$/.test(a)) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (isValue(next)) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `eighty-thousand-hours-cli — search the 80,000 Hours job board (high-impact roles)

USAGE
  bun run src/cli.ts search [--query "<text>"] [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>     Keywords (title, organisation, summary, tags). Omit to
                         browse the newest roles.
  --location, -l <tags>  The board's own location tags, case-insensitive, several
                         separated by ";" (tags contain commas). Examples:
                         "Remote, Global"  "Europe (ex UK)"  "UK"  "London, UK"
                         "Remote, Global;Remote, Europe;Europe (ex UK)"
  --remote               Only roles tagged remote (includes region-locked remote,
                         e.g. "Remote, USA" - check the location field).
  --jobage <days>        Only roles posted within N days.
  --page <n>             1-indexed page (20 results/page). Default 1.
  --limit, -n <n>        Cap results emitted (client-side).
  --format <fmt>         json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "machine learning" --remote --format table
  bun run src/cli.ts search -q "AI safety" -l "Remote, Global;Europe (ex UK)" --jobage 14
  bun run src/cli.ts search -q "software engineer" --remote --jobage 7 --limit 10
  bun run src/cli.ts detail 21083 --format plain

Data: https://jobs.80000hours.org — the board's public search index; see url-reference.md.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "remote", "jobage", "page", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

function parseIntFlag(name: string, raw: string | boolean | string[]): number | null {
  // Number(), not parseInt(): parseInt truncates, so "--jobage 0.5" would
  // become 0 and silently widen the window instead of erroring.
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < 1) {
    writeError(`--${name} must be a whole number of at least 1, got "${String(raw)}"`, "BAD_ARG")
    return null
  }
  return val
}

function parseFormat(raw: string | boolean | string[] | undefined, allowed: string[]): string | null {
  const fmt = raw === undefined ? "json" : raw
  if (typeof fmt !== "string" || !allowed.includes(fmt)) {
    writeError(`--format must be one of ${allowed.join(", ")}, got "${String(raw)}"`, "BAD_ARG")
    return null
  }
  return fmt
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  // Reject unknown flags rather than silently discarding them: a dropped
  // filter widens the search with no error, which is worse than failing.
  const knownFlags = KNOWN_FLAGS[cmd]
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      writeError(
        `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help`,
        "UNKNOWN_FLAG",
      )
      return 1
    }
  }

  if (cmd === "search") {
    if (flags.query === true) {
      writeError('--query/-q needs a value (e.g. -q "machine learning"); omit the flag to browse all roles', "MISSING_REQUIRED")
      return 1
    }
    if (flags.location === true) {
      writeError('--location/-l needs a value (e.g. -l "Remote, Global")', "MISSING_REQUIRED")
      return 1
    }

    const nums: Record<string, number | undefined> = {}
    for (const name of ["jobage", "page", "limit"] as const) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name]!)
        if (v === null) return 1
        nums[name] = v
      }
    }

    // --remote is a switch. "--remote true/false" is tolerated; anything else is
    // almost certainly a misplaced query word and must not be swallowed.
    let remote = false
    if (flags.remote !== undefined) {
      if (flags.remote === true || flags.remote === "true") remote = true
      else if (flags.remote === "false") remote = false
      else {
        writeError(`--remote is a switch and takes no value, got "${String(flags.remote)}"`, "BAD_ARG")
        return 1
      }
    }

    const format = parseFormat(flags.format, ["json", "table", "plain"])
    if (!format) return 1

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query.trim() : "",
      locations: typeof flags.location === "string" ? splitLocations(flags.location) : [],
      remote,
      jobage: nums.jobage,
      page: nums.page ?? 1,
      limit: nums.limit,
      format: format as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      writeError("detail requires an <id|url>", "MISSING_REQUIRED")
      return 1
    }
    const format = parseFormat(flags.format, ["json", "plain"])
    if (!format) return 1
    const opts: DetailOpts = { id, format: format as DetailOpts["format"] }
    return runDetail(opts)
  }

  writeError(`Unknown command "${cmd}"`, "BAD_CMD")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    writeError(e instanceof Error ? e.message : String(e), "INTERNAL_ERROR")
    process.exit(1)
  })
