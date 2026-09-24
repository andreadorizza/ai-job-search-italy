import {
  LICENSE,
  LICENSE_URL,
  PER_PAGE,
  SOURCE,
  buildSearchUrl,
  fail,
  fetchPage,
  hasNextPage,
  parseJobCards,
  resolveCountry,
  withinJobage,
  type Country,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query: string
  location?: string
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header =
    "ID".padEnd(52) + " " + "TITLE".padEnd(36) + " " + "COMPANY".padEnd(16) + " " + "LOCATION".padEnd(16) + " DEADLINE"
  const rows = cards.map((c) => {
    const title = c.title.slice(0, 36).padEnd(36)
    const company = (c.company ?? "-").slice(0, 16).padEnd(16)
    const loc = (c.location ?? "-").slice(0, 16).padEnd(16)
    return `${c.id.slice(0, 52).padEnd(52)} ${title} ${company} ${loc} ${c.deadline ?? "-"}`
  })
  return [header, "-".repeat(header.length), ...rows, "", `Fonte: ${SOURCE} (${LICENSE})`].join("\n")
}

function renderPlain(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const blocks = cards.map((c) =>
    [
      c.headline,
      `  ${c.company ?? "-"} · ${c.location ?? "-"} · published ${c.publishedMonth ?? "-"}` +
        (c.deadline ? ` · deadline ${c.deadline}` : ""),
      c.contractType || c.duration
        ? `  contract: ${[c.contractType, c.duration].filter(Boolean).join(", ")}`
        : null,
      `  id: ${c.id}`,
      `  ${c.url}`,
    ]
      .filter((line) => line !== null)
      .join("\n"),
  )
  return blocks.join("\n\n") + `\n\nFonte: ${SOURCE} (${LICENSE})`
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  let html: string
  let country: Country | undefined
  try {
    if (opts.location) country = await resolveCountry(opts.location)
    const url = buildSearchUrl({ query: opts.query, page: opts.page, paeseId: country?.id })
    const page = await fetchPage(url)
    if (page === null) {
      return fail(new Error(`The job search page returned 404 (${url}) - the site has changed; see url-reference.md`))
    }
    html = page
  } catch (e) {
    return fail(e)
  }

  // Per-card parsing inside parseJobCards: one malformed card is skipped, not fatal.
  let cards = parseJobCards(html)
  if (opts.jobage !== undefined) cards = cards.filter((c) => withinJobage(c, opts.jobage!))
  if (opts.limit !== undefined) cards = cards.slice(0, opts.limit)

  if (opts.format === "table") {
    process.stdout.write(renderTable(cards) + "\n")
    return 0
  }
  if (opts.format === "plain") {
    process.stdout.write(renderPlain(cards) + "\n")
    return 0
  }
  process.stdout.write(
    JSON.stringify(
      {
        meta: {
          count: cards.length,
          page: opts.page,
          perPage: PER_PAGE,
          hasNext: hasNextPage(html),
          country: country ? { id: country.id, name: country.name } : null,
          attribution: { source: SOURCE, license: LICENSE, licenseUrl: LICENSE_URL },
        },
        results: cards,
      },
      null,
      2,
    ) + "\n",
  )
  return 0
}
