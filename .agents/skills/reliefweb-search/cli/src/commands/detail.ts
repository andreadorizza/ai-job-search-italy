import {
  ApiError,
  JOBS_PATH,
  apiPost,
  buildDetailBody,
  parseIdInput,
  requireAppname,
  toJobDetail,
  writeError,
  type ApiListResponse,
  type JobDetail,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/**
 * One request: an id-filtered list query under the `analysis` preset, which
 * reaches expired postings too (the item endpoint 404s on those).
 */
export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = parseIdInput(opts.id)
  if (id === null) {
    writeError(
      `"${opts.id}" is not a ReliefWeb job id or job URL ` +
        `(expected a number, or https://reliefweb.int/job/<id>/<slug>)`,
      "BAD_ID",
    )
    return 1
  }

  const appname = requireAppname()
  if (!appname) return 1

  let data: ApiListResponse | null
  try {
    data = await apiPost<ApiListResponse>(JOBS_PATH, buildDetailBody(id), appname)
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), e instanceof ApiError ? e.code : "API_ERROR")
    return 1
  }

  const match = (data?.data ?? []).find((item) => String(item?.fields?.id ?? item?.id) === String(id))
  if (!match) {
    writeError(`No ReliefWeb job found with id ${id}`, "NOT_FOUND")
    return 1
  }

  const detail: JobDetail | null = toJobDetail(match)
  if (!detail) {
    writeError(`ReliefWeb returned job ${id} with no usable title`, "PARSE_ERROR")
    return 1
  }

  if (opts.format === "json") {
    process.stdout.write(JSON.stringify(detail, null, 2) + "\n")
    return 0
  }

  process.stdout.write(
    [
      `Title:      ${detail.title}`,
      `Company:    ${detail.company ?? "-"}${detail.companyShort && detail.companyShort !== detail.company ? ` (${detail.companyShort})` : ""}`,
      `Location:   ${detail.location ?? "-"}`,
      `Type:       ${detail.type ?? "-"}`,
      `Experience: ${detail.experience ?? "-"}`,
      `Category:   ${detail.categories.join(", ") || "-"}`,
      `Themes:     ${detail.themes.join(", ") || "-"}`,
      `Posted:     ${detail.date ?? "-"}`,
      `Closes:     ${detail.deadline ?? "-"}`,
      `Status:     ${detail.status ?? "-"}${detail.isActive ? "" : " (not open)"}`,
      `URL:        ${detail.url}`,
      "",
      detail.description ?? "(no description)",
      "",
      "HOW TO APPLY",
      detail.howToApply ?? "(not stated)",
    ].join("\n") + "\n",
  )
  return 0
}
