#!/usr/bin/env bun
// Self-contained CLI for Randstad Italia vacancies.
//
// Randstad publishes complete schema.org/JobPosting markup on every vacancy
// page - title, dates, contract type, location and baseSalary (RAL) - so the
// job data is read from structured data rather than scraped out of HTML. The
// only site-specific logic is finding the vacancy links on a listing page.
//
// robots.txt permits /offerte-lavoro/. Honest User-Agent, no impersonation,
// zero runtime dependencies.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

/** A negative number is a value, not a flag name (`--page -1`). */
const NUMERIC = /^-\d*\.?\d+$/

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a.startsWith("-") && !NUMERIC.test(a)) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (next !== undefined && (!next.startsWith("-") || NUMERIC.test(next))) {
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

const HELP = `randstad-cli — search Randstad Italia job vacancies

USAGE
  bun run src/cli.ts search --query "<text>" [flags]
  bun run src/cli.ts detail <url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>     Keywords. REQUIRED.
  --location, -l <place> Italian region or city (e.g. "Lombardia", "Milano").
                         Omit to search all of Italy.
  --jobage <days>        Only vacancies published within N days.
  --page <n>             1-indexed listing page (~30 vacancies each). Default 1.
  --limit, -n <n>        Cap vacancies fetched and emitted. Recommended.
  --format <fmt>         json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q magazziniere -l Lombardia --limit 5 --format table
  bun run src/cli.ts search -q infermiere --jobage 14 --limit 10
  bun run src/cli.ts detail "https://www.randstad.it/offerte-lavoro/<slug>_<city>_<uuid>/" --format plain

NOTE
  Randstad's filters are path segments, not query parameters, and an unknown
  filter silently returns the unfiltered national listing. This CLI verifies
  from the page's canonical URL that your filters were actually applied, and
  fails rather than handing back thousands of unrelated vacancies.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "jobage", "page", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

function parseIntFlag(name: string, raw: string | boolean | string[]): number | null {
  // Number(), not parseInt(): parseInt would truncate "--jobage 0.5" to 0 and
  // silently widen the window instead of complaining.
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < 1) {
    process.stderr.write(
      JSON.stringify({
        error: `--${name} must be a whole number of at least 1, got "${String(raw)}"`,
        code: "BAD_ARG",
      }) + "\n",
    )
    return null
  }
  return val
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  // A discarded filter changes what the search returns with no error, which is
  // worse than failing outright - so unknown flags are rejected, never ignored.
  const known = KNOWN_FLAGS[cmd]
  if (known) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || known.has(key)) continue
      process.stderr.write(
        JSON.stringify({
          error: `unknown flag --${key} for '${cmd}' - flags are never silently ignored; see --help`,
          code: "UNKNOWN_FLAG",
        }) + "\n",
      )
      return 1
    }
  }

  if (cmd === "search") {
    const query = typeof flags.query === "string" ? flags.query.trim() : ""
    if (!query) {
      process.stderr.write(
        JSON.stringify({
          error: 'the --query/-q flag is required (e.g. -q magazziniere)',
          code: "MISSING_REQUIRED",
        }) + "\n",
      )
      return 1
    }

    for (const name of ["jobage", "page", "limit"] as const) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name]!)
        if (v === null) return 1
        flags[name] = String(v)
      }
    }

    const fmt = typeof flags.format === "string" ? flags.format : "json"
    const location = typeof flags.location === "string" ? flags.location.trim() : ""

    const opts: SearchOpts = {
      query,
      location: location || undefined,
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : 9999,
      page: flags.page ? parseInt(flags.page as string, 10) : 1,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(
        JSON.stringify({ error: "detail requires a vacancy <url>", code: "MISSING_REQUIRED" }) + "\n",
      )
      return 1
    }
    const fmt = typeof flags.format === "string" ? flags.format : "json"
    const opts: DetailOpts = { id, format: fmt === "plain" ? "plain" : "json" }
    return runDetail(opts)
  }

  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({
        error: e instanceof Error ? e.message : String(e),
        code: "INTERNAL_ERROR",
      }) + "\n",
    )
    process.exit(1)
  })
