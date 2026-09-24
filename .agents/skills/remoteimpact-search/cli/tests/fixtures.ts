// Shared offline fixtures, shaped like the real feed at
// https://remoteimpact.org/feed/jobs/ (recorded 2026-09-24): RSS 2.0, the
// description is XML-escaped HTML cut at 500 characters, titles read
// "<role> at <organisation>".

import { settings } from "../src/helpers.js"

settings.politeDelayMs = 0

export const NOW_MS = Date.parse("2026-09-24T12:00:00Z")

export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** 500 characters of HTML, cut inside a tag like the real feed does. */
export const LONG_HTML = (
  '<div><p><span style="font-weight:bold;">Senior ML Engineer (Remote, EU time zones)</span></p>' +
  "<ul>\n<li>Build evaluation pipelines for frontier models &amp; agents.</li>\n<li>Own our PyTorch training stack.</li>\n</ul>" +
  "<p>" +
  "We are a non-profit working on AI safety. ".repeat(12) +
  "</p><p><strong><span style=\"color:#121317;\">Status: Full-time</span></strong></p>"
).slice(0, 500)

export const MARKDOWN_DESC = "## About Us\n\nWe fund **open-source** climate tools & data.\n"

export interface ItemSpec {
  title: string
  slug: string
  pubDate: string
  description?: string
}

export function item(spec: ItemSpec): string {
  const link = `https://remoteimpact.org/jobs/${spec.slug}/`
  return (
    `<item><title>${xmlEscape(spec.title)}</title><link>${link}</link>` +
    `<description>${xmlEscape(spec.description ?? "")}</description>` +
    `<pubDate>${spec.pubDate}</pubDate><guid>${link}</guid></item>`
  )
}

export const ML_ITEM: ItemSpec = {
  title: "Senior Machine Learning Engineer at Far.Ai",
  slug: "senior-machine-learning-engineer-far-ai",
  pubDate: "Wed, 23 Sep 2026 13:22:25 +0000",
  description: LONG_HTML,
}

export const CLIMATE_ITEM: ItemSpec = {
  title: "Data Analyst, Land &amp; Power at Clean Data Co",
  slug: "data-analyst-land-power-clean-data-co",
  pubDate: "Tue, 22 Sep 2026 08:00:00 +0000",
  description: MARKDOWN_DESC,
}

export const OLD_ITEM: ItemSpec = {
  title: "Programme Manager at Old Foundation",
  slug: "programme-manager-old-foundation",
  pubDate: "Mon, 24 Aug 2026 09:00:00 +0000",
  description: "<p>Grants programme.</p>",
}

export function feedXml(items: ItemSpec[], extra = ""): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>' +
    "<title>Remote Impact Jobs</title><link>https://remoteimpact.org/jobs/</link>" +
    "<description>Latest remote jobs</description><language>en-us</language>" +
    items.map(item).join("") +
    extra +
    "</channel></rss>"
  )
}

export const FEED = feedXml([ML_ITEM, CLIMATE_ITEM, OLD_ITEM])

export function rss(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "application/rss+xml; charset=utf-8" } })
}

type Route = (url: string, init?: RequestInit) => Response

/**
 * Stub fetch: `routes` maps a URL (exact) to a response; anything else gets
 * the default feed. Records every call so tests can inspect what was sent.
 */
export function stubFeeds(routes: Record<string, Route> = {}, fallback: Route = () => rss(FEED)) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const route = routes[String(url)]
    return route ? route(String(url), init) : fallback(String(url), init)
  }) as unknown as typeof fetch
  return calls
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
