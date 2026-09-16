#!/usr/bin/env bun
// Self-contained CLI for the EURES public job-vacancy search API (European
// Commission / European Labour Authority). No key, no account, no browser
// impersonation - a plain JSON endpoint that robots.txt permits. Zero runtime
// dependencies, so it runs anywhere `bun` is available.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

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

const HELP = `eures-cli — search EU job vacancies on the EURES public API

USAGE
  bun run src/cli.ts search --query "<text>" [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>     Keywords (title or description). REQUIRED.
  --location, -l <codes> Comma-separated. A country code ("it", "de"), a NUTS
                         code ("ITC4"), or an Italian region name ("Lombardia",
                         "Emilia-Romagna"). Default: it. Pass "" for all of EU.
  --jobage <days>        Only vacancies published within N days. Default: all.
  --page <n>             1-indexed page (20 results/page). Default 1.
  --limit, -n <n>        Cap results emitted (client-side).
  --sort <mode>          recent (default) | relevance.
  --format <fmt>         json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "data engineer" -l it --limit 5 --format table
  bun run src/cli.ts search -q "infermiere" -l "Lombardia,Veneto" --jobage 14
  bun run src/cli.ts search -q "python developer" -l "" --format table
  bun run src/cli.ts detail "OTkyMTM2IDE3" --format plain

Data: https://europa.eu/eures — public sector, open access, no credentials.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "jobage", "page", "limit", "sort", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

function parseIntFlag(name: string, raw: string | boolean | string[]): number | null {
  // Number(), not parseInt(): parseInt truncates, so "--jobage 0.5" would
  // become 0 and silently widen the window instead of erroring.
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

  // Reject unknown flags rather than silently discarding them: a dropped
  // filter widens the search with no error, which is worse than failing.
  const knownFlags = KNOWN_FLAGS[cmd]
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      process.stderr.write(
        JSON.stringify({
          error: `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help`,
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
          error: 'the --query/-q flag is required (e.g. -q "data engineer")',
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

    const sortRaw = typeof flags.sort === "string" ? flags.sort : "recent"
    if (!["recent", "relevance"].includes(sortRaw)) {
      process.stderr.write(
        JSON.stringify({ error: `--sort must be "recent" or "relevance", got "${sortRaw}"`, code: "BAD_ARG" }) + "\n",
      )
      return 1
    }

    const fmt = typeof flags.format === "string" ? flags.format : "json"
    // `-l ""` is a deliberate "all of the EU"; only an absent flag defaults to Italy.
    const location = typeof flags.location === "string" ? flags.location : "it"

    const opts: SearchOpts = {
      query,
      location,
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : 9999,
      page: flags.page ? parseInt(flags.page as string, 10) : 1,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
      sort: sortRaw === "relevance" ? "BEST_MATCH" : "MOST_RECENT",
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(
        JSON.stringify({ error: "detail requires an <id|url>", code: "MISSING_REQUIRED" }) + "\n",
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
