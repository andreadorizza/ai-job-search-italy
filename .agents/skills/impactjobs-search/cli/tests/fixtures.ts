// Shared offline fixtures, shaped like the real pages at https://impactjobs.org
// (recorded 2026-09-24): a /jobs results page embeds its jobs as
// `window.jobsList = window.jobsList.concat([...])` with `<`, `>` and `/`
// escaped the way Laravel's @json does; a job page embeds `window.job = {...}`
// plus a schema.org JobPosting block.

import { settings } from "../src/helpers.js"

// No real waiting in tests; retry-backoff.test.ts sets it explicitly when it
// tests the crawl delay itself.
settings.crawlDelayMs = 0

/** JSON the way the board embeds it in a <script>. */
export function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003C").replace(/>/g, "\\u003E").replace(/\//g, "\\/")
}

export function jobObj(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 716264444,
    title: "CACF - Director of Development and Communications",
    description:
      '<br /><img alt="" src="https://assets.example/logo.png" /><p style="margin:0px;"><strong>About CACF</strong></p>' +
      "<p>We fund children&#39;s health &amp; education.</p><ul>\n<li>Lead fundraising</li>\n<li>Own communications</li>\n</ul>",
    category_id: null,
    employer_id: 3439184,
    min_compensation: "140000.00",
    max_compensation: "150000.00",
    compensation_time_frame: "annually",
    compensation_currency: "usd",
    apply_by: "by_link",
    apply_to: "https://nrgconsultinggroup.applytojob.com/apply/vYtDnPE4wU/CACF-Director",
    status: "active",
    draft: false,
    location: "New York, NY",
    location_id: 169,
    remote: false,
    featured: false,
    pin_to_top: false,
    posted_at: "2026-09-21T00:00:00.000000Z",
    job_expires_in_days: 31,
    job_type_id: 13377,
    updated_at: "2026-09-24T10:31:23.000000Z",
    job_details_path: "/jobs/716264444-cacf-director-of-development-and-communications",
    apply_through_reg_wall: false,
    employer: {
      id: 3439184,
      name: "NRG Consulting Group",
      website: "https://www.nrgconsulting.group/",
      description: "<p>Executive search for non-profits.</p>",
    },
    tags: [],
    job_type: { id: 13377, title: "Full-time", alias: "full-time" },
    category: null,
    job_location: { id: 169, name: "New York, New York, United States" },
    ...overrides,
  }
}

/** A remote job with an empty location, no salary and no job type, like most remote rows. */
export const REMOTE_JOB = jobObj({
  id: 658739199,
  title: "Senior Site Reliability Engineer, Data Persistence",
  description: "<div><p><strong>Summary</strong></p><p>Keep Wikipedia up.</p></div>",
  min_compensation: null,
  max_compensation: null,
  compensation_currency: null,
  apply_to: "https://boards.greenhouse.io/wikimedia/jobs/7972965",
  location: "",
  location_id: null,
  remote: true,
  posted_at: "2026-09-02T04:22:31.000000Z",
  job_details_path: "/jobs/658739199-senior-site-reliability-engineer-data-persistence",
  employer: { id: 1909563, name: "Wikimedia Foundation", website: "wikimediafoundation.org", description: null },
  job_type: null,
  job_location: null,
})

export const OLD_JOB = jobObj({
  id: 181813250,
  title: "Machine Learning Research Scientist (1 Year Fixed Term)",
  min_compensation: null,
  max_compensation: null,
  location: "Stanford",
  posted_at: "2025-07-17T00:00:00.000000Z",
  job_details_path: "/jobs/181813250-machine-learning-research-scientist-1-year-fixed-term",
  employer: { id: 1, name: "Stanford University" },
  job_type: null,
  job_location: null,
})

export const FILTER_FORM =
  '<form action="/jobs" class="filter-form" method="get">' +
  '<input type="text" class="form-control" id="text_search_filter_12450" name="filters[12450]" placeholder="Skill, employer, tag ..." value="" />' +
  '<select id="job_category_filter_12451" name="filters[12451]"><option value="">All categories</option></select>' +
  '<select id="date_filter_12453" name="filters[12453]"><option value="">Any time</option><option value="7">Last 7 days</option></select>' +
  '<input type="text" placeholder="Location" id="location_filter_12454" name="filters[12454][location]" value="" />' +
  '<input type="checkbox" id="checkbox_filter_12455" name="filters[12455]" value="1" />' +
  '<select id="filter-job-order-by" name="order"><option value="posted_at">Date</option></select>' +
  "</form>"

export interface PageSpec {
  /** Job objects, or the raw source of the array's contents. */
  jobs?: Array<Record<string, unknown>> | string
  form?: string
  /** Page numbers linked from the pager. */
  pageLinks?: number[]
  next?: boolean
  /** Leave out the embedded list entirely (a redesigned page). */
  noList?: boolean
}

export function jobsPage(spec: PageSpec = {}): string {
  const jobs = spec.jobs ?? [jobObj(), REMOTE_JOB, OLD_JOB]
  const arrayBody = typeof jobs === "string" ? jobs : embedJson(jobs).slice(1, -1)
  const script = spec.noList
    ? ""
    : "<script>\n        window.jobsList = window.jobsList || [];\n" +
      `        window.jobsList = window.jobsList.concat([${arrayBody}]);\n` +
      '        window.employerDefaultLogo = "https:\\/\\/jboard-tenant.s3.us-west-1.amazonaws.com\\/no-logo.png";\n</script>'
  const pager = (spec.pageLinks ?? [])
    .map((n) => `<li class="page-item"><a class="page-link" href="/jobs?filters%5B12455%5D=1&amp;order=posted_at&amp;page=${n}">${n}</a></li>`)
    .join("")
  return (
    "<!DOCTYPE html><html><head><title>All Social Impact &amp; Nonprofit Jobs - ImpactJobs.org</title>" +
    (spec.next ? '<link rel="next" href="/jobs?page=2">' : "") +
    "</head><body>" +
    (spec.form ?? FILTER_FORM) +
    script +
    '<section id="job-listings"><div data-jobId="716264444"><a href="/jobs/716264444-cacf"><h3>CACF</h3></a></div></section>' +
    (pager ? `<nav><ul class="pagination">${pager}</ul></nav>` : "") +
    "</body></html>"
  )
}

export const JOB_POSTING_LD = {
  "@context": "https://schema.org/",
  "@type": "JobPosting",
  title: "Senior Site Reliability Engineer, Data Persistence",
  datePosted: "2026-09-02T04:22:31.000000Z",
  validThrough: "2026-10-02T04:22:31.000000Z",
  hiringOrganization: { "@type": "Organization", name: "Wikimedia Foundation" },
  identifier: { "@type": "PropertyValue", name: "Wikimedia Foundation", value: "658739199" },
  jobLocationType: "TELECOMMUTE",
  applicantLocationRequirements: { "@type": "Country", name: "Any" },
  employmentType: "FULL_TIME",
}

/** A job page: `window.job` (which, unlike list rows, has no job_type/job_location) plus JSON-LD. */
export function detailPage(job: Record<string, unknown> = REMOTE_JOB, ld: unknown = JOB_POSTING_LD): string {
  const { job_type: _t, job_location: _l, category: _c, ...pageJob } = job
  return (
    "<!DOCTYPE html><html><head>" +
    '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","name":"x"}</script>' +
    (ld ? `<script type="application/ld+json">${JSON.stringify(ld)}</script>` : "") +
    "</head><body><script>\n" +
    `    window.job =  ${embedJson(pageJob)} ;\n` +
    "</script>" +
    // The page also lists related jobs; detail must not pick one of them.
    `<script>window.jobsList = window.jobsList || [];window.jobsList = window.jobsList.concat(${embedJson([OLD_JOB])});</script>` +
    "<script>window.jobDetailsPage = true;</script></body></html>"
  )
}

export function html(body: string, status = 200, url?: string): Response {
  const res = new Response(body, { status, headers: { "Content-Type": "text/html; charset=UTF-8" } })
  if (url) Object.defineProperty(res, "url", { value: url })
  return res
}

type Route = (url: string, init?: RequestInit) => Response

/**
 * Stub fetch: `route` answers every request. Records every call so tests can
 * inspect what was sent.
 */
export function stubFetch(route: Route = () => html(jobsPage())) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return route(String(url), init)
  }) as unknown as typeof fetch
  return calls
}

export function captureStdout(): () => string {
  let out = ""
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out += chunk.toString()
    return true
  }) as typeof process.stdout.write
  return () => out
}

export function captureStderr(): () => string {
  let out = ""
  process.stderr.write = ((chunk: string | Uint8Array) => {
    out += chunk.toString()
    return true
  }) as typeof process.stderr.write
  return () => out
}
