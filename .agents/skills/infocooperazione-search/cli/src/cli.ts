#!/usr/bin/env bun
// Self-contained CLI for the jobs category ("Lavoro") of Info Cooperazione
// (www.info-cooperazione.it), the Italian international-cooperation and NGO
// news site: vacancies at Italian NGOs, UN agencies and third-sector bodies,
// in Italy and in the field. Server-rendered HTML, parsed per card.
// No account, no browser impersonation, zero runtime dependencies.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { writeError } from "./helpers.js"

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

const HELP = `infocooperazione-cli — search job postings on Info Cooperazione (Italian NGO / international cooperation)

USAGE
  bun run src/cli.ts search [--query "<text>"] [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>     Text searched by the site in title and body, as one phrase
                         (case-insensitive substring; word order matters). At least
                         3 characters: the site returns nothing for shorter text,
                         so use "informatica" or "ICT", not "IT". Omit to browse.
  --location, -l <name>  One country, by the site's Italian name ("Italia", "Kenya",
                         "Libano", "Più paesi", "Africa") or its numeric paese_id.
  --jobage <days>        Only postings published within N days, at month precision:
                         listings carry only the publication month (see SKILL.md).
  --page <n>             1-indexed page (20 postings/page). Default 1.
  --limit, -n <n>        Cap results emitted (client-side).
  --format <fmt>         json (default) | table | plain.

Only open postings (deadline not passed) are listed, the site's own default.

EXAMPLES
  bun run src/cli.ts search -q "informatica" --format table
  bun run src/cli.ts search -q "dati" -l Italia --format table
  bun run src/cli.ts search -l Kenya --jobage 30
  bun run src/cli.ts detail 2026/9/ong-esempio-project-manager-kenya --format plain

Data: https://www.info-cooperazione.it (Lavoro), content under CC BY-NC-SA 4.0 -
personal, non-commercial use with attribution; see url-reference.md.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "jobage", "page", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

/** The site ignores search text shorter than this and returns no postings. */
const MIN_QUERY_LENGTH = 3

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
      writeError('--query/-q needs a value (e.g. -q "informatica"); omit the flag to browse all postings', "MISSING_REQUIRED")
      return 1
    }
    if (flags.location === true) {
      writeError('--location/-l needs a value (e.g. -l Italia)', "MISSING_REQUIRED")
      return 1
    }
    const query = typeof flags.query === "string" ? flags.query.trim() : ""
    if (query && query.length < MIN_QUERY_LENGTH) {
      writeError(
        `--query "${query}" is shorter than ${MIN_QUERY_LENGTH} characters, and the site returns no postings for it; ` +
          `use a longer term (e.g. "informatica", "ICT", "digitale", "dati")`,
        "BAD_ARG",
      )
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

    const format = parseFormat(flags.format, ["json", "table", "plain"])
    if (!format) return 1

    const opts: SearchOpts = {
      query,
      location: typeof flags.location === "string" && flags.location.trim() ? flags.location.trim() : undefined,
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
