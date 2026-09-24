import {
  DETAIL_ATTRS,
  algoliaQuery,
  fail,
  loadBoardConfig,
  parseIdInput,
  toJobDetail,
  writeError,
  type AlgoliaResponse,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/**
 * The board has no per-job endpoint and its job pages are client-rendered, so
 * `detail` does what the board's own page does when opened on `?jobPk=<id>`:
 * one index query filtered to that record's objectID. One request, same as a
 * dedicated endpoint would cost.
 */
export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = parseIdInput(opts.id)
  if (!id) {
    writeError(
      `"${opts.id}" is not an 80,000 Hours job id or board URL ` +
        `(expected a number such as 21083, or https://jobs.80000hours.org/jobs?jobPk=<id>)`,
      "BAD_ID",
    )
    return 1
  }

  let data: AlgoliaResponse
  try {
    const cfg = await loadBoardConfig()
    data = await algoliaQuery(cfg, {
      query: "",
      filters: `objectID:${id}`,
      hitsPerPage: 1,
      attributesToRetrieve: DETAIL_ATTRS,
    })
  } catch (e) {
    return fail(e)
  }

  // Only an exact id match counts - never fall back to whatever came first.
  const hit = (data?.hits ?? []).find((h) => h?.objectID === id || String(h?.post_pk) === id)
  if (!hit) {
    writeError(`No 80,000 Hours job found with id "${id}" (it may have closed)`, "NOT_FOUND")
    return 1
  }
  const detail = toJobDetail(hit)
  if (!detail) {
    writeError(`The board returned job "${id}" with no usable title`, "PARSE_ERROR")
    return 1
  }

  if (opts.format === "json") {
    process.stdout.write(JSON.stringify(detail, null, 2) + "\n")
    return 0
  }

  const list = (xs: string[]) => (xs.length ? xs.join("; ") : "-")
  process.stdout.write(
    [
      `Title:       ${detail.title}`,
      `Company:     ${detail.company ?? "-"}`,
      `Location:    ${detail.location ?? "-"}${detail.remote ? " (remote)" : ""}`,
      `Posted:      ${detail.date ?? "-"}`,
      `Closes:      ${detail.deadline ?? "rolling / not stated"}`,
      `Salary:      ${detail.salary ?? "-"}`,
      `Area:        ${list(detail.areas)}`,
      `Skills:      ${list(detail.skills)}`,
      `Role type:   ${list(detail.roleTypes)}`,
      `Experience:  ${list(detail.experience)}`,
      `Education:   ${list(detail.degree)}`,
      `Board page:  ${detail.url}`,
      `Apply at:    ${detail.applyUrl ?? "-"}`,
      "",
      "Summary (from the 80,000 Hours board; the full posting is at the apply link):",
      detail.description ?? "(no summary)",
      "",
      `About ${detail.company ?? "the organisation"}:`,
      detail.companyDescription ?? "(no description)",
    ].join("\n") + "\n",
  )
  return 0
}
