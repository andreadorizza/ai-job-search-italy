import {
  ApiError,
  JOBS_PATH,
  apiPost,
  buildSearchBody,
  requireAppname,
  toJobCard,
  writeError,
  type ApiListResponse,
  type CategoryResolution,
  type CountryResolution,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  countries?: CountryResolution
  remote: boolean
  categories?: CategoryResolution
  jobage?: number
  page: number
  limit?: number
  sort: "recent" | "relevance" | "closing"
  format: "json" | "table" | "plain"
}

export const PER_PAGE = 20

export async function runSearch(opts: SearchOpts): Promise<number> {
  const appname = requireAppname()
  if (!appname) return 1

  let data: ApiListResponse | null
  try {
    data = await apiPost<ApiListResponse>(
      JOBS_PATH,
      buildSearchBody({
        query: opts.query,
        countries: opts.countries,
        remote: opts.remote,
        categories: opts.categories,
        jobage: opts.jobage,
        page: opts.page,
        perPage: PER_PAGE,
        sort: opts.sort,
      }),
      appname,
    )
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), e instanceof ApiError ? e.code : "API_ERROR")
    return 1
  }
  if (!data) {
    writeError("ReliefWeb answered 404 for the jobs endpoint", "API_ERROR")
    return 1
  }

  const items = Array.isArray(data.data) ? data.data : []
  // Per-record mapping: one malformed job is skipped, not fatal.
  const cards: JobCard[] = []
  for (const item of items) {
    const card = toJobCard(item)
    if (card) cards.push(card)
  }
  const results = opts.limit !== undefined ? cards.slice(0, opts.limit) : cards

  if (opts.format === "json") {
    process.stdout.write(
      JSON.stringify(
        {
          meta: {
            count: results.length,
            page: opts.page,
            perPage: PER_PAGE,
            total: typeof data.totalCount === "number" ? data.totalCount : null,
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
    process.stdout.write("No jobs matched.\n")
    return 0
  }

  if (opts.format === "table") {
    for (const r of results) {
      process.stdout.write(
        [
          `${r.title}  [${r.id}]`,
          `  ${r.company ?? "-"} | ${r.location ?? "-"} | posted ${r.date ?? "-"} | closes ${r.deadline ?? "-"}`,
          `  ${[r.type, r.experience, ...r.categories].filter(Boolean).join(" | ") || "-"}`,
          `  ${r.url}`,
        ].join("\n") + "\n\n",
      )
    }
    return 0
  }

  for (const r of results) {
    process.stdout.write(
      [
        `ID:         ${r.id}`,
        `Title:      ${r.title}`,
        `Company:    ${r.company ?? "-"}`,
        `Location:   ${r.location ?? "-"}`,
        `Posted:     ${r.date ?? "-"}`,
        `Closes:     ${r.deadline ?? "-"}`,
        `Type:       ${r.type ?? "-"}`,
        `Experience: ${r.experience ?? "-"}`,
        `Category:   ${r.categories.join(", ") || "-"}`,
        `URL:        ${r.url}`,
        "---",
      ].join("\n") + "\n",
    )
  }
  return 0
}
