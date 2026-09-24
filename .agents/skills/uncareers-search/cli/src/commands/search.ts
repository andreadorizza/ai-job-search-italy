import {
  PER_PAGE,
  buildFilterConfig,
  fail,
  listBody,
  listOpenings,
  loadLocationVocabulary,
  resolveLocations,
  toJobCard,
  withinDays,
  type JobCard,
  type ListResult,
} from "../helpers.js"

export interface SearchOpts {
  query: string
  locations: string[]
  /** Recruitment-type codes (`recrtype`) from parseCategories. */
  recruitmentTypes: string[]
  networks: string[]
  homeBased: boolean
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
  nowMs?: number
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header =
    "ID".padEnd(7) +
    " " +
    "TITLE".padEnd(44) +
    " " +
    "DEPARTMENT / OFFICE".padEnd(30) +
    " " +
    "LOCATION".padEnd(22) +
    " " +
    "POSTED".padEnd(10) +
    " DEADLINE"
  const rows = cards.map((c) => {
    const title = c.title.slice(0, 44).padEnd(44)
    const company = (c.company ?? "-").slice(0, 30).padEnd(30)
    const loc = (c.homeBased ? `${c.location ?? "-"} (home)` : (c.location ?? "-")).slice(0, 22).padEnd(22)
    return `${c.id.padEnd(7)} ${title} ${company} ${loc} ${(c.date ?? "-").padEnd(10)} ${c.deadline ?? "-"}`
  })
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

function renderPlain(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  return cards
    .map((c) =>
      [
        c.title,
        `  ${c.company ?? "-"} · ${c.location ?? "-"} · ${c.level ?? "-"} · posted ${c.date ?? "-"} · deadline ${c.deadline ?? "-"}`,
        `  ${c.category ?? "-"}${c.jobNetwork ? ` · ${c.jobNetwork}` : ""}`,
        c.workLocation ? `  work location: ${c.workLocation}${c.duration ? ` · duration: ${c.duration}` : ""}` : null,
        c.summary ? `  ${c.summary}` : null,
        `  id: ${c.id}`,
        `  ${c.url}`,
      ]
        .filter((line) => line !== null)
        .join("\n"),
    )
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  let data: ListResult
  let matchedLocations: string[] | null = null
  try {
    let dutyStations: string[] = []
    if (opts.locations.length) {
      const resolved = resolveLocations(opts.locations, await loadLocationVocabulary())
      matchedLocations = resolved.matched
      dutyStations = resolved.codes
    }
    if (opts.locations.length && dutyStations.length === 0) {
      // Every matched place is one the portal cannot filter on (no duty
      // station behind it). Sending no `ds` would return the whole board, so
      // answer with an honest empty result instead.
      data = { list: [], count: 0 }
    } else {
      data = await listOpenings(
        listBody(
          buildFilterConfig({
            query: opts.query,
            dutyStations,
            recruitmentTypes: opts.recruitmentTypes,
            networks: opts.networks,
            jobage: opts.jobage,
          }),
          opts.page,
        ),
      )
    }
  } catch (e) {
    return fail(e)
  }

  // Per-item mapping: one malformed item is skipped, not fatal.
  let cards: JobCard[] = []
  for (const item of data.list) {
    const card = toJobCard(item)
    if (card) cards.push(card)
  }
  // The server's date filter only knows 1/7/30 days; trim to the exact window.
  if (opts.jobage !== undefined) {
    const days = opts.jobage
    cards = cards.filter((c) => withinDays(c.date, days, opts.nowMs))
  }
  if (opts.homeBased) cards = cards.filter((c) => c.homeBased === true)
  if (opts.limit !== undefined) cards = cards.slice(0, opts.limit)

  if (opts.format === "table") {
    process.stdout.write(renderTable(cards) + "\n")
    return 0
  }
  if (opts.format === "plain") {
    process.stdout.write(renderPlain(cards) + "\n")
    return 0
  }
  const total = data.count
  process.stdout.write(
    JSON.stringify(
      {
        meta: {
          count: cards.length,
          page: opts.page,
          perPage: PER_PAGE,
          total,
          pages: total === null ? null : Math.ceil(total / PER_PAGE),
          locations: matchedLocations,
        },
        results: cards,
      },
      null,
      2,
    ) + "\n",
  )
  return 0
}
