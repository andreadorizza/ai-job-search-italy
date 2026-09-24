#!/usr/bin/env bun
// Self-contained CLI for Impact Jobs (impactjobs.org): social-impact and
// non-profit roles, mostly in the US, with a remote filter. It reads the job
// JSON the board embeds in its own public, server-rendered pages, one request
// per call, with an honest User-Agent and robots.txt's 1-second crawl delay.
// No account, no RSS (disallowed), zero runtime dependencies.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { PER_PAGE, writeError } from "./helpers.js"

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

const HELP = `impactjobs-cli — search Impact Jobs (impactjobs.org), social-impact and non-profit jobs

USAGE
  bun run src/cli.ts search [--query "<text>"] [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>     Keywords, matched by the board against job title,
                         employer and tags (not the description). Omit to list
                         the newest roles.
  --location, -l <text>  Free-text place, matched by the board (US cities and
                         states work; see SKILL.md for outside the US).
  --remote               Only jobs the employer marked remote.
  --jobage <days>        Only jobs posted within N days (filtered by the board).
  --page <n>             1-indexed page (${PER_PAGE} results/page). Default 1.
  --limit, -n <n>        Cap results emitted (client-side).
  --format <fmt>         json (default) | table | plain.

  Results are newest first. Every call is one request, at least 1 second after
  the previous one (robots.txt Crawl-delay: 1).

EXAMPLES
  bun run src/cli.ts search -q "data" --remote --format table
  bun run src/cli.ts search -q "software engineer" --remote --jobage 30
  bun run src/cli.ts search --remote --jobage 7 --limit 10
  bun run src/cli.ts detail 658739199 --format plain

Data: https://impactjobs.org/jobs — the job JSON embedded in the board's pages; see url-reference.md.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "remote", "jobage", "page", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

function parseIntFlag(name: string, raw: string | boolean | string[]): number | null {
  // Number(), not parseInt(): parseInt truncates, so "--jobage 0.5" would
  // become 0 and silently change the window instead of erroring.
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < 1 || val > 100000) {
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

/** A free-text flag value: trimmed, non-empty, bounded. Null after writing the error. */
function textFlag(name: string, raw: string | boolean | string[] | undefined, example: string, max: number): string | null {
  if (raw === undefined) return ""
  if (typeof raw !== "string" || !raw.trim()) {
    writeError(`--${name} needs a value (e.g. ${example})`, "MISSING_REQUIRED")
    return null
  }
  const v = raw.trim()
  if (v.length > max) {
    writeError(`--${name} is longer than ${max} characters`, "BAD_ARG")
    return null
  }
  return v
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
    const query = textFlag("query/-q", flags.query, '-q "data"; omit the flag to list the newest roles', 200)
    if (query === null) return 1
    const location = textFlag("location/-l", flags.location, '-l "New York"', 100)
    if (location === null) return 1

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
      query,
      location,
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
