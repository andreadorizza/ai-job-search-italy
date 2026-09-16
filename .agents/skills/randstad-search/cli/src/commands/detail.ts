import { fetchHtml, parseDetailPage, parseDetailInput, writeError } from "../helpers.js"
import { formatSalary } from "./search.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const parsed = parseDetailInput(opts.id)
  if (!parsed) {
    writeError(
      `"${opts.id}" is not a Randstad vacancy URL. Randstad vacancy ids cannot be resolved on ` +
        `their own - the title and city slugs are part of the path - so pass the full URL, ` +
        `e.g. https://www.randstad.it/offerte-lavoro/<title>_<city>_<uuid>/`,
      "BAD_ID",
    )
    return 1
  }

  let html: string
  try {
    html = await fetchHtml(parsed.url)
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "API_ERROR")
    return 1
  }
  if (!html) {
    writeError(`No Randstad vacancy at ${parsed.url} (it may have expired)`, "NOT_FOUND")
    return 1
  }

  const job = parseDetailPage(html, parsed.url)
  if (!job) {
    writeError(
      `${parsed.url} carries no schema.org/JobPosting markup - it may not be a vacancy page`,
      "PARSE_ERROR",
    )
    return 1
  }

  if (opts.format === "json") {
    process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    return 0
  }

  process.stdout.write(
    [
      `Title:      ${job.title}`,
      `Company:    ${job.company ?? "-"}`,
      `Location:   ${job.location ?? "-"}`,
      `Posted:     ${job.date ?? "-"}`,
      `Deadline:   ${job.deadline ?? "-"}`,
      `Contract:   ${job.employmentType ?? "-"}`,
      `Industry:   ${job.industry ?? "-"}`,
      `Salary:     ${formatSalary(job)}`,
      `URL:        ${job.url}`,
      "",
      job.description ?? "(no description)",
    ].join("\n") + "\n",
  )
  return 0
}
