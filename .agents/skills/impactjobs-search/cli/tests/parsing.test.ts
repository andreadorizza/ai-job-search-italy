import { describe, expect, test } from "bun:test"
import {
  CliError,
  buildSearchUrl,
  checkFilters,
  decodeEntities,
  detailUrl,
  excerpt,
  extractJobChunks,
  extractJobPosting,
  extractWindowJob,
  formatSalary,
  hasJobsList,
  htmlToText,
  jobUrl,
  matchBracket,
  parseIdInput,
  parseJobs,
  parsePagination,
  parseTimestamp,
  splitJsonArray,
  toJob,
  usedFilters,
} from "../src/helpers.js"
import { FILTER_FORM, OLD_JOB, REMOTE_JOB, detailPage, embedJson, jobObj, jobsPage } from "./fixtures.js"

describe("splitJsonArray", () => {
  test("returns the source of each top-level object", () => {
    const text = '[{"id":1,"a":[1,2]},{"id":2,"b":{"c":3}}]'
    expect(splitJsonArray(text, 0)).toEqual(['{"id":1,"a":[1,2]}', '{"id":2,"b":{"c":3}}'])
  })

  test("ignores brackets and escaped quotes inside strings", () => {
    const text = '[{"t":"a ] } [ { \\" still a string"},{"id":2}]'
    const items = splitJsonArray(text, 0)
    expect(items).toHaveLength(2)
    expect(JSON.parse(items[0]!).t).toBe('a ] } [ { " still a string')
  })

  test("stops at the array's own closing bracket", () => {
    const text = '[{"id":1}]); window.other = [{"id":99}]'
    expect(splitJsonArray(text, 0)).toEqual(['{"id":1}'])
  })

  test("an array cut short still yields the objects that closed", () => {
    expect(splitJsonArray('[{"id":1},{"id":2},{"id":3,"t":"cut', 0)).toEqual(['{"id":1}', '{"id":2}'])
  })

  test("an empty array yields nothing", () => {
    expect(splitJsonArray("[]", 0)).toEqual([])
  })
})

describe("matchBracket", () => {
  test("finds the closing brace of a nested object", () => {
    const text = 'x = {"a":{"b":"}"},"c":[1]} ;'
    expect(text[matchBracket(text, 4)]).toBe("}")
    expect(matchBracket(text, 4)).toBe(text.lastIndexOf("}"))
  })

  test("returns -1 when the value never closes", () => {
    expect(matchBracket('{"a":1', 0)).toBe(-1)
  })
})

describe("embedded job list", () => {
  test("hasJobsList is true for an empty list and false when absent", () => {
    expect(hasJobsList(jobsPage({ jobs: [] }))).toBe(true)
    expect(hasJobsList(jobsPage({ noList: true }))).toBe(false)
  })

  test("repeated calls give the same answer (no regex state leaks between them)", () => {
    const page = jobsPage()
    expect(hasJobsList(page)).toBe(true)
    expect(extractJobChunks(page)).toHaveLength(3)
    expect(hasJobsList(page)).toBe(true)
    expect(extractJobChunks(page)).toHaveLength(3)
  })

  test("reads every block when the page embeds more than one", () => {
    const page = jobsPage({ jobs: [jobObj()] }) + jobsPage({ jobs: [REMOTE_JOB] })
    expect(extractJobChunks(page)).toHaveLength(2)
  })

  test("decodes the escaped HTML inside the embedded JSON", () => {
    const { jobs } = parseJobs(extractJobChunks(jobsPage()))
    expect(jobs[0]!.description).toContain("About CACF")
    expect(jobs[0]!.description).not.toMatch(/<[a-z/]|\\u003C/i)
  })
})

describe("parseJobs isolates bad items", () => {
  test("one bad JSON chunk and one job with no title are skipped, the rest survive", () => {
    const body = [
      embedJson(jobObj()),
      '{"id":5,"title":"Broken" "missing comma":1}',
      embedJson(jobObj({ id: 6, title: "" })),
      embedJson(REMOTE_JOB),
    ].join(",")
    const { jobs, skipped } = parseJobs(extractJobChunks(jobsPage({ jobs: body })))
    expect(jobs.map((j) => j.id)).toEqual(["716264444", "658739199"])
    expect(skipped).toBe(2)
  })

  test("a non-numeric id is skipped rather than trusted", () => {
    const { jobs, skipped } = parseJobs([JSON.stringify(jobObj({ id: "../../etc" }))])
    expect(jobs).toEqual([])
    expect(skipped).toBe(1)
  })

  test("a job repeated in two blocks is kept once", () => {
    const chunks = [JSON.stringify(jobObj()), JSON.stringify(jobObj())]
    expect(parseJobs(chunks).jobs).toHaveLength(1)
  })
})

describe("toJob", () => {
  const job = toJob(jobObj())!

  test("maps every field and never omits one", () => {
    expect(Object.keys(job).sort()).toEqual(
      [
        "id", "title", "company", "location", "remote", "date", "posted", "url", "applyUrl",
        "salary", "salaryMin", "salaryMax", "salaryCurrency", "salaryPeriod",
        "jobType", "category", "tags", "description", "descriptionTruncated",
      ].sort(),
    )
    expect(job).toMatchObject({
      id: "716264444",
      title: "CACF - Director of Development and Communications",
      company: "NRG Consulting Group",
      location: "New York, NY",
      remote: false,
      date: "2026-09-21",
      posted: "2026-09-21T00:00:00.000Z",
      url: "https://impactjobs.org/jobs/716264444-cacf-director-of-development-and-communications",
      applyUrl: "https://nrgconsultinggroup.applytojob.com/apply/vYtDnPE4wU/CACF-Director",
      jobType: "Full-time",
      category: null,
      tags: [],
    })
  })

  test("formats the salary and keeps the raw numbers", () => {
    expect(job.salary).toBe("USD 140,000-150,000 / year")
    expect(job.salaryMin).toBe(140000)
    expect(job.salaryMax).toBe(150000)
    expect(job.salaryCurrency).toBe("USD")
    expect(job.salaryPeriod).toBe("annually")
  })

  test("currency and period are null when there is no amount", () => {
    const r = toJob(REMOTE_JOB)!
    expect(r.salary).toBeNull()
    expect(r.salaryCurrency).toBeNull()
    expect(r.salaryPeriod).toBeNull()
  })

  test("a remote job with no location reads Remote", () => {
    const r = toJob(REMOTE_JOB)!
    expect(r.location).toBe("Remote")
    expect(r.remote).toBe(true)
    expect(r.jobType).toBeNull()
  })

  test("an empty location falls back to the job_location name", () => {
    const r = toJob(jobObj({ location: "  " }))!
    expect(r.location).toBe("New York, New York, United States")
  })

  test("an on-site job with no location at all is null, not Remote", () => {
    expect(toJob(jobObj({ location: "", job_location: null }))!.location).toBeNull()
  })

  test("the search description is an excerpt; full keeps everything", () => {
    const long = jobObj({ description: "<p>" + "Build tools for good. ".repeat(60) + "</p>" })
    const cut = toJob(long)!
    expect(cut.descriptionTruncated).toBe(true)
    expect(cut.description!.endsWith(" …")).toBe(true)
    expect([...cut.description!].length).toBeLessThanOrEqual(502)
    const full = toJob(long, { full: true })!
    expect(full.descriptionTruncated).toBe(false)
    expect(full.description!.length).toBeGreaterThan(1000)
  })

  test("category and tags are read from their objects", () => {
    const r = toJob(jobObj({ category: { id: 93175, name: "Education" }, tags: [{ name: "Python" }, "Data", { title: "Data" }] }))!
    expect(r.category).toBe("Education")
    expect(r.tags).toEqual(["Python", "Data"])
  })

  test("a non-http apply target is not reported as a URL", () => {
    expect(toJob(jobObj({ apply_by: "by_email", apply_to: "jobs@example.org" }))!.applyUrl).toBeNull()
  })

  test("entities and stray tags in titles are cleaned", () => {
    expect(toJob(jobObj({ title: "  Land &amp; Water   <b>Lead</b> " }))!.title).toBe("Land & Water Lead")
  })

  test("returns null without an id or a title", () => {
    expect(toJob(jobObj({ id: null }))).toBeNull()
    expect(toJob(jobObj({ title: "   " }))).toBeNull()
    expect(toJob("nope")).toBeNull()
  })
})

describe("jobUrl", () => {
  test("uses the board's own path when it matches the id", () => {
    expect(jobUrl("5", "/jobs/5-data-lead")).toBe("https://impactjobs.org/jobs/5-data-lead")
  })

  test("falls back to /jobs/<id>-job (the board redirects it) for a bad or foreign path", () => {
    expect(jobUrl("5", "/jobs/6-other")).toBe("https://impactjobs.org/jobs/5-job")
    expect(jobUrl("5", "https://evil.example/jobs/5-x")).toBe("https://impactjobs.org/jobs/5-job")
    expect(jobUrl("5", null)).toBe("https://impactjobs.org/jobs/5-job")
  })
})

describe("text helpers", () => {
  test("htmlToText keeps paragraphs and bullets and drops tags", () => {
    expect(htmlToText("<p>About</p><ul>\n<li>One</li>\n<li>Two</li>\n</ul><p>Line<br/>break</p>")).toBe(
      "About\n\n- One\n- Two\n\nLine\nbreak",
    )
  })

  test("htmlToText decodes entities once and removes zero-width marks", () => {
    expect(htmlToText("<p>A &amp;lt; B&nbsp;&nbsp;C\u200f\u200e D&#8217;s</p>")).toBe("A &lt; B C D\u2019s")
  })

  test("htmlToText returns null for empty input", () => {
    expect(htmlToText("")).toBeNull()
    expect(htmlToText("<p> </p>")).toBeNull()
  })

  test("decodeEntities leaves unknown entities alone", () => {
    expect(decodeEntities("&foo; &amp; &#x41;")).toBe("&foo; & A")
  })

  test("excerpt cuts at a word boundary", () => {
    const e = excerpt("alpha beta gamma delta", 13)
    expect(e).toEqual({ text: "alpha beta …", truncated: true })
    expect(excerpt("short", 13)).toEqual({ text: "short", truncated: false })
  })

  test("formatSalary covers ranges, single values and open ends", () => {
    expect(formatSalary(25, 30, "USD", "hourly")).toBe("USD 25-30 / hour")
    expect(formatSalary(50000, 50000, "EUR", "annually")).toBe("EUR 50,000 / year")
    expect(formatSalary(60000, null, null, null)).toBe("from 60,000")
    expect(formatSalary(null, 70000, "USD", "annually")).toBe("USD up to 70,000 / year")
    expect(formatSalary(null, null, "USD", "annually")).toBeNull()
  })

  test("parseTimestamp accepts microseconds and rejects junk", () => {
    expect(parseTimestamp("2026-09-02T04:22:31.123456Z")!.toISOString()).toBe("2026-09-02T04:22:31.123Z")
    expect(parseTimestamp("not a date")).toBeNull()
    expect(parseTimestamp(null)).toBeNull()
  })
})

describe("search request", () => {
  test("buildSearchUrl maps every flag to the board's filter ids, newest first", () => {
    const url = new URL(buildSearchUrl({ query: "data science", location: "New York", remote: true, jobage: 14, page: 3 }))
    expect(url.origin + url.pathname).toBe("https://impactjobs.org/jobs")
    expect(url.searchParams.get("filters[12450]")).toBe("data science")
    expect(url.searchParams.get("filters[12453]")).toBe("14")
    expect(url.searchParams.get("filters[12454][location]")).toBe("New York")
    expect(url.searchParams.get("filters[12455]")).toBe("1")
    expect(url.searchParams.get("order")).toBe("posted_at")
    expect(url.searchParams.get("page")).toBe("3")
  })

  test("unused filters and page 1 are left out", () => {
    expect(buildSearchUrl({ query: "", location: "", remote: false, page: 1 })).toBe("https://impactjobs.org/jobs?order=posted_at")
  })

  test("usedFilters lists what the request sends", () => {
    expect(usedFilters({ query: "x", location: "", remote: true, jobage: 7, page: 1 })).toEqual(["query", "jobage", "remote"])
  })

  test("checkFilters passes when the form still renders every sent filter", () => {
    expect(() => checkFilters(FILTER_FORM, ["query", "jobage", "location", "remote"])).not.toThrow()
    expect(() => checkFilters("<html></html>", [])).not.toThrow()
  })

  test("checkFilters fails with FILTERS_CHANGED when a filter id has moved", () => {
    const moved = FILTER_FORM.replace(/12455/g, "99999")
    let err: unknown
    try {
      checkFilters(moved, ["query", "remote"])
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(CliError)
    expect((err as CliError).code).toBe("FILTERS_CHANGED")
    expect((err as CliError).message).toContain("remote")
    expect((err as CliError).message).not.toContain("query")
  })
})

describe("parsePagination", () => {
  test("reads the last linked page and the next link", () => {
    expect(parsePagination(jobsPage({ pageLinks: [2, 3, 4, 26, 27], next: true }), 1, 25)).toEqual({ pages: 27, hasNext: true })
  })

  test("a single page of results with no pager is page 1 of 1", () => {
    expect(parsePagination(jobsPage(), 1, 3)).toEqual({ pages: 1, hasNext: false })
  })

  test("no pager and no results is unknown, not zero", () => {
    expect(parsePagination(jobsPage({ jobs: [] }), 5, 0)).toEqual({ pages: null, hasNext: false })
  })
})

describe("detail input", () => {
  test("accepts an id, an id-slug segment, and board URLs", () => {
    expect(parseIdInput("658739199")).toEqual({ id: "658739199", slug: null })
    expect(parseIdInput("658739199-senior-sre")).toEqual({ id: "658739199", slug: "senior-sre" })
    expect(parseIdInput("https://impactjobs.org/jobs/658739199-senior-sre")).toEqual({ id: "658739199", slug: "senior-sre" })
    expect(parseIdInput("https://www.impactjobs.org/jobs/658739199")).toEqual({ id: "658739199", slug: null })
  })

  test("rejects other hosts, other paths and junk", () => {
    expect(parseIdInput("https://evil.example/jobs/1-x")).toBeNull()
    expect(parseIdInput("https://impactjobs.org/companies/1-x")).toBeNull()
    expect(parseIdInput("https://impactjobs.org/jobs/1-x/../../admin")).toBeNull()
    expect(parseIdInput("Senior SRE")).toBeNull()
    expect(parseIdInput("1".repeat(13))).toBeNull()
  })

  test("detailUrl uses the slug when known, else a placeholder the board redirects", () => {
    expect(detailUrl("5", "data-lead")).toBe("https://impactjobs.org/jobs/5-data-lead")
    expect(detailUrl("5", null)).toBe("https://impactjobs.org/jobs/5-job")
  })
})

describe("job page", () => {
  test("extractWindowJob reads window.job and not the related-jobs list", () => {
    const job = extractWindowJob(detailPage())!
    expect(job.id).toBe(658739199)
    expect(extractWindowJob("<html>no job</html>")).toBeNull()
  })

  test("extractJobPosting finds the JobPosting among other JSON-LD blocks", () => {
    expect(extractJobPosting(detailPage())!.validThrough).toBe("2026-10-02T04:22:31.000000Z")
  })

  test("extractJobPosting also looks inside @graph and arrays, and skips broken blocks", () => {
    const ld = (v: unknown) => `<script type="application/ld+json">${typeof v === "string" ? v : JSON.stringify(v)}</script>`
    expect(extractJobPosting(ld("{broken") + ld({ "@graph": [{ "@type": "JobPosting", title: "G" }] }))!.title).toBe("G")
    expect(extractJobPosting(ld([{ "@type": "Organization" }, { "@type": "JobPosting", title: "A" }]))!.title).toBe("A")
    expect(extractJobPosting(ld({ "@type": "WebPage" }))).toBeNull()
  })

  test("OLD_JOB stays a valid fixture", () => {
    expect(toJob(OLD_JOB)!.date).toBe("2025-07-17")
  })
})
