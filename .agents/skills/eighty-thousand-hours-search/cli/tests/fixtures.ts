// Shared offline fixtures. The app id and key are fake on purpose: no real
// key string is ever committed; the CLI reads the live one from the board page.

export const FAKE_APP_ID = "TESTAPP123"
export const FAKE_KEY = "0123456789abcdef0123456789abcdef"

export const BOARD_HTML = `<!DOCTYPE html><html><head></head><body><script>
window.__NUXT__={};window.__NUXT__.config={public:{apiBase:"https://backend.example/api",env:"prod",
algoliaApplicationId:"${FAKE_APP_ID}",algoliaApiKey:"${FAKE_KEY}",algoliaTagsIndex:"tags_prod",
algoliaJobsIndexAlternative:"jobs_prod_closing_date",algoliaJobsIndex:"jobs_prod",algoliaStrictIndex:"jobs_prod_strict"}}
</script></body></html>`

export const HIT = {
  objectID: "20437",
  post_pk: 20437,
  title: "Machine Learning Engineer",
  company_name: "Gray Swan",
  company_url: "https://www.grayswan.ai/",
  company_description: '<p><a href="https://www.grayswan.ai/">Gray Swan</a> is an AI security company.</p>',
  card_locations: ["Pittsburgh, PA", "Remote, Global"],
  tags_location_80k: ["Pittsburgh, PA", "Remote, Global", "USA"],
  tags_location_type: ["Remote"],
  tags_area: ["AI safety & policy"],
  tags_skill: ["Research", "Software engineering"],
  tags_role_type: ["Full-time"],
  tags_exp_required: ["Mid (5-9 years experience)"],
  tags_degree_required: ["Undergraduate degree or less"],
  posted_at: 1785715200, // 2026-08-03
  updated_at: 1790227938,
  closes_at: null,
  url_external: "https://jobs.example/gray-swan/ml-engineer",
  salary: "$160,000 - $257,000",
  description: "",
  description_short:
    "<ul>\n<li>Design and deploy ML models &amp; evals.</li>\n<li>Lead adversarial testing.</li>\n</ul>",
}

export const SEARCH_RESPONSE = { nbHits: 61, nbPages: 4, page: 0, hitsPerPage: 20, hits: [HIT] }

type Route = (url: string, init?: RequestInit) => Response

/**
 * Route stubbed fetches: the board page gets `html`, the search index gets
 * `algolia`. Records every call so tests can inspect what was sent.
 */
export function stubBoard(opts: { html?: Route; algolia?: Route } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const html: Route = opts.html ?? (() => new Response(BOARD_HTML, { status: 200 }))
  const algolia: Route = opts.algolia ?? (() => json(SEARCH_RESPONSE))
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return String(url).includes(".algolia.net/") ? algolia(String(url), init) : html(String(url), init)
  }) as unknown as typeof fetch
  return calls
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
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
