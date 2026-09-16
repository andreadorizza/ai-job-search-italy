// Source-agnostic reader for schema.org/JobPosting JSON-LD.
//
// This is the reusable core of every markup-based portal skill in this fork.
// JobPosting markup exists so that job aggregators can machine-read postings -
// it is what Google for Jobs consumes - which makes it both a legitimate target
// and a far more stable one than CSS selectors: a site redesign rarely breaks
// it, because breaking it costs the site its Google for Jobs traffic.
//
// Nothing in this file knows about any particular portal. A sibling skill should
// import it rather than copy it, so a schema fix lands once.

/** Salary as published. Italian postings quote RAL, i.e. gross annual EUR. */
export interface Salary {
  currency: string | null
  min: number | null
  max: number | null
  /** "YEAR" | "MONTH" | "HOUR" | ... as the site declares it. */
  unit: string | null
}

export interface JobPosting {
  title: string
  company: string | null
  companyUrl: string | null
  location: string | null
  /** ISO date from datePosted. */
  date: string | null
  /** ISO date from validThrough - a real application deadline. */
  deadline: string | null
  employmentType: string | null
  industry: string | null
  salary: Salary | null
  description: string | null
  identifier: string | null
}

const SCRIPT_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

/**
 * Pull every JSON-LD object out of a page, however it is nested.
 *
 * JSON-LD in the wild is routinely malformed, duplicated, or wrapped in an
 * unexpected container, so every layer here is defensive: one unparseable block
 * must never cost us the rest of the page.
 */
export function extractLdJson(html: string): unknown[] {
  const out: unknown[] = []
  for (const match of html.matchAll(SCRIPT_RE)) {
    const raw = match[1]
    if (!raw) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.trim())
    } catch {
      continue // malformed block - skip it, keep the others
    }
    walk(parsed, out)
  }
  return out
}

function walk(node: unknown, out: unknown[], depth = 0): void {
  if (depth > 6 || node === null || typeof node !== "object") return
  if (Array.isArray(node)) {
    for (const item of node) walk(item, out, depth + 1)
    return
  }
  out.push(node)
  const graph = (node as Record<string, unknown>)["@graph"]
  if (graph) walk(graph, out, depth + 1)
}

function isType(node: unknown, type: string): boolean {
  if (node === null || typeof node !== "object") return false
  const t = (node as Record<string, unknown>)["@type"]
  return Array.isArray(t) ? t.includes(type) : t === type
}

/** Every JobPosting object on the page, in document order. */
export function findJobPostings(html: string): Record<string, unknown>[] {
  return extractLdJson(html).filter((n) => isType(n, "JobPosting")) as Record<string, unknown>[]
}

function str(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null
  if (typeof v === "number") return String(v)
  return null
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.-]/g, ""))
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Day-first date, as Italian sites write it: 16/09/2026 or 16-09-2026. */
const IT_DATE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/

/**
 * Dates that cannot be a real job posting. Sites emit epoch-zero values for
 * "no deadline" surprisingly often - Gi Group publishes `validThrough:
 * "1970-04-01"` - and surfacing that as a deadline would mark every vacancy
 * long expired.
 */
const EARLIEST_PLAUSIBLE = Date.UTC(2000, 0, 1)

/**
 * Normalize a schema.org date to YYYY-MM-DD.
 *
 * The spec says ISO 8601, but Italian sites routinely publish day-first
 * dd/mm/yyyy instead, and `Date.parse` reads a slash format as **American
 * month-first**: "01/12/2026" would silently become 12 January rather than
 * 1 December. A wrong date is worse than a missing one - it misreports
 * deadlines and corrupts --jobage filtering - so day-first input is matched
 * explicitly and never handed to Date.parse.
 */
export function isoDate(v: unknown): string | null {
  const s = str(v)
  if (!s) return null

  let ms: number
  const m = IT_DATE.exec(s)
  if (m) {
    const [, day, month, year] = m
    ms = Date.UTC(Number(year), Number(month) - 1, Number(day))
    // Date.UTC rolls 32/13 over into the next month/year instead of failing.
    const d = new Date(ms)
    if (d.getUTCDate() !== Number(day) || d.getUTCMonth() !== Number(month) - 1) return null
  } else {
    ms = Date.parse(s)
  }

  if (Number.isNaN(ms) || ms < EARLIEST_PLAUSIBLE) return null
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Strip markup and decode entities. Descriptions are HTML far more often than
 * the spec suggests, and an unstripped one poisons the whole text layer.
 */
export function cleanText(raw: unknown): string | null {
  const s = str(raw)
  if (!s) return null
  const text = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => cp(parseInt(d, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, h) => cp(parseInt(h, 16)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

function cp(n: number): string {
  return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ""
}

/** "Milano, Lombardia" from a jobLocation, however deeply it is wrapped. */
export function formatLocation(node: unknown): string | null {
  const places = Array.isArray(node) ? node : [node]
  const parts: string[] = []
  for (const place of places) {
    if (place === null || typeof place !== "object") continue
    const addr = (place as Record<string, unknown>)["address"]
    if (addr === null || typeof addr !== "object") continue
    const a = addr as Record<string, unknown>
    const bits = [str(a["addressLocality"]), str(a["addressRegion"])].filter(Boolean) as string[]
    if (bits.length) parts.push(bits.join(", "))
  }
  const unique = parts.filter((v, i, arr) => arr.indexOf(v) === i)
  return unique.length ? unique.join("; ") : null
}

export function parseSalary(node: unknown): Salary | null {
  if (node === null || typeof node !== "object") return null
  const b = node as Record<string, unknown>
  const value = b["value"]
  const v = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const min = num(v["minValue"]) ?? num(v["value"]) ?? num(b["minValue"])
  const max = num(v["maxValue"]) ?? num(v["value"]) ?? num(b["maxValue"])
  const currency = str(b["currency"]) ?? str(b["salaryCurrency"])
  const unit = str(v["unitText"]) ?? str(b["unitText"])
  if (min === null && max === null) return null
  return { currency, min, max, unit }
}

function joinType(v: unknown): string | null {
  if (Array.isArray(v)) {
    const parts = v.map(str).filter(Boolean) as string[]
    return parts.length ? parts.join(", ") : null
  }
  return str(v)
}

/**
 * Map one JobPosting object onto the shape the rest of the framework expects.
 * Every field is always present - `null` rather than omitted - so a consumer
 * never has to tell "absent" from "unknown".
 */
export function toJobPosting(node: Record<string, unknown>): JobPosting | null {
  const title = cleanText(node["title"]) ?? cleanText(node["name"])
  if (!title) return null

  const org = node["hiringOrganization"]
  const orgObj = org !== null && typeof org === "object" ? (org as Record<string, unknown>) : {}

  // Some sites split the prose across description/responsibilities/qualifications.
  const description = [node["description"], node["responsibilities"], node["qualifications"]]
    .map(cleanText)
    .filter(Boolean)
    .join("\n\n") || null

  return {
    title,
    company: cleanText(orgObj["name"]),
    companyUrl: str(orgObj["sameAs"]) ?? str(orgObj["url"]),
    location: formatLocation(node["jobLocation"]),
    date: isoDate(node["datePosted"]),
    deadline: isoDate(node["validThrough"]),
    employmentType: joinType(node["employmentType"]),
    industry: joinType(node["industry"]),
    salary: parseSalary(node["baseSalary"]),
    description,
    identifier: readIdentifier(node["identifier"]),
  }
}

function readIdentifier(v: unknown): string | null {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return str((v as Record<string, unknown>)["value"]) ?? str((v as Record<string, unknown>)["name"])
  }
  return str(v)
}

/** Convenience: the first usable JobPosting on a page, or null. */
export function readJobPosting(html: string): JobPosting | null {
  for (const node of findJobPostings(html)) {
    const posting = toJobPosting(node)
    if (posting) return posting
  }
  return null
}
