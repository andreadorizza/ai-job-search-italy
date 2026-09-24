// Data source: the 80,000 Hours job board (https://jobs.80000hours.org).
//
// The board is a Nuxt single-page app. Its job list is not in the HTML: the
// browser queries an Algolia search index directly, using a search-only key
// that the board ships to every visitor in `window.__NUXT__.config`. This CLI
// makes exactly the same two calls a browser does - load the board page, then
// query the index - with an honest User-Agent and no impersonation.
//
// The key is read from the page at runtime rather than hardcoded, so it follows
// any rotation by the board and no key string is committed to this repo. See
// ../url-reference.md for where it lives and how it was verified as search-only.
//
// Zero runtime dependencies: responses are JSON, and the only HTML parsed is a
// single config object literal plus short job summaries.

export const BOARD_ORIGIN = "https://jobs.80000hours.org"
/** Canonical public link for one job: the board opens that job's card. */
export const JOB_PAGE = `${BOARD_ORIGIN}/jobs`
export const PER_PAGE = 20

const UA = "Mozilla/5.0 (compatible; 80000hours-search-cli/1.0)"
const TIMEOUT_MS = 15000
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
 * Returns null on 404 so callers can report NOT_FOUND instead of crashing.
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

// ---------------------------------------------------------------------------
// Board config: where the public search key comes from
// ---------------------------------------------------------------------------

export interface BoardConfig {
  appId: string
  apiKey: string
  jobsIndex: string
}

function configValue(html: string, key: string): string | null {
  // The config is a JS object literal (`algoliaApiKey:"..."`); accept a quoted
  // key too, in case the board ever switches to serialising it as JSON.
  const m = html.match(new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']+)["']`))
  return m ? m[1]! : null
}

/**
 * Pull the Algolia app id, search key and jobs index out of the board page.
 * Every value is shape-checked: the app id becomes part of a hostname, so an
 * unexpected value must never be able to steer the request somewhere else.
 */
export function parseBoardConfig(html: string): BoardConfig | null {
  const appId = configValue(html, "algoliaApplicationId")
  const apiKey = configValue(html, "algoliaApiKey")
  const jobsIndex = configValue(html, "algoliaJobsIndex")
  if (!appId || !/^[A-Z0-9]{6,20}$/.test(appId)) return null
  if (!apiKey || !/^[A-Za-z0-9]{16,128}$/.test(apiKey)) return null
  if (!jobsIndex || !/^[A-Za-z0-9_-]{1,64}$/.test(jobsIndex)) return null
  return { appId, apiKey, jobsIndex }
}

export async function loadBoardConfig(): Promise<BoardConfig> {
  const response = await fetchWithRetry(`${BOARD_ORIGIN}/`, { headers: { Accept: "text/html" } })
  if (!response || !response.ok) {
    throw new CliError(
      `Could not load ${BOARD_ORIGIN}/ (HTTP ${response?.status ?? 404}) to read its search config`,
      "API_ERROR",
    )
  }
  const config = parseBoardConfig(await response.text())
  if (!config) {
    throw new CliError(
      "The board page no longer exposes its Algolia search config in window.__NUXT__.config - " +
        "the site has changed; see url-reference.md to re-locate the index and key",
      "CONFIG_NOT_FOUND",
    )
  }
  return config
}

// ---------------------------------------------------------------------------
// Algolia query
// ---------------------------------------------------------------------------

export interface AlgoliaHit {
  objectID?: string
  post_pk?: number
  title?: string
  company_name?: string
  company_url?: string
  company_description?: string
  card_locations?: string[]
  tags_location_80k?: string[]
  tags_location_type?: string[]
  tags_area?: string[]
  tags_skill?: string[]
  tags_role_type?: string[]
  tags_exp_required?: string[]
  tags_degree_required?: string[]
  posted_at?: number
  updated_at?: number
  closes_at?: number | null
  url_external?: string
  salary?: string
  description?: string
  description_short?: string
}

export interface AlgoliaResponse {
  hits?: AlgoliaHit[]
  nbHits?: number
  nbPages?: number
  page?: number
}

const CARD_ATTRS = [
  "objectID",
  "post_pk",
  "title",
  "company_name",
  "card_locations",
  "tags_location_80k",
  "tags_location_type",
  "tags_area",
  "tags_skill",
  "tags_role_type",
  "tags_exp_required",
  "posted_at",
  "closes_at",
  "url_external",
  "salary",
  "description",
  "description_short",
]

export const SEARCH_ATTRS = CARD_ATTRS
export const DETAIL_ATTRS = [
  ...CARD_ATTRS,
  "company_url",
  "company_description",
  "tags_degree_required",
  "updated_at",
]

/**
 * POST one query to the board's jobs index. `analytics: false` keeps this
 * tool's queries out of the board's own search analytics - they are not real
 * visitor behaviour and should not skew what the board learns from its users.
 */
export async function algoliaQuery(
  cfg: BoardConfig,
  params: Record<string, unknown>,
): Promise<AlgoliaResponse> {
  const url = `https://${cfg.appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(cfg.jobsIndex)}/query`
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "X-Algolia-Application-Id": cfg.appId,
      "X-Algolia-API-Key": cfg.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ analytics: false, attributesToHighlight: [], attributesToSnippet: [], ...params }),
  })
  if (!response) {
    throw new CliError(`Search index "${cfg.jobsIndex}" not found - the board has changed; see url-reference.md`, "API_ERROR")
  }
  if (response.status === 401 || response.status === 403) {
    throw new CliError(
      "The search service rejected the board's public search key - the board may have rotated or restricted it",
      "API_ERROR",
    )
  }
  if (!response.ok) {
    throw new CliError(`Request failed: ${response.status} ${response.statusText}`, "API_ERROR")
  }
  try {
    return (await response.json()) as AlgoliaResponse
  } catch {
    throw new CliError("The search service returned a response that is not JSON", "PARSE_ERROR")
  }
}

// ---------------------------------------------------------------------------
// Search parameters
// ---------------------------------------------------------------------------

export interface SearchParamOpts {
  query: string
  page: number // 1-indexed
  locations: string[]
  remote: boolean
  jobage?: number
  nowMs?: number
}

/**
 * `--location` takes the board's own location tags. Those tags contain commas
 * ("Remote, Global", "London, UK"), so several are separated with `;`.
 */
export function splitLocations(raw: string): string[] {
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * In an Algolia facet filter a leading "-" negates the value. Escape it so a
 * user-supplied tag can only ever narrow the search, never invert it.
 */
function facetValue(v: string): string {
  return v.startsWith("-") ? `\\${v}` : v
}

export function buildSearchParams(opts: SearchParamOpts): Record<string, unknown> {
  const facetFilters: string[][] = []
  // Values inside one inner array are OR'ed; the arrays themselves are AND'ed.
  if (opts.locations.length) {
    facetFilters.push(opts.locations.map((l) => `tags_location_80k:${facetValue(l)}`))
  }
  if (opts.remote) facetFilters.push(["tags_location_type:Remote"])

  const numericFilters: string[] = []
  if (opts.jobage !== undefined) {
    const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000)
    numericFilters.push(`posted_at>=${nowSec - opts.jobage * 86400}`)
  }

  return {
    query: opts.query,
    page: opts.page - 1,
    hitsPerPage: PER_PAGE,
    facetFilters,
    numericFilters,
    attributesToRetrieve: SEARCH_ATTRS,
  }
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
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  eacute: "é",
  euro: "€",
  pound: "£",
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
 * The board's summaries are short HTML: bullet lists, paragraphs and links.
 * Keep the structure readable as text - bullets become "- " lines, paragraphs
 * are separated by a blank line - and drop every tag.
 */
export function htmlToText(raw: string | null | undefined): string | null {
  if (!raw) return null
  const text = decodeEntities(
    raw
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
      // Swallow the source's own newlines before each list item, or every
      // bullet ends up separated by a blank line. `</li>` goes first so its
      // removal cannot eat the newline the `<li>` replacement inserts.
      .replace(/<\/li>/gi, "")
      .replace(/\s*<li(\s[^>]*)?>/gi, "\n- ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|ul|ol|div|h[1-6])>/gi, "\n\n")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

// ---------------------------------------------------------------------------
// Record mapping
// ---------------------------------------------------------------------------

/** The board's timestamps are epoch seconds. Emit YYYY-MM-DD (UTC), or null. */
export function toIsoDate(epochSec: number | null | undefined): string | null {
  if (typeof epochSec !== "number" || !Number.isFinite(epochSec) || epochSec <= 0) return null
  const d = new Date(epochSec * 1000)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []
}

function nonEmpty(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

export function jobUrl(id: string): string {
  return `${JOB_PAGE}?jobPk=${encodeURIComponent(id)}`
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  remote: boolean
  date: string | null
  deadline: string | null
  url: string
  applyUrl: string | null
  salary: string | null
  areas: string[]
  skills: string[]
  roleTypes: string[]
  experience: string[]
  description: string | null
}

export interface JobDetail extends JobCard {
  locations: string[]
  degree: string[]
  updated: string | null
  companyUrl: string | null
  companyDescription: string | null
}

function hitId(hit: AlgoliaHit): string | null {
  if (typeof hit?.objectID === "string" && /^\d+$/.test(hit.objectID)) return hit.objectID
  if (typeof hit?.post_pk === "number" && Number.isInteger(hit.post_pk)) return String(hit.post_pk)
  return null
}

/**
 * Map one index record. Every field is always present - `null` (or `[]` for
 * lists) is emitted rather than omitted. Called per record, so one malformed
 * record is skipped instead of breaking the batch.
 */
export function toJobCard(hit: AlgoliaHit): JobCard | null {
  const id = hitId(hit)
  const title = nonEmpty(hit?.title)
  if (!id || !title) return null
  const cardLocations = strings(hit.card_locations)
  const locations = cardLocations.length ? cardLocations : strings(hit.tags_location_80k)
  return {
    id,
    title,
    company: nonEmpty(hit.company_name),
    // Location tags themselves contain commas ("London, UK"), so join with ";".
    location: locations.length ? locations.join("; ") : null,
    remote: strings(hit.tags_location_type).includes("Remote"),
    date: toIsoDate(hit.posted_at),
    deadline: toIsoDate(hit.closes_at ?? null),
    url: jobUrl(id),
    applyUrl: nonEmpty(hit.url_external),
    salary: nonEmpty(hit.salary),
    areas: strings(hit.tags_area),
    skills: strings(hit.tags_skill),
    roleTypes: strings(hit.tags_role_type),
    experience: strings(hit.tags_exp_required),
    // The index's long `description` is usually empty; the board itself shows
    // the short summary and links out to the employer for the full posting.
    description: htmlToText(hit.description) ?? htmlToText(hit.description_short),
  }
}

export function toJobDetail(hit: AlgoliaHit): JobDetail | null {
  const card = toJobCard(hit)
  if (!card) return null
  return {
    ...card,
    locations: strings(hit.tags_location_80k),
    degree: strings(hit.tags_degree_required),
    updated: toIsoDate(hit.updated_at),
    companyUrl: nonEmpty(hit.company_url),
    companyDescription: htmlToText(hit.company_description),
  }
}

// ---------------------------------------------------------------------------
// detail input
// ---------------------------------------------------------------------------

/**
 * Accept a numeric job id or a board URL carrying `?jobPk=<id>`. URLs are only
 * accepted from jobs.80000hours.org, and only the id is kept: the request is
 * rebuilt from it, so a supplied URL can never steer the fetch.
 */
export function parseIdInput(input: string): string | null {
  const raw = input.trim()
  if (/^\d{1,12}$/.test(raw)) return raw
  if (!/^https?:\/\//i.test(raw)) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.hostname.toLowerCase() !== "jobs.80000hours.org") return null
  const pk = url.searchParams.get("jobPk")
  return pk && /^\d{1,12}$/.test(pk) ? pk : null
}
