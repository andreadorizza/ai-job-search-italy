import {
  buildSearchUrl,
  canonicalHasLocation,
  canonicalHasQuery,
  extractDetailUrls,
  fetchHtml,
  parseDetailPage,
  readCanonical,
  readTotal,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query: string
  location?: string
  jobage: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

/** Vacancy pages are fetched a few at a time - enough to be quick, few enough to be polite. */
const CONCURRENCY = 4

export async function runSearch(opts: SearchOpts): Promise<number> {
  const url = buildSearchUrl({ query: opts.query, location: opts.location, page: opts.page })

  let listing: string
  try {
    listing = await fetchHtml(url)
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "API_ERROR")
    return 1
  }
  if (!listing) {
    writeError(`Randstad returned no listing page for ${url}`, "NOT_FOUND")
    return 1
  }

  // Randstad answers 200 with the *unfiltered national listing* when it does not
  // recognise a filter, so confirm from the canonical URL that our filters were
  // actually applied. Silently returning thousands of unrelated jobs would be
  // far worse than failing here.
  const canonical = readCanonical(listing)
  if (opts.location && !canonicalHasLocation(canonical)) {
    writeError(
      `Randstad did not recognise the location "${opts.location}" - it answered with the ` +
        `unfiltered national listing. Use an Italian region or city name (e.g. "Lombardia", "Milano").`,
      "BAD_ARG",
    )
    return 1
  }
  if (!canonicalHasQuery(canonical)) {
    writeError(
      `Randstad did not apply the query "${opts.query}" - it answered with an unfiltered listing. ` +
        `Try a simpler keyword.`,
      "BAD_ARG",
    )
    return 1
  }

  const detailUrls = extractDetailUrls(listing)
  const wanted = opts.limit !== undefined ? detailUrls.slice(0, opts.limit) : detailUrls

  const results: JobCard[] = []
  for (let i = 0; i < wanted.length; i += CONCURRENCY) {
    const batch = wanted.slice(i, i + CONCURRENCY)
    const pages = await Promise.all(
      // One bad vacancy page must not cost us the batch.
      batch.map(async (u) => {
        try {
          return { url: u, html: await fetchHtml(u) }
        } catch {
          return { url: u, html: "" }
        }
      }),
    )
    for (const { url: u, html } of pages) {
      if (!html) continue
      const card = parseDetailPage(html, u)
      if (card) results.push(card)
    }
  }

  const fresh = withinJobAge(results, opts.jobage)

  if (opts.format === "json") {
    process.stdout.write(
      JSON.stringify(
        {
          meta: { total: readTotal(listing) ?? fresh.length, page: opts.page, perPage: detailUrls.length },
          results: fresh,
        },
        null,
        2,
      ) + "\n",
    )
    return 0
  }

  if (fresh.length === 0) {
    process.stdout.write("No vacancies matched.\n")
    return 0
  }

  if (opts.format === "table") {
    for (const r of fresh) {
      process.stdout.write(
        [
          r.title,
          `  ${r.company ?? "-"} | ${r.location ?? "-"} | ${r.date ?? "-"}${
            r.deadline ? ` | scade ${r.deadline}` : ""
          }${r.salary ? ` | ${formatSalary(r)}` : ""}`,
          `  ${r.url}`,
        ].join("\n") + "\n\n",
      )
    }
    return 0
  }

  for (const r of fresh) {
    process.stdout.write(
      [
        `Title:    ${r.title}`,
        `Company:  ${r.company ?? "-"}`,
        `Location: ${r.location ?? "-"}`,
        `Date:     ${r.date ?? "-"}`,
        `Deadline: ${r.deadline ?? "-"}`,
        `Salary:   ${r.salary ? formatSalary(r) : "-"}`,
        `URL:      ${r.url}`,
        r.description ? `\n${r.description}\n` : "",
        "---",
      ].join("\n") + "\n",
    )
  }
  return 0
}

export function formatSalary(job: JobCard): string {
  const s = job.salary
  if (!s) return "-"
  const cur = s.currency ?? ""
  const range =
    s.min !== null && s.max !== null && s.min !== s.max
      ? `${s.min}-${s.max}`
      : String(s.min ?? s.max ?? "")
  const unit = s.unit ? `/${s.unit.toLowerCase()}` : ""
  return `${cur} ${range}${unit}`.trim()
}

export function withinJobAge(cards: JobCard[], days: number): JobCard[] {
  if (!Number.isFinite(days) || days >= 9999) return cards
  const cutoff = Date.now() - days * 86400000
  return cards.filter((c) => {
    if (!c.date) return true
    const t = Date.parse(`${c.date}T00:00:00Z`)
    return Number.isNaN(t) ? true : t >= cutoff
  })
}
