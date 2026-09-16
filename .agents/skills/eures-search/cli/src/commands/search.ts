import {
  SEARCH_PATH,
  apiPost,
  buildSearchBody,
  toJobCard,
  toLocationCodes,
  withinJobAge,
  writeError,
  type JobCard,
  type SearchResponse,
} from "../helpers.js"

export interface SearchOpts {
  query: string
  location: string
  jobage: number
  page: number
  limit?: number
  sort: "MOST_RECENT" | "BEST_MATCH"
  format: "json" | "table" | "plain"
}

const PER_PAGE = 20

export async function runSearch(opts: SearchOpts): Promise<number> {
  let data: SearchResponse
  try {
    data = await apiPost<SearchResponse>(
      SEARCH_PATH,
      buildSearchBody({
        query: opts.query,
        page: opts.page,
        perPage: PER_PAGE,
        locationCodes: toLocationCodes(opts.location),
        sort: opts.sort,
      }),
    )
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "API_ERROR")
    return 1
  }

  const jvs = Array.isArray(data?.jvs) ? data.jvs : []
  // Per-record mapping: one malformed vacancy is skipped, not fatal.
  const cards: JobCard[] = []
  for (const raw of jvs) {
    const card = toJobCard(raw)
    if (card) cards.push(card)
  }

  let results = withinJobAge(cards, opts.jobage)
  if (opts.limit !== undefined) results = results.slice(0, opts.limit)

  if (opts.format === "json") {
    process.stdout.write(
      JSON.stringify(
        {
          meta: {
            total: typeof data?.numberRecords === "number" ? data.numberRecords : results.length,
            page: opts.page,
            perPage: PER_PAGE,
          },
          results,
        },
        null,
        2,
      ) + "\n",
    )
    return 0
  }

  if (results.length === 0) {
    process.stdout.write("No vacancies matched.\n")
    return 0
  }

  if (opts.format === "table") {
    for (const r of results) {
      process.stdout.write(
        [
          r.title,
          `  ${r.company ?? "-"} | ${r.location ?? "-"} | ${r.date ?? "-"}`,
          `  ${r.url}`,
        ].join("\n") + "\n\n",
      )
    }
    return 0
  }

  for (const r of results) {
    process.stdout.write(
      [
        `Title:    ${r.title}`,
        `Company:  ${r.company ?? "-"}`,
        `Location: ${r.location ?? "-"}`,
        `Date:     ${r.date ?? "-"}`,
        `URL:      ${r.url}`,
        r.description ? `\n${r.description}\n` : "",
        "---",
      ].join("\n") + "\n",
    )
  }
  return 0
}
