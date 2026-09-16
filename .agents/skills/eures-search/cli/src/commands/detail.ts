import {
  SEARCH_PATH,
  apiPost,
  buildSearchBody,
  detailUrl,
  parseIdInput,
  toJobDetail,
  writeError,
  type JobDetail,
  type SearchResponse,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/**
 * EURES exposes no per-vacancy REST endpoint - every path the portal's own
 * bundle could plausibly use answers 404, and the vacancy page is a
 * client-rendered SPA shell with no content in its HTML.
 *
 * It does not need one: the search endpoint returns the complete record,
 * description included, and searching for a vacancy's own base64 id with
 * `specificSearchCode: EVERYWHERE` matches that single vacancy. So `detail` is
 * one request, same as a dedicated endpoint would have been.
 */
export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = parseIdInput(opts.id)
  if (!id) {
    writeError(
      `"${opts.id}" is not a EURES vacancy id or a europa.eu vacancy URL ` +
        `(expected an id, or https://europa.eu/eures/portal/jv-se/jv-details/<id>)`,
      "BAD_ID",
    )
    return 1
  }

  let data: SearchResponse
  try {
    data = await apiPost<SearchResponse>(
      SEARCH_PATH,
      buildSearchBody({
        query: id,
        page: 1,
        perPage: 5,
        locationCodes: [],
        sort: "MOST_RECENT",
      }),
    )
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "API_ERROR")
    return 1
  }

  const match = (data?.jvs ?? []).find((jv) => jv?.id === id)
  if (!match) {
    writeError(`No EURES vacancy found with id "${id}" (it may have expired)`, "NOT_FOUND")
    return 1
  }

  const detail: JobDetail | null = toJobDetail(match)
  if (!detail) {
    writeError(`EURES returned a vacancy for "${id}" with no usable title`, "PARSE_ERROR")
    return 1
  }

  if (opts.format === "json") {
    process.stdout.write(JSON.stringify(detail, null, 2) + "\n")
    return 0
  }

  process.stdout.write(
    [
      `Title:     ${detail.title}`,
      `Company:   ${detail.company ?? "-"}`,
      `Location:  ${detail.location ?? "-"}`,
      `Posted:    ${detail.date ?? "-"}`,
      `Updated:   ${detail.lastModified ?? "-"}`,
      `Positions: ${detail.numberOfPosts ?? "-"}`,
      `Contract:  ${detail.contractType ?? "-"}`,
      `Languages: ${detail.languages.length ? detail.languages.join(", ") : "-"}`,
      `URL:       ${detailUrl(detail.id)}`,
      "",
      detail.description ?? "(no description)",
    ].join("\n") + "\n",
  )
  return 0
}
