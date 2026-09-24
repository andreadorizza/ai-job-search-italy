import {
  PER_PAGE,
  SOURCE,
  CliError,
  buildSearchUrl,
  checkFilters,
  extractJobChunks,
  fail,
  fetchPage,
  hasJobsList,
  parseJobs,
  parsePagination,
  usedFilters,
  type Job,
} from "../helpers.js"

export interface SearchOpts {
  query: string
  location: string
  remote: boolean
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

function cell(s: string | null, width: number): string {
  const v = s ?? "-"
  return (v.length > width ? v.slice(0, width - 1) + "…" : v).padEnd(width)
}

function renderTable(jobs: Job[]): string {
  if (jobs.length === 0) return "No results."
  const header = [cell("TITLE", 44), cell("ORGANISATION", 26), cell("LOCATION", 22), "RMT", cell("DATE", 10), "ID"].join(" ")
  const rows = jobs.map((j) =>
    [
      cell(j.title, 44),
      cell(j.company, 26),
      cell(j.location, 22),
      j.remote ? "yes" : "-  ",
      cell(j.date, 10),
      j.id,
    ].join(" "),
  )
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

function renderPlain(jobs: Job[]): string {
  if (jobs.length === 0) return "No results."
  return jobs
    .map((j) =>
      [
        j.title,
        `  ${j.company ?? "-"} · ${j.location ?? "-"}${j.remote && j.location !== "Remote" ? " · remote" : ""} · posted ${j.date ?? "-"}` +
          (j.jobType ? ` · ${j.jobType}` : ""),
        ...(j.salary ? [`  salary: ${j.salary}`] : []),
        `  id: ${j.id}`,
        `  ${j.url}`,
      ].join("\n"),
    )
    .join("\n\n")
}

/**
 * One request: the board's own /jobs results page with the filters in the
 * query string, newest first. The jobs come from the JSON the page embeds.
 */
export async function runSearch(opts: SearchOpts): Promise<number> {
  const params = { query: opts.query, location: opts.location, remote: opts.remote, jobage: opts.jobage, page: opts.page }
  const url = buildSearchUrl(params)

  let jobs: Job[]
  let skipped: number
  let pagination: { pages: number | null; hasNext: boolean }
  try {
    const page = await fetchPage(url)
    if (!page) throw new CliError(`${url} returned 404 - the board has moved its job list; see url-reference.md`, "API_ERROR")
    if (!hasJobsList(page.html)) {
      throw new CliError(
        `${url} no longer embeds window.jobsList - the board has changed its pages; see url-reference.md`,
        "PARSE_ERROR",
      )
    }
    checkFilters(page.html, usedFilters(params))
    ;({ jobs, skipped } = parseJobs(extractJobChunks(page.html)))
    pagination = parsePagination(page.html, opts.page, jobs.length)
  } catch (e) {
    return fail(e)
  }

  const results = opts.limit !== undefined ? jobs.slice(0, opts.limit) : jobs

  if (opts.format === "table") {
    process.stdout.write(renderTable(results) + "\n")
    return 0
  }
  if (opts.format === "plain") {
    process.stdout.write(renderPlain(results) + "\n")
    return 0
  }

  process.stdout.write(
    JSON.stringify(
      {
        meta: {
          count: results.length,
          page: opts.page,
          perPage: PER_PAGE,
          pages: pagination.pages,
          hasNext: pagination.hasNext,
          skipped,
          searchUrl: url,
          source: SOURCE,
        },
        results,
      },
      null,
      2,
    ) + "\n",
  )
  return 0
}
