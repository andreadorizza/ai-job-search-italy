---
name: infocooperazione-search
version: 1.0.0
description: >
  Search the jobs section ("Lavoro") of Info Cooperazione (info-cooperazione.it),
  the main Italian news site for international cooperation and NGOs. It lists
  open vacancies at Italian NGOs, UN agencies and third-sector organisations,
  in Italy and in field postings abroad (programme, admin, finance, logistics,
  communication, MEAL, data and digital roles). Use for: Info Cooperazione,
  NGO jobs Italy, Italian NGO jobs, international development jobs,
  international cooperation jobs, humanitarian jobs, development aid jobs,
  non-profit jobs Italy, field jobs abroad. Italiano: lavoro cooperazione
  internazionale, offerte di lavoro cooperazione internazionale, lavoro ONG,
  offerte di lavoro ONG, lavoro nelle ONG, cooperazione allo sviluppo, lavoro
  cooperazione allo sviluppo, terzo settore, lavoro terzo settore, lavoro non
  profit, lavoro umanitario, lavoro all'estero ONG, cooperante, vacancy ONG.
context: fork
enabled: false  # impact/non-profit portal - ships opt-in; set true to have /scrape use it
access: open    # no robots.txt (404) and no terms-of-use page; content is CC BY-NC-SA 4.0, so personal non-commercial use with attribution
allowed-tools: Bash(bun run .agents/skills/infocooperazione-search/cli/src/cli.ts *)
---

# Info Cooperazione Job Search

[Info Cooperazione](https://www.info-cooperazione.it) is the Italian community
site for international cooperation and sustainability. Its **Lavoro** section
lists vacancies from Italian NGOs (COOPI, INTERSOS, WeWorld, ACRA, CESVI,
EMERGENCY, Medici Senza Frontiere...), UN agencies and other third-sector
bodies. Roles are in Italy (mostly NGO head offices, for example in Milano and
Roma) and in the field abroad. Most are programme, admin, finance, logistics, HR and
communication roles. Data, digital and IT roles are few but do appear. Postings
are in Italian, English or French. Only postings whose deadline has not passed
are listed: 63 at recon (2026-09-24), so the whole board is 4 pages.

The site is server-rendered HTML. This CLI fetches the same public pages a
browser does, with an honest User-Agent, and parses them card by card. No
account, no browser impersonation. **Zero runtime dependencies**: it runs with
nothing but `bun`.

**Ships disabled.** `enabled: false` keeps `/scrape` from using it until you
set `enabled: true` in the frontmatter above.

## Licence and attribution

The site's Copyright page (`/pages/copia-pure`) says its content is released
under a Creative Commons licence ("i contenuti di Info Cooperazione sono
rilasciati sotto Licenza Creative Commons Attribuzione 4.0"). The link on
that sentence points to **CC BY-NC-SA 4.0**, and the page lists the three
conditions: attribution (Attribuzione), non-commercial (NonCommerciale) and
share-alike (StessaLicenza). For web reuse it also asks for a live link and
the citation `www.info-cooperazione.it – La community italiana della
Cooperazione Internazionale`.

What this means for you:

- **Non-commercial only.** Use it for your own job search. Do not resell,
  republish or feed the postings into a commercial product.
- **Attribution travels with the data.** Every search result and every detail
  record carries a `source` field with the site's citation. JSON `meta` and
  `detail` also carry `license` and `licenseUrl`. Table and plain output end
  with a `Fonte:` line. Keep it when you store or share postings (for example
  in `/html-report` or `/notion-sync`), and link the posting `url`.
- **Keep volume low.** One request per search page (two with a country name),
  one per detail.

There is no `robots.txt` (it returns 404) and no terms-of-use page (the footer
links only Privacy, Cookie Policy and Copyright), so nothing restricts
automated access beyond the licence above.

## Usage

```bash
# IT and digital roles (use a term of 3+ characters, not "IT")
bun run .agents/skills/infocooperazione-search/cli/src/cli.ts search -q "informatica" --format table
bun run .agents/skills/infocooperazione-search/cli/src/cli.ts search -q "digitale" --format table

# Data roles based in Italy (head-office jobs in Milano, Roma...)
bun run .agents/skills/infocooperazione-search/cli/src/cli.ts search -q "analisi dati" -l Italia --format table

# MEAL / monitoring roles anywhere, published in the last month (month precision)
bun run .agents/skills/infocooperazione-search/cli/src/cli.ts search -q "monitoraggio" --jobage 30 --format table

# Everything open in Kenya, or in several countries at once ("Più paesi")
bun run .agents/skills/infocooperazione-search/cli/src/cli.ts search -l Kenya --format table
bun run .agents/skills/infocooperazione-search/cli/src/cli.ts search -l "Più paesi" --format table

# Browse the newest open postings, page 2, as JSON for /scrape
bun run .agents/skills/infocooperazione-search/cli/src/cli.ts search --page 2

# One posting, by id or URL
bun run .agents/skills/infocooperazione-search/cli/src/cli.ts detail 2026/9/medici-senza-frontiere-stage-curriculare-web-platforms-italia-f252ab92 --format plain
```

## Commands

### `search`

| Flag | Meaning |
|---|---|
| `--query`, `-q` | Text the site searches for in title and body. Optional: omit it to browse. See *Query behaviour* below. |
| `--location`, `-l` | One country, by the site's **Italian** name (`Italia`, `Kenya`, `Libano`, `Etiopia`, `Stati Uniti`), a region (`Africa`, `Asia`, `America Latina`), `Più paesi` for multi-country roles, or the numeric `paese_id`. Case- and accent-insensitive; `Italy` also works. A name costs one extra request to read the site's country list. Unknown names fail with `BAD_ARG` and suggestions. |
| `--jobage <days>` | Only postings published within N days, **at month precision** (see Notes). Filtered client-side on the fetched page. |
| `--page <n>` | 1-indexed, 20 postings per page. Default 1. |
| `--limit`, `-n <n>` | Cap results emitted (client-side). |
| `--format` | `json` (default), `table`, `plain`. |

JSON output:

```json
{ "meta": { "count": 1, "page": 1, "perPage": 20, "hasNext": false, "country": null,
            "attribution": { "source": "www.info-cooperazione.it – La community italiana della Cooperazione Internazionale",
                             "license": "CC BY-NC-SA 4.0",
                             "licenseUrl": "https://creativecommons.org/licenses/by-nc-sa/4.0/deed.it" } },
  "results": [ { "id": "2026/9/medici-senza-frontiere-stage-curriculare-web-platforms-italia-f252ab92",
                 "title": "Stage curriculare Web & Platforms",
                 "headline": "MEDICI SENZA FRONTIERE - Stage curriculare Web & Platforms - Italia",
                 "roleCategory": "Stage curriculare Web & Platforms",
                 "company": "MEDICI SENZA FRONTIERE", "location": "Italia",
                 "date": null, "publishedMonth": "2026-09", "deadline": "2026-10-01",
                 "contractType": "Stage/Tirocinio", "duration": "6 mesi",
                 "summary": "MEDICI SENZA FRONTIERE sta selezionando un/a ...",
                 "url": "https://www.info-cooperazione.it/2026/9/medici-senza-frontiere-stage-curriculare-web-platforms-italia-f252ab92",
                 "source": "www.info-cooperazione.it – La community italiana della Cooperazione Internazionale" } ] }
```

Every field is always present; unknown values are `null`, never omitted.
`meta.hasNext` says whether the site offers a next page.

### `detail <id|url>`

Takes an id from `search` (`<year>/<month>/<slug>`) or a posting URL
`https://www.info-cooperazione.it/<year>/<month>/<slug>`. Returns the card
fields plus the exact publication `date`, the full `description` (paragraphs
and bullets kept), `applyUrl` (the site's *LINK ALLA VACANCY*, `null` when the
posting asks for applications by email) and `license` / `licenseUrl`.

Errors go to stderr as `{"error": "...", "code": "..."}` with exit 1. Codes:
`MISSING_REQUIRED`, `BAD_ARG`, `BAD_ID`, `NOT_FOUND`, `PARSE_ERROR`,
`API_ERROR`, `UNKNOWN_FLAG`, `BAD_CMD`, `INTERNAL_ERROR`.

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default: programmatic use, `/scrape`, passing ids to `detail` |
| `table` | Quick scanning: id, title, organisation, country, deadline |
| `plain` | Reading: headline, organisation, country, month, deadline, contract; with `detail`, the full posting |

## Notes

- **Query behaviour.** The site matches `-q` as one case-insensitive phrase
  anywhere in the title or body, so word order matters: `program manager`
  finds 3 postings, `manager program` finds none. Text under 3 characters
  returns nothing on the site, so the CLI refuses it with `BAD_ARG`. Search
  `informatica`, `ICT`, `digitale`, `web`, `CRM` rather than `IT`.
  Common words are noisy: `dati` also matches the privacy line on most
  postings ("trattamento dei dati"), and `data` matches "data di inizio"
  (start date). Prefer phrases such as `analisi dati` or `data manager`.
- **`date` is `null` in search results. This is by design.** A listing card
  carries no publication day. The site encodes the year and month in the URL
  (`/2026/9/...`), which becomes `publishedMonth`. Only `detail` has the exact
  `date`.
- **`--jobage` is month-precise.** It keeps a posting when its
  `publishedMonth` is on or after the month the window starts in. It never
  drops a posting inside the window, but it can keep one up to a month older.
  For `/scrape`, pass `--jobage 14` and do **not** drop results for a `null`
  `date`. The listing is newest-first, so page 1 holds the most recent
  postings. Every listed posting is still open, whatever its age.
- **`title` vs `roleCategory`.** The headline is always
  `ORG - Role - Place`, and `title` is the role taken from it. The site's own
  *Posizione* tag is a standardised category, and it can differ from the real
  role: a "Program Manager" posting is tagged "Project Manager", an
  "Assistente amministrativo/a" is tagged "Admin". It is kept as
  `roleCategory`.
- **`location` is the site's one country tag.** Multi-country roles are
  tagged `Più paesi` (their headlines say "Paesi vari"). A split role such as
  "Afghanistan / Italia" (field posting plus home-based months) is tagged
  with the field country only, so read `headline` too. The real work city
  (Lodi, Roma, Milano) is usually only in the description (`Sede di lavoro`).
- **`company` is the site's short name** (`COOPI`, `MLFM`). The full legal
  name opens the `summary` ("... sta selezionando un/a ...").
- **`contractType` and `duration` are the site's raw values**, read from the
  generated first sentence: `Tempo det.`, `Tempo indeterminato.`,
  `Co.co.co.`, `Consulenza`, `Stage/Tirocinio`; `12 mesi`. Many roles are
  fixed-term or co.co.co. contracts tied to a project.
- **Salary is not a field.** When a posting states pay, it is in the
  description and is usually not RAL: stipends, gross monthly amounts or
  co.co.co. fees. Label it as the posting does.
- **The `summary` is truncated by the site** (about 400 characters). Run
  `detail` before judging fit.
- **Applying.** `applyUrl` is the organisation's own vacancy page when there
  is one. Otherwise the description gives an email address and the subject
  line to use.
