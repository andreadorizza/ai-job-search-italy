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
| `README.it.md`, `SETUP.it.md` | Italian-language docs; no upstream counterpart |
| `CLAUDE.md` | the candidate profile |
| `.claude/skills/job-application-assistant/10-mercato-italiano.md` | Italian market conventions; new file |
| `.agents/skills/{eures,cliclavoro,adzuna,talent,infojobs,ats,inpa}-search/` | Italian portal skills |
| `.agents/skills/{indeed,jobrapido,subito,monster}-search/` | restricted-tier portals |
| `tests/test_restricted_portals.py` | guards the restricted tier; new file |
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
workflows, `cover_letters/cover.cls`, `AGENTS.md`, `README.md`, `SETUP.md`.

`README.md` and `SETUP.md` stay English and stay structurally upstream's. The
Italian versions are separate files, because `tests/test_onboarding_privacy.py`
pins English literals inside their "Fork and clone" sections — translating
those files in place means either mangling the Italian or forking a test.

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
| **Adzuna Italy** | blocked on credentials | Official API, free App ID/Key from developer.adzuna.com, Italy index exists. Cannot ship: `/add-portal` Step 4 requires a live search + detail run, and that needs a key nobody has registered yet. Register one, then this is a clean portal. |
| **InfoJobs** | blocked on credentials + unverified | Official REST API at `api.infojobs.net` (Client ID/Secret). Documentation describes it as Spain's offer database and **no separate `.it` developer programme was found** — Italy coverage must be confirmed before building. The website itself answers bot challenges, so scraping is not the fallback. |
| **Talent.com** | viable, not built | robots-allowed, returns real Italian results. But its `ld+json` carries only vacancy URLs (an `ItemList` of `WebPage`), so titles/companies need regex over ~660 KB of markup — a fragile scraper, worth doing only if broader coverage is wanted. |
| **Company ATS boards** | viable, needs board tokens | `boards-api.greenhouse.io/v1/boards/<token>/jobs` and `api.lever.co/v0/postings/<company>?mode=json` are public, unauthenticated JSON and verified working (Greenhouse returned 647 real jobs for a known board). The blocker is discovery: board tokens are per-company slugs and cannot be guessed — eight plausible Italian tokens all 404'd. Needs tokens read off each company's careers page, or a user-supplied list. |
| InPA, Jobrapido, Subito, Monster, Indeed | restricted tier | See the access table in the README and the tier rules below. No open-source scraper is reusable for any of them: the Subito projects target classifieds rather than Lavoro, and the InPA ones are commercial Apify actors. |

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
