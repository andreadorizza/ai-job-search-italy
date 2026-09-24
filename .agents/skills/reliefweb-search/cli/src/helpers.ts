// Data source: the official ReliefWeb API v2 (UN OCHA), `POST /v2/jobs`.
// The API is read-only JSON and its terms say anyone can use it, but since
// 1 November 2025 every call must carry a *pre-approved* `appname`, requested
// through ReliefWeb's own form. That appname is read from the environment
// (RELIEFWEB_APPNAME) and never from a flag, and it is kept out of every
// error message because it rides in the request URL.
//
// The website itself (reliefweb.int/jobs and its RSS feeds) answers
// non-browser clients with "not available for scraping", and robots.txt
// disallows the feeds, so the API is the only sanctioned path. This CLI does
// no HTML scraping and no browser impersonation.
//
// Zero runtime dependencies: responses are JSON, descriptions are Markdown.

export const API_BASE = "https://api.reliefweb.int/v2"
export const JOBS_PATH = "/jobs"
export const SITE_BASE = "https://reliefweb.int"
export const APPNAME_ENV = "RELIEFWEB_APPNAME"
export const APPNAME_FORM = "https://apidoc.reliefweb.int/parameters#appname"

const UA = "Mozilla/5.0 (compatible; reliefweb-cli/1.0)"
const TIMEOUT_MS = 20000

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** An error that already knows which contract code it maps to. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
  }
}

// ---------------------------------------------------------------------------
// Credential
// ---------------------------------------------------------------------------

/** The approved appname, or null when the variable is unset or blank. */
export function readAppname(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env[APPNAME_ENV]
  const value = typeof raw === "string" ? raw.trim() : ""
  return value ? value : null
}

export const MISSING_APPNAME_MESSAGE =
  `${APPNAME_ENV} is not set. The ReliefWeb API only answers pre-approved appnames ` +
  `(policy since 1 November 2025). Request one (free, reviewed by ReliefWeb) via the form linked at ` +
  `${APPNAME_FORM}, then: export ${APPNAME_ENV}=<your-approved-appname>`

/**
 * Exit-1 guard shared by `search` and `detail`: never fall through to a request
 * that ReliefWeb will reject with a confusing 400/403.
 */
export function requireAppname(): string | null {
  const appname = readAppname()
  if (!appname) writeError(MISSING_APPNAME_MESSAGE, "MISSING_CREDENTIALS")
  return appname
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/** ReliefWeb's error envelope is `{status, time, error: {type, message}}`. */
export function upstreamMessage(body: string): string | null {
  if (!body.trimStart().startsWith("{")) return null
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } }
    const msg = parsed?.error?.message
    return typeof msg === "string" && msg.trim() ? msg.trim() : null
  } catch {
    return null
  }
}

/** Remove the appname (raw or URL-encoded) from text bound for stderr. */
export function scrub(text: string, appname: string): string {
  if (!appname) return text
  return text.split(encodeURIComponent(appname)).join("<appname>").split(appname).join("<appname>")
}

function scrubbed(text: string | null, appname: string): string | null {
  return text === null ? null : scrub(text, appname)
}

/**
 * POST a JSON query with exponential backoff + jitter on 429/5xx, capped
 * retries, and a hard per-attempt timeout. Honest User-Agent, never a browser
 * impersonation. Returns null on 404.
 *
 * Error messages never include the request URL: it carries the appname.
 */
export async function apiPost<T>(path: string, body: unknown, appname: string): Promise<T | null> {
  const url = `${API_BASE}${path}?appname=${encodeURIComponent(appname)}`
  const maxRetries = 6
  // A hung backend is retried too, but only twice: at TIMEOUT_MS per attempt,
  // the full 429/5xx budget would stall a /scrape run for minutes.
  const maxNetworkFailures = 3
  let networkFailures = 0
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (e) {
      networkFailures++
      if (networkFailures >= maxNetworkFailures || attempt === maxRetries) {
        const name = e instanceof Error ? e.name : ""
        const msg = e instanceof Error ? e.message : String(e)
        throw new ApiError(
          name === "TimeoutError" || name === "AbortError"
            ? `ReliefWeb did not answer within ${TIMEOUT_MS / 1000}s (${networkFailures} attempts); the API may be degraded, try again later`
            : `Could not reach ReliefWeb: ${scrub(msg, appname)}`,
          "API_ERROR",
        )
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        const detail = scrubbed(upstreamMessage(await response.text().catch(() => "")), appname)
        throw new ApiError(
          `ReliefWeb request failed: ${response.status} ${response.statusText}` +
            (detail ? ` - ${detail}` : "") +
            (response.status === 429 ? " (the API allows 1000 calls/day per appname)" : ""),
          response.status === 429 ? "RATE_LIMITED" : "API_ERROR",
        )
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }

    if (response.status === 404) return null

    const text = await response.text()

    if (response.status === 401 || response.status === 403) {
      const detail = scrubbed(upstreamMessage(text), appname)
      throw new ApiError(
        `ReliefWeb rejected the appname in ${APPNAME_ENV} (HTTP ${response.status}` +
          (detail ? `: ${detail}` : "") +
          `). Only pre-approved appnames work; request one via ${APPNAME_FORM}`,
        "INVALID_CREDENTIALS",
      )
    }

    if (!response.ok) {
      const detail = scrubbed(upstreamMessage(text), appname)
      throw new ApiError(
        `ReliefWeb request failed: ${response.status} ${response.statusText}` +
          (detail ? ` - ${detail}` : ""),
        "API_ERROR",
      )
    }

    if (/^\s*</.test(text)) {
      throw new ApiError(
        "ReliefWeb answered with HTML instead of JSON (blocked or rate-limited)",
        "API_ERROR",
      )
    }
    try {
      return JSON.parse(text) as T
    } catch {
      throw new ApiError("ReliefWeb returned a response that is not valid JSON", "PARSE_ERROR")
    }
  }
  throw new ApiError("Request failed after max retries", "API_ERROR")
}

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

/**
 * ReliefWeb's nine career categories, as `career_categories.name` spells them.
 * Filtering on the name (not the numeric id) keeps the flag readable; numeric
 * ids are still accepted as an escape hatch for a category added later.
 */
export const CAREER_CATEGORIES = [
  "Administration/Finance",
  "Advocacy/Communications",
  "Donor Relations/Grants Management",
  "Human Resources",
  "Information and Communications Technology",
  "Information Management",
  "Logistics/Procurement",
  "Monitoring and Evaluation",
  "Program/Project Management",
] as const

/** Lowercase, `&` read as "and", every other non-alphanumeric run dropped. */
export function matchKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
}

const CATEGORY_ALIASES: Record<string, (typeof CAREER_CATEGORIES)[number]> = {
  admin: "Administration/Finance",
  administration: "Administration/Finance",
  finance: "Administration/Finance",
  advocacy: "Advocacy/Communications",
  communications: "Advocacy/Communications",
  comms: "Advocacy/Communications",
  donor: "Donor Relations/Grants Management",
  grants: "Donor Relations/Grants Management",
  hr: "Human Resources",
  ict: "Information and Communications Technology",
  it: "Information and Communications Technology",
  im: "Information Management",
  logistics: "Logistics/Procurement",
  procurement: "Logistics/Procurement",
  me: "Monitoring and Evaluation",
  mande: "Monitoring and Evaluation", // "M&E"
  mel: "Monitoring and Evaluation",
  meal: "Monitoring and Evaluation",
  pm: "Program/Project Management",
  program: "Program/Project Management",
  programme: "Program/Project Management",
  project: "Program/Project Management",
  programmeprojectmanagement: "Program/Project Management",
}

for (const name of CAREER_CATEGORIES) CATEGORY_ALIASES[matchKey(name)] = name

export interface CategoryResolution {
  names: string[]
  ids: number[]
  unknown: string[]
}

/** Resolve a comma-separated --category value to canonical names and/or ids. */
export function resolveCategories(raw: string): CategoryResolution {
  const out: CategoryResolution = { names: [], ids: [], unknown: [] }
  for (const token of raw.split(",").map((t) => t.trim()).filter(Boolean)) {
    if (/^\d+$/.test(token)) {
      out.ids.push(parseInt(token, 10))
      continue
    }
    const name = CATEGORY_ALIASES[matchKey(token)]
    if (name) {
      if (!out.names.includes(name)) out.names.push(name)
    } else {
      out.unknown.push(token)
    }
  }
  return out
}

export interface CountryResolution {
  names: string[]
  iso3: string[]
  bad: string[]
}

/**
 * Split --location into English country names and ISO3 codes. Two-letter codes
 * are rejected rather than sent as a name: `-l it` would otherwise silently
 * match nothing, which reads like "no jobs in Italy".
 */
export function resolveCountries(raw: string): CountryResolution {
  const out: CountryResolution = { names: [], iso3: [], bad: [] }
  for (const token of raw.split(",").map((t) => t.trim()).filter(Boolean)) {
    if (/^[A-Za-z]{3}$/.test(token)) out.iso3.push(token.toUpperCase())
    else if (/^[A-Za-z]{2}$/.test(token)) out.bad.push(token)
    else out.names.push(token)
  }
  return out
}

/**
 * The query field is parsed with Lucene syntax, where `/`, `:`, `(`, `-` and
 * friends are operators - so "Program/Project" or "M&E" would come back as a
 * 400. Escape them; keep balanced double quotes so phrase search still works.
 */
export function escapeQuery(q: string): string {
  const quotes = (q.match(/"/g) ?? []).length
  const special = quotes % 2 === 0 ? /[+\-&|!(){}\[\]^~*?:\\\/]/g : /[+\-&|!(){}\[\]^~*?:\\\/"]/g
  return q.replace(special, (c) => `\\${c}`)
}

/** ISO-8601 with an explicit +00:00 offset, the form the API docs use. */
export function isoDaysAgo(days: number, now: number = Date.now()): string {
  return new Date(now - days * 86400000).toISOString().replace(/\.\d{3}Z$/, "+00:00")
}

export type Filter = Record<string, unknown>

export interface SearchQueryOpts {
  query?: string
  countries?: CountryResolution
  remote: boolean
  categories?: CategoryResolution
  jobage?: number
  page: number
  perPage: number
  sort: "recent" | "relevance" | "closing"
  now?: number
}

/** `field` exists / does not exist - the API's ExistenceFilter. */
const NO_COUNTRY: Filter = { field: "country", negate: true }

function anyOf(conditions: Filter[]): Filter | null {
  if (conditions.length === 0) return null
  if (conditions.length === 1) return conditions[0]!
  return { operator: "OR", conditions }
}

export const LIST_FIELDS = [
  "id",
  "title",
  "url",
  "url_alias",
  "status",
  "date.created",
  "date.closing",
  "source.name",
  "source.shortname",
  "country.name",
  "city.name",
  "type.name",
  "experience.name",
  "career_categories.name",
  "theme.name",
]

export function buildSearchBody(opts: SearchQueryOpts): Record<string, unknown> {
  const conditions: Filter[] = []

  // Location: countries OR'd together; --remote adds "no country at all",
  // which is how ReliefWeb records remote/home-based, roving and TBD postings.
  const location: Filter[] = []
  if (opts.countries?.names.length) {
    location.push({ field: "country.name", value: opts.countries.names, operator: "OR" })
  }
  if (opts.countries?.iso3.length) {
    location.push({ field: "country.iso3", value: opts.countries.iso3, operator: "OR" })
  }
  if (opts.remote) location.push(NO_COUNTRY)
  const loc = anyOf(location)
  if (loc) conditions.push(loc)

  const cats: Filter[] = []
  if (opts.categories?.names.length) {
    cats.push({ field: "career_categories.name", value: opts.categories.names, operator: "OR" })
  }
  if (opts.categories?.ids.length) {
    cats.push({ field: "career_categories.id", value: opts.categories.ids, operator: "OR" })
  }
  const cat = anyOf(cats)
  if (cat) conditions.push(cat)

  if (opts.jobage !== undefined) {
    conditions.push({ field: "date.created", value: { from: isoDaysAgo(opts.jobage, opts.now) } })
  }

  const body: Record<string, unknown> = {
    // `latest` serves open postings only; expired ones sit behind `analysis`.
    preset: "latest",
    limit: opts.perPage,
    offset: (opts.page - 1) * opts.perPage,
    fields: { include: LIST_FIELDS },
    sort:
      opts.sort === "closing"
        ? ["date.closing:asc", "date.created:desc"]
        : opts.sort === "relevance"
          ? ["score:desc", "date.created:desc"]
          : ["date.created:desc"],
  }
  if (opts.query) body.query = { value: escapeQuery(opts.query), operator: "AND" }
  if (conditions.length === 1) body.filter = conditions[0]
  else if (conditions.length > 1) body.filter = { operator: "AND", conditions }
  return body
}

/**
 * Fetch one job by id through the list endpoint rather than `GET /jobs/{id}`:
 * the item endpoint 404s on an expired job, while an id filter under the
 * `analysis` preset reaches open and expired postings alike.
 */
export function buildDetailBody(id: number): Record<string, unknown> {
  return { filter: { field: "id", value: id }, profile: "full", preset: "analysis", limit: 1 }
}

// ---------------------------------------------------------------------------
// Response mapping
// ---------------------------------------------------------------------------

interface Named {
  name?: string
  shortname?: string
}

export interface RawJobFields {
  id?: number
  title?: string
  url?: string
  url_alias?: string
  status?: string
  date?: { created?: string; changed?: string; closing?: string }
  source?: Named[]
  country?: Named[]
  city?: Named[] | Named
  type?: Named[]
  experience?: Named[]
  career_categories?: Named[]
  theme?: Named[]
  body?: string
  "body-html"?: string
  how_to_apply?: string
  "how_to_apply-html"?: string
}

export interface RawItem {
  id?: number | string
  fields?: RawJobFields
}

export interface ApiListResponse {
  totalCount?: number
  count?: number
  data?: RawItem[]
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  companyShort: string | null
  location: string | null
  countries: string[]
  locationUnspecified: boolean
  date: string | null
  deadline: string | null
  url: string
  type: string | null
  experience: string | null
  categories: string[]
  themes: string[]
}

export interface JobDetail extends JobCard {
  status: string | null
  isActive: boolean
  lastModified: string | null
  description: string | null
  howToApply: string | null
}

export const UNSPECIFIED_LOCATION = "Unspecified (remote/home-based, roving or TBD)"

function names(list: Named[] | Named | undefined): string[] {
  const arr = Array.isArray(list) ? list : list ? [list] : []
  return arr
    .map((x) => (typeof x?.name === "string" ? x.name.trim() : ""))
    .filter((v, i, a) => v && a.indexOf(v) === i)
}

/** "2026-07-15T10:09:12+00:00" -> "2026-07-15"; null if absent or unparsable. */
export function toIsoDate(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null
  const t = Date.parse(raw)
  if (Number.isNaN(t)) return null
  return new Date(t).toISOString().slice(0, 10)
}

export function jobUrl(id: string, f?: RawJobFields): string {
  return f?.url_alias || f?.url || `${SITE_BASE}/node/${id}`
}

/**
 * Map one raw job. Every field is always present (null or [] rather than
 * omitted). Called per record so one malformed job cannot sink the batch.
 */
export function toJobCard(item: RawItem): JobCard | null {
  const f = item?.fields ?? {}
  const rawId = f.id ?? item?.id
  const id = rawId === undefined || rawId === null ? "" : String(rawId).trim()
  const title = typeof f.title === "string" ? decodeEntities(f.title).trim() : ""
  if (!/^\d+$/.test(id) || !title) return null

  const countries = names(f.country)
  const cities = names(f.city)
  const unspecified = countries.length === 0 && cities.length === 0
  const source = Array.isArray(f.source) ? f.source[0] : undefined

  let location: string | null
  if (unspecified) location = UNSPECIFIED_LOCATION
  else if (cities.length && countries.length === 1) location = `${cities.join(", ")}, ${countries[0]}`
  else location = [...cities, ...countries].join("; ")

  return {
    id,
    title,
    company: source?.name?.trim() || null,
    companyShort: source?.shortname?.trim() || null,
    location,
    countries,
    locationUnspecified: unspecified,
    date: toIsoDate(f.date?.created),
    deadline: toIsoDate(f.date?.closing),
    url: jobUrl(id, f),
    type: names(f.type)[0] ?? null,
    experience: names(f.experience)[0] ?? null,
    categories: names(f.career_categories),
    themes: names(f.theme),
  }
}

export function toJobDetail(item: RawItem): JobDetail | null {
  const card = toJobCard(item)
  if (!card) return null
  const f = item.fields ?? {}
  const status = typeof f.status === "string" ? f.status : null
  return {
    ...card,
    status,
    isActive: status === "published",
    lastModified: toIsoDate(f.date?.changed),
    description: markdownToText(f.body) ?? htmlToText(f["body-html"]),
    howToApply: markdownToText(f.how_to_apply) ?? htmlToText(f["how_to_apply-html"]),
  }
}

// ---------------------------------------------------------------------------
// Text cleaning
// ---------------------------------------------------------------------------

function codePoint(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "-")
    .replace(/&hellip;/g, "...")
    .replace(/&#(\d+);/g, (_, d) => codePoint(parseInt(d, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
}

function tidy(text: string): string | null {
  const out = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return out || null
}

/** Fallback for records that only carry HTML. */
export function htmlToText(raw: string | null | undefined): string | null {
  if (!raw) return null
  return tidy(
    decodeEntities(
      raw
        .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<li[^>]*>/gi, "\n- ")
        .replace(/<\/(p|div|h[1-6]|ul|ol|table|tr)>/gi, "\n\n")
        .replace(/<[^>]+>/g, ""),
    ),
  )
}

/**
 * ReliefWeb stores descriptions as Markdown. Reduce it to readable plain text:
 * headings lose their hashes, emphasis markers go, links keep both the text
 * and the target, bullets become "- ", backslash escapes are undone, and any
 * inline HTML is stripped. Paragraph breaks are preserved.
 */
export function markdownToText(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null
  let t = raw.replace(/\r\n?/g, "\n")

  // Autolinks first, or the tag stripper below would eat them.
  t = t.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/gi, (_, u: string) => u.replace(/^mailto:/i, ""))
  // Inline HTML occasionally leaks into the Markdown.
  t = t.replace(/<br\s*\/?>/gi, "\n").replace(/<\/?(p|div)[^>]*>/gi, "\n").replace(/<[^>]+>/g, "")

  // Images: keep the alt text only. Links: "text (url)", or just the url.
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
  t = t.replace(/\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (_, text: string, url: string) => {
    const label = text.trim()
    const bare = url.replace(/^mailto:/i, "")
    return label === url || label === bare ? bare : `${label} (${bare})`
  })

  const lines = t.split("\n").map((line) => {
    let l = line
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) return "" // horizontal rule
    l = l.replace(/^\s{0,3}#{1,6}\s+/, "").replace(/\s+#+\s*$/, "") // ATX heading
    l = l.replace(/^\s{0,3}>\s?/, "") // blockquote
    l = l.replace(/^(\s*)[*+-]\s+/, (_, indent: string) => `${indent}- `) // bullet
    return l
  })
  t = lines.join("\n")
  // Setext heading underlines.
  t = t.replace(/\n[=-]{3,}\s*(?=\n|$)/g, "")

  // Emphasis: ***x***, **x**, *x*, __x__. Single underscores are left alone -
  // they are far more often part of an email address or URL than italics.
  t = t.replace(/(\*{1,3})(?=\S)([^*\n]*?\S)\1/g, "$2")
  t = t.replace(/__(?=\S)([^_\n]*?\S)__/g, "$1")
  t = t.replace(/`([^`\n]+)`/g, "$1")

  // Backslash escapes (\- \* \_ \# ...).
  t = t.replace(/\\([\\`*_{}\[\]()#+\-.!|>~])/g, "$1")

  return tidy(decodeEntities(t))
}

// ---------------------------------------------------------------------------
// Detail input
// ---------------------------------------------------------------------------

/**
 * Accept a numeric job id or a reliefweb.int job URL (`/job/<id>/<slug>` or
 * `/node/<id>`). The id is re-extracted and the request rebuilt from it, so a
 * supplied URL can never steer the fetch.
 */
export function parseIdInput(input: string): number | null {
  const raw = input.trim()
  if (!raw) return null
  if (/^\d{1,12}$/.test(raw)) return parseInt(raw, 10)
  if (!/^https?:\/\//i.test(raw)) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (host !== "reliefweb.int" && !host.endsWith(".reliefweb.int")) return null
  const m = url.pathname.match(/^\/(?:job|node)\/(\d{1,12})(?:\/[^/]*)?\/?$/)
  return m ? parseInt(m[1]!, 10) : null
}
