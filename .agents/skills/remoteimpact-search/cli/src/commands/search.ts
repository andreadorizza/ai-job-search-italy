import {
  PER_PAGE,
  SOURCE,
  fail,
  fetchFeed,
  matchesQuery,
  mergeFeeds,
  parseQuery,
  settings,
  sleep,
  withinDays,
  type FeedItem,
  type Job,
} from "../helpers.js"

export interface SearchOpts {
  query: string
  categories: string[]
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
  nowMs?: number
}

const ATTRIBUTION = `Source: ${SOURCE}. Keep this attribution and the job links when sharing.`

function renderTable(jobs: Job[]): string {
  if (jobs.length === 0) return `No results.\n\n${ATTRIBUTION}`
  const header = "TITLE".padEnd(46) + " " + "ORGANISATION".padEnd(28) + " " + "DATE".padEnd(10) + " ID"
  const rows = jobs.map((j) => {
    const title = j.title.slice(0, 46).padEnd(46)
    const company = (j.company ?? "-").slice(0, 28).padEnd(28)
    return `${title} ${company} ${(j.date ?? "-").padEnd(10)} ${j.id}`
  })
  return [header, "-".repeat(header.length), ...rows, "", ATTRIBUTION].join("\n")
}

function renderPlain(jobs: Job[]): string {
  if (jobs.length === 0) return `No results.\n\n${ATTRIBUTION}`
  const blocks = jobs.map((j) =>
    [
      j.title,
      `  ${j.company ?? "-"} · ${j.location} · posted ${j.date ?? "-"}` +
        (j.categories.length ? ` · ${j.categories.join(", ")}` : ""),
      `  id: ${j.id}`,
      `  ${j.url}`,
    ].join("\n"),
  )
  return [...blocks, ATTRIBUTION].join("\n\n")
}

/**
 * The feeds ignore every query parameter, so this fetches the site-wide feed
 * (or one feed per requested category), then filters by keyword and age and
 * paginates on the client.
 */
export async function runSearch(opts: SearchOpts): Promise<number> {
  const feeds: Array<{ category?: string; url: string; items: FeedItem[] }> = []
  try {
    const targets: Array<string | undefined> = opts.categories.length ? opts.categories : [undefined]
    for (let i = 0; i < targets.length; i++) {
      if (i > 0) await sleep(settings.politeDelayMs)
      const { url, items } = await fetchFeed(targets[i])
      feeds.push({ category: targets[i], url, items })
    }
  } catch (e) {
    return fail(e)
  }

  const all = mergeFeeds(feeds)
  const terms = parseQuery(opts.query)
  const nowMs = opts.nowMs ?? Date.now()
  const matched = all.filter(
    (j) => matchesQuery(j, terms) && (opts.jobage === undefined || withinDays(j, opts.jobage, nowMs)),
  )

  const start = (opts.page - 1) * PER_PAGE
  let results = matched.slice(start, start + PER_PAGE)
  if (opts.limit !== undefined) results = results.slice(0, opts.limit)

  if (opts.format === "table") {
    process.stdout.write(renderTable(results) + "\n")
    return 0
  }
  if (opts.format === "plain") {
    process.stdout.write(renderPlain(results) + "\n")
    return 0
  }

  // The window the feeds covered, so a caller can tell "no match" from "the
  // feed does not reach back that far".
  const dates = all.map((j) => j.date).filter((d): d is string => d !== null).sort()
  process.stdout.write(
    JSON.stringify(
      {
        meta: {
          count: results.length,
          page: opts.page,
          perPage: PER_PAGE,
          total: matched.length,
          pages: Math.ceil(matched.length / PER_PAGE),
          scanned: all.length,
          coverage: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
          feeds: feeds.map((f) => f.url),
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
