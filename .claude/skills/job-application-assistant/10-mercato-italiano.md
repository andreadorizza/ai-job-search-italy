---
framework_version: 1.0.0
---

# Italian Market Conventions

Fork-owned file (see `FORK.md`). Covers what an Italian CV, cover letter and
application are expected to contain, where those expectations differ from the
Anglo/Nordic defaults the stock templates assume.

Where this file conflicts with `05-cv-templates.md` or
`06-cover-letter-templates.md`, **this file wins for Italian-language
documents**. For English-language documents aimed at multinationals, the stock
guidance still applies.

## The GDPR consent line — effectively mandatory

An Italian CV without a data-processing consent line reads as incomplete, and
some recruiters' systems will not accept it. Put it as the **last line** of the
CV, in small type.

Standard wording:

> Autorizzo il trattamento dei miei dati personali presenti nel CV ai sensi
> dell'art. 13 del D. Lgs. 196/2003 e dell'art. 13 del Regolamento UE 2016/679
> relativo alla protezione delle persone fisiche con riguardo al trattamento
> dei dati personali.

Shorter form, also accepted:

> Autorizzo il trattamento dei dati personali contenuti nel mio curriculum
> vitae in base all'art. 13 del GDPR (Regolamento UE 2016/679).

On an English-language CV for the Italian market, keep the Italian wording —
it is a legal formula, not prose, and translating it weakens it.

In LaTeX, remember to escape: `D. Lgs.` is fine, but a `%` in any added note
must be written `\%`.

## Photo and date of birth

Common in Italy, unlike the UK/US/Nordics where both are actively discouraged.
Neither is required, and both give an employer grounds to filter on protected
characteristics.

**Ask the candidate; do not decide for them.** Reasonable default: include
neither unless the posting or the sector expects it (public sector and
traditional SMEs more often do; tech and multinationals generally do not).
If a photo is included, it belongs top-right, professional, head-and-shoulders.

## Salary: RAL, netto, and the CCNL

Italian salary talk has three separate numbers, and mixing them up is a real
mistake in a negotiation:

- **RAL** (*Retribuzione Annua Lorda*) — gross annual salary. **This is the
  number job postings and recruiters mean** unless they say otherwise. Always
  state expectations as RAL.
- **Netto** — take-home, monthly. Roughly 55–65% of RAL depending on region,
  deductions and bracket. Never quote a figure without saying which one it is.
- **Mensilità** — Italian salaries are paid over **13 or 14 monthly
  instalments**, not 12. A "RAL 35.000 su 14 mensilità" is ~2.500 €/month gross.
  When comparing two offers, check the number of mensilità before concluding
  one pays more.

**CCNL** (*Contratto Collettivo Nazionale di Lavoro*) is the sector-wide
collective agreement that sets minimums, levels (*livelli*, e.g. Metalmeccanici
D1/D2, Commercio 1°–7°) and leave. A posting naming a CCNL and a livello is
telling you the floor, not the offer. Relevant agreements for tech and
engineering roles: **Metalmeccanici**, **Commercio e Terziario**, **Studi
Professionali**, **Telecomunicazioni**.

Contract types worth distinguishing in a fit evaluation: *tempo indeterminato*
(permanent), *tempo determinato* (fixed-term), *apprendistato* (apprenticeship,
under-30, reduced pay for training), *somministrazione* (agency), *stage/
tirocinio* (internship, often low or token pay), *partita IVA* (self-employed —
the headline figure is pre-tax and pre-contributions, so it is not comparable
to a RAL without adjustment).

## Notice period (*preavviso*)

Set by the CCNL and by seniority, typically 15 days to 6 months. The candidate's
own current notice period is a scheduling fact a posting's start date may
conflict with — surface it in the fit evaluation rather than discovering it at
offer stage.

## Cover letter conventions

**Salutations**, most to least formal:

| Italian | Use |
|---|---|
| `Spettabile [Azienda],` | to a company, no named contact |
| `Egregio Dott. [Cognome],` / `Gentile Dott.ssa [Cognome],` | to a named, formal contact |
| `Gentile [Nome Cognome],` | to a named contact, modern and safe default |
| `Gentile Responsabile della Selezione,` | equivalent of "Dear Hiring Manager" |

Use the surname with a title, not the first name, unless the company's own tone
is clearly informal. `A chi di competenza` is the Italian "To whom it may
concern" — avoid it for the same reason.

Titles: `Dott./Dott.ssa` for any university graduate (not only PhDs — this
surprises non-Italians), `Ing.` for registered engineers, `Avv.` for lawyers.

**Closings:**

| Italian | Register |
|---|---|
| `Distinti saluti,` | most formal |
| `Cordiali saluti,` | standard professional default |
| `Cordialmente,` | slightly warmer |

Replaces `Kind regards,` in `\closing{}`.

**Dates** are `16 settembre 2026` in prose, `16/09/2026` in fields. Months are
lowercase in Italian: *gennaio, febbraio, marzo, aprile, maggio, giugno, luglio,
agosto, settembre, ottobre, novembre, dicembre*.

`cover_letters/cover.cls` loads no babel or polyglossia, so `\today` renders in
English. For an Italian letter, write the date literally rather than patching
the shared class file — the class is upstream-pristine and CI-smoke-tested.

## CV section headings in Italian

When the profile's `CV language` is Italian, translate every heading and the
References boilerplate. They are literal English strings in the template and do
not translate themselves.

| English | Italian |
|---|---|
| `Core Competencies` | `Competenze Chiave` |
| `Professional Experience` | `Esperienza Professionale` |
| `Education` | `Istruzione e Formazione` |
| `Languages` | `Lingue` |
| `Publications` | `Pubblicazioni` |
| `Honors and Awards` | `Riconoscimenti e Premi` |
| `References` | `Referenze` |
| `Available upon request.` | `Disponibili su richiesta.` |
| `Technical Skills` | `Competenze Tecniche` |
| `Certifications` | `Certificazioni` |
| `Independent Projects` | `Progetti Personali` |

Italian month abbreviations for date ranges: `Gen, Feb, Mar, Apr, Mag, Giu,
Lug, Ago, Set, Ott, Nov, Dic`. Keep the ASCII hyphen in ranges
(`Mar 2016 - Lug 2016`) — an en-dash breaks ATS date parsing.

## Accented characters and ATS extraction

Italian text is full of `è à ù ò ì é`. The guarded
`\ifpdftex\usepackage[T1]{fontenc}\fi` line in the CV preamble is what keeps
them extractable from the PDF text layer. **Never remove it.** After compiling,
always confirm:

```bash
python3 tools/verify_pdf.py cv/main_<company>_<role>.pdf --dump-text cv/main_<company>_<role>.txt
grep -c 'à\|è\|é\|ì\|ò\|ù' cv/main_<company>_<role>.txt
```

If accented characters come back as `(cid:*)` or `�`, an ATS parser sees
garbage where your job titles were.

## Europass

Expected in parts of the public sector and by some traditional SMEs; generally
seen as dated in tech and at multinationals. If a posting explicitly asks for
Europass, use it. Otherwise the stock template is the better choice — Europass
is verbose and dilutes a strong profile.

## Application etiquette

`04-job-evaluation.md` recommends phoning the employer before applying. That is
a Nordic convention and it does **not** transfer: in Italy an unsolicited call
before applying is more often read as intrusive than as initiative. Exceptions
are small firms and when the posting names a contact and invites contact.

Follow-up after applying is fine after **two to three weeks**, by email, once.
