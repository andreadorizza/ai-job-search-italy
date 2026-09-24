// Data source: Remote Impact (https://remoteimpact.org), a remote-only board of
// jobs at impact-focused organisations.
//
// The CLI reads only the board's public RSS feeds - the site-wide feed and the
// per-category feeds - which the board's own "share our jobs" page offers for
// reuse in newsletters, Slack workflows and community digests, provided the
// Remote Impact link and attribution are kept. It never requests the HTML job
// pages and never touches /api/ (disallowed in robots.txt).
//
// Every feed holds only the newest 50 items and ignores query parameters, so
// keyword, age and page filtering all happen client-side. See ../url-reference.md.
//
// Zero runtime dependencies: RSS is parsed with per-item regex chunks, so one
// malformed <item> cannot break the rest.

export const ORIGIN = "https://remoteimpact.org"
export const FEED_ALL = `${ORIGIN}/feed/jobs/`
export const PER_PAGE = 20
/** The feed cuts every <description> to this many characters of HTML. */
export const FEED_EXCERPT_CHARS = 500
/** Each category is one extra request; keep a run at human scale. */
export const MAX_CATEGORIES = 5
/** Attribution the board asks for when its feed is reused. */
export const SOURCE = "Remote Impact (https://remoteimpact.org) - public RSS feed"

const UA = "Mozilla/5.0 (compatible; remoteimpact-cli/1.0)"
const TIMEOUT_MS = 15000
const MAX_RETRIES = 6

/** Pause between consecutive feed requests in one run. Tests set it to 0. */
export const settings = { politeDelayMs: 1000 }

/**
 * Category slugs found on https://remoteimpact.org/domains/ at recon
 * (2026-09-24). Used for help text and docs only: the server is the authority,
 * so a slug missing here is still tried, and an unknown one fails cleanly.
 */
export const KNOWN_CATEGORIES: Record<string, string> = {
  "advocacy-or-policy": "Advocacy or Policy",
  "ai-safety": "AI Safety & Governance",
  "animal-welfare": "Animal Welfare",
  biosecurity: "Biosecurity & Pandemic Preparedness",
  buildings: "Buildings",
  capital: "Capital (impact investing)",
  "children-youth": "Children & Youth",
  "civic-engagement": "Civic Engagement",
  "climate-environment": "Climate & Environment",
  "coastal-ocean-sinks": "Coastal & Ocean Sinks",
  communications: "Communications & Media",
  "community-development": "Community Development",
  disability: "Disability",
  education: "Education & Research",
  "effective-altruism": "Effective Altruism",
  energy: "Energy",
  "food-agriculture-land-use": "Food, Agriculture & Land Use",
  "gender-equality-social-inclusion": "Gender Equality & Social Inclusion",
  "global-health": "Global Health",
  humanitarian: "Humanitarian & Disaster Relief",
  "human-rights": "Human Rights & Justice",
  "impact-careers": "Impact Careers",
  "materials-manufacturing": "Materials & Manufacturing",
  "media-journalism": "Media & Journalism",
  "mental-health": "Mental Health",
  "nonprofit-charity": "Nonprofit & Charity",
  "nuclear-security": "Nuclear Security",
  operations: "Operations & Administration",
  other: "Other Impact Areas",
  "policy-advocacy": "Policy & Advocacy",
  "poverty-development": "Poverty & Economic Development",
  technology: "Technology & Engineering",
  transportation: "Transportation",
}

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
 * Returns null on 404 so callers can report a clean error instead of crashing.
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
// Categories and feed URLs
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * `--category` takes one or more slugs separated by commas. Slugs are
 * lower-cased, de-duplicated and shape-checked, because each becomes a path
 * segment of the feed URL.
 */
export function parseCategories(raw: string): string[] {
  const out: string[] = []
  for (const part of raw.split(",")) {
    const slug = part.trim().toLowerCase()
    if (!slug) continue
    if (!SLUG_RE.test(slug) || slug.length > 64) {
      throw new CliError(
        `"${part.trim()}" is not a category slug (lower-case words joined by "-", e.g. ai-safety); see --help`,
        "BAD_ARG",
      )
    }
    if (!out.includes(slug)) out.push(slug)
  }
  if (out.length > MAX_CATEGORIES) {
    throw new CliError(
      `at most ${MAX_CATEGORIES} categories per run (one feed request each), got ${out.length}`,
      "BAD_ARG",
    )
  }
  return out
}

export function feedUrl(category?: string): string {
  return category ? `${ORIGIN}/feed/jobs/category/${category}/` : FEED_ALL
}

// ---------------------------------------------------------------------------
// RSS parsing
// ---------------------------------------------------------------------------

export interface FeedItem {
  title: string | null
  link: string | null
  guid: string | null
  /** The item's description as HTML, already XML-unescaped. */
  descriptionHtml: string | null
  pubDate: string | null
}

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
  middot: "·",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ograve: "ò",
  ugrave: "ù",
  igrave: "ì",
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
 * are left as they are rather than dropped.
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
 * Text content of the first `<tag>` in an item chunk: CDATA kept verbatim,
 * otherwise XML-unescaped. `trim: false` keeps edge whitespace, which the
 * description needs: the feed's 500-character cut counts it, so trimming
 * first would make a cut excerpt look complete.
 */
export function xmlField(chunk: string, tag: string, opts: { trim?: boolean } = {}): string | null {
  const m = chunk.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))
  if (!m) return null
  const inner = m[1]!
  const cdata = inner.trim().match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/)
  const value = cdata ? cdata[1]! : decodeEntities(inner)
  if (!value.trim()) return null
  return opts.trim === false ? value : value.trim()
}

/**
 * Split the feed into per-<item> chunks and read each one independently, so
 * one malformed item is skipped instead of breaking the whole feed.
 */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = []
  for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g)) {
    const chunk = m[1]!
    try {
      items.push({
        title: xmlField(chunk, "title"),
        link: xmlField(chunk, "link"),
        guid: xmlField(chunk, "guid"),
        descriptionHtml: xmlField(chunk, "description", { trim: false }),
        pubDate: xmlField(chunk, "pubDate"),
      })
    } catch {
      // skip this item only
    }
  }
  return items
}

export function looksLikeRss(body: string): boolean {
  return /<rss[\s>]/.test(body.slice(0, 2000)) && /<channel[\s>]/.test(body)
}

/**
 * GET one feed. A 404 on a category feed means the slug does not exist; the
 * site answers that with an HTML error page, never an empty feed.
 */
export async function fetchFeed(category?: string): Promise<{ url: string; items: FeedItem[] }> {
  const url = feedUrl(category)
  const response = await fetchWithRetry(url, { headers: { Accept: "application/rss+xml, application/xml;q=0.9" } })
  if (!response) {
    if (category) {
      throw new CliError(
        `Remote Impact has no category "${category}" (404 on ${url}); see --help for the known slugs`,
        "BAD_CATEGORY",
      )
    }
    throw new CliError(`The Remote Impact feed ${url} returned 404 - the site has changed; see url-reference.md`, "API_ERROR")
  }
  if (!response.ok) {
    throw new CliError(`Request failed: ${response.status} ${response.statusText} (${url})`, "API_ERROR")
  }
  const body = await response.text()
  if (!looksLikeRss(body)) {
    throw new CliError(`${url} did not return an RSS feed - the site has changed; see url-reference.md`, "PARSE_ERROR")
  }
  return { url, items: parseFeed(body) }
}

// ---------------------------------------------------------------------------
// Text cleaning
// ---------------------------------------------------------------------------

/**
 * Turn the feed's HTML excerpt into readable text: paragraphs separated by a
 * blank line, list items as "- " lines, every tag dropped, entities decoded.
 * The feed cuts the HTML at a fixed length, often inside a tag or entity, so a
 * dangling `<span sty` or `&am` at the very end is removed first. Some
 * descriptions are Markdown rather than HTML (the board rewrites some with
 * AI); their `## ` heading markers and `**` bold markers are dropped too.
 */
export function htmlToText(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cut = raw.replace(/<[^>]*$/, "").replace(/&[#a-zA-Z0-9]*$/, "")
  const text = decodeEntities(
    cut
      .replace(/<(script|style)[^>]*>[\s\S]*?(<\/\1>|$)/gi, "")
      // Swallow the source's own whitespace around list items, or every bullet
      // ends up separated by a blank line. `</li>` goes first so its removal
      // cannot eat the newline the `<li>` replacement inserts.
      .replace(/<\/li>/gi, "")
      .replace(/\s*<li(\s[^>]*)?>/gi, "\n- ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|ul|ol|div|h[1-6]|tr|table|blockquote)>/gi, "\n\n")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t ]+/g, " ")
        .trim()
        .replace(/^#{1,6}\s+/, "")
        .replace(/\*\*/g, ""),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

/** Titles carry no markup; decode anything the XML layer left and collapse whitespace. */
function cleanInline(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " "))
    .replace(/[\s ]+/g, " ")
    .trim()
}

/**
 * Feed titles read "<role> at <organisation>". Split on the LAST " at ",
 * because role titles can contain " at " while organisation names rarely do.
 */
export function splitTitle(full: string): { title: string; company: string | null } {
  const clean = cleanInline(full)
  const i = clean.lastIndexOf(" at ")
  if (i <= 0) return { title: clean, company: null }
  const title = clean.slice(0, i).trim()
  const company = clean.slice(i + 4).trim()
  if (!title || !company) return { title: clean, company: null }
  return { title, company }
}

// ---------------------------------------------------------------------------
// Record mapping
// ---------------------------------------------------------------------------

const JOB_PATH_RE = /^\/jobs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/

/** The job slug from a remoteimpact.org job URL, or null for anything else. */
export function slugFromUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (host !== "remoteimpact.org" && host !== "www.remoteimpact.org") return null
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  const m = url.pathname.match(JOB_PATH_RE)
  if (!m || m[1] === "category") return null
  return m[1]!.length <= 300 ? m[1]! : null
}

export function jobUrl(slug: string): string {
  return `${ORIGIN}/jobs/${slug}/`
}

/** RFC 822 pubDate -> Date, or null when absent or unparseable. */
export function parsePubDate(raw: string | null | undefined): Date | null {
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

export interface Job {
  id: string
  title: string
  company: string | null
  location: string
  remote: true
  date: string | null
  published: string | null
  url: string
  categories: string[]
  description: string | null
  descriptionTruncated: boolean
  source: string
}

/**
 * Map one feed item. Every field is always present - `null` (or `[]`) rather
 * than omitted. Returns null for an item with no usable job link or title, so
 * the caller skips it instead of emitting a half-record.
 */
export function toJob(item: FeedItem, categories: string[] = []): Job | null {
  const id = slugFromUrl(item.link) ?? slugFromUrl(item.guid)
  if (!id || !item.title) return null
  const { title, company } = splitTitle(item.title)
  if (!title) return null
  const published = parsePubDate(item.pubDate)
  // Code points, not UTF-16 units: the cut is made on characters.
  const truncated = item.descriptionHtml ? [...item.descriptionHtml].length >= FEED_EXCERPT_CHARS : false
  const text = htmlToText(item.descriptionHtml)
  return {
    id,
    title,
    company,
    // The board lists remote roles only and the feed carries no region, so a
    // region lock (US-only, one country, a time zone) shows up only in the
    // title or description.
    location: "Remote",
    remote: true,
    date: published ? published.toISOString().slice(0, 10) : null,
    published: published ? published.toISOString() : null,
    url: jobUrl(id),
    categories: [...categories],
    description: text && truncated ? `${text} …` : text,
    descriptionTruncated: truncated,
    source: "remoteimpact.org",
  }
}

/**
 * Merge items from several feeds: one record per job id, categories unioned,
 * newest first (undated items last). The same job often sits in several
 * category feeds at once.
 */
export function mergeFeeds(feeds: Array<{ category?: string; items: FeedItem[] }>): Job[] {
  const byId = new Map<string, Job>()
  for (const feed of feeds) {
    for (const item of feed.items) {
      const job = toJob(item, feed.category ? [feed.category] : [])
      if (!job) continue
      const seen = byId.get(job.id)
      if (!seen) {
        byId.set(job.id, job)
      } else if (feed.category && !seen.categories.includes(feed.category)) {
        seen.categories.push(feed.category)
      }
    }
  }
  return [...byId.values()].sort((a, b) => {
    if (a.published === b.published) return 0
    if (a.published === null) return 1
    if (b.published === null) return -1
    return a.published < b.published ? 1 : -1
  })
}

// ---------------------------------------------------------------------------
// Client-side filters
// ---------------------------------------------------------------------------

/** Lower-case and strip accents, so "cafe" finds "café" and "IA" finds "ia". */
export function normalize(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase()
}

/**
 * Split a query into terms. A "quoted phrase" stays one term; everything else
 * splits on whitespace.
 */
export function parseQuery(q: string): string[] {
  const terms: string[] = []
  for (const m of q.matchAll(/"([^"]+)"|(\S+)/g)) {
    const term = normalize((m[1] ?? m[2] ?? "").trim())
    if (term) terms.push(term)
  }
  return terms
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Terms match at the start of a word, so "engineer" finds "engineering". A
 * term of three characters or fewer must match a whole word, so "AI" does not
 * find "aid" and "ML" does not find "html".
 */
export function termMatcher(term: string): RegExp {
  const body = escapeRe(term).replace(/\s+/g, "\\s+")
  const tail = term.length <= 3 ? "(?![\\p{L}\\p{N}])" : ""
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}${tail}`, "u")
}

/** Every term must match the title, organisation or description excerpt. */
export function matchesQuery(job: Job, terms: string[]): boolean {
  if (terms.length === 0) return true
  const haystack = normalize([job.title, job.company ?? "", job.description ?? ""].join("\n"))
  return terms.every((t) => termMatcher(t).test(haystack))
}

/** Keep jobs published within the last `days` days. Undated jobs cannot prove it, so they drop. */
export function withinDays(job: Job, days: number, nowMs = Date.now()): boolean {
  if (!job.published) return false
  return Date.parse(job.published) >= nowMs - days * 86_400_000
}

// ---------------------------------------------------------------------------
// detail input
// ---------------------------------------------------------------------------

/**
 * Accept a job slug from `search` or a remoteimpact.org job URL. Only the slug
 * is kept: `detail` looks it up in the feed, so a supplied URL never steers a
 * request anywhere.
 */
export function parseIdInput(input: string): string | null {
  const raw = input.trim()
  if (SLUG_RE.test(raw) && raw.length <= 300 && raw !== "category") return raw
  if (!/^https?:\/\//i.test(raw)) return null
  return slugFromUrl(raw)
}

export async function sleep(ms: number): Promise<void> {
  if (ms > 0) await new Promise((r) => setTimeout(r, ms))
}
