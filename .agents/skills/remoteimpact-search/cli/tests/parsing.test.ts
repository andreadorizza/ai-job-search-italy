import { describe, expect, test } from "bun:test"
import {
  decodeEntities,
  feedUrl,
  htmlToText,
  matchesQuery,
  mergeFeeds,
  parseCategories,
  parseFeed,
  parseIdInput,
  parseQuery,
  slugFromUrl,
  splitTitle,
  toJob,
  withinDays,
  type Job,
} from "../src/helpers.js"
import { CLIMATE_ITEM, FEED, LONG_HTML, ML_ITEM, NOW_MS, OLD_ITEM, feedXml, item } from "./fixtures.js"

describe("parseFeed", () => {
  test("reads every item with its fields XML-unescaped", () => {
    const items = parseFeed(FEED)
    expect(items).toHaveLength(3)
    expect(items[0]!.title).toBe("Senior Machine Learning Engineer at Far.Ai")
    expect(items[0]!.link).toBe("https://remoteimpact.org/jobs/senior-machine-learning-engineer-far-ai/")
    expect(items[0]!.pubDate).toBe("Wed, 23 Sep 2026 13:22:25 +0000")
    expect(items[0]!.descriptionHtml).toBe(LONG_HTML)
  })

  test("a single-escaped ampersand in a title decodes once", () => {
    const xml = feedXml([]).replace(
      "</channel>",
      "<item><title>Associate of Land &amp; Power at CleanSpark</title><link>https://remoteimpact.org/jobs/a-b/</link></item></channel>",
    )
    expect(parseFeed(xml)[0]!.title).toBe("Associate of Land & Power at CleanSpark")
  })

  test("reads CDATA verbatim", () => {
    const xml = feedXml([]).replace(
      "</channel>",
      "<item><title><![CDATA[R&D Lead at Lab]]></title><link>https://remoteimpact.org/jobs/r-d-lead-lab/</link></item></channel>",
    )
    expect(parseFeed(xml)[0]!.title).toBe("R&D Lead at Lab")
  })

  test("one malformed item does not break the others", () => {
    const xml = feedXml([ML_ITEM], "<item><title>No link at All</title></item><item>garbage</item>")
    const jobs = mergeFeeds([{ items: parseFeed(xml) }])
    expect(jobs.map((j) => j.id)).toEqual(["senior-machine-learning-engineer-far-ai"])
  })

  test("a channel with no items is an empty list", () => {
    expect(parseFeed(feedXml([]))).toEqual([])
  })
})

describe("toJob", () => {
  const job = toJob(parseFeed(FEED)[0]!)!

  test("splits the title and maps every contract field", () => {
    expect(job.id).toBe("senior-machine-learning-engineer-far-ai")
    expect(job.title).toBe("Senior Machine Learning Engineer")
    expect(job.company).toBe("Far.Ai")
    expect(job.location).toBe("Remote")
    expect(job.remote).toBe(true)
    expect(job.date).toBe("2026-09-23")
    expect(job.published).toBe("2026-09-23T13:22:25.000Z")
    expect(job.url).toBe("https://remoteimpact.org/jobs/senior-machine-learning-engineer-far-ai/")
    expect(job.source).toBe("remoteimpact.org")
  })

  test("flags the 500-character excerpt as truncated and ends it with an ellipsis", () => {
    expect(job.descriptionTruncated).toBe(true)
    expect(job.description!.endsWith(" …")).toBe(true)
    expect(job.description).not.toMatch(/<|&[a-z#0-9]+;/i)
    expect(job.description).toContain("- Build evaluation pipelines for frontier models & agents.")
  })

  test("a short description is not flagged", () => {
    const j = toJob(parseFeed(FEED)[2]!)!
    expect(j.descriptionTruncated).toBe(false)
    expect(j.description).toBe("Grants programme.")
  })

  test("edge whitespace counts toward the 500-character cut", () => {
    const desc = "x".repeat(499) + "\n"
    const j = toJob(parseFeed(feedXml([{ ...OLD_ITEM, description: desc }]))[0]!)!
    expect(j.descriptionTruncated).toBe(true)
  })

  test("missing values are null, never omitted", () => {
    const xml = feedXml([]).replace(
      "</channel>",
      "<item><title>Researcher</title><link>https://remoteimpact.org/jobs/researcher/</link></item></channel>",
    )
    const j = toJob(parseFeed(xml)[0]!)!
    for (const key of ["company", "date", "published", "description"] as const) {
      expect(Object.hasOwn(j, key)).toBe(true)
      expect(j[key]).toBeNull()
    }
    expect(j.categories).toEqual([])
  })

  test("an item whose link is not a remoteimpact.org job page is skipped", () => {
    const xml = feedXml([]).replace(
      "</channel>",
      "<item><title>X at Y</title><link>https://evil.example/jobs/x-y/</link></item></channel>",
    )
    expect(toJob(parseFeed(xml)[0]!)).toBeNull()
  })
})

describe("splitTitle", () => {
  test("splits on the last ' at '", () => {
    expect(splitTitle("Head of Research at Scale at Big Org")).toEqual({ title: "Head of Research at Scale", company: "Big Org" })
  })

  test("collapses the feed's double spaces", () => {
    expect(splitTitle("Senior Manager, Channel Marketing  at Charge Point")).toEqual({
      title: "Senior Manager, Channel Marketing",
      company: "Charge Point",
    })
  })

  test("a title with no organisation keeps company null", () => {
    expect(splitTitle("Expressions of Interest")).toEqual({ title: "Expressions of Interest", company: null })
  })

  test("decodes an entity left in the title", () => {
    expect(splitTitle("Data Analyst, Land &amp; Power at Clean Data Co").title).toBe("Data Analyst, Land & Power")
  })
})

describe("htmlToText", () => {
  test("list items become '- ' lines and paragraphs stay apart", () => {
    expect(htmlToText("<p>Intro.</p><ul>\n<li>One</li>\n<li>Two</li>\n</ul><p>End.</p>")).toBe("Intro.\n\n- One\n- Two\n\nEnd.")
  })

  test("drops a tag cut off by the 500-character limit", () => {
    expect(htmlToText('<p>Status: External</p><p><strong><span style="color:#12')).toBe("Status: External")
  })

  test("drops an entity cut off by the limit", () => {
    expect(htmlToText("Land &amp; Power &am")).toBe("Land & Power")
  })

  test("strips Markdown heading and bold markers", () => {
    expect(htmlToText("## About Us\n\nWe fund **open-source** climate tools &amp; data.\n")).toBe(
      "About Us\n\nWe fund open-source climate tools & data.",
    )
  })

  test("<br> and non-breaking spaces become plain line breaks and spaces", () => {
    expect(htmlToText("Your mission<br>                IONITY&nbsp;is building.<br><br>Next")).toBe(
      "Your mission\nIONITY is building.\n\nNext",
    )
  })

  test("returns null for empty input", () => {
    expect(htmlToText("")).toBeNull()
    expect(htmlToText("<p> </p>")).toBeNull()
  })
})

describe("decodeEntities", () => {
  test("decodes named, decimal and hex references in one pass", () => {
    expect(decodeEntities("R&amp;D &ndash; you&#39;ll &#x2192; caf&eacute;")).toBe("R&D – you'll → café")
  })

  test("never double-decodes", () => {
    expect(decodeEntities("&amp;lt;")).toBe("&lt;")
  })

  test("leaves unknown entities untouched", () => {
    expect(decodeEntities("a &unknownthing; b")).toBe("a &unknownthing; b")
  })
})

describe("query matching", () => {
  const jobs = mergeFeeds([{ items: parseFeed(FEED) }])
  const find = (q: string) => jobs.filter((j) => matchesQuery(j, parseQuery(q))).map((j) => j.id)

  test("every term must match, case-insensitively, across title, organisation and description", () => {
    expect(find("machine learning")).toEqual(["senior-machine-learning-engineer-far-ai"])
    expect(find("far.ai pytorch")).toEqual(["senior-machine-learning-engineer-far-ai"])
    expect(find("machine climate")).toEqual([])
  })

  test("terms match at the start of a word", () => {
    expect(find("engineer")).toEqual(["senior-machine-learning-engineer-far-ai"])
    expect(find("gineer")).toEqual([])
  })

  test("short terms must be whole words, so AI does not match 'aid'", () => {
    const aid = { ...jobs[0]!, title: "Humanitarian aid officer", company: "X", description: null } as Job
    expect(matchesQuery(aid, parseQuery("AI"))).toBe(false)
    expect(matchesQuery(jobs[0]!, parseQuery("AI"))).toBe(true) // "Far.Ai", "AI safety"
  })

  test("quoted phrases stay together", () => {
    expect(parseQuery('"machine learning" remote')).toEqual(["machine learning", "remote"])
    expect(find('"learning machine"')).toEqual([])
  })

  test("accents are ignored", () => {
    const j = { ...jobs[0]!, title: "Responsable commercial Sécurité" } as Job
    expect(matchesQuery(j, parseQuery("securite"))).toBe(true)
  })

  test("an empty query matches everything", () => {
    expect(find("")).toHaveLength(3)
  })
})

describe("withinDays", () => {
  const jobs = mergeFeeds([{ items: parseFeed(FEED) }])

  test("keeps jobs published inside the window and drops older ones", () => {
    expect(jobs.filter((j) => withinDays(j, 7, NOW_MS)).map((j) => j.id)).toEqual([
      "senior-machine-learning-engineer-far-ai",
      "data-analyst-land-power-clean-data-co",
    ])
    expect(jobs.filter((j) => withinDays(j, 32, NOW_MS))).toHaveLength(3)
  })

  test("an undated job cannot prove it is recent and is dropped", () => {
    expect(withinDays({ ...jobs[0]!, published: null }, 30, NOW_MS)).toBe(false)
  })
})

describe("mergeFeeds", () => {
  test("one record per id, categories unioned, newest first", () => {
    const aiFeed = parseFeed(feedXml([ML_ITEM]))
    const techFeed = parseFeed(feedXml([OLD_ITEM, ML_ITEM]))
    const allFeed = parseFeed(feedXml([CLIMATE_ITEM]))
    const jobs = mergeFeeds([
      { category: "ai-safety", items: aiFeed },
      { category: "technology", items: techFeed },
      { items: allFeed },
    ])
    expect(jobs.map((j) => j.id)).toEqual([
      "senior-machine-learning-engineer-far-ai",
      "data-analyst-land-power-clean-data-co",
      "programme-manager-old-foundation",
    ])
    expect(jobs[0]!.categories).toEqual(["ai-safety", "technology"])
    expect(jobs[1]!.categories).toEqual([])
  })
})

describe("categories", () => {
  test("parses, lower-cases and de-duplicates a comma list", () => {
    expect(parseCategories("AI-Safety, technology,ai-safety")).toEqual(["ai-safety", "technology"])
  })

  test("rejects anything that is not a slug before it reaches a URL", () => {
    for (const bad of ["../api", "ai safety", "ai_safety", "a/b", "-x"]) {
      expect(() => parseCategories(bad)).toThrow()
    }
  })

  test("caps the number of feeds per run", () => {
    expect(() => parseCategories("a,b,c,d,e,f")).toThrow(/at most 5/)
  })

  test("builds the feed URLs", () => {
    expect(feedUrl()).toBe("https://remoteimpact.org/feed/jobs/")
    expect(feedUrl("ai-safety")).toBe("https://remoteimpact.org/feed/jobs/category/ai-safety/")
  })
})

describe("detail input", () => {
  test("accepts a slug", () => {
    expect(parseIdInput("job-at-farai-farai-22")).toBe("job-at-farai-farai-22")
  })

  test("accepts a job URL and keeps only its slug", () => {
    expect(parseIdInput("https://remoteimpact.org/jobs/job-at-farai-farai-22/")).toBe("job-at-farai-farai-22")
    expect(parseIdInput("https://www.remoteimpact.org/jobs/job-at-farai-farai-22")).toBe("job-at-farai-farai-22")
  })

  test("rejects other hosts, other paths and non-slugs", () => {
    for (const bad of [
      "https://evil.example/jobs/x/",
      "https://remoteimpact.org/api/jobs/x/",
      "https://remoteimpact.org/jobs/category/ai-safety/",
      "Some Title",
      "../x",
      "category",
    ]) {
      expect(parseIdInput(bad)).toBeNull()
    }
  })

  test("slugFromUrl ignores non-job pages", () => {
    expect(slugFromUrl("https://remoteimpact.org/jobs/")).toBeNull()
    expect(slugFromUrl(null)).toBeNull()
  })
})

// Guard the fixture itself: the item helper must produce what parseFeed reads.
test("fixture item round-trips", () => {
  expect(parseFeed(feedXml([]).replace("</channel>", item(OLD_ITEM) + "</channel>"))[0]!.title).toBe(OLD_ITEM.title)
})
