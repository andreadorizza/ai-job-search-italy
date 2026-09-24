#!/usr/bin/env bun
// Self-contained CLI for ReliefWeb Jobs (UN OCHA) - humanitarian, development,
// NGO and UN vacancies - through the official ReliefWeb API v2. Needs a
// pre-approved appname in RELIEFWEB_APPNAME; no scraping, no browser
// impersonation, zero runtime dependencies.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import {
  APPNAME_ENV,
  CAREER_CATEGORIES,
  resolveCategories,
  resolveCountries,
  writeError,
} from "./helpers.js"

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
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit", c: "category" }
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

const HELP = `reliefweb-cli - search humanitarian / development / NGO / UN jobs on ReliefWeb (UN OCHA)

SETUP
  The ReliefWeb API only answers pre-approved appnames. Request one (free) via
  https://apidoc.reliefweb.int/parameters#appname, then:
    export ${APPNAME_ENV}=<your-approved-appname>

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS (at least one of -q, -l, --remote, --category)
  --query, -q <text>       Keywords, all must match (title, body, organization...).
                           "Double-quoted phrases" work; other query syntax is escaped.
  --location, -l <list>    Comma-separated countries: English name ("Italy") or
                           ISO3 code ("ITA"). Two-letter codes are rejected.
  --remote                 Include postings with no country (remote/home-based,
                           roving, TBD). With -l: those countries OR no country.
  --category, -c <list>    Career category, comma-separated. Accepts the full
                           name or a shorthand: ict, im, pm, me, admin, hr,
                           logistics, advocacy, donor. Numeric ids also accepted.
  --jobage <days>          Only jobs posted within N days (server-side).
  --page <n>               1-indexed page (20 results/page). Default 1.
  --limit, -n <n>          Cap results emitted (client-side).
  --sort <mode>            recent (default) | relevance | closing (soonest deadline).
  --format <fmt>           json (default) | table | plain.

CAREER CATEGORIES
  ${CAREER_CATEGORIES.join("\n  ")}

EXAMPLES
  bun run src/cli.ts search -q "data" --remote -c ict --format table
  bun run src/cli.ts search -l Italy --jobage 30 --format table
  bun run src/cli.ts search -q "information management" -l "ITA,CHE" --remote
  bun run src/cli.ts detail 4221508 --format plain

Data: https://reliefweb.int/jobs via https://api.reliefweb.int (UN OCHA). 1000 calls/day per appname.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set([
    "query", "location", "remote", "category", "jobage", "page", "limit", "sort", "format", "help", "h",
  ]),
  detail: new Set(["format", "help", "h"]),
}

function parseIntFlag(name: string, raw: string | boolean | string[], min: number): number | null {
  // Number(), not parseInt(): parseInt truncates, so "--jobage 0.5" would
  // become 0 and silently change the window instead of erroring.
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < min) {
    writeError(`--${name} must be a whole number of at least ${min}, got "${String(raw)}"`, "BAD_ARG")
    return null
  }
  return val
}

function parseBoolFlag(name: string, raw: string | boolean | string[] | undefined): boolean | null {
  if (raw === undefined || raw === false) return false
  if (raw === true) return true
  const v = String(raw).trim().toLowerCase()
  if (["true", "yes", "1"].includes(v)) return true
  if (["false", "no", "0"].includes(v)) return false
  writeError(`--${name} is a switch and takes no value (got "${String(raw)}")`, "BAD_ARG")
  return null
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
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
    const query = typeof flags.query === "string" ? flags.query.trim() : ""
    if (flags.query === true) {
      writeError("--query needs a value", "BAD_ARG")
      return 1
    }

    const remote = parseBoolFlag("remote", flags.remote)
    if (remote === null) return 1

    let countries: SearchOpts["countries"]
    if (flags.location !== undefined) {
      if (typeof flags.location !== "string" || !flags.location.trim()) {
        writeError('--location needs a value, e.g. -l Italy or -l "ITA,CHE"', "BAD_ARG")
        return 1
      }
      countries = resolveCountries(flags.location)
      if (countries.bad.length) {
        writeError(
          `--location takes English country names or ISO3 codes, not two-letter codes: ${countries.bad
            .map((b) => `"${b}"`)
            .join(", ")} (Italy is "Italy" or "ITA")`,
          "BAD_ARG",
        )
        return 1
      }
    }

    let categories: SearchOpts["categories"]
    if (flags.category !== undefined) {
      if (typeof flags.category !== "string" || !flags.category.trim()) {
        writeError("--category needs a value, e.g. -c ict", "BAD_ARG")
        return 1
      }
      categories = resolveCategories(flags.category)
      if (categories.unknown.length) {
        writeError(
          `unknown --category ${categories.unknown.map((u) => `"${u}"`).join(", ")}. ` +
            `Valid: ${CAREER_CATEGORIES.join(", ")} (or shorthands ict, im, pm, me, admin, hr, logistics, advocacy, donor, or a numeric id)`,
          "BAD_ARG",
        )
        return 1
      }
    }

    if (!query && !countries && !remote && !categories) {
      writeError(
        'search needs at least one of --query/-q, --location/-l, --remote or --category (e.g. -q "data" --remote)',
        "MISSING_REQUIRED",
      )
      return 1
    }

    const nums: Record<string, number | undefined> = {}
    for (const [name, min] of [["jobage", 1], ["page", 1], ["limit", 0]] as const) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name]!, min)
        if (v === null) return 1
        nums[name] = v
      }
    }

    const sortRaw = typeof flags.sort === "string" ? flags.sort : "recent"
    if (!["recent", "relevance", "closing"].includes(sortRaw)) {
      writeError(`--sort must be "recent", "relevance" or "closing", got "${String(flags.sort)}"`, "BAD_ARG")
      return 1
    }

    const fmt = typeof flags.format === "string" ? flags.format : "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      writeError(`--format must be json, table or plain, got "${String(flags.format)}"`, "BAD_ARG")
      return 1
    }

    const opts: SearchOpts = {
      query: query || undefined,
      countries,
      remote,
      categories,
      jobage: nums.jobage,
      page: nums.page ?? 1,
      limit: nums.limit,
      sort: sortRaw as SearchOpts["sort"],
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      writeError("detail requires an <id|url>", "MISSING_REQUIRED")
      return 1
    }
    const fmt = typeof flags.format === "string" ? flags.format : "json"
    if (!["json", "plain"].includes(fmt)) {
      writeError(`--format for detail must be json or plain, got "${String(flags.format)}"`, "BAD_ARG")
      return 1
    }
    const opts: DetailOpts = { id, format: fmt as DetailOpts["format"] }
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
