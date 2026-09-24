import {
  SOURCE,
  fail,
  fetchFeed,
  parseIdInput,
  settings,
  sleep,
  toJob,
  writeError,
  type Job,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  categories: string[]
  format: "json" | "plain"
}

/**
 * Find one job in the feeds by its slug. The requested category feeds are
 * checked first (a job found through `--category` may be too old for the
 * site-wide feed), then the site-wide feed; the first exact match wins.
 *
 * Only the feeds are read, never the HTML job page, so the description is the
 * feed's excerpt (cut at 500 characters of HTML). The full posting is at `url`.
 */
export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = parseIdInput(opts.id)
  if (!id) {
    writeError(
      `"${opts.id}" is not a Remote Impact job id or URL ` +
        `(expected a slug such as senior-software-engineer-far-ai, or https://remoteimpact.org/jobs/<slug>/)`,
      "BAD_ID",
    )
    return 1
  }

  const targets: Array<string | undefined> = [...opts.categories, undefined]
  const checked: string[] = []
  let job: Job | null = null
  let foundIn: string | null = null
  try {
    for (let i = 0; i < targets.length && !job; i++) {
      if (i > 0) await sleep(settings.politeDelayMs)
      const { url, items } = await fetchFeed(targets[i])
      checked.push(url)
      for (const item of items) {
        const candidate = toJob(item, targets[i] ? [targets[i]!] : [])
        // Only an exact id match counts - never fall back to whatever came first.
        if (candidate?.id === id) {
          job = candidate
          foundIn = url
          break
        }
      }
    }
  } catch (e) {
    return fail(e)
  }

  if (!job) {
    writeError(
      `Job "${id}" is not in the current Remote Impact feed(s) checked (${checked.join(", ")}). ` +
        `Each feed holds only its newest 50 roles; if you found it with --category, pass the same --category. ` +
        `The job page is https://remoteimpact.org/jobs/${id}/`,
      "NOT_FOUND",
    )
    return 1
  }

  if (opts.format === "json") {
    process.stdout.write(JSON.stringify({ ...job, foundIn }, null, 2) + "\n")
    return 0
  }

  process.stdout.write(
    [
      `Title:         ${job.title}`,
      `Organisation:  ${job.company ?? "-"}`,
      `Location:      ${job.location} (region, if any, is stated only in the text)`,
      `Posted:        ${job.published ?? "-"}`,
      `Categories:    ${job.categories.length ? job.categories.join(", ") : "-"}`,
      `Job page:      ${job.url}`,
      "",
      job.descriptionTruncated
        ? "Description (the feed's 500-character excerpt; read the full posting at the job page):"
        : "Description:",
      job.description ?? "(no description in the feed)",
      "",
      `Source: ${SOURCE}.`,
    ].join("\n") + "\n",
  )
  return 0
}
