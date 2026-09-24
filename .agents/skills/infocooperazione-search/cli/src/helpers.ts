// Data source: Info Cooperazione (https://www.info-cooperazione.it), the
// Italian international-cooperation and NGO news site, "Lavoro" category.
//
// The site is server-rendered ASP.NET: the job list and every posting are plain
// HTML, so this CLI fetches the same pages a browser does, with an honest
// User-Agent, and parses them with regexes. The listing is split into one
// chunk per card and each chunk is parsed on its own, so one malformed card is
// skipped instead of breaking the page (the `parseJobCards` pattern from
// linkedin-search).
//
// Licence: the site states its content is released under Creative Commons
// (the linked deed is BY-NC-SA 4.0). Every record this CLI emits carries a
// `source` attribution, and the skill is for personal, non-commercial use.
// See ../url-reference.md for the endpoints, anchors and the exact wording.
//
// Zero runtime dependencies.

export const ORIGIN = "https://www.info-cooperazione.it"
export const SEARCH_PATH = "/Category/Search"
/** The "Lavoro" (jobs) category id on the site's search endpoint. */
export const JOBS_CATEGORY = "3"
export const PER_PAGE = 20

/** The citation the site asks for when its content is reused (its own wording). */
export const SOURCE =
  "www.info-cooperazione.it – La community italiana della Cooperazione Internazionale"
export const LICENSE = "CC BY-NC-SA 4.0"
export const LICENSE_URL = "https://creativecommons.org/licenses/by-nc-sa/4.0/deed.it"

const UA = "Mozilla/5.0 (compatible; infocooperazione-cli/1.0)"
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
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.5",
        ...(init.headers as Record<string, string> | undefined),
      },
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

/** GET a page as text. 404 -> null; any other non-2xx -> API_ERROR. */
export async function fetchPage(url: string): Promise<string | null> {
  const response = await fetchWithRetry(url)
  if (!response) return null
  if (!response.ok) {
    throw new CliError(`Request failed: ${response.status} ${response.statusText} (${url})`, "API_ERROR")
  }
  return response.text()
}

// ---------------------------------------------------------------------------
// Text cleaning
// ---------------------------------------------------------------------------

// Case-sensitive on purpose: &Egrave; and &egrave; are different letters, and
// Italian postings use both.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", shy: "",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", sbquo: "‚", bdquo: "„",
  laquo: "«", raquo: "»", ndash: "–", mdash: "—", hellip: "…", bull: "•", middot: "·",
  deg: "°", euro: "€", pound: "£", copy: "©", reg: "®", trade: "™", sect: "§", times: "×",
  agrave: "à", aacute: "á", acirc: "â", auml: "ä", egrave: "è", eacute: "é", ecirc: "ê", euml: "ë",
  igrave: "ì", iacute: "í", icirc: "î", iuml: "ï", ograve: "ò", oacute: "ó", ocirc: "ô", ouml: "ö",
  ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü", ccedil: "ç", ntilde: "ñ",
  Agrave: "À", Aacute: "Á", Egrave: "È", Eacute: "É", Igrave: "Ì", Iacute: "Í",
  Ograve: "Ò", Oacute: "Ó", Ugrave: "Ù", Uacute: "Ú", Ccedil: "Ç", Ntilde: "Ñ",
}

function codePoint(cp: number): string {
  return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => codePoint(parseInt(d, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => NAMED_ENTITIES[name] ?? m)
}

/**
 * Some bodies carry a mangled, double-encoded non-breaking space from a Word
 * paste ("&amp;n bsp;", which decodes to "&n bsp;"). It is never content.
 */
function dropMangledNbsp(s: string): string {
  return s.replace(/&n ?bsp;/g, " ")
}

/** Inline text: strip tags, decode entities, collapse all whitespace to one space. */
export function clean(raw: string | null | undefined): string {
  if (!raw) return ""
  return decodeEntities(raw.replace(/<[^>]+>/g, " "))
    .replace(/[\s\u00a0]+/g, " ")
    .trim()
}

/**
 * Posting bodies are pasted rich text (often from Word): paragraphs, lists,
 * spans full of data-* attributes, the odd table. Keep the structure readable
 * as text - paragraphs separated by a blank line, bullets as "- " lines - and
 * drop every tag. Entities are decoded after tags are gone, so an encoded
 * "&lt;b&gt;" in the text can never turn back into markup.
 */
export function htmlToText(raw: string | null | undefined): string | null {
  if (!raw) return null
  const text = dropMangledNbsp(decodeEntities(
    raw
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      // The source's own newlines are layout, not content.
      .replace(/[\r\n]+/g, " ")
      // Word pastes often wrap every bullet in its own list; merge adjacent
      // lists so the bullets stay together instead of a blank line apiece.
      .replace(/<\/(ul|ol)>\s*<(?:ul|ol)(\s[^>]*)?>/gi, "")
      .replace(/<\/li>/gi, "")
      .replace(/\s*<li(\s[^>]*)?>/gi, "\n- ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(td|th)>/gi, " ")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<\/(p|ul|ol|div|table|h[1-6])>/gi, "\n\n")
      .replace(/<[^>]+>/g, ""),
  ))
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const IT_MONTHS: Record<string, number> = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
}

function isoDate(y: number, m: number, d: number): string | null {
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return null // e.g. 31 settembre
  return dt.toISOString().slice(0, 10)
}

/** "07 ottobre 2026" / "7 Ottobre 2026" -> "2026-10-07"; anything else -> null. */
export function parseItalianDate(s: string | null | undefined): string | null {
  const m = (s ?? "").trim().match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})$/)
  if (!m) return null
  const month = IT_MONTHS[m[2]!.toLowerCase()]
  return month ? isoDate(Number(m[3]), month, Number(m[1])) : null
}

/** "08/09/2026" (dd/mm/yyyy, the Italian order) -> "2026-09-08"; else null. */
export function parseSlashDate(s: string | null | undefined): string | null {
  const m = (s ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return m ? isoDate(Number(m[3]), Number(m[2]), Number(m[1])) : null
}

// ---------------------------------------------------------------------------
// Posting ids and URLs
// ---------------------------------------------------------------------------

/**
 * A posting lives at /<year>/<month>/<slug>. That path (without the leading
 * slash) is the id: it is stable, unique, and rebuilds the URL on its own.
 */
const ID_RE = /^(\d{4})\/(\d{1,2})\/([A-Za-z0-9][A-Za-z0-9-]{0,200})$/

export function postingUrl(id: string): string {
  return `${ORIGIN}/${id}`
}

/** "2026/9/slug" -> "2026-09" (the publication month the site encodes in the path). */
export function monthFromId(id: string): string | null {
  const m = id.match(ID_RE)
  if (!m) return null
  const month = Number(m[2])
  return month >= 1 && month <= 12 ? `${m[1]}-${String(month).padStart(2, "0")}` : null
}

/**
 * Accept an id ("2026/9/slug", with or without a leading slash) or a posting
 * URL on info-cooperazione.it. Only the path is kept and the URL is rebuilt
 * from it, so a supplied URL can never steer the fetch to another host.
 */
export function parseIdInput(input: string): string | null {
  let raw = input.trim()
  if (/^https?:\/\//i.test(raw)) {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return null
    }
    const host = url.hostname.toLowerCase()
    if (host !== "www.info-cooperazione.it" && host !== "info-cooperazione.it") return null
    raw = url.pathname
  }
  raw = raw.replace(/^\/+/, "").replace(/\/+$/, "")
  const m = raw.match(ID_RE)
  return m ? `${m[1]}/${Number(m[2])}/${m[3]}` : null
}

// ---------------------------------------------------------------------------
// Search URL and the country list
// ---------------------------------------------------------------------------

export interface SearchUrlOpts {
  query: string
  page: number // 1-indexed, same as the site
  paeseId?: string
}

export function buildSearchUrl(opts: SearchUrlOpts): string {
  const params = new URLSearchParams({ Cat: JOBS_CATEGORY })
  if (opts.query) params.set("s", opts.query)
  if (opts.paeseId) params.set("paese_id", opts.paeseId)
  // Open postings only (deadline not passed) - the site's own default.
  params.set("lavoro_non_scaduti", "True")
  params.set("page", String(opts.page))
  return `${ORIGIN}${SEARCH_PATH}?${params.toString()}`
}

export interface Country {
  id: string
  name: string
}

/** The site's own country list: the <select name="paese_id"> in the search form. */
export function parseCountryOptions(html: string): Country[] {
  const select = html.match(/<select[^>]*name="paese_id"[^>]*>([\s\S]*?)<\/select>/i)
  if (!select) return []
  const out: Country[] = []
  for (const m of select[1]!.matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]*)</gi)) {
    const name = clean(m[2])
    if (name) out.push({ id: m[1]!, name })
  }
  return out
}

/** Case- and accent-insensitive key: "Perù" and "peru" compare equal. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

// The site's names are Italian. A few English spellings people will reach for.
const COUNTRY_ALIASES: Record<string, string> = {
  italy: "italia",
  "multiple countries": "piu paesi",
  "various countries": "piu paesi",
  "paesi vari": "piu paesi",
}

/** Exact (normalised) match on the site's country name; null if none. */
export function matchCountry(countries: Country[], input: string): Country | null {
  let key = normalizeName(input)
  key = COUNTRY_ALIASES[key] ?? key
  return countries.find((c) => normalizeName(c.name) === key) ?? null
}

/** Up to five names containing the input, for a helpful error message. */
export function suggestCountries(countries: Country[], input: string): string[] {
  const key = normalizeName(input).slice(0, 4)
  if (!key) return []
  return countries.filter((c) => normalizeName(c.name).includes(key)).slice(0, 5).map((c) => c.name)
}

/**
 * Resolve `--location` to the site's paese_id. A number is used as-is; a name
 * is looked up in the country list the search form itself offers (one extra
 * request), so the CLI follows the site rather than a copied table.
 */
export async function resolveCountry(input: string): Promise<Country> {
  const raw = input.trim()
  if (/^\d{1,4}$/.test(raw)) return { id: raw, name: raw }
  const html = await fetchPage(`${ORIGIN}${SEARCH_PATH}?Cat=${JOBS_CATEGORY}`)
  const countries = html ? parseCountryOptions(html) : []
  if (countries.length === 0) {
    throw new CliError(
      "Could not read the site's country list from the search form - the page has changed; see url-reference.md",
      "PARSE_ERROR",
    )
  }
  const hit = matchCountry(countries, raw)
  if (hit) return hit
  const near = suggestCountries(countries, raw)
  throw new CliError(
    `Unknown country "${raw}". Use the site's Italian name (e.g. "Italia", "Kenya", "Libano", "Più paesi")` +
      (near.length ? `; did you mean: ${near.join(", ")}?` : ""),
    "BAD_ARG",
  )
}

// ---------------------------------------------------------------------------
// Listing cards
// ---------------------------------------------------------------------------

export interface JobCard {
  id: string
  title: string
  headline: string
  roleCategory: string | null
  company: string | null
  location: string | null
  date: string | null
  publishedMonth: string | null
  deadline: string | null
  contractType: string | null
  duration: string | null
  summary: string | null
  url: string
  source: string
}

const CARD_MARKER = /<div class="post-block-wrapper post-list-view[^"]*">/i

/** The last segment of "ORG - Role - Place" is the place. */
function placeFromHeadline(headline: string): string | null {
  const parts = headline.split(" - ")
  return parts.length >= 3 ? parts[parts.length - 1]!.trim() || null : null
}

/**
 * Every headline is "ORG - Role - Place", and the role itself may contain
 * " - " ("Head of Programmes - Roster Various Countries"). Drop the known
 * organisation prefix (or the first segment) and the last segment.
 */
export function roleFromHeadline(headline: string, company: string | null): string | null {
  let rest = headline
  const prefix = company ? `${company} - `.toLowerCase() : null
  if (prefix && rest.toLowerCase().startsWith(prefix)) {
    rest = rest.slice(prefix.length)
  } else {
    const first = rest.indexOf(" - ")
    if (first < 0) return null
    rest = rest.slice(first + 3)
  }
  const last = rest.lastIndexOf(" - ")
  if (last > 0) rest = rest.slice(0, last)
  return rest.trim() || null
}

/**
 * The first sentence of every card summary is generated by the site:
 * "<ORG> sta selezionando un/a <Role> ... Durata 6 mesi. Tipo contratto:
 * Stage/Tirocinio Scadenza candidature 07/10/2026". Pull the structured bits.
 */
export function parseSummaryFacts(summary: string): {
  duration: string | null
  contractType: string | null
  deadline: string | null
} {
  const dur = summary.match(/\bDurata\s+(.{1,40}?)\.\s+Tipo contratto/i)
  const duration = dur && /\d/.test(dur[1]!) ? dur[1]!.trim() : null
  const ct = summary.match(/Tipo contratto:\s*(.{1,60}?)\s+Scadenza candidature/i)
  const contractType = ct ? ct[1]!.trim() || null : null
  const dl = summary.match(/Scadenza candidature\s+(\d{1,2}\/\d{1,2}\/\d{4})/i)
  return { duration, contractType, deadline: dl ? parseSlashDate(dl[1]) : null }
}

/** One card chunk -> JobCard, or null if it has no usable link and title. */
export function parseCard(chunk: string): JobCard | null {
  const link = chunk.match(/class="post-title[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
  if (!link) return null
  const id = parseIdInput(decodeEntities(link[1]!))
  const headline = clean(link[2])
  if (!id || !headline) return null

  const pos = chunk.match(/Posizione:\s*([\s\S]*?)<\/strong>/i)
  const position = pos ? clean(pos[1]) : ""

  const org = chunk.match(/href="[^"]*organizzazione_id=\d+"[^>]*>([\s\S]*?)<\/a>/i)
  const company = org ? clean(org[1]) || null : null

  const places = [...chunk.matchAll(/href="[^"]*paese_id=\d+"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => clean(m[1]))
    .filter(Boolean)
  const location = places.length ? [...new Set(places)].join("; ") : placeFromHeadline(headline)

  const sum = chunk.match(/<div class="righe-4">([\s\S]*?)<\/div>/i)
  const summary = sum ? clean(sum[1]) || null : null
  const facts = summary ? parseSummaryFacts(summary) : { duration: null, contractType: null, deadline: null }

  const scad = chunk.match(/Scadenza:\s*([^<]+)</i)
  const deadline = (scad ? parseItalianDate(clean(scad[1])) : null) ?? facts.deadline

  return {
    id,
    // "Posizione" is the site's standardised role tag ("Program Manager" is
    // tagged "Project Manager"), so the real title comes from the headline.
    title: roleFromHeadline(headline, company) ?? (position || headline),
    headline,
    roleCategory: position || null,
    company,
    location,
    // The listing carries no publication day; only `detail` has it.
    date: null,
    publishedMonth: monthFromId(id),
    deadline,
    contractType: facts.contractType,
    duration: facts.duration,
    summary,
    url: postingUrl(id),
    source: SOURCE,
  }
}

/**
 * Split the listing into one chunk per card and parse each on its own. The
 * page is cut at the pagination bar first, so the sidebar (news teasers) can
 * never be read as part of the last card.
 */
export function parseJobCards(html: string): JobCard[] {
  const end = html.search(/<nav[^>]*pagination-wrapper/i)
  const body = end >= 0 ? html.slice(0, end) : html
  const chunks = body.split(CARD_MARKER).slice(1)
  const cards: JobCard[] = []
  const seen = new Set<string>()
  for (const chunk of chunks) {
    let card: JobCard | null = null
    try {
      card = parseCard(chunk)
    } catch {
      card = null
    }
    if (card && !seen.has(card.id)) {
      seen.add(card.id)
      cards.push(card)
    }
  }
  return cards
}

/** True when the pagination bar offers a "Next" link. */
export function hasNextPage(html: string): boolean {
  return /<a[^>]*class="page-link"[^>]*aria-label="Next"/i.test(html)
}

/**
 * `--jobage` at the precision the listing allows. Cards carry only the
 * publication month (from the URL path), so keep a card when its month is on
 * or after the month the window starts in. This never drops a posting inside
 * the window; it can keep ones up to a month older.
 */
export function withinJobage(card: Pick<JobCard, "publishedMonth">, jobage: number, nowMs = Date.now()): boolean {
  if (!card.publishedMonth) return true
  const start = new Date(nowMs - jobage * 86400_000).toISOString().slice(0, 7)
  return card.publishedMonth >= start
}

// ---------------------------------------------------------------------------
// Detail page
// ---------------------------------------------------------------------------

export interface JobDetail extends Omit<JobCard, "summary"> {
  applyUrl: string | null
  description: string | null
  license: string
  licenseUrl: string
}

/**
 * Return the inner HTML of the first <div> whose opening tag matches `open`,
 * balancing nested divs - posting bodies are pasted rich text and may nest.
 */
export function extractDiv(html: string, open: RegExp): string | null {
  const start = html.search(open)
  if (start < 0) return null
  const tagEnd = html.indexOf(">", start)
  if (tagEnd < 0) return null
  const re = /<div\b[^>]*>|<\/div\s*>/gi
  re.lastIndex = tagEnd + 1
  let depth = 1
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0][1] === "/" ? -1 : 1
    if (depth === 0) return html.slice(tagEnd + 1, m.index)
  }
  return null
}

export function parseDetail(html: string, id: string): JobDetail | null {
  const h2 = html.match(/<div class="post-body[^"]*">\s*<h2[^>]*>([\s\S]*?)<\/h2>/i)
  const ogTitle = html.match(/<meta property="og:title" content="([^"]*)"/i)
  const headline = clean(h2?.[1]) || clean(ogTitle?.[1])
  if (!headline) return null

  const header = extractDiv(html, /<div class="post-header[^"]*">/i) ?? ""

  const pos = header.match(/Posizione:\s*([\s\S]*?)<\/strong>/i)
  const position = pos ? clean(pos[1]) : ""

  // `<b(\s...)?>`, not `<b[^>]*>`, which would also match the `<br />` before it.
  const org = header.match(/<b(?:\s[^>]*)?>([\s\S]*?)<\/b>/i)
  const company = org ? clean(org[1]) || null : null

  const loc = header.match(/fa-map-marker[^>]*><\/i>([\s\S]*?)<\/small>/i)
  const location = (loc ? clean(loc[1]) || null : null) ?? placeFromHeadline(headline)

  const pub = header.match(/class="post-category[^"]*">\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*</i)
  const date = pub ? parseSlashDate(pub[1]) : null

  const scad = header.match(/Scadenza:\s*([^<]+)</i)
  const bodyHtml = extractDiv(html, /<div class="entry-content[^"]*">/i)
  const description = htmlToText(bodyHtml)
  const facts = parseSummaryFacts(clean(bodyHtml?.slice(0, 2000)))
  const deadline = (scad ? parseItalianDate(clean(scad[1])) : null) ?? facts.deadline

  const apply = html.match(/<a[^>]*href="([^"]+)"[^>]*>(?:(?!<\/a>)[\s\S])*?LINK ALLA VACANCY/i)
  const applyHref = apply ? decodeEntities(apply[1]!).trim() : ""
  const applyUrl = /^(https?:|mailto:)/i.test(applyHref) ? applyHref : null

  return {
    id,
    title: roleFromHeadline(headline, company) ?? (position || headline),
    headline,
    roleCategory: position || null,
    company,
    location,
    date,
    publishedMonth: date ? date.slice(0, 7) : monthFromId(id),
    deadline,
    contractType: facts.contractType,
    duration: facts.duration,
    url: postingUrl(id),
    applyUrl,
    description,
    source: SOURCE,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
  }
}
