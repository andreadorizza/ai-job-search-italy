// Data source: Impact Jobs (https://impactjobs.org), a social-impact and
// non-profit job board run by Green Jobs Network on the JBoard platform.
//
// The board renders its job lists on the server and embeds the jobs of each
// page as JSON in a `window.jobsList = window.jobsList.concat([...])` script.
// A job page embeds the job as `window.job = {...}` plus a schema.org
// JobPosting block. The CLI reads those, not the card markup, and never
// touches /rss/ (disallowed in robots.txt).
//
// robots.txt asks for `Crawl-delay: 1`. Every request waits until at least one
// second has passed since the previous one, across CLI runs too (a timestamp
// file in the OS temp directory). See ../url-reference.md.
//
// Zero runtime dependencies. The embedded array is split into per-job chunks
// by a string-aware bracket scanner and each chunk is parsed and mapped on its
// own, so one bad job is skipped instead of breaking the page.

import { readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const ORIGIN = "https://impactjobs.org"
/** The board's fixed page size. */
export const PER_PAGE = 25
/** Characters of description text kept in `search` results; `detail` has it all. */
export const EXCERPT_CHARS = 500
export const SOURCE = "Impact Jobs (https://impactjobs.org)"

const UA = "Mozilla/5.0 (compatible; impactjobs-cli/1.0)"
const TIMEOUT_MS = 20000
const MAX_RETRIES = 6
const HOSTS = new Set(["impactjobs.org", "www.impactjobs.org"])

/**
 * `crawlDelayMs` honours robots.txt `Crawl-delay: 1`. `stampFile` records when
 * the last request went out, so back-to-back CLI runs keep the gap too. Tests
 * set the delay to 0.
 */
export const settings = {
  crawlDelayMs: 1000,
  stampFile: join(tmpdir(), "impactjobs-cli.last-request"),
}

/**
 * The board's search form fields. The numbers are this board's filter ids in
 * JBoard (another JBoard board has other numbers). `marker` is the element id
 * the form renders for that field: if it is missing from a response, the board
 * has renumbered its filters and the parameter would be silently ignored, so
 * the CLI fails with FILTERS_CHANGED instead of returning unfiltered results.
 */
export const FILTERS = {
  query: { param: "filters[12450]", marker: 'id="text_search_filter_12450"' },
  jobage: { param: "filters[12453]", marker: 'id="date_filter_12453"' },
  location: { param: "filters[12454][location]", marker: 'id="location_filter_12454"' },
  remote: { param: "filters[12455]", marker: 'id="checkbox_filter_12455"' },
} as const
export type FilterName = keyof typeof FILTERS

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

export async function sleep(ms: number): Promise<void> {
  if (ms > 0) await new Promise((r) => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/**
 * Wait until `crawlDelayMs` has passed since the previous request (this run or
 * an earlier one), then reserve the slot. Best effort: an unreadable or
 * unwritable stamp file never blocks a request.
 */
export async function politeWait(nowMs = Date.now()): Promise<void> {
  const delay = settings.crawlDelayMs
  if (delay <= 0) return
  let last = 0
  try {
    last = Number(readFileSync(settings.stampFile, "utf8").trim()) || 0
  } catch {
    // no stamp yet
  }
  // A stamp from the future (clock change) is ignored rather than obeyed.
  const slot = last > nowMs + delay ? nowMs : Math.max(nowMs, last + delay)
  try {
    writeFileSync(settings.stampFile, String(slot))
  } catch {
    // read-only temp dir: still wait, just cannot tell the next run
  }
  await sleep(slot - nowMs)
}

/** Seconds from a Retry-After header, capped; null when absent or a date. */
function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get("retry-after")
  if (!raw || !/^\d{1,5}$/.test(raw.trim())) return null
  return Math.min(Number(raw.trim()) * 1000, 60000)
}

/**
 * fetch with exponential backoff + jitter on 429/5xx, capped retries and a hard
 * per-attempt timeout. An honest User-Agent, never a browser impersonation.
 * Every attempt waits out the crawl delay first. Returns null on 404.
 */
export async function fetchWithRetry(url: string, init: RequestInit = {}): Promise<Response | null> {
  let delay = 1000
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await politeWait()
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
      await sleep(Math.max(delay + jitter, retryAfterMs(response) ?? 0))
      delay = Math.min(delay * 2, 16000)
      continue
    }
    if (response.status === 404) return null
    return response
  }
  throw new CliError("Request failed after max retries", "API_ERROR")
}

/** GET an HTML page from the board and return its body. 404 -> null. */
export async function fetchPage(url: string): Promise<{ html: string; finalUrl: string } | null> {
  const response = await fetchWithRetry(url, { headers: { Accept: "text/html,application/xhtml+xml" } })
  if (!response) return null
  if (!response.ok) {
    throw new CliError(`Request failed: ${response.status} ${response.statusText} (${url})`, "API_ERROR")
  }
  const finalUrl = response.url || url
  let host = ""
  try {
    host = new URL(finalUrl).hostname.toLowerCase()
  } catch {
    // keep "" and fail below
  }
  if (!HOSTS.has(host)) {
    throw new CliError(`${url} redirected off the board, to ${finalUrl}`, "API_ERROR")
  }
  return { html: await response.text(), finalUrl }
}

// ---------------------------------------------------------------------------
// Embedded JSON
// ---------------------------------------------------------------------------

/**
 * Index of the bracket that closes the JSON value opening at `text[start]`
 * (`{` or `[`), skipping brackets inside strings; -1 if it never closes.
 */
export function matchBracket(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === "{" || ch === "[") depth++
    else if (ch === "}" || ch === "]") {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Split the JSON array opening at `text[start]` into the source of each
 * top-level object, without parsing them. The caller parses every chunk on its
 * own, so a job with a bad value costs that job only. An array cut short
 * still yields the objects that closed.
 */
export function splitJsonArray(text: string, start: number): string[] {
  const items: string[] = []
  let depth = 0
  let inString = false
  let escaped = false
  let itemStart = -1
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === "{" || ch === "[") {
      if (depth === 0 && ch === "{") itemStart = i
      depth++
    } else if (ch === "}" || ch === "]") {
      if (depth === 0) break // the array itself closed
      depth--
      if (depth === 0 && itemStart >= 0) {
        items.push(text.slice(itemStart, i + 1))
        itemStart = -1
      }
    }
  }
  return items
}

// Built fresh on each use: a shared /g regex carries lastIndex between calls,
// and matchAll starts from it.
const JOBS_LIST_SRC = String.raw`window\.jobsList\s*=\s*window\.jobsList\.concat\(\s*\[`

/** True when the page carries the board's embedded job list (even an empty one). */
export function hasJobsList(html: string): boolean {
  return new RegExp(JOBS_LIST_SRC).test(html)
}

/** Source chunks of every job object in every embedded `window.jobsList` block. */
export function extractJobChunks(html: string): string[] {
  const chunks: string[] = []
  for (const m of html.matchAll(new RegExp(JOBS_LIST_SRC, "g"))) {
    chunks.push(...splitJsonArray(html, m.index! + m[0].length - 1))
  }
  return chunks
}

/** The `window.job = {...}` object on a job page, or null. */
export function extractWindowJob(html: string): Record<string, unknown> | null {
  const m = /window\.job\s*=\s*\{/.exec(html)
  if (!m) return null
  const start = m.index + m[0].length - 1
  const end = matchBracket(html, start)
  if (end < 0) return null
  try {
    const value = JSON.parse(html.slice(start, end + 1))
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** The schema.org JobPosting block on a job page, or null. */
export function extractJobPosting(html: string): Record<string, unknown> | null {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let value: unknown
    try {
      value = JSON.parse(m[1]!)
    } catch {
      continue
    }
    const candidates: unknown[] = Array.isArray(value)
      ? value
      : isObj(value) && Array.isArray(value["@graph"])
        ? (value["@graph"] as unknown[])
        : [value]
    for (const c of candidates) {
      if (isObj(c) && c["@type"] === "JobPosting") return c
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Text cleaning
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  bull: "•",
  middot: "·",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ograve: "ò",
  ugrave: "ù",
  igrave: "ì",
  ntilde: "ñ",
  euro: "€",
  pound: "£",
  copy: "©",
  reg: "®",
  trade: "™",
}

function codePoint(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

/**
 * Decode character references in ONE pass, so `&amp;lt;` becomes the text
 * `&lt;` and is never decoded a second time into `<`. Unknown named entities
 * are left as they are.
 */
export function decodeEntities(s: string): string {
  return s.replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (m, ref: string) => {
    if (ref[0] === "#") {
      const hex = ref[1] === "x" || ref[1] === "X"
      return codePoint(parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10)) || m
    }
    return NAMED_ENTITIES[ref] ?? NAMED_ENTITIES[ref.toLowerCase()] ?? m
  })
}

/**
 * Turn a job description (HTML, often pasted from Word or an ATS, full of
 * inline styles) into readable text: paragraphs separated by a blank line,
 * list items as "- " lines, every tag dropped, entities decoded.
 */
export function htmlToText(raw: string | null | undefined): string | null {
  if (!raw) return null
  const text = decodeEntities(
    raw
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style)[^>]*>[\s\S]*?(<\/\1>|$)/gi, "")
      // Swallow the source's own whitespace around list items, or every bullet
      // ends up separated by a blank line. `</li>` goes first so its removal
      // cannot eat the newline the `<li>` replacement inserts.
      .replace(/<\/li>/gi, "")
      .replace(/\s*<li(\s[^>]*)?>/gi, "\n- ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<(h[1-6])(\s[^>]*)?>/gi, "\n\n")
      .replace(/<\/(p|ul|ol|div|h[1-6]|tr|table|blockquote|section)>/gi, "\n\n")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    // Zero-width and direction marks (common in Workday exports) carry no text.
    .map((line) => line.replace(/[\u200b-\u200f\u2060\ufeff]/g, "").replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

/** One-line text: tags dropped, entities decoded, whitespace collapsed. */
export function cleanInline(s: unknown): string | null {
  if (typeof s !== "string") return null
  const out = decodeEntities(s.replace(/<[^>]+>/g, " "))
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, "")
    .replace(/[\s\u00a0]+/g, " ")
    .trim()
  return out || null
}

/** Cut text to about `max` characters at a word boundary. */
export function excerpt(text: string | null, max = EXCERPT_CHARS): { text: string | null; truncated: boolean } {
  if (!text) return { text: null, truncated: false }
  const chars = [...text]
  if (chars.length <= max) return { text, truncated: false }
  let cut = chars.slice(0, max).join("")
  const space = cut.search(/\s\S*$/)
  if (space > max * 0.6) cut = cut.slice(0, space)
  return { text: `${cut.trimEnd()} …`, truncated: true }
}

// ---------------------------------------------------------------------------
// Record mapping
// ---------------------------------------------------------------------------

export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function money(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

const PERIODS: Record<string, string> = {
  annually: "year",
  yearly: "year",
  monthly: "month",
  weekly: "week",
  daily: "day",
  hourly: "hour",
}

export function formatSalary(
  min: number | null,
  max: number | null,
  currency: string | null,
  period: string | null,
): string | null {
  if (min === null && max === null) return null
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 })
  const range =
    min !== null && max !== null
      ? min === max
        ? fmt(min)
        : `${fmt(min)}-${fmt(max)}`
      : min !== null
        ? `from ${fmt(min)}`
        : `up to ${fmt(max!)}`
  const unit = period ? (PERIODS[period] ?? period) : null
  return `${currency ? currency + " " : ""}${range}${unit ? " / " + unit : ""}`
}

/**
 * JBoard timestamps carry microseconds (`2026-09-21T00:00:00.000000Z`), which
 * not every Date parser accepts; keep milliseconds only.
 */
export function parseTimestamp(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw.trim()) return null
  const d = new Date(raw.trim().replace(/(\.\d{3})\d+/, "$1"))
  return Number.isNaN(d.getTime()) ? null : d
}

const ID_RE = /^\d{1,12}$/
const DETAILS_PATH_RE = /^\/jobs\/(\d{1,12})-[A-Za-z0-9-]{1,300}$/

export function jobUrl(id: string, detailsPath: unknown): string {
  if (typeof detailsPath === "string") {
    const m = detailsPath.match(DETAILS_PATH_RE)
    if (m && m[1] === id) return ORIGIN + detailsPath
  }
  // /jobs/<id>-<anything> answers with a 301 to the canonical slug.
  return `${ORIGIN}/jobs/${id}-job`
}

export interface Job {
  id: string
  title: string
  company: string | null
  location: string | null
  remote: boolean | null
  date: string | null
  posted: string | null
  url: string
  applyUrl: string | null
  salary: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryPeriod: string | null
  jobType: string | null
  category: string | null
  tags: string[]
  description: string | null
  descriptionTruncated: boolean
}

function tagNames(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const t of v) {
    const name = typeof t === "string" ? cleanInline(t) : isObj(t) ? cleanInline(t.name ?? t.title) : null
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/**
 * Map one embedded job object. Every field is always present - `null` (or
 * `[]`) rather than omitted. Returns null for an object with no usable id or
 * title, so the caller skips it instead of emitting a half-record.
 * `full: false` (search) keeps a description excerpt; `full: true` (detail)
 * keeps all of it.
 */
export function toJob(raw: unknown, opts: { full?: boolean } = {}): Job | null {
  if (!isObj(raw)) return null
  const id = typeof raw.id === "number" || typeof raw.id === "string" ? String(raw.id) : ""
  if (!ID_RE.test(id)) return null
  const title = cleanInline(raw.title)
  if (!title) return null

  const employer = isObj(raw.employer) ? raw.employer : null
  const remote = typeof raw.remote === "boolean" ? raw.remote : null
  const jobLocation = isObj(raw.job_location) ? raw.job_location : null
  const posted = parseTimestamp(raw.posted_at)

  const salaryMin = money(raw.min_compensation)
  const salaryMax = money(raw.max_compensation)
  const hasSalary = salaryMin !== null || salaryMax !== null
  // Currency and period are defaults on every job; they mean something only
  // next to an amount.
  const salaryCurrency =
    hasSalary && typeof raw.compensation_currency === "string" && raw.compensation_currency.trim()
      ? raw.compensation_currency.trim().toUpperCase()
      : null
  const salaryPeriod =
    hasSalary && typeof raw.compensation_time_frame === "string" && raw.compensation_time_frame.trim()
      ? raw.compensation_time_frame.trim()
      : null

  const text = htmlToText(typeof raw.description === "string" ? raw.description : null)
  const desc = opts.full ? { text, truncated: false } : excerpt(text)
  const apply = typeof raw.apply_to === "string" ? raw.apply_to.trim() : ""

  return {
    id,
    title,
    company: cleanInline(employer?.name),
    // Remote jobs often have an empty location; a location next to
    // remote: true usually names the employer's base or a residency limit.
    location: cleanInline(raw.location) ?? cleanInline(jobLocation?.name) ?? (remote ? "Remote" : null),
    remote,
    date: posted ? posted.toISOString().slice(0, 10) : null,
    posted: posted ? posted.toISOString() : null,
    url: jobUrl(id, raw.job_details_path),
    applyUrl: /^https?:\/\/\S+$/i.test(apply) ? apply : null,
    salary: formatSalary(salaryMin, salaryMax, salaryCurrency, salaryPeriod),
    salaryMin,
    salaryMax,
    salaryCurrency,
    salaryPeriod,
    jobType: isObj(raw.job_type) ? cleanInline(raw.job_type.title) : null,
    category: isObj(raw.category) ? cleanInline(raw.category.name ?? raw.category.title) : null,
    tags: tagNames(raw.tags),
    description: desc.text,
    descriptionTruncated: desc.truncated,
  }
}

/**
 * Parse every job chunk on its own. A chunk that is not valid JSON, or maps to
 * no usable job, is counted in `skipped` and the rest carry on. Duplicate ids
 * (a job repeated in two embedded blocks) keep the first.
 */
export function parseJobs(chunks: string[], opts: { full?: boolean } = {}): { jobs: Job[]; skipped: number } {
  const jobs: Job[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const chunk of chunks) {
    let job: Job | null = null
    try {
      job = toJob(JSON.parse(chunk), opts)
    } catch {
      job = null
    }
    if (!job) {
      skipped++
      continue
    }
    if (seen.has(job.id)) continue
    seen.add(job.id)
    jobs.push(job)
  }
  return { jobs, skipped }
}

// ---------------------------------------------------------------------------
// Search request and response
// ---------------------------------------------------------------------------

export interface SearchParams {
  query: string
  location: string
  remote: boolean
  jobage?: number
  page: number
}

/** The filters a search actually sends, in a fixed order. */
export function usedFilters(p: SearchParams): FilterName[] {
  const used: FilterName[] = []
  if (p.query) used.push("query")
  if (p.jobage !== undefined) used.push("jobage")
  if (p.location) used.push("location")
  if (p.remote) used.push("remote")
  return used
}

/** `/jobs?filters[...]=...&order=posted_at&page=N` - newest first. */
export function buildSearchUrl(p: SearchParams): string {
  const qs = new URLSearchParams()
  if (p.query) qs.set(FILTERS.query.param, p.query)
  if (p.jobage !== undefined) qs.set(FILTERS.jobage.param, String(p.jobage))
  if (p.location) qs.set(FILTERS.location.param, p.location)
  if (p.remote) qs.set(FILTERS.remote.param, "1")
  qs.set("order", "posted_at")
  if (p.page > 1) qs.set("page", String(p.page))
  return `${ORIGIN}/jobs?${qs.toString()}`
}

/** Throws FILTERS_CHANGED if the page no longer renders a filter this search sent. */
export function checkFilters(html: string, used: FilterName[]): void {
  const missing = used.filter((f) => !html.includes(FILTERS[f].marker))
  if (missing.length) {
    throw new CliError(
      `Impact Jobs no longer renders the ${missing.join(", ")} filter(s) this CLI sends ` +
        `(${missing.map((f) => FILTERS[f].param).join(", ")}), so the board would ignore them and return ` +
        `unfiltered results. The board's filter ids have changed; see url-reference.md "If it breaks".`,
      "FILTERS_CHANGED",
    )
  }
}

/**
 * Last page number linked from the page's pagination (the board always links
 * the last two pages), and whether a next page exists. `pages` is null when
 * the page links no other page and has no results (unknown).
 */
export function parsePagination(html: string, page: number, resultCount: number): { pages: number | null; hasNext: boolean } {
  let max = 0
  for (const m of html.matchAll(/href="((?:https:\/\/(?:www\.)?impactjobs\.org)?\/jobs\?[^"]*)"/g)) {
    const pm = decodeEntities(m[1]!).match(/[?&]page=(\d{1,6})(?:&|$)/)
    if (pm) max = Math.max(max, Number(pm[1]))
  }
  // Both the <head> `<link rel="next">` and the pager's "Next" anchor carry it.
  const hasNext = /\brel="next"/.test(html)
  if (resultCount > 0) max = Math.max(max, page)
  return { pages: max > 0 ? max : null, hasNext }
}

// ---------------------------------------------------------------------------
// detail input
// ---------------------------------------------------------------------------

/**
 * Accept a numeric id from `search`, an `<id>-<slug>` path segment, or an
 * impactjobs.org job URL. Only the id and slug are kept, so a supplied URL
 * never steers a request anywhere else.
 */
export function parseIdInput(input: string): { id: string; slug: string | null } | null {
  const raw = input.trim()
  if (ID_RE.test(raw)) return { id: raw, slug: null }
  const seg = raw.match(/^(\d{1,12})-([A-Za-z0-9-]{1,300})$/)
  if (seg) return { id: seg[1]!, slug: seg[2]! }
  if (!/^https?:\/\//i.test(raw)) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (!HOSTS.has(url.hostname.toLowerCase())) return null
  const m = url.pathname.match(/^\/jobs\/(\d{1,12})(?:-([A-Za-z0-9-]{1,300}))?\/?$/)
  if (!m) return null
  return { id: m[1]!, slug: m[2] ?? null }
}

export function detailUrl(id: string, slug: string | null): string {
  return `${ORIGIN}/jobs/${id}-${slug ?? "job"}`
}
