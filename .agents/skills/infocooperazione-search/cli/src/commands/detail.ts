import { fail, fetchPage, parseDetail, parseIdInput, postingUrl, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** One request: the posting's own page at /<year>/<month>/<slug>. */
export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = parseIdInput(opts.id)
  if (!id) {
    writeError(
      `"${opts.id}" is not an Info Cooperazione posting id or URL ` +
        `(expected <year>/<month>/<slug> such as 2026/9/ong-esempio-project-manager-kenya, ` +
        `or https://www.info-cooperazione.it/<year>/<month>/<slug>)`,
      "BAD_ID",
    )
    return 1
  }

  let html: string | null
  try {
    html = await fetchPage(postingUrl(id))
  } catch (e) {
    return fail(e)
  }
  if (html === null) {
    writeError(`No Info Cooperazione posting at ${postingUrl(id)} (it may have been removed)`, "NOT_FOUND")
    return 1
  }

  const d = parseDetail(html, id)
  if (!d) {
    writeError(`Could not find a title on ${postingUrl(id)} - the page layout has changed; see url-reference.md`, "PARSE_ERROR")
    return 1
  }

  if (opts.format === "json") {
    process.stdout.write(JSON.stringify(d, null, 2) + "\n")
    return 0
  }

  process.stdout.write(
    [
      `Title:       ${d.title}`,
      `Headline:    ${d.headline}`,
      `Company:     ${d.company ?? "-"}`,
      `Location:    ${d.location ?? "-"}`,
      `Published:   ${d.date ?? d.publishedMonth ?? "-"}`,
      `Deadline:    ${d.deadline ?? "-"}`,
      `Contract:    ${[d.contractType, d.duration].filter(Boolean).join(", ") || "-"}`,
      `Posting:     ${d.url}`,
      `Apply at:    ${d.applyUrl ?? "-"}`,
      "",
      d.description ?? "(no description)",
      "",
      `Fonte: ${d.source} - ${d.url} (${d.license}, ${d.licenseUrl})`,
    ].join("\n") + "\n",
  )
  return 0
}
