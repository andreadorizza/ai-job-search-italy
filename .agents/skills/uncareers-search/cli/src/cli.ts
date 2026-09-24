#!/usr/bin/env bun
// Self-contained CLI for UN Careers (careers.un.org): United Nations
// Secretariat job openings - staff positions, consultancies, individual
// contractors and internships, worldwide and home-based.
// It calls the portal's own public JSON list endpoint the way its search page
// does. No account, no browser impersonation, zero runtime dependencies.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { CliError, parseCategories, parseNetworks, splitLocations, writeError } from "./helpers.js"

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

const SWITCHES = new Set(["home-based", "help", "h"])

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit", c: "category" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a.startsWith("-") && !/^-\d*\.?\d+$/.test(a)) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      // A switch only swallows an explicit true/false, never a stray word.
      if (isValue(next) && (!SWITCHES.has(key) || next === "true" || next === "false")) {
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

const HELP = `uncareers-cli — search UN Careers (careers.un.org), the UN Secretariat job portal

USAGE
  bun run src/cli.ts search [--query "<text>"] [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>       Keywords, matched by the portal (titles and parts of the
                           posting text). Single words work best. Omit to browse.
  --location, -l <places>  Duty stations or countries, several separated by ";" or ",".
                           Examples: "Geneva"  "Rome"  "Italy"  "New York;Vienna"
  --category, -c <cats>    consultant (consultants + individual contractors) |
                           internship | staff (every staff job opening) | pool
                           (open-ended candidate pools). Several separated by ",".
  --network <nets>         Job network: ict (ITECNET), development (DEVNET), science
                           (SCINET), management (MAGNET), political (POLNET),
                           information (INFONET), legal, logistics, security.
                           Consultancies carry no job network.
  --home-based             Only postings whose Work Location reads home-based/remote
                           (filters the fetched page; consultancies only).
  --jobage <days>          Only postings published within N days (New York dates).
  --page <n>               1-indexed page (20 results/page). Default 1.
  --limit, -n <n>          Cap results emitted (client-side).
  --format <fmt>           json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search --network ict --format table
  bun run src/cli.ts search -q data --jobage 7 --format table
  bun run src/cli.ts search --category consultant --home-based --format table
  bun run src/cli.ts search -l Italy --format table
  bun run src/cli.ts detail 285103 --format plain

Data: https://careers.un.org — the portal's public list endpoint; see url-reference.md.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set([
    "query",
    "location",
    "category",
    "network",
    "home-based",
    "jobage",
    "page",
    "limit",
    "format",
    "help",
    "h",
  ]),
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

  // A stray word (e.g. `--home-based engineer`) must not vanish silently.
  const positionals = flags._ as string[]
  const maxPositionals = cmd === "detail" ? 2 : 1
  if (knownFlags && positionals.length > maxPositionals) {
    writeError(
      `unexpected argument "${positionals[maxPositionals]}" for '${cmd}'` +
        (cmd === "search" ? ' - put keywords in --query, e.g. -q "statistics"' : ""),
      "BAD_ARG",
    )
    return 1
  }

  if (cmd === "search") {
    for (const [name, example] of [
      ["query", '-q "statistics"'],
      ["location", '-l "Geneva"'],
      ["category", "--category consultant"],
      ["network", "--network ict"],
    ] as const) {
      if (flags[name] === true) {
        writeError(`--${name} needs a value (e.g. ${example}); omit the flag to leave it unfiltered`, "MISSING_REQUIRED")
        return 1
      }
    }

    const nums: Record<string, number | undefined> = {}
    for (const name of ["jobage", "page", "limit"] as const) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name]!)
        if (v === null) return 1
        nums[name] = v
      }
    }

    let homeBased = false
    const hb = flags["home-based"]
    if (hb !== undefined) {
      if (hb === true || hb === "true") homeBased = true
      else if (hb === "false") homeBased = false
      else {
        writeError(`--home-based is a switch and takes no value, got "${String(hb)}"`, "BAD_ARG")
        return 1
      }
    }

    const format = parseFormat(flags.format, ["json", "table", "plain"])
    if (!format) return 1

    let recruitmentTypes: string[] = []
    let networks: string[] = []
    try {
      if (typeof flags.category === "string") recruitmentTypes = parseCategories(flags.category)
      if (typeof flags.network === "string") networks = parseNetworks(flags.network)
    } catch (e) {
      if (e instanceof CliError) {
        writeError(e.message, e.code)
        return 1
      }
      throw e
    }

    const locations = typeof flags.location === "string" ? splitLocations(flags.location) : []
    if (typeof flags.location === "string" && !locations.length) {
      writeError('--location needs a value (e.g. -l "Geneva")', "MISSING_REQUIRED")
      return 1
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query.trim() : "",
      locations,
      recruitmentTypes,
      networks,
      homeBased,
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
