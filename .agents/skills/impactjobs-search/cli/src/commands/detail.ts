import {
  SOURCE,
  cleanInline,
  detailUrl,
  extractJobPosting,
  extractWindowJob,
  fail,
  fetchPage,
  htmlToText,
  isObj,
  parseIdInput,
  parseTimestamp,
  toJob,
  writeError,
  CliError,
  type Job,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

export interface JobDetail extends Job {
  status: string | null
  validThrough: string | null
  applicantLocation: string[]
  updated: string | null
  companyWebsite: string | null
  companyDescription: string | null
}

/** "New York, NY, United States" from a schema.org Place (or list of them). */
function placeText(v: unknown): string | null {
  const place = Array.isArray(v) ? v[0] : v
  if (!isObj(place) || !isObj(place.address)) return null
  const a = place.address
  const parts = [a.addressLocality, a.addressRegion, a.addressCountry].map(cleanInline).filter((p): p is string => !!p)
  return parts.length ? parts.join(", ") : null
}

function applicantLocations(v: unknown): string[] {
  const list = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]
  const out: string[] = []
  for (const item of list) {
    const name = isObj(item) ? cleanInline(item.name) : cleanInline(item)
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

const EMPLOYMENT_TYPES: Record<string, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACTOR: "Contract",
  TEMPORARY: "Temporary",
  INTERN: "Internship",
  VOLUNTEER: "Volunteer",
  PER_DIEM: "Per diem",
  OTHER: "Other",
}

/**
 * One request: the job's own page. The job comes from the `window.job` JSON
 * the page embeds; the schema.org JobPosting block adds the closing date, the
 * employment type and where applicants may live.
 */
export async function runDetail(opts: DetailOpts): Promise<number> {
  const parsed = parseIdInput(opts.id)
  if (!parsed) {
    writeError(
      `"${opts.id}" is not an Impact Jobs job id or URL ` +
        `(expected a number such as 658739199, or https://impactjobs.org/jobs/<id>-<slug>)`,
      "BAD_ID",
    )
    return 1
  }
  const { id, slug } = parsed
  const url = detailUrl(id, slug)

  let detail: JobDetail
  try {
    const page = await fetchPage(url)
    if (!page) {
      throw new CliError(`Job ${id} is not on Impact Jobs (404 on ${url}) - it has expired or been removed`, "NOT_FOUND")
    }
    const raw = extractWindowJob(page.html)
    if (!raw) {
      throw new CliError(`${page.finalUrl} no longer embeds window.job - the board has changed its pages; see url-reference.md`, "PARSE_ERROR")
    }
    const job = toJob(raw, { full: true })
    if (!job) throw new CliError(`${page.finalUrl}: the embedded job has no usable id or title`, "PARSE_ERROR")
    // Only an exact id match counts - never report whatever job the page shows.
    if (job.id !== id) {
      throw new CliError(`${page.finalUrl} shows job ${job.id}, not ${id}`, "PARSE_ERROR")
    }

    const ld = extractJobPosting(page.html)
    const employer = isObj(raw.employer) ? raw.employer : null
    const validThrough = parseTimestamp(ld?.validThrough)
    const updated = parseTimestamp(raw.updated_at)
    const employmentType = typeof ld?.employmentType === "string" ? ld.employmentType : null
    const telecommute = ld?.jobLocationType === "TELECOMMUTE"

    detail = {
      ...job,
      // The job page's embedded object omits the type and place objects the
      // list pages carry, so fall back to the JobPosting block.
      location: job.location ?? placeText(ld?.jobLocation) ?? (telecommute ? "Remote" : null),
      remote: job.remote ?? (ld ? telecommute : null),
      jobType: job.jobType ?? (employmentType ? (EMPLOYMENT_TYPES[employmentType] ?? employmentType) : null),
      status: cleanInline(raw.status),
      validThrough: validThrough ? validThrough.toISOString().slice(0, 10) : null,
      applicantLocation: applicantLocations(ld?.applicantLocationRequirements),
      updated: updated ? updated.toISOString() : null,
      companyWebsite: cleanInline(employer?.website),
      companyDescription: htmlToText(typeof employer?.description === "string" ? employer.description : null),
    }
  } catch (e) {
    return fail(e)
  }

  if (opts.format === "json") {
    process.stdout.write(JSON.stringify(detail, null, 2) + "\n")
    return 0
  }

  const d = detail
  process.stdout.write(
    [
      `Title:         ${d.title}`,
      `Organisation:  ${d.company ?? "-"}${d.companyWebsite ? ` (${d.companyWebsite})` : ""}`,
      `Location:      ${d.location ?? "-"}${d.remote && d.location !== "Remote" ? " (remote)" : ""}`,
      ...(d.applicantLocation.length ? [`Applicants in: ${d.applicantLocation.join(", ")}`] : []),
      `Type:          ${d.jobType ?? "-"}`,
      `Salary:        ${d.salary ?? "-"}`,
      `Posted:        ${d.date ?? "-"}`,
      `Listed until:  ${d.validThrough ?? "-"}`,
      `Status:        ${d.status ?? "-"}`,
      `Job page:      ${d.url}`,
      `Apply:         ${d.applyUrl ?? "-"}`,
      "",
      "Description:",
      d.description ?? "(no description)",
      "",
      `Source: ${SOURCE}.`,
    ].join("\n") + "\n",
  )
  return 0
}
