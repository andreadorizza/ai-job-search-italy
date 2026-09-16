// Randstad Italia adapter. Everything portal-specific lives here; the actual
// vacancy data is read by the source-agnostic extractor in ./jobposting.ts.
//
// robots.txt permits /offerte-lavoro/. No credentials, no impersonation.

import { readJobPosting, type JobPosting } from "./jobposting.js"

export const BASE_URL = "https://www.randstad.it"
export const SEARCH_PATH = "/offerte-lavoro"

const UA = "Mozilla/5.0 (compatible; randstad-search-cli/1.0)"
const TIMEOUT_MS = 15000

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** A vacancy URL: /offerte-lavoro/<title-slug>_<city-slug>_<uuid>/ */
export const DETAIL_RE =
  /\/offerte-lavoro\/[a-z0-9-]+_[a-z0-9-]+_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//g

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export interface SearchUrlOpts {
  query?: string
  location?: string
  page?: number
}

/**
 * Randstad is a Next.js app whose filters are **path segments**, not query
 * parameters: `?q=` and `?keywords=` are silently ignored and return the
 * national listing. The real vocabulary is `<location>/q-<slug>/page-<n>/`.
 */
export function buildSearchUrl(opts: SearchUrlOpts): string {
  const segments: string[] = []
  if (opts.location) segments.push(slugify(opts.location))
  if (opts.query) segments.push(`q-${slugify(opts.query)}`)
  if (opts.page && opts.page > 1) segments.push(`page-${opts.page}`)
  const path = segments.length ? `${SEARCH_PATH}/${segments.join("/")}/` : `${SEARCH_PATH}/`
  return `${BASE_URL}${path}`
}

/** Unique vacancy URLs on a listing page, in document order. */
export function extractDetailUrls(html: string): string[] {
  const seen = new Set<string>()
  for (const m of html.matchAll(DETAIL_RE)) {
    const path = m[0]
    if (path) seen.add(`${BASE_URL}${path}`)
  }
  return [...seen]
}

/**
 * The canonical URL Randstad renders reflects the filters it *actually*
 * applied, in its internal vocabulary: `re-lombardia`, `ci-milano`, `q-...`.
 *
 * This matters more than it looks. An unrecognised location (`zzz-not-a-region`)
 * returns **HTTP 200 with the unfiltered national listing** - a silent widening
 * that would hand back thousands of irrelevant jobs as if they matched. Reading
 * the canonical lets us catch that with no extra request.
 */
export function readCanonical(html: string): string | null {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
  return m?.[1] ?? null
}

export function canonicalHasLocation(canonical: string | null): boolean {
  return canonical !== null && /\/(re|ci|pr)-[^/]+/.test(canonical)
}

export function canonicalHasQuery(canonical: string | null): boolean {
  return canonical !== null && /\/q-[^/]+/.test(canonical)
}

/** Total result count, rendered in the page heading ("2680 offerte di lavoro"). */
export function readTotal(html: string): number | null {
  const m = html.match(/<h1[^>]*>\s*([\d.  ]+)\s*offerte/i)
  if (!m?.[1]) return null
  const n = Number(m[1].replace(/[^\d]/g, ""))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** GET with exponential backoff + jitter on 429/5xx, honest UA, hard timeout. */
export async function fetchHtml(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
      },
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
    if (response.status === 404) return ""
    if (!response.ok) throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

/** The vacancy id is the trailing UUID of its URL. */
export function idFromUrl(url: string): string | null {
  const m = url.match(/_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/)
  return m?.[1] ?? null
}

/**
 * Accept a bare UUID or a randstad.it vacancy URL. Only that host and only that
 * path shape: the id is re-extracted and the request URL rebuilt from the page
 * we found it on, so a supplied URL can never steer the fetch elsewhere.
 */
export function parseDetailInput(input: string): { url: string; id: string } | null {
  const raw = input.trim()
  if (!raw) return null

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    // A bare id cannot be turned into a URL - the slug is part of the path.
    return null
  }
  if (!/^https?:\/\//i.test(raw)) return null

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  const host = url.hostname.toLowerCase()
  if (host !== "randstad.it" && !host.endsWith(".randstad.it")) return null

  const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`
  const matches = [...path.matchAll(DETAIL_RE)]
  if (matches.length !== 1 || matches[0]![0] !== path) return null

  const id = idFromUrl(path)
  return id ? { url: `${BASE_URL}${path}`, id } : null
}

export interface JobCard extends JobPosting {
  id: string
  url: string
}

/** Read one vacancy page. Returns null when it carries no usable JobPosting. */
export function parseDetailPage(html: string, url: string): JobCard | null {
  const posting = readJobPosting(html)
  if (!posting) return null
  const id = posting.identifier ?? idFromUrl(url)
  if (!id) return null
  return { ...posting, id, url }
}
