# Remote Impact — data source reference

Recorded during `/add-portal` Step 2 (2026-09-24). About ten requests in total:
`robots.txt`, `llms.txt`, the terms page, the sharing page, `/domains/`, the
site-wide feed, one category feed, one bogus category feed, and one feed request
with query parameters. No account, no session cookie, no impersonation.

## Data source: the public RSS feeds

| Feed | URL |
|---|---|
| Site-wide | `https://remoteimpact.org/feed/jobs/` |
| One category | `https://remoteimpact.org/feed/jobs/category/<slug>/` |

- `GET`, `Content-Type: application/rss+xml; charset=utf-8`, about 45 KB each.
- **Exactly 50 items per feed**, newest first. The site-wide feed spanned only
  16 hours at recon (23 Sep 16:27 to 24 Sep 08:47 UTC). The `ai-safety` feed
  spanned 10-23 Sep (2 weeks).
- **Query parameters are ignored.** `/feed/jobs/?page=2&category=ai-safety&q=engineer`
  returned the same 50 guids, in the same order, as `/feed/jobs/`. So there is no
  server-side search, filtering or pagination. Everything is done on the client.
- An unknown category slug returns **404 with an HTML "Page Not Found" page**,
  never an empty feed. The CLI maps this to `BAD_CATEGORY`.
- Headers: `last-modified` equals the channel's `lastBuildDate`, and
  `cf-cache-status: DYNAMIC` (Cloudflare, not cached). No rate-limit headers
  were seen.

### Structure

```xml
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
  <title>Remote Impact Jobs</title><link>https://remoteimpact.org/jobs/</link>
  <description>Latest remote jobs in climate, AI safety, global health &amp; social impact</description>
  <atom:link href="https://remoteimpact.org/feed/jobs/" rel="self"/>
  <language>en-us</language><lastBuildDate>Thu, 24 Sep 2026 08:47:19 +0000</lastBuildDate>
  <item>
    <title>Senior Entomologist at Colossal Biosciences</title>
    <link>https://remoteimpact.org/jobs/senior-entomologist-colossal-biosciences/</link>
    <description>&lt;p&gt;We are seeking a contract &lt;strong&gt;Senior Ento... (XML-escaped HTML, cut at 500 chars)</description>
    <pubDate>Thu, 24 Sep 2026 04:11:34 +0000</pubDate>
    <guid>https://remoteimpact.org/jobs/senior-entomologist-colossal-biosciences/</guid>
  </item>
  ...
</channel></rss>
```

No `<category>`, `<dc:*>`, `<content:encoded>` or `<media:*>` elements. The whole
feed is on one line, with no CDATA. The parser also accepts CDATA in case the
feed changes.

### Per-item fields

| RSS element | Maps to | Notes |
|---|---|---|
| `link` (= `guid`, identical on all 100 items seen) | `id`, `url` | `https://remoteimpact.org/jobs/<slug>/`. `id` is the slug (`[a-z0-9-]+`). Slugs are not always derived from the title (`job-at-khanacademy-khanacademy-11`), so treat them as opaque. |
| `title` | `title`, `company` | `"<role> at <organisation>"`, XML-escaped once (`&amp;`). Split on the **last** `" at "`. Titles are not truncated (up to 104 characters seen). Some have a double space before `at`. |
| `description` | `description`, `descriptionTruncated` | The HTML, XML-escaped, **cut at exactly 500 characters** of the unescaped HTML, counting edge whitespace. 96 of 99 distinct items were cut. The cut often falls inside a tag (`...&lt;/span&gt;&lt;`) or an entity. The CLI strips the dangling fragment, then the tags. Some descriptions are plain text with `<br>`, and some are Markdown (`## About Us`, `**bold**`). The site says descriptions are "enriched with AI". |
| `pubDate` | `date` (YYYY-MM-DD, UTC), `published` (ISO) | RFC 822 with `+0000`. This is when Remote Impact published the item, not necessarily the employer's posting date. |
| — | `location: "Remote"`, `remote: true` | The board lists remote roles only, and the feed has no region. |
| (feed it came from) | `categories` | Category slugs whose feed held the item. `[]` for the site-wide feed. |
| — | `source: "remoteimpact.org"` | Attribution (see Access). |

### Category slugs

From `https://remoteimpact.org/domains/` (33 slugs; 32 domain cards plus
`media-journalism` in the footer). `llms.txt` lists 19 of them with job counts,
for example `climate-environment` 2745, `global-health` 387, `energy` 385,
`ai-safety` 333, `education` 235, `animal-welfare` 153, `effective-altruism` 44,
`biosecurity` 44. The site total was 6,821 active roles.

```
advocacy-or-policy ai-safety animal-welfare biosecurity buildings capital
children-youth civic-engagement climate-environment coastal-ocean-sinks
communications community-development disability education effective-altruism
energy food-agriculture-land-use gender-equality-social-inclusion global-health
humanitarian human-rights impact-careers materials-manufacturing media-journalism
mental-health nonprofit-charity nuclear-security operations other
policy-advocacy poverty-development technology transportation
```

The list lives in `helpers.ts → KNOWN_CATEGORIES`, for help text only. The CLI
sends any well-formed slug and lets the server's 404 decide. Slugs are
shape-checked (`^[a-z0-9]+(-[a-z0-9]+)*$`) before they become a path segment.

## Search (client-side)

`search` fetches the site-wide feed, or one feed per `--category` slug
(sequentially, 1 s apart, max 5). It merges the items by `id` (unioning
`categories`), sorts them newest first, and then applies:

| CLI flag | Applied as |
|---|---|
| `-q` | Every term must match the normalised (NFKD, accents stripped, lower-case) title + organisation + description excerpt, at a word start. Terms of 3 characters or fewer must be whole words. `"phrases"` stay one term. |
| `--jobage N` | `published >= now - N days`. Undated items are dropped. |
| `--page`, `--limit` | Slice 20 per page, then cap. |
| `-l` | Refused (`UNSUPPORTED_FLAG`): the feed has no location. |

## Detail

There is no per-job feed. `detail <slug|url>` fetches the `--category` feeds
given (if any), then the site-wide feed, and stops at the first item whose slug
matches **exactly**. A URL is accepted only from `remoteimpact.org` /
`www.remoteimpact.org` with path `/jobs/<slug>/`, and only the slug is kept.
`NOT_FOUND` means the job is not among the newest 50 of any feed checked. It
does not mean the job has closed.

**Why not the job page.** Job pages (`/jobs/<slug>/`) are allowed by
`robots.txt`, and `llms.txt` says they carry schema.org `JobPosting` data. That
would give the full description, salary and apply link. But the terms say "Not
scrape", and only the feed is offered for reuse. So the CLI stays on the feed
and points the user to `url` for the full posting.

## Access

- **robots.txt** (`https://remoteimpact.org/robots.txt`): `User-agent: *`,
  `Allow: /`, `Disallow: /admin/ /accounts/ /api/ /checkout/`. Named AI crawlers
  (GPTBot, ClaudeBot, ...) get the same rules plus `Crawl-delay: 2`. Several SEO
  scrapers (Bytespider, CCBot, SemrushBot, AhrefsBot, ...) are blocked entirely.
  `/feed/` is allowed. **`/api/` is disallowed, and the CLI never calls it**
  (`llms.txt`: "API: Not currently public").
- **Terms of Service** (`https://remoteimpact.org/terms/`, "Last updated: February
  2026"), section 2: users agree to "Use the platform for legitimate job seeking
  or hiring purposes" and "Not scrape, spam, or abuse our platform". Section 6
  forbids copying or distributing "our platform" without permission.
- **Sharing page** (`https://remoteimpact.org/resources/remote-impact-jobs/`,
  linked from `llms.txt` as "Feeds, attribution guidance"). Under "Live RSS
  feed" it says the feed can be used in "a newsletter, Slack workflow,
  career-center page, or community digest", and asks: "Please keep the Remote
  Impact link and source attribution when republishing." It shows both
  `/feed/jobs/` and `/feed/jobs/category/climate-environment/`.
- **Verdict: open, feed only.** Reading the RSS feed that the board publishes
  for reuse, for one person's job search, is a legitimate job-seeking use and is
  not scraping the platform. The CLI keeps the attribution (`source`,
  `meta.source`, a footer line) and the Remote Impact links. It loads no HTML
  pages. It makes at most 6 requests per call, 1 s apart.
- **Login**: not required.
- **User-Agent**: `Mozilla/5.0 (compatible; remoteimpact-cli/1.0)`. Exponential
  backoff with jitter on 429/5xx (max 6 retries, 15 s per-attempt timeout). A
  404 returns `null` and becomes `BAD_CATEGORY` or `API_ERROR`.

## If it breaks

1. `PARSE_ERROR ... did not return an RSS feed`: fetch `/feed/jobs/` and check
   whether the feed moved. `llms.txt` and the sharing page both name the
   current feed URL.
2. Every result has `company: null`: the title format changed from
   `"<role> at <org>"`. Look at a raw `<title>` and update `splitTitle`.
3. `descriptionTruncated` is never true: the feed stopped cutting at 500
   characters (update `FEED_EXCERPT_CHARS`), or it now ships full text
   (`<content:encoded>`?), in which case read that element instead.
4. `BAD_CATEGORY` for a slug in `KNOWN_CATEGORIES`: the site renamed it. Re-read
   `/domains/`.
5. If the feed ever needs a key, or moves under `/api/`, stop. The open-access
   verdict above no longer holds.
