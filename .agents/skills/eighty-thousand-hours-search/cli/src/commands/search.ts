import {
  PER_PAGE,
  algoliaQuery,
  buildSearchParams,
  fail,
  loadBoardConfig,
  toJobCard,
  type AlgoliaResponse,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query: string
  locations: string[]
  remote: boolean
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header =
    "ID".padEnd(7) + " " + "TITLE".padEnd(44) + " " + "COMPANY".padEnd(24) + " " + "LOCATION".padEnd(26) + " DATE"
  const rows = cards.map((c) => {
    const title = c.title.slice(0, 44).padEnd(44)
    const company = (c.company ?? "-").slice(0, 24).padEnd(24)
    const loc = (c.location ?? "-").slice(0, 26).padEnd(26)
    return `${c.id.padEnd(7)} ${title} ${company} ${loc} ${c.date ?? "-"}`
  })
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

function renderPlain(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  return cards
    .map((c) =>
      [
        c.title,
        `  ${c.company ?? "-"} · ${c.location ?? "-"}${c.remote ? " · remote" : ""} · posted ${c.date ?? "-"}` +
          (c.deadline ? ` · closes ${c.deadline}` : ""),
        c.salary ? `  salary: ${c.salary}` : null,
        c.areas.length ? `  area: ${c.areas.join(", ")}` : null,
        `  id: ${c.id}`,
        `  ${c.url}`,
      ]
        .filter((line) => line !== null)
        .join("\n"),
    )
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  let data: AlgoliaResponse
  try {
    const cfg = await loadBoardConfig()
    data = await algoliaQuery(
      cfg,
      buildSearchParams({
        query: opts.query,
        page: opts.page,
        locations: opts.locations,
        remote: opts.remote,
        jobage: opts.jobage,
      }),
    )
  } catch (e) {
    return fail(e)
  }

  const hits = Array.isArray(data?.hits) ? data.hits : []
  // Per-record mapping: one malformed record is skipped, not fatal.
  let cards: JobCard[] = []
  for (const hit of hits) {
    const card = toJobCard(hit)
    if (card) cards.push(card)
  }
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
          total: typeof data?.nbHits === "number" ? data.nbHits : null,
          pages: typeof data?.nbPages === "number" ? data.nbPages : null,
        },
        results: cards,
      },
      null,
      2,
    ) + "\n",
  )
  return 0
}
