// Shared offline fixtures, shaped like real responses from
// POST /api/public/opening/jo/list/filteredV2/en and
// GET /api/public/opening/jo-filter/list/v2/en (recorded 2026-09-24, trimmed).

import { FILTERS_URL, LIST_URL } from "../src/helpers.js"

const item = (title: string, content: string) =>
  `<div class='jobPostingItem'><div class='jobPostingItemTitle'>${title}</div><div class='jobPostingItemContent'>${content}</div></div>\n\r`

/** A home-based consultancy: has Work Location and Expected duration sections. */
export const CONSULTANCY = {
  _id: "6ab3fb93dca68d6a353d0001",
  jobId: 285226,
  language: "EN",
  categoryCode: "CON",
  jobTitle: "Open-Source Software policy consultant",
  postingTitle: "Open-Source Software policy consultant",
  jobCodeTitle: "CONSULTANT",
  jobDescription:
    "<div class='jobPostingDetail'>\n\r" +
    item("Result of Service", "Final policy report with annexes.") +
    item("Work Location", "Home-based") +
    item("Expected duration", "16 weeks") +
    item(
      "Duties and Responsibilities",
      "GENERAL SCOPE Open-source software policies provide a framework.   DUTIES The consultant shall:  • Review practices; • Draft the policy &amp; annexes.",
    ) +
    item("Languages", "Fluency in Arabic and English is required.") +
    "<div class='jobPostingItem'><div class='jobPostingItemTitle'>No Fee</div><div class='jobImportant'>THE UNITED NATIONS DOES NOT CHARGE A FEE.</div></div></div>",
  jobFamilyCode: "IST",
  jobLevel: "CON",
  dutyStation: [{ code: "2490", description: "BEIRUT", _id: "x1" }],
  recruitmentType: "C",
  startDate: "2026-09-23T04:00:00.000Z",
  endDate: "2026-10-07T03:59:59.000Z",
  jf: { Code: "IST", Name: "Information Management Systems and Technology" },
  jc: { code: "CON", name: "Affiliate Personnel – Consultants/Individual Contractors" },
  jl: { code: "CON", name: "CON" },
  recrttype: { code: "C", name: "Consultant" },
  dept: { code: "11741174", name: "Economic and Social Commission for Western Asia" },
  totalCount: 2,
}

/** A staff position: no Work Location; a Languages table and a style block. */
export const STAFF = {
  _id: "6ab3fb93dca68d6a353d0002",
  jobId: 285249,
  language: "EN",
  categoryCode: "PD",
  jobTitle: "INFORMATION SYSTEMS OFFICER",
  postingTitle: "INFORMATION SYSTEMS OFFICER, P3",
  jobCodeTitle: "INFORMATION SYSTEMS OFFICER",
  jobDescription:
    "<div class='jobPostingDetail'>\n\r" +
    item("Org. Setting and Reporting", "The Fund was established in 1949.  This position is located in New York.") +
    item("Responsibilities", "The officer will:     • Manage projects.  • Develop specifications.") +
    item(
      "Languages",
      "<div><div>English is required.</div><style>.headtable { width: 100%; }</style><div><h2 class = 'headTitle'>Required Languages</h2>" +
        "<table class = 'headtable'><tr><th>Language</th><th>Reading</th></tr><tr><td><b>English</b></td><td>UN Level III</td></tr></table></div></div>",
    ) +
    "</div>",
  jobFamilyCode: "IST",
  jobLevel: "P-3",
  dutyStation: [{ code: "4560", description: "NEW YORK", _id: "x2" }],
  recruitmentType: "J",
  startDate: "2026-09-22T04:00:00.000Z",
  endDate: "2026-10-07T03:59:59.000Z",
  jn: { code: "ITECNET", name: "Information and Telecommunication Technology" },
  jf: { Code: "IST", Name: "Information Management Systems and Technology" },
  jc: { code: "PD", name: "Professional and Higher Categories" },
  jl: { code: "100", name: "P-3" },
  recrttype: { code: "P", name: "Position Specific Job Openings" },
  dept: { code: "88888902", name: "United Nations Joint Staff Pension Fund - Pension Administration" },
  totalCount: 2,
}

export function listResponse(list: unknown[], count = list.length) {
  return { status: 1, message: "Success.", data: { list, count } }
}

export const FILTERS_RESPONSE = {
  status: 1,
  data: {
    jc: { name: "Category", shortname: "jc", values: [{ code: "CON", name: "Consultants" }] },
    jl: {
      name: "Job Locations",
      shortname: "jl",
      values: [
        { name: "Rome", code: "ROME", countryName: "Italy", inspiraDutyStations: [{ code: "2220", name: "ROME" }] },
        { name: "Brindisi", code: "BRINDISI", countryName: "Italy", inspiraDutyStations: [{ code: "2223", name: "BRINDISI" }] },
        { name: "Turin", code: "TURIN", countryName: "Italy", inspiraDutyStations: [] },
        { name: "Geneva", code: "Geneva", countryName: "Switzerland", inspiraDutyStations: [{ code: "5750", name: "GENEVA" }] },
        { name: "New York", code: "NEWYORK", countryName: "United States of America", inspiraDutyStations: [{ code: "4560", name: "NEW YORK" }] },
        { name: "Port-au-Prince", code: "PORTAUPRINCE", countryName: "Haiti", inspiraDutyStations: [{ code: "3001", name: "PORT-AU-PRINCE - LOCAL" }] },
        { name: "Côte d'Ivoire city", code: "ABIDJAN", countryName: "Côte d'Ivoire", inspiraDutyStations: [{ code: "2250", name: "ABIDJAN" }] },
        // The catch-all bucket: holds thousands of duty stations, including
        // ones that share a name with real locations.
        { name: "OTHER", code: "OTHER", countryName: "ALL", inspiraDutyStations: [{ code: "9999", name: "TURIN" }, { code: "9998", name: "ZURICH" }] },
      ],
    },
  },
}

export interface Call {
  url: string
  init?: RequestInit
}

type Route = (url: string, init?: RequestInit) => Response

/**
 * Route stubbed fetches: the filter list gets `filters`, the list endpoint gets
 * `list`, anything else is a test failure. Records every call.
 */
export function stubPortal(opts: { list?: Route; filters?: Route } = {}): Call[] {
  const calls: Call[] = []
  const list: Route = opts.list ?? (() => json(listResponse([CONSULTANCY, STAFF], 2)))
  const filters: Route = opts.filters ?? (() => json(FILTERS_RESPONSE))
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    if (String(url) === LIST_URL) return list(String(url), init)
    if (String(url) === FILTERS_URL) return filters(String(url), init)
    throw new Error(`unexpected request to ${String(url)}`)
  }) as unknown as typeof fetch
  return calls
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

export function bodyOf(call: Call): { filterConfig: Record<string, unknown>; pagination: Record<string, unknown> } {
  return JSON.parse(String(call.init!.body))
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
