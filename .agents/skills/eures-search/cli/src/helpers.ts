// Data source: EURES, the European Commission / European Labour Authority job
// mobility portal. Its public search API needs no key, no account and no
// browser impersonation - it is a plain JSON POST endpoint that the portal's
// own SPA calls, and robots.txt permits it.
//
// Zero runtime dependencies: responses are JSON, so there is nothing to parse
// out of HTML.

export const API_BASE = "https://europa.eu/eures/api"
export const SEARCH_PATH = "/jv-searchengine/public/jv-search/search"
/** Public, human-readable vacancy page. Also the only URL `detail` accepts. */
export const PORTAL_DETAIL = "https://europa.eu/eures/portal/jv-se/jv-details"

const UA = "Mozilla/5.0 (compatible; eures-search-cli/1.0)"
const TIMEOUT_MS = 15000

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/**
 * NUTS-2 code -> Italian region name, so results carry a place a human
 * recognises instead of "ITC4". EURES returns NUTS-3 (e.g. ITC4C = Cremona),
 * and the first four characters are always its NUTS-2 parent, so a prefix
 * lookup covers every Italian code without enumerating all ~110 provinces.
 */
export const IT_NUTS2: Record<string, string> = {
  ITC1: "Piemonte",
  ITC2: "Valle d'Aosta",
  ITC3: "Liguria",
  ITC4: "Lombardia",
  ITH1: "Provincia Autonoma di Bolzano",
  ITH2: "Provincia Autonoma di Trento",
  ITH3: "Veneto",
  ITH4: "Friuli-Venezia Giulia",
  ITH5: "Emilia-Romagna",
  ITI1: "Toscana",
  ITI2: "Umbria",
  ITI3: "Marche",
  ITI4: "Lazio",
  ITF1: "Abruzzo",
  ITF2: "Molise",
  ITF3: "Campania",
  ITF4: "Puglia",
  ITF5: "Basilicata",
  ITF6: "Calabria",
  ITG1: "Sicilia",
  ITG2: "Sardegna",
}

/** Italian region name (lowercased, no accents/spaces) -> NUTS-2 code. */
const IT_REGION_TO_NUTS: Record<string, string> = Object.fromEntries(
  Object.entries(IT_NUTS2).map(([code, name]) => [normalizePlace(name), code]),
)

export function normalizePlace(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "")
}

/**
 * Turn a --location value into EURES `locationCodes`. Accepts a two-letter
 * country code ("it"), a NUTS code ("ITC4"), or an Italian region name
 * ("Lombardia", "Emilia-Romagna"), comma-separated. Anything unrecognised is
 * passed through verbatim rather than silently dropped - dropping a location
 * filter would widen the search instead of narrowing it.
 */
export function toLocationCodes(location: string): string[] {
  return location
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => IT_REGION_TO_NUTS[normalizePlace(part)] ?? part)
}

export function locationFromMap(
  locationMap: Record<string, string[]> | null | undefined,
): string | null {
  if (!locationMap) return null
  const parts: string[] = []
  for (const [country, codes] of Object.entries(locationMap)) {
    const named = (codes ?? [])
      .map((code) => IT_NUTS2[code.slice(0, 4).toUpperCase()] ?? code)
      .filter((v, i, a) => a.indexOf(v) === i)
    parts.push(named.length ? `${named.join(", ")} (${country})` : country)
  }
  return parts.length ? parts.join("; ") : null
}

/** EURES dates are epoch milliseconds. Emit YYYY-MM-DD, or null if unusable. */
export function toIsoDate(epochMs: number | null | undefined): string | null {
  if (typeof epochMs !== "number" || !Number.isFinite(epochMs)) return null
  const d = new Date(epochMs)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/**
 * Descriptions are usually plain text but some carry light HTML. Strip tags and
 * decode the handful of entities that appear, so the text layer stays readable.
 */
export function cleanText(raw: string | null | undefined): string | null {
  if (!raw) return null
  const text = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => codePoint(parseInt(d, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

function codePoint(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export interface SearchBodyOpts {
  query: string
  page: number
  perPage: number
  locationCodes: string[]
  sort: "MOST_RECENT" | "BEST_MATCH"
}

/**
 * The API validates the whole body as an enum-checked schema and answers a bare
 * `{"key":"invalid-json"}` on any mismatch, so every field it expects is sent
 * explicitly - including the empty arrays. `specificSearchCode` only accepts a
 * fixed set of values; EVERYWHERE is the one that searches title + description,
 * and is also what makes an id lookup work in `detail`.
 */
export function buildSearchBody(opts: SearchBodyOpts): Record<string, unknown> {
  return {
    resultsPerPage: opts.perPage,
    page: opts.page,
    sortSearch: opts.sort,
    keywords: [{ keyword: opts.query, specificSearchCode: "EVERYWHERE" }],
    publicationPeriod: null,
    occupationUris: [],
    skillUris: [],
    requiredExperienceCodes: [],
    positionScheduleCodes: [],
    sectorCodes: [],
    educationAndQualificationLevelCodes: [],
    positionOfferingCodes: [],
    locationCodes: opts.locationCodes,
    euresFlagCodes: [],
    otherBenefitsCodes: [],
    requiredLanguages: [],
    minNumberPost: null,
    sessionId: "eures-search-cli",
    requestLanguage: "en",
  }
}

export interface EuresRaw {
  id?: string
  title?: string
  description?: string
  creationDate?: number
  lastModificationDate?: number
  numberOfPosts?: number
  locationMap?: Record<string, string[]>
  positionOfferingCode?: string
  availableLanguages?: string[]
  employer?: { name?: string; website?: string | null } | null
}

export interface SearchResponse {
  numberRecords?: number
  jvs?: EuresRaw[]
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  companyUrl: string | null
  location: string | null
  date: string | null
  deadline: string | null
  url: string
  description: string | null
}

export interface JobDetail extends JobCard {
  lastModified: string | null
  numberOfPosts: number | null
  contractType: string | null
  languages: string[]
}

export function detailUrl(id: string): string {
  return `${PORTAL_DETAIL}/${encodeURIComponent(id)}?lang=en`
}

/**
 * EURES ids are base64 of "<number> <number>", so they contain a space and
 * sometimes padding. Accept a bare id or a portal URL, but only from europa.eu
 * and only from the vacancy-details path: the id is then re-extracted and the
 * request URL rebuilt from it, so a hostile URL cannot steer the fetch.
 */
export function parseIdInput(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  if (!/^https?:\/\//i.test(raw)) {
    return /^[A-Za-z0-9+/=\s_-]+$/.test(raw) ? raw : null
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  const host = url.hostname.toLowerCase()
  if (host !== "europa.eu" && !host.endsWith(".europa.eu")) return null
  const m = url.pathname.match(/\/eures\/portal\/jv-se\/jv-details\/([^/]+)\/?$/)
  if (!m) return null
  try {
    return decodeURIComponent(m[1]!)
  } catch {
    return null
  }
}

/**
 * POST JSON with exponential backoff + jitter on 429/5xx, capped retries and a
 * hard per-attempt timeout. An honest User-Agent, never a browser impersonation.
 */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
      },
      body: JSON.stringify(body),
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return (await response.json()) as T
  }
  throw new Error("Request failed after max retries")
}

/**
 * Map one raw vacancy. Every field is always present - `null` is emitted rather
 * than omitted, so a consumer never has to distinguish "absent" from "unknown".
 * Parsed per-record by the caller so one malformed vacancy cannot take out the
 * whole batch.
 */
export function toJobCard(raw: EuresRaw): JobCard | null {
  const id = typeof raw?.id === "string" ? raw.id : null
  const title = cleanText(raw?.title)
  if (!id || !title) return null
  return {
    id,
    title,
    company: cleanText(raw?.employer?.name ?? null),
    companyUrl: raw?.employer?.website ?? null,
    location: locationFromMap(raw?.locationMap),
    date: toIsoDate(raw?.creationDate),
    // EURES exposes no application deadline on the search record.
    deadline: null,
    url: detailUrl(id),
    description: cleanText(raw?.description),
  }
}

export function toJobDetail(raw: EuresRaw): JobDetail | null {
  const card = toJobCard(raw)
  if (!card) return null
  return {
    ...card,
    lastModified: toIsoDate(raw?.lastModificationDate),
    numberOfPosts: typeof raw?.numberOfPosts === "number" ? raw.numberOfPosts : null,
    contractType: raw?.positionOfferingCode ?? null,
    languages: Array.isArray(raw?.availableLanguages) ? raw.availableLanguages : [],
  }
}

/** Keep only vacancies created within the last `days` days. */
export function withinJobAge(cards: JobCard[], days: number): JobCard[] {
  if (!Number.isFinite(days) || days >= 9999) return cards
  const cutoff = Date.now() - days * 86400000
  return cards.filter((c) => {
    if (!c.date) return true
    const t = Date.parse(`${c.date}T00:00:00Z`)
    return Number.isNaN(t) ? true : t >= cutoff
  })
}
