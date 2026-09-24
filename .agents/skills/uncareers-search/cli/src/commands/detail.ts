import {
  fail,
  listBody,
  listOpenings,
  parseIdInput,
  toJobDetail,
  writeError,
  type ListResult,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/**
 * The portal has a per-job endpoint, but loading a posting through it counts as
 * a public view of that posting, and a CLI lookup is not a candidate reading
 * the page. The list endpoint already carries each posting's full text, and a
 * keyword search for the numeric id returns that posting, so `detail` is one
 * list query - the same single request a dedicated endpoint would cost - and
 * then accepts only an exact jobId match.
 */
export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = parseIdInput(opts.id)
  if (!id) {
    writeError(
      `"${opts.id}" is not a UN Careers job id or posting URL ` +
        `(expected a number such as 285103, or https://careers.un.org/jobSearchDescription/<id>)`,
      "BAD_ID",
    )
    return 1
  }

  let data: ListResult
  try {
    data = await listOpenings(listBody({ keyword: id }, 1))
  } catch (e) {
    return fail(e)
  }

  // Only an exact id match counts - never fall back to whatever came first.
  const item = data.list.find((o) => String(o?.jobId) === id)
  if (!item) {
    writeError(`No open UN Careers posting found with id "${id}" (it may have closed)`, "NOT_FOUND")
    return 1
  }
  const detail = toJobDetail(item)
  if (!detail) {
    writeError(`UN Careers returned posting "${id}" with no usable title`, "PARSE_ERROR")
    return 1
  }

  if (opts.format === "json") {
    process.stdout.write(JSON.stringify(detail, null, 2) + "\n")
    return 0
  }

  const row = (label: string, value: string) => `${(label + ":").padEnd(19)} ${value}`
  process.stdout.write(
    [
      row("Title", detail.title),
      row("Department/Office", detail.company ?? "-"),
      row("Duty station", detail.location ?? "-"),
      row("Level", detail.level ?? "-"),
      row("Category", detail.category ?? "-"),
      row("Job network", detail.jobNetwork ?? "-"),
      row("Job family", detail.jobFamily ?? "-"),
      row("Recruitment type", detail.recruitmentType ?? "-"),
      row("Posted", detail.date ?? "-"),
      row("Deadline", detail.deadline ? `${detail.deadline} (11:59 p.m. New York time)` : "-"),
      ...(detail.workLocation
        ? [
            row(
              "Work location",
              // Flag the heuristic's verdict only where the text does not already say it.
              detail.homeBased && !/home[\s-]*based/i.test(detail.workLocation)
                ? `${detail.workLocation} (home-based)`
                : detail.workLocation,
            ),
            row("Duration", detail.duration ?? "-"),
          ]
        : []),
      row("Posting", detail.url),
      "",
      detail.description ?? "(no description)",
    ].join("\n") + "\n",
  )
  return 0
}
