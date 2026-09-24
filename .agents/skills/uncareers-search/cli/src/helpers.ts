// Data source: UN Careers (https://careers.un.org), the United Nations
// Secretariat's job portal: staff positions, consultancies, individual
// contractors and internships.
//
// The portal is an Angular single-page app. Its search page POSTs a filter
// object to a public JSON endpoint and renders the list it gets back. This CLI
// makes that same call with an honest User-Agent and no impersonation. Every
// list item already carries the full posting HTML, so `detail` is a filtered
// list query too: the per-job endpoint (`/api/public/opening/jo/<id>/<lang>`)
// is never called, because opening a posting there counts as a public view.
// See ../url-reference.md.
//
// Zero runtime dependencies: responses are JSON; the only HTML parsed is the
// posting body, which has a fixed section structure.

export const ORIGIN = "https://careers.un.org"
export const LIST_URL = `${ORIGIN}/api/public/opening/jo/list/filteredV2/en`
export const FILTERS_URL = `${ORIGIN}/api/public/opening/jo-filter/list/v2/en`
export const PER_PAGE = 20
/** Dates are shown by the portal in New York time; deadlines close 11:59 p.m. NY. */
export const PORTAL_TZ = "America/New_York"

const UA = "Mozilla/5.0 (compatible; uncareers-cli/1.0)"
const TIMEOUT_MS = 20000
const MAX_RETRIES = 6

export class CliError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message)
  }
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** Report any thrown value on stderr with the right code; returns exit code 1. */
export function fail(e: unknown, fallbackCode = "API_ERROR"): number {
  if (e instanceof CliError) writeError(e.message, e.code)
  else writeError(e instanceof Error ? e.message : String(e), fallbackCode)
  return 1
}

/**
 * fetch with exponential backoff + jitter on 429/5xx, capped retries and a hard
 * per-attempt timeout. An honest User-Agent, never a browser impersonation.
 * Returns null on 404 so callers can report it instead of crashing.
 */
export async function fetchWithRetry(url: string, init: RequestInit = {}): Promise<Response | null> {
  let delay = 500
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, {
      ...init,
      headers: { "User-Agent": UA, ...(init.headers as Record<string, string> | undefined) },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (response.status === 429 || response.status >= 500) {
      if (attempt === MAX_RETRIES) {
        throw new CliError(`Request failed: ${response.status} ${response.statusText}`, "API_ERROR")
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null
    return response
  }
  throw new CliError("Request failed after max retries", "API_ERROR")
}

async function readJson(response: Response | null, what: string): Promise<unknown> {
  if (!response) {
    throw new CliError(`${what} returned 404 - the portal has changed; see url-reference.md`, "API_ERROR")
  }
  if (!response.ok) {
    throw new CliError(`${what} failed: ${response.status} ${response.statusText}`, "API_ERROR")
  }
  try {
    return await response.json()
  } catch {
    // The SPA answers unknown paths with its HTML shell, so a moved API shows
    // up here rather than as a 404.
    throw new CliError(`${what} did not return JSON - the API may have moved; see url-reference.md`, "PARSE_ERROR")
  }
}

// ---------------------------------------------------------------------------
// The list endpoint
// ---------------------------------------------------------------------------

export interface Coded {
  code?: string
  name?: string
  Code?: string
  Name?: string
}

export interface Opening {
  jobId?: number
  language?: string
  categoryCode?: string
  jobTitle?: string
  postingTitle?: string
  jobCodeTitle?: string
  jobDescription?: string
  jobFamilyCode?: string
  jobLevel?: string
  dutyStation?: Array<{ code?: string; description?: string }>
  recruitmentType?: string
  startDate?: string
  endDate?: string
  jn?: Coded | null
  jf?: Coded | null
  jc?: Coded | null
  jl?: Coded | null
  recrttype?: Coded | null
  dept?: Coded | null
}

/**
 * The portal's filter object. Values inside one key are OR'ed, keys are AND'ed.
 * `jc` (category) is deliberately absent: the server ignores `keyword` when it
 * is set. `recrtype` covers the same ground and honours the keyword.
 */
export interface FilterConfig {
  keyword?: string
  ds?: string[]
  recrtype?: string[]
  jn?: string[]
  span?: string[]
}

export interface ListBody {
  filterConfig: FilterConfig
  pagination: { page: number; itemPerPage: number; sortBy: string; sortDirection: number }
}

export interface ListResult {
  list: Opening[]
  count: number | null
}

/**
 * POST one filter object to the portal's list endpoint - the same call its own
 * search page makes. The envelope is `{status: 1, message, data: {list, count}}`.
 */
export async function listOpenings(body: ListBody): Promise<ListResult> {
  const response = await fetchWithRetry(LIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  })
  const data = (await readJson(response, "The UN Careers list endpoint")) as {
    status?: number
    message?: string
    data?: { list?: unknown; count?: unknown }
  }
  if (data?.status !== 1) {
    throw new CliError(`UN Careers returned an error: ${String(data?.message ?? "unknown")}`, "API_ERROR")
  }
  if (!Array.isArray(data.data?.list)) {
    throw new CliError("UN Careers returned no job list - the response shape has changed", "PARSE_ERROR")
  }
  return {
    list: data.data.list as Opening[],
    count: typeof data.data.count === "number" ? data.data.count : null,
  }
}

/**
 * Sort by jobId, newest first. The portal's own default (`startDate`) has many
 * ties - every posting of a day shares one midnight timestamp - and the server
 * does not break them, so the same item can show up on two pages. `jobId` is
 * unique, so pages never overlap.
 */
export function listBody(filterConfig: FilterConfig, page: number, itemPerPage = PER_PAGE): ListBody {
  return { filterConfig, pagination: { page: page - 1, itemPerPage, sortBy: "jobId", sortDirection: -1 } }
}

// ---------------------------------------------------------------------------
// Filters. The server silently IGNORES a value it does not recognise (an
// unknown category or duty station returns the whole board), so every value
// is validated here before it is sent.
// ---------------------------------------------------------------------------

/**
 * `--category` filters on the portal's recruitment type (`recrtype`), not on
 * its "category" (`jc`): the server silently drops the keyword whenever `jc` is
 * set, so `jc:["CON"]` plus any keyword returns every consultancy. The
 * recruitment types partition the board exactly (117 + 60 + 272 + 18 = 467 at
 * recon) and combine with a keyword correctly. Codes are the portal's own
 * (see url-reference.md).
 */
export const CATEGORIES: Record<string, string[]> = {
  // C = Consultant, I = Individual Contractor.
  consultant: ["C", "I"],
  // N = Intern.
  internship: ["N"],
  // Every staff job-opening type: position-specific (F, P), recruit-from-roster
  // (R, S), Young Professionals (Y), generic (G), temporary (T), language (L),
  // language exams (E).
  staff: ["F", "P", "R", "S", "Y", "G", "T", "L", "E"],
  // H/V = open-ended candidate pools (rosters) for consultants and interns.
  pool: ["H", "V"],
}

const CATEGORY_ALIASES: Record<string, string> = {
  consultants: "consultant",
  consultancy: "consultant",
  consultancies: "consultant",
  contractor: "consultant",
  con: "consultant",
  intern: "internship",
  interns: "internship",
  internships: "internship",
  int: "internship",
  "candidate-pool": "pool",
  roster: "pool",
}

export const NETWORKS: Record<string, string> = {
  DEVNET: "Economic, Social and Development",
  ITECNET: "Information and Telecommunication Technology",
  SAFETYNET: "Internal Security and Safety",
  LEGALNET: "Legal",
  LOGNET: "Logistics, Transportation and Supply Chain",
  MAGNET: "Management and Administration",
  POLNET: "Political, Peace and Humanitarian",
  INFONET: "Public Information and Conference Management",
  SCINET: "Science",
}

const NETWORK_ALIASES: Record<string, string> = {
  ict: "ITECNET",
  it: "ITECNET",
  development: "DEVNET",
  security: "SAFETYNET",
  legal: "LEGALNET",
  logistics: "LOGNET",
  management: "MAGNET",
  political: "POLNET",
  information: "INFONET",
  science: "SCINET",
}

function splitList(raw: string, sep: RegExp): string[] {
  return raw
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean)
}

function unknownValue(flag: string, item: string, valid: string[]): CliError {
  return new CliError(`${flag}: unknown value "${item}". Use one of: ${valid.join(", ")}`, "BAD_ARG")
}

/** `--category` -> the recruitment-type codes to send as `recrtype` (OR'ed). */
export function parseCategories(raw: string): string[] {
  const out: string[] = []
  for (const item of splitList(raw, /,/)) {
    const key = item.toLowerCase()
    const codes = CATEGORIES[CATEGORY_ALIASES[key] ?? key]
    if (!codes) throw unknownValue("--category", item, Object.keys(CATEGORIES))
    for (const c of codes) if (!out.includes(c)) out.push(c)
  }
  if (!out.length) throw new CliError("--category needs at least one value", "MISSING_REQUIRED")
  return out
}

/** `--network` -> job-network codes to send as `jn` (OR'ed). */
export function parseNetworks(raw: string): string[] {
  const out: string[] = []
  for (const item of splitList(raw, /,/)) {
    const code = NETWORKS[item.toUpperCase()] ? item.toUpperCase() : NETWORK_ALIASES[item.toLowerCase()]
    if (!code) throw unknownValue("--network", item, [...Object.keys(NETWORK_ALIASES), ...Object.keys(NETWORKS)])
    if (!out.includes(code)) out.push(code)
  }
  if (!out.length) throw new CliError("--network needs at least one value", "MISSING_REQUIRED")
  return out
}

/** `--location` takes duty stations or countries, several separated by ";" or ",". */
export function splitLocations(raw: string): string[] {
  return splitList(raw, /[;,]/)
}

/**
 * The portal's date filter (`span`) only knows 1, 7 and 30 days. Send the
 * smallest window that covers the request; `withinDays` trims to the exact
 * number client-side. Beyond 30 days there is no server filter at all.
 */
export function spanFor(jobage: number): string | null {
  if (jobage <= 1) return "1"
  if (jobage <= 7) return "7"
  if (jobage <= 30) return "30"
  return null
}

export interface SearchFilterOpts {
  query: string
  dutyStations: string[]
  /** Recruitment-type codes from parseCategories. */
  recruitmentTypes: string[]
  networks: string[]
  jobage?: number
}

export function buildFilterConfig(opts: SearchFilterOpts): FilterConfig {
  const fc: FilterConfig = {}
  if (opts.query) fc.keyword = opts.query
  if (opts.dutyStations.length) fc.ds = opts.dutyStations
  if (opts.recruitmentTypes.length) fc.recrtype = opts.recruitmentTypes
  if (opts.networks.length) fc.jn = opts.networks
  if (opts.jobage !== undefined) {
    const span = spanFor(opts.jobage)
    if (span) fc.span = [span]
  }
  return fc
}

// ---------------------------------------------------------------------------
// Location vocabulary: the portal's own filter list, loaded only for -l
// ---------------------------------------------------------------------------

export interface LocationEntry {
  name: string
  code: string
  country: string
  /** Inspira duty-station names behind this location. None = unfilterable. */
  dutyStations: string[]
}

export function parseLocationVocabulary(data: unknown): LocationEntry[] | null {
  const values = (data as { data?: { jl?: { values?: unknown } } })?.data?.jl?.values
  if (!Array.isArray(values)) return null
  const out: LocationEntry[] = []
  for (const v of values as Array<Record<string, unknown>>) {
    if (typeof v?.name !== "string" || typeof v?.code !== "string" || !v.code.trim()) continue
    const ds = Array.isArray(v.inspiraDutyStations) ? (v.inspiraDutyStations as Array<{ name?: unknown }>) : []
    out.push({
      name: v.name.trim(),
      code: v.code,
      country: typeof v.countryName === "string" ? v.countryName.trim() : "",
      dutyStations: ds.map((d) => (typeof d?.name === "string" ? d.name.trim() : "")).filter(Boolean),
    })
  }
  return out.length ? out : null
}

export async function loadLocationVocabulary(): Promise<LocationEntry[]> {
  const response = await fetchWithRetry(FILTERS_URL, { headers: { Accept: "application/json" } })
  const vocab = parseLocationVocabulary(await readJson(response, "The UN Careers filter list"))
  if (!vocab) {
    throw new CliError(
      "The UN Careers filter list no longer carries its location vocabulary (data.jl.values) - see url-reference.md",
      "PARSE_ERROR",
    )
  }
  return vocab
}

/** Case-, accent- and spacing-insensitive form for matching place names. */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

// Placeholder "countries" in the vocabulary that must not match a user term.
const NOT_A_COUNTRY = new Set(["", "-", "all"])

/**
 * The vocabulary's "OTHER" entry (country "ALL") is a catch-all bucket of
 * about 2,500 duty stations; filtering on it returns nearly the whole board.
 * It is never a sensible answer to a place name, so it never matches.
 */
function isCatchAll(e: LocationEntry): boolean {
  return norm(e.country) === "all" || norm(e.code) === "other"
}

export interface ResolvedLocations {
  /** `ds` codes to send. Empty with `matched` non-empty = nothing filterable. */
  codes: string[]
  /** Display names of every matched location. */
  matched: string[]
}

/**
 * Map each user term to the portal's location codes. A term matches a
 * location by its name, its code or its country, so "Italy" means Rome +
 * Brindisi + Turin. Only if nothing matches that way is it tried against the
 * duty-station names behind each location (the spelling results show, e.g.
 * "PORT-AU-PRINCE - LOCAL"); that list has cross-filed oddities, so it is a
 * fallback, not a peer. An unknown term is an error, never dropped: the server
 * would treat a bad code as "no filter" and return the whole board.
 */
export function resolveLocations(terms: string[], vocab: LocationEntry[]): ResolvedLocations {
  const codes: string[] = []
  const matched: string[] = []
  const places = vocab.filter((e) => !isCatchAll(e))
  for (const term of terms) {
    const t = norm(term)
    let hits = places.filter(
      (e) =>
        norm(e.name) === t ||
        norm(e.code) === t ||
        (!NOT_A_COUNTRY.has(norm(e.country)) && norm(e.country) === t),
    )
    if (!hits.length) hits = places.filter((e) => e.dutyStations.some((d) => norm(d) === t))
    if (!hits.length) {
      const near = places
        .flatMap((e) => [e.name, e.country])
        .filter((s, i, all) => s && !NOT_A_COUNTRY.has(norm(s)) && all.indexOf(s) === i)
        .filter((s) => (t.length >= 3 && norm(s).includes(t)) || (norm(s).length >= 4 && t.includes(norm(s))))
        .slice(0, 8)
      const hint = near.length ? ` Did you mean: ${near.join("; ")}?` : ""
      throw new CliError(
        `--location: "${term}" is not a UN Careers duty station or country.${hint} ` +
          `Home-based work is not a location on this portal; use --home-based.`,
        "UNKNOWN_LOCATION",
      )
    }
    for (const e of hits) {
      if (!matched.includes(e.name)) matched.push(e.name)
      // A location with no duty stations behind it cannot be filtered on: the
      // server drops it and would return the whole board.
      if (e.dutyStations.length && !codes.includes(e.code)) codes.push(e.code)
    }
  }
  return { codes, matched }
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const NY_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: PORTAL_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/**
 * ISO timestamp -> YYYY-MM-DD in New York time, which is how the portal shows
 * dates. `endDate` is stored as 23:59:59 NY (03:59:59Z the next day), so a UTC
 * slice would put every deadline one day late.
 */
export function nyDate(iso: string | null | undefined): string | null {
  if (typeof iso !== "string" || !iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return NY_DATE.format(d)
}

/** Whole days between two YYYY-MM-DD dates (a - b). */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000)
}

/**
 * Posted today or in the previous `days - 1` days, by New York date - the same
 * window the portal's own "within last 7 days" filter uses.
 */
export function withinDays(date: string | null, days: number, nowMs = Date.now()): boolean {
  if (!date) return false
  const today = NY_DATE.format(new Date(nowMs))
  return dayDiff(today, date) < days
}

// ---------------------------------------------------------------------------
// Posting text
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  bull: "•",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  euro: "€",
}

function codePoint(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => codePoint(parseInt(d, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
}

/**
 * Posting HTML -> readable text. The portal's source text has lost its line
 * breaks: paragraphs survive only as runs of spaces and list items as inline
 * "•". Rebuild them - a run of 3+ spaces, or 2+ after a sentence end, starts a
 * new line, and each "•" starts a "- " line. Table rows become "a | b | c".
 */
export function htmlToText(raw: string | null | undefined): string | null {
  if (!raw) return null
  const text = decodeEntities(
    raw
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/t[dh]>/gi, " | ")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<li(\s[^>]*)?>/gi, "\n- ")
      .replace(/<\/(p|div|ul|ol|li|table|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[​-‏⁠﻿]/g, "")
    .replace(/\r/g, "")
    .replace(/ {3,}/g, "\n")
    .replace(/([.:;!?]) {2,}(?=\S)/g, "$1\n")
    .replace(/\s*•\s*/g, "\n- ")
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t ]+/g, " ")
        .replace(/ \|\s*$/, "")
        .trim(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

export interface Section {
  title: string
  text: string
}

/**
 * Every posting is a list of `<div class='jobPostingItem'>` blocks, each with a
 * `jobPostingItemTitle` ("Responsibilities", "Work Location", "Education", ...)
 * followed by its content. Parsed block by block, so one odd block cannot
 * break the rest.
 */
export function parseSections(html: string | null | undefined): Section[] {
  if (!html) return []
  const cleaned = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
  const out: Section[] = []
  for (const chunk of cleaned.split(/<div\s+class\s*=\s*['"]jobPostingItem['"]\s*>/i).slice(1)) {
    const m = chunk.match(/<div\s+class\s*=\s*['"]jobPostingItemTitle['"]\s*>([\s\S]*?)<\/div>([\s\S]*)$/i)
    if (!m) continue
    const title = htmlToText(m[1])?.replace(/\s+/g, " ")
    const text = htmlToText(m[2])
    if (title && text) out.push({ title, text })
  }
  return out
}

function sectionText(sections: Section[], ...titles: string[]): string | null {
  for (const t of titles) {
    const s = sections.find((x) => norm(x.title) === norm(t))
    if (s) return s.text
  }
  return null
}

function oneLine(s: string | null): string | null {
  return s ? s.replace(/\s*\n+\s*/g, " ").trim() || null : null
}

/** A short snippet for triage: the duties, else the organisational setting. */
export function summarize(sections: Section[], max = 300): string | null {
  const text = oneLine(
    sectionText(sections, "Duties and Responsibilities", "Responsibilities", "Org. Setting and Reporting") ??
      sections[0]?.text ??
      null,
  )
  if (!text) return null
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(" ")
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`
}

/**
 * Consultancy postings state where the work happens in free text ("Home-based",
 * "Remote", "Home based with travel", "Nairobi"). True only for text that
 * leads with home-based/remote work; "Paris with remote possible" and
 * "Lusaka (Remote within the work location)" are not home-based. Null when the
 * posting has no Work Location section (staff positions).
 */
export function isHomeBased(workLocation: string | null): boolean | null {
  if (!workLocation) return null
  return /home[\s-]*based/i.test(workLocation) || /^\s*remote\b(?!\s+within)/i.test(workLocation)
}

// ---------------------------------------------------------------------------
// Record mapping
// ---------------------------------------------------------------------------

export function jobUrl(id: string): string {
  return `${ORIGIN}/jobSearchDescription/${encodeURIComponent(id)}?language=en`
}

function nonEmpty(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ") : null
}

function codedName(v: Coded | null | undefined): string | null {
  return nonEmpty(v?.name ?? v?.Name)
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  deadline: string | null
  url: string
  level: string | null
  category: string | null
  categoryCode: string | null
  jobNetwork: string | null
  jobFamily: string | null
  recruitmentType: string | null
  workLocation: string | null
  duration: string | null
  homeBased: boolean | null
  summary: string | null
}

export interface JobDetail extends JobCard {
  jobCodeTitle: string | null
  description: string | null
  sections: Section[]
}

function openingId(o: Opening): string | null {
  return typeof o?.jobId === "number" && Number.isInteger(o.jobId) && o.jobId > 0 ? String(o.jobId) : null
}

/**
 * Map one list item. Every field is always present - `null` is emitted rather
 * than omitted. Called per item, so one malformed item is skipped instead of
 * breaking the batch.
 */
export function toJobCard(o: Opening, sections: Section[] = parseSections(o?.jobDescription)): JobCard | null {
  const id = openingId(o)
  const title = nonEmpty(o?.postingTitle) ?? nonEmpty(o?.jobTitle)
  if (!id || !title) return null
  const stations = (Array.isArray(o.dutyStation) ? o.dutyStation : [])
    .map((d) => nonEmpty(d?.description))
    .filter((d): d is string => d !== null)
  const workLocation = oneLine(sectionText(sections, "Work Location"))
  return {
    id,
    title,
    // The hiring department or office, e.g. "Economic Commission for Africa".
    company: codedName(o.dept),
    location: stations.length ? stations.join("; ") : null,
    date: nyDate(o.startDate),
    deadline: nyDate(o.endDate),
    url: jobUrl(id),
    level: nonEmpty(o.jobLevel),
    category: codedName(o.jc),
    categoryCode: nonEmpty(o.jc?.code) ?? nonEmpty(o.categoryCode),
    jobNetwork: codedName(o.jn),
    jobFamily: codedName(o.jf),
    recruitmentType: codedName(o.recrttype),
    workLocation,
    duration: oneLine(sectionText(sections, "Expected duration")),
    homeBased: isHomeBased(workLocation),
    summary: summarize(sections),
  }
}

export function toJobDetail(o: Opening): JobDetail | null {
  const sections = parseSections(o?.jobDescription)
  const card = toJobCard(o, sections)
  if (!card) return null
  const description = sections.length
    ? sections.map((s) => `${s.title}\n${s.text}`).join("\n\n")
    : htmlToText(o.jobDescription)
  return {
    ...card,
    jobCodeTitle: nonEmpty(o.jobCodeTitle),
    description,
    sections,
  }
}

// ---------------------------------------------------------------------------
// detail input
// ---------------------------------------------------------------------------

/**
 * Accept a numeric job id or a careers.un.org posting URL
 * (`/jobSearchDescription/<id>`, or a legacy `?id=<id>`). Only the id is kept:
 * the request is rebuilt from it, so a supplied URL can never steer the fetch.
 */
export function parseIdInput(input: string): string | null {
  const raw = input.trim()
  if (/^\d{1,9}$/.test(raw)) return raw
  if (!/^https?:\/\//i.test(raw)) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (!["careers.un.org", "www.careers.un.org"].includes(url.hostname.toLowerCase())) return null
  const path = url.pathname.match(/\/jobSearchDescription\/(\d{1,9})\/?$/i)
  if (path) return path[1]!
  const q = url.searchParams.get("id") ?? url.searchParams.get("jobId")
  return q && /^\d{1,9}$/.test(q) ? q : null
}
