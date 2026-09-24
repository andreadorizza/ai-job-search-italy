// Offline fixtures. The markup mirrors the live site's structure (recorded in
// ../../url-reference.md) but every organisation and posting is invented, so
// no third-party posting text is committed to this repo.

const card = (o: {
  path: string
  headline: string
  position: string
  org: string
  orgId: number
  deadline: string
  country: string
  paeseId: number
  summary: string
}) => `
                            <div class="post-block-wrapper post-list-view clearfix">
                                <div class="row">
                                    <div class="col-md-2 col-sm-2">
                                        <div class="post-thumbnail thumb-float-style">
                                            <a href="${o.path}">
                                                <img class="img-fluid mt-1 img-120" src="/public/organizzazioni/loghi/x-120x120.jpg" alt="${o.headline}" />
                                            </a>
                                        </div>
                                    </div>
                                    <div class="col-md-9 col-sm-9">
                                        <div class="post-content">
                                            <h2 class="post-title title-large">
                                                <a href="${o.path}">${o.headline}</a>
                                            </h2>
                                            <div class="righe-4">
                                                ${o.summary}
                                            </div>
                                                <div class=" bg-grigio p-2">
                                                    <div class="row" style="padding:0px 2px 2px 2px;">
                                                        <div class="col-md-8 col-sm-12">
                                                            <small><strong>Posizione: ${o.position}</strong></small>
                                                        </div>
                                                        <div class="col-md-4 col-sm-12 text-md-end text-start">
                                                            <a href="/Category/Search?Cat=3&organizzazione_id=${o.orgId}">
                                                                <small> ${o.org} </small>
                                                            </a>
                                                        </div>
                                                    </div>
                                                    <div class="row" style="padding:2px;">
                                                        <div class="col-md-5 col-sm-12">
                                                            <small class="text-danger"><strong>Scadenza: ${o.deadline}</strong></small>
                                                        </div>
                                                        <div class="col-md-7 col-sm-12 text-md-end text-start">
                                                            <small>
                                                                    <a href="/Category/Search?Cat=3&paese_id=${o.paeseId}">
                                                                        ${o.country}
                                                                    </a>
                                                            </small>
                                                        </div>
                                                    </div>
                                                </div>
                                                <br />
                                                <hr class="p-0 m-0" />
                                        </div>
                                    </div>
                                </div>
                            </div>`

export const COUNTRY_SELECT = `
<select class="field form-control" name="paese_id">
  <option value="" selected>Scegli una voce...</option>
  <option value="42">Costa d&#x27;Avorio</option>
  <option value="85">Italia</option>
  <option value="87">Kenya</option>
  <option value="130">Perù</option>
  <option value="188">Più paesi</option>
</select>`

export const CARD_A = card({
  path: "/2026/9/ong-esempio-data-officer-italia",
  headline: "ONG ESEMPIO - Data &amp; Digital Officer - Italia",
  position: "Data Officer",
  org: "ONG ESEMPIO",
  orgId: 901,
  deadline: "07 ottobre 2026",
  country: "Italia",
  paeseId: 85,
  summary: `ONG ESEMPIO ETS sta selezionando un/a Data &amp; Digital Officer da inserire nella sua operativit&agrave; in Italia. Durata 12 mesi. Tipo contratto: Tempo det. Scadenza candidature 07/10/2026
Sede: Roma`,
})

export const CARD_B = card({
  path: "/2026/8/fondazione-prova-head-of-programmes-roster-paesi-vari",
  headline: "FONDAZIONE PROVA - Head of Programmes - Roster - Paesi vari",
  position: "Project Manager",
  org: "FONDAZIONE PROVA",
  orgId: 902,
  deadline: "1 settembre 2026",
  country: "Più paesi",
  paeseId: 188,
  summary: `FONDAZIONE PROVA sta selezionando un/a Head of Programmes da inserire nella sua operativit&agrave; in Paesi vari. Durata  mesi. Tipo contratto: Co.co.co. Scadenza candidature 01/09/2026`,
})

/** A card with no title link at all - must be skipped, not fatal. */
export const CARD_BROKEN = `
                            <div class="post-block-wrapper post-list-view clearfix">
                                <div class="post-content"><h2 class="post-title title-large">no link here</h2></div>
                            </div>`

const PAGINATION_WITH_NEXT = `
    <nav aria-label="pagination-wrapper" class="pagination-wrapper">
        <ul class="pagination justify-content-center">
            <li class="page-item active"><span class="page-link">1</span></li>
            <li class="page-item"><a class="page-link" href="?Cat=3&amp;organizzazione_id=&amp;paese_id=&amp;lavoro_non_scaduti=True&page=2">2</a></li>
            <li class="page-item">
                <a class="page-link" href="?Cat=3&amp;organizzazione_id=&amp;paese_id=&amp;lavoro_non_scaduti=True&page=2" aria-label="Next">
                    <span aria-hidden="true"><i class="fa fa-angle-double-right ml-2"></i></span>
                </a>
            </li>
        </ul>
    </nav>`

/** Sidebar teaser after the listing: must never be read as a card. */
const SIDEBAR = `
<div class="col-lg-4 col-md-12 col-sm-12 col-xs-12">
  <div class="post-block-wrapper post-list-view clearfix">
    <h4 class="name post-title"><a href="/2026/8/una-notizia-non-un-lavoro">Una notizia, non un lavoro</a></h4>
  </div>
</div>`

export function listingPage(cards: string[], opts: { next?: boolean } = {}): string {
  return `<!DOCTYPE html><html lang="it"><head><title>Lavoro - Info-Cooperazione.it</title></head><body>
<form method="get" id="searchform" action="/Category/Search" role="search">
<input type="hidden" name="Cat" value="3" />
${COUNTRY_SELECT}
</form>
<div class="block category-listing category-style2">
<h3 class="news-title mt-3"><span>Lavoro</span></h3>
${cards.join("\n")}
</div>
${opts.next ? PAGINATION_WITH_NEXT : ""}
${SIDEBAR}
</body></html>`
}

export const LISTING_HTML = listingPage([CARD_A, CARD_BROKEN, CARD_B], { next: true })

export const DETAIL_ID = "2026/9/ong-esempio-data-officer-italia"

export const DETAIL_HTML = `<!DOCTYPE html><html lang="it"><head>
<meta property="og:title" content="ONG ESEMPIO - Data &amp; Digital Officer - Italia" />
</head><body>
<div class="post-header mt-2">
  <div class="post-feat-ured-image pb-1">
    <div class=" rounded-0 row border border-black m-0 p-0 bg-white ">
      <div class="col-md-2 col-sm-12 text-center m-0 p-0"><div class="bg-white "><img src="/x.jpg" class="m-3 img-80"></div></div>
      <div class="col-md-10 col-sm-12">
        <small class="text-danger"><strong>Scadenza: 07 ottobre 2026</strong></small><br />
        <div class=" ">
          <b class=""> ONG ESEMPIO </b><br />
          <small><strong>Posizione: Data Officer</strong></small><br />
          <span class="post-author">
            <small>
              <i class="fa fa-map-marker"></i>
Italia                                                        <span>&nbsp;</span>
            </small>
          </span>
        </div>
      </div>
    </div>
    <div class=" container-fluid" style="padding:0px 0px;">
      <div class="row ">
        <div class="col-sm-12 col-md-6"><a href="#" class="post-category bg-black">08/09/2026</a></div>
        <div class="col-sm-12 col-md-6  text-md-end"><a href="/Category/lavoro" class="post-category bg-black">Lavoro</a></div>
      </div>
    </div>
  </div>
</div>
<div class="post-body mt-0">
  <h2 class="" style="font-size:40px; line-height:48px;">
    ONG ESEMPIO - Data &amp; Digital Officer - Italia
  </h2>
  <div class="entry-content text-justify">
<p><strong>ONG ESEMPIO ETS</strong> sta selezionando un/a <strong>Data &amp; Digital Officer</strong> da inserire nella sua operativit&agrave; in <strong>Italia</strong>. Durata <strong>12</strong> mesi. Tipo contratto: <strong>Tempo det.</strong> Scadenza candidature <strong style="color: red;">07/10/2026</strong></p>
<p><span data-contrast="auto">L&rsquo;associazione &egrave; nata nel 1990.</span><span data-ccp-props="{&quot;335551550&quot;:6}">&nbsp;</span></p>
<div class="nested"><p>Sede: Roma &ndash; ibrido</p></div>
<p><strong>Attivit&agrave;:</strong></p>
<ul>
<li data-aria-level="1"><span>Gestione del CRM donatori.</span><span>&amp;n bsp;</span></li>
</ul>
<ul>
<li data-aria-level="1"><span>Analisi dei dati &lt;b&gt;di monitoraggio&lt;/b&gt;.</span></li>
</ul>
<p>Candidature a <a href="mailto:lavoro@example.org">lavoro@example.org</a></p>
  </div>
  <div class="text-center p-4">
    <a href="https://jobs.example.org/data-officer" class="btn btn-sm btn-info" target="_blank">
      <i class="fa-solid fa-link"></i> LINK ALLA VACANCY
    </a>
  </div>
</div>
</body></html>`

type Route = (url: string, init?: RequestInit) => Response

/**
 * Stub fetch. `/Category/Search` with a `page=` param is the job listing;
 * without one it is the country-list lookup; anything else is a posting page.
 * Records every call so tests can inspect what was sent.
 */
export function stubSite(opts: { listing?: Route; countries?: Route; detail?: Route } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const listing: Route = opts.listing ?? (() => html(LISTING_HTML))
  const countries: Route = opts.countries ?? (() => html(listingPage([])))
  const detail: Route = opts.detail ?? (() => html(DETAIL_HTML))
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, init })
    if (u.includes("/Category/Search")) {
      return new URL(u).searchParams.has("page") ? listing(u, init) : countries(u, init)
    }
    return detail(u, init)
  }) as unknown as typeof fetch
  return calls
}

export function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } })
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
