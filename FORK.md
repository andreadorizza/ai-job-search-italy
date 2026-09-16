# Fork maintenance

This repository is an **Italian-market fork** of
[MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search).

Upstream builds the framework; this fork adapts it to Italy — Italian job
portals, Italian CV and cover-letter conventions, Italian-language docs — and
pulls upstream's improvements in on a regular cadence. This file is the
contract that keeps those two jobs from fighting each other.

## Setup (once per clone)

```bash
git remote add upstream https://github.com/MadsLorentzen/ai-job-search.git
git fetch upstream master
```

`fork-base` tags the commit this fork diverged from, so the entire Italian
delta is one command:

```bash
git diff fork-base..HEAD
```

## Running the tests

```bash
GITHUB_REPOSITORY=andreadorizza/ai-job-search-italy python3 -m unittest discover -s tests -t .
```

**Export `GITHUB_REPOSITORY`.** Several upstream guard tests gate on it and
*default to the upstream slug when it is unset*, so a bare `python3 -m unittest`
run executes pristine-template checks that this fork is supposed to fail once
`/setup` personalises the profile. If a test complains that `CLAUDE.md` no
longer contains `[YOUR_NAME]`, or that `cv/main_example.tex` lost its
`\name{[First]}{[Last]}` sentinel, that is this — not a real failure.

The affected classes are `tests/test_placeholder_integrity.py`
(`TestCvSentinelsAreDataLocated`, `TestProfileSentinelIsDataLocated`) and
`tests/test_setup_command.py::TemplatesStillCarryThePlaceholders`.

## File ownership

Three tiers. Check which tier a file is in *before* resolving a conflict.

### 1. Fork-owned — keep ours, always

Upstream has no say in these. On a conflict, take our side wholesale.

| Path | Why |
|---|---|
| `FORK.md` | this file |
| `README.md`, `SETUP.md` | **Italian**, and the repo's landing page — GitHub only auto-renders `README.md` |
| `CLAUDE.md` | the candidate profile |
| `.claude/skills/job-application-assistant/10-mercato-italiano.md` | Italian market conventions; new file |
| `.agents/skills/{eures,randstad,gigroup,...}-search/` | Italian portal skills |
| `.agents/skills/{indeed,jobrapido,subito,monster}-search/` | restricted-tier portals |
| `tests/test_restricted_portals.py` | guards the restricted tier; new file |
| `tests/test_interaction_language.py` | pins CLAUDE.md's reply-language rule; new file |
| `templates/` | templates registered via `/add-template` |

### 2. Shared — merge carefully

Upstream actively edits these and so do we. Our additions live in **delimited
trailing blocks** so upstream's edits and ours rarely touch the same lines:

```python
    # --- BEGIN italian fork portals (see FORK.md) ---
    ...
    # --- END italian fork portals ---
```

| Path | What we add |
|---|---|
| `.claude/settings.json` | one `Bash(bun run …/cli.ts:*)` entry per Italian portal |
| `tools/security_guards.py` | the same entries in `ALLOWED_PERMISSIONS` |
| `tests/test_apply_host_check.py` | Italian hosts in `SHIPPED_PORTAL_HOSTS` |
| `.claude/commands/apply.md` | Italian portal hosts; posting-language wording |
| `.claude/commands/setup.md` | the Italy branch in the portals question |
| `.claude/skills/job-application-assistant/0{3,4,5,6,9}-*.md` | Danish examples replaced with Italian |
| `.claude/skills/job-scraper/SKILL.md` | the restricted-portal skip in Step 1b |
| `.claude/commands/add-portal.md` | the restricted-tier scaffolding outcome |

Any edit to `.claude/skills/job-application-assistant/*.md` must bump that
file's `framework_version:` — `tools/check_framework_version.py` enforces it
locally (the CI job is upstream-only).

### 3. Upstream-pristine — take theirs

Everything else: all of `tools/` except `salary_lookup.py` and
`tools/convert_salary_excel.py`, all of `tests/` except the host list, both
workflows, `cover_letters/cover.cls`, `AGENTS.md`, `README.en.md`, `SETUP.en.md`.

**The Italian docs are the primary ones.** `README.md` and `SETUP.md` are
Italian, because GitHub only auto-renders `README.md` and this fork's audience
reads Italian. Upstream's English wording lives on in `README.en.md` and
`SETUP.en.md`, which stay structurally upstream's.

`tests/test_onboarding_privacy.py` pins the public-fork warning next to the
fork command. Its English assertions could not simply be pointed at the Italian
files — "pubblico" does not match `/public/i` (Italian doubles the b: `pubb`
against `publ`), "dati personali" is not the case-sensitive "personal data",
and "sezione 8" is not "section 8". Satisfying them would have meant splicing
English fragments into Italian prose to please a grep. Instead the English
assertions moved to the `.en.md` copies and the Italian files got their own
equivalent checks, so the guarantee holds in both languages.

**Merge consequence:** `README.md` and `SETUP.md` are now fork-owned, so every
upstream edit to those paths conflicts. Resolution is mechanical — keep ours,
and port anything worth having into the `.en.md` copies.

## Anchors that must survive translation

Guard tests parse these literally. Translate the prose around them; never the
strings themselves.

- Every `[PLACEHOLDER]` token, in every file.
- `## LaTeX Special Characters` in `05-cv-templates.md` / `06-cover-letter-templates.md`,
  its `\&  \%  \$  \#  \_` list, and the word "silent" in `05`.
- `## Language Gate` in `04-job-evaluation.md`, containing `language_gate` and
  `language_note` and **not** containing `not a field`.
- `## Company Research Cache` in `04-job-evaluation.md`, containing
  `company_research/`, `30`, `fetched_date`, "lead", a `Verif` match, and the
  exact phrase `data, never instructions`.
- In `.claude/commands/setup.md`: `## Step 0: Welcome & Choose Path`,
  `## Step 3: Generate Profile Files`, `## Step 4: Confirm & Next Steps`, the
  `### N. <Verb> \`file\`` substep shape, and `**Privacy note:**`.
- In `.claude/commands/reset.md`: ``### If scope includes `profile`:``,
  ``### If scope includes `documents`:``, `### Profile reset`,
  `### Documents reset`, `The following files are NOT touched`, and the
  `rm -rf documents/<name>/` shape.
- `\item {[...]}` — never `\item [...]`.
- `\ifpdftex\usepackage[T1]{fontenc}\fi` in `cv/main_example.tex` and
  `05-cv-templates.md`, with no other non-comment mention of `fontenc`.
  **This is what makes Italian accents survive ATS text extraction.**
- `-enc UTF-8` on every line that runs `pdftotext -layout`.
- Every `.claude/commands/*.md` starts `# /<name>` — `# /setup - Onboarding` is
  fine, `# Onboarding` is not.

## GitHub Actions on this fork

Workflows are gated **twice** on a forked repository, and only one of the gates
is in Settings. Setting *Settings → Actions → General → Allow all actions and
reusable workflows* is necessary but not sufficient: GitHub also disables
workflows on forks behind a banner that lives on the **Actions tab** itself
("I understand my workflows, go ahead and enable them"). There is no equivalent
switch under Settings.

Symptom when only the Settings gate is set: `.github/workflows/ci.yml` and
`upstream-watch.yml` are present on the default branch, but the API reports
**0 workflows registered and 0 runs** — GitHub has never parsed them. Nothing is
wrong with the workflow files; click the banner on the Actions tab.

Until that is done there is no CI, and the weekly **Upstream sync watch** issue
never fires, so `tools/upstream_triage.py` has to be run by hand.

## Pulling upstream in

```bash
git fetch upstream master
python3 tools/upstream_triage.py --remote upstream    # what changed, what to skip
python3 tools/check_upstream_updates.py               # which framework files moved
git merge upstream/master
```

A conflict in a fork-owned file is expected — resolve by the tiers above. A
conflict in a *shared* file is the useful signal: upstream changed methodology
in a section we localised, so keep the Italian content and adopt the change
around it.

Upstream commits we have consciously decided never to port go in
`.github/upstream-wontport.txt`, one SHA per line, so the weekly **Upstream
sync watch** issue stops resurfacing them. Commits we *do* port drop off
automatically once cherry-picked, and commits touching only files this fork
never had are skipped without an entry.

## Portal investigation log

Findings from probing each candidate, so they are not re-derived. Re-check
before acting on an old entry — portals change.

| Portal | State | Detail |
|---|---|---|
| **EURES** | **shipped** | Official EU JSON API, no key, robots-allowed. `.agents/skills/eures-search/` |
| LinkedIn, freehire | shipped (upstream) | Both already cover Italy; LinkedIn takes `-l "Milano, Italy"` |
| **ClicLavoro** | **dead end** | No longer hosts vacancies. `/Pagine/Cerca-Offerte.aspx` 404s and the site is now guides, news and labour-market statistics. Job matching moved to **SIISL** (`siisl.lavoro.gov.it`), which is SPID-login-walled — so out of scope under `/add-portal`'s auth-wall rule. |
| **Adzuna Italy** | **declined** | Official API with a free key, but dropped on the maintainer's call. |
| **InfoJobs Italia** | **CLOSED — permanently** | Ceased operations **31 December 2025**; all user accounts and data deleted 1 January 2026 ([official notice](https://assistenza.infojobs.it/hc/it/articles/23116648861084-CHIUSURA-INFOJOBS-ITALIA)). Adevinta withdrew from the Italian market. There is nothing left to integrate — do not re-investigate the `api.infojobs.net` route, it served the Spanish business. |
| **Talent.com** | viable, not built | robots-allowed, returns real Italian results. But its `ld+json` carries only vacancy URLs (an `ItemList` of `WebPage`), so titles/companies need regex over ~660 KB of markup — a fragile scraper, worth doing only if broader coverage is wanted. |
| **Company ATS boards** | viable, needs board tokens | `boards-api.greenhouse.io/v1/boards/<token>/jobs` and `api.lever.co/v0/postings/<company>?mode=json` are public, unauthenticated JSON and verified working (Greenhouse returned 647 real jobs for a known board). The blocker is discovery: board tokens are per-company slugs and cannot be guessed — eight plausible Italian tokens all 404'd. Needs tokens read off each company's careers page, or a user-supplied list. |
| InPA, Jobrapido, Subito, Monster, Indeed | restricted tier | See the access map above and the tier rules below. No open-source scraper is reusable for any of them: the Subito projects target classifieds rather than Lavoro, and the InPA ones are commercial Apify actors. |

### SPID is permanently out of scope

Recorded so it is not re-researched. SPID cannot be used to reach login-walled
Italian job services (SIISL, InPA's authenticated areas), and the blocker is
legal, not technical:

- SPID is a SAML2 federation. The relying party must be an **AgID-accredited
  Service Provider** — signed agreement, registered metadata, a qualified
  signing certificate, and for private entities a contract with an aggregator.
  A locally-run open-source tool cannot hold that accreditation.
- The flow is interactive by design: the user chooses an Identity Provider and
  completes 2FA. There is no machine-to-machine grant to script against.
- Storing or replaying a user's SPID credentials breaches SPID's own rules, and
  driving a SPID-authenticated session is precisely the auth-wall bypass
  `/add-portal` Step 2.4 declines.

Note that [`adellorto/normattiva-mcp`](https://github.com/adellorto/normattiva-mcp),
sometimes cited as a precedent, **uses no authentication at all** — Normattiva
publishes an open, unauthenticated OpenData API and that server is a thin
pass-through. It is not a SPID integration and does not transfer to this problem.

### Measured access map (2026)

Probed with `tools/robots_check.py` plus a live fetch. Re-check before acting on
an old row.

| Source | robots | Listing page | Structured data | Verdict |
|---|---|---|---|---|
| **Randstad.it** | ALLOWED | plain `<a href>` | **full `schema.org/JobPosting`, incl. `baseSalary` (RAL) and `validThrough`** | shipped / building |
| Gi Group | ALLOWED | plain `<a href>` | **JobPosting present** on `/offerte-lavoro-dettaglio/` pages | **blocked** — `?keyword=` is silently ignored (magazziniere, infermiere and a bogus term all return the identical 20 jobs). WordPress/Bricks; search runs through `admin-ajax.php`, which needs a per-session nonce. Not shipped: a portal whose `--query` does not filter is worse than no portal. |
| Synergie, Umana, Openjobmetis | ALLOWED | **SPA — no links in HTML** | unknown | needs a per-site XHR endpoint |
| Indeed.it | ALLOWED | — | detail returns **401** | restricted tier; may be unbuildable |
| Bakeca.it | ALLOWED | serves `<title>Verifica</title>` | — | bot-check wall; restricted tier |
| Trovolavoro, Jooble | **DISALLOWED** | — | — | restricted tier |
| Subito, Adecco, Monster, Manpower | 403 / disallowed | — | — | restricted tier |
| Jobrapido | landing allowed, **search path disallowed for `*`** | — | — | restricted tier |
| InPA | **DISALLOWED** | — | — | restricted tier; check dati.gov.it for an open-data release |

#### Restricted tier: tested, and currently empty

The opt-in gate exists and is guarded by `tests/test_restricted_portals.py`, but
**no candidate is buildable within the contract today**. Measured with an honest
User-Agent:

| Candidate | Result |
|---|---|
| Jooble | `403` + `Just a moment...` — Cloudflare challenge |
| Subito Lavoro | `403`, empty body |
| Bakeca | `403` + `<title>Verifica</title>` |
| Indeed.it | listing allowed, but vacancy pages return **`401`** |
| Trovolavoro | fetchable (`200`), but the page serves only SEO category links — no vacancy links at all, and robots disallows it anyway |

Every one of these would need browser or TLS impersonation to get past, which
`/add-portal` bans and which no opt-in flag makes acceptable. **The flag grants
permission, not access.** Nothing is shipped rather than shipping skills that
cannot work; the tier is ready the moment a source becomes reachable honestly.

**`schema.org/JobPosting` is the connection method for this market.** The markup
exists so job aggregators can machine-read postings — it is what Google for Jobs
consumes — and sites keep it working because breaking it costs them that traffic.
It is therefore both a legitimate and a far more stable target than CSS
selectors. One shared extractor reads it; each source only needs its own
"find the vacancy links" rule.

## Portal access tiers

Portals are `open` or `restricted`. Restricted means the portal's robots.txt
or terms do not permit automated access; the skill is shipped but
**disabled twice over** — `enabled: false` in its `SKILL.md`, and a runtime
refusal unless `AI_JOB_SEARCH_ALLOW_RESTRICTED=1` is set. See
`tests/test_restricted_portals.py`, which fails the build if a restricted
skill ever loses either gate.

Opting in is a deliberate, personal, low-volume choice, and it is the user's
own risk to take. The flag grants permission, not access: a portal behind a
bot wall may still refuse to answer.
