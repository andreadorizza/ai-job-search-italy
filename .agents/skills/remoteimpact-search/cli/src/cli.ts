#!/usr/bin/env bun
// Self-contained CLI for Remote Impact (remoteimpact.org), a remote-only board
// of jobs at impact-focused organisations: climate, AI safety and governance,
// global health, biosecurity, animal welfare, effective altruism, non-profits.
// It reads only the board's public RSS feeds, which the board offers for reuse
// with attribution. No account, no HTML scraping, zero runtime dependencies.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { CliError, KNOWN_CATEGORIES, MAX_CATEGORIES, PER_PAGE, parseCategories, writeError } from "./helpers.js"

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

function categoryHelp(): string {
  const slugs = Object.keys(KNOWN_CATEGORIES)
  const lines: string[] = []
  let line = "                        "
  for (const s of slugs) {
    if (line.length + s.length + 1 > 80) {
      lines.push(line.trimEnd())
      line = "                        "
    }
    line += s + " "
  }
  lines.push(line.trimEnd())
  return lines.join("\n")
}

const HELP = `remoteimpact-cli — search Remote Impact (remoteimpact.org), remote impact jobs

USAGE
  bun run src/cli.ts search [--query "<text>"] [--category <slug[,slug]>] [flags]
  bun run src/cli.ts detail <id|url> [--category <slug[,slug]>] [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords matched against title, organisation and the
                          description excerpt. Every term must match; "quoted
                          phrases" stay together. Omit to list the newest roles.
  --category, -c <slugs>  Read these category feeds instead of the site-wide
                          feed (comma-separated, max ${MAX_CATEGORIES}). Each feed holds its newest
                          50 roles, so categories reach further back in time.
  --jobage <days>         Only roles published within N days.
  --page <n>              1-indexed page (${PER_PAGE} results/page). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

  There is no --location: every role on the board is remote and the feed has no
  region field. Put a region in --query instead (e.g. -q "engineer Europe").

CATEGORY SLUGS
${categoryHelp()}

EXAMPLES
  bun run src/cli.ts search -q "machine learning" -c ai-safety,technology --format table
  bun run src/cli.ts search -q "software engineer" -c technology --jobage 14
  bun run src/cli.ts search --jobage 1 --format table
  bun run src/cli.ts detail senior-software-engineer-gpu-cluster-infrastructure-far-ai -c ai-safety

Data: the public RSS feeds at https://remoteimpact.org/feed/jobs/ — see url-reference.md.
Source attribution: Remote Impact (https://remoteimpact.org). Keep it when sharing results.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "category", "jobage", "page", "limit", "format", "help", "h"]),
  detail: new Set(["category", "format", "help", "h"]),
}

function parseIntFlag(name: string, raw: string | boolean | string[]): number | null {
  // Number(), not parseInt(): parseInt truncates, so "--jobage 0.5" would
  // become 0 and silently change the window instead of erroring.
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

/** `--category` value -> slugs, or null after writing the error. */
function categoriesFrom(flags: Flags): string[] | null {
  if (flags.category === undefined) return []
  if (typeof flags.category !== "string") {
    writeError("--category/-c needs a value (e.g. -c ai-safety or -c ai-safety,technology)", "MISSING_REQUIRED")
    return null
  }
  try {
    return parseCategories(flags.category)
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), e instanceof CliError ? e.code : "BAD_ARG")
    return null
  }
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  if (cmd === "search" && flags.location !== undefined) {
    writeError(
      "--location is not supported: Remote Impact lists remote roles only and its feed carries no region. " +
        'Put a region in --query instead (e.g. -q "engineer Europe")',
      "UNSUPPORTED_FLAG",
    )
    return 1
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
      writeError('--query/-q needs a value (e.g. -q "machine learning"); omit the flag to list the newest roles', "MISSING_REQUIRED")
      return 1
    }
    const categories = categoriesFrom(flags)
    if (!categories) return 1

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
      query: typeof flags.query === "string" ? flags.query.trim() : "",
      categories,
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
    const categories = categoriesFrom(flags)
    if (!categories) return 1
    const format = parseFormat(flags.format, ["json", "plain"])
    if (!format) return 1
    const opts: DetailOpts = { id, categories, format: format as DetailOpts["format"] }
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
