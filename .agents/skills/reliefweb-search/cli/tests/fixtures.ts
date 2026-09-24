// Response shapes follow the ReliefWeb API v2 OpenAPI spec
// (https://api.reliefweb.int/v2/swagger/api/api.yml, schemas ResultJobs/Job):
// list items are `{id, fields: {...}}`, dates are ISO-8601 with an offset,
// references are arrays of `{name, ...}`, and an empty/missing `country`
// means the job location is unspecified (remote, roving or TBD).

export const ITALY_JOB = {
  id: 4221508,
  score: 1,
  fields: {
    id: 4221508,
    title: "Data Management Specialist (Consultant) &ndash; Rome",
    url: "https://reliefweb.int/node/4221508",
    url_alias: "https://reliefweb.int/job/4221508/data-management-specialist-consultant-rome",
    status: "published",
    date: {
      created: "2026-09-15T10:09:12+00:00",
      changed: "2026-09-16T08:00:00+00:00",
      closing: "2026-10-03T00:00:00+00:00",
    },
    source: [{ name: "World Food Programme", shortname: "WFP" }],
    country: [{ name: "Italy", shortname: "Italy", iso3: "ita", primary: true }],
    city: [{ name: "Rome" }],
    type: [{ name: "Consultancy" }],
    experience: [{ name: "5-9 years" }],
    career_categories: [{ name: "Information Management" }],
    theme: [{ name: "Food and Nutrition" }],
    body:
      "## About the role\n\nWFP is looking for a **Data Management Specialist** to support\n" +
      "the *Research, Assessment and Monitoring* division.\n\n" +
      "### Key responsibilities\n\n" +
      "* Maintain data pipelines in Python and SQL\n" +
      "* Build dashboards for [country offices](https://www.wfp.org/countries)\n" +
      "- Document data models \\- including metadata\n\n" +
      "---\n\n" +
      "Contact: data_team@wfp.org",
    "body-html": "<h2>About the role</h2><p>WFP is looking for a Data Management Specialist.</p>",
    how_to_apply: "Apply via [WFP careers](https://www.wfp.org/careers) before **3 October 2026**.",
    "how_to_apply-html": "<p>Apply via WFP careers.</p>",
  },
}

export const REMOTE_JOB = {
  id: "4230001",
  fields: {
    id: 4230001,
    title: "Remote GIS & Data Analyst",
    url: "https://reliefweb.int/node/4230001",
    url_alias: "https://reliefweb.int/job/4230001/remote-gis-data-analyst",
    status: "published",
    date: { created: "2026-09-20T12:00:00+00:00" },
    source: [{ name: "iMMAP", shortname: "iMMAP" }],
    type: [{ name: "Job" }],
    experience: [{ name: "3-4 years" }],
    career_categories: [{ name: "Information and Communications Technology" }],
  },
}

export const LIST_RESPONSE = {
  time: 12,
  href: "https://api.reliefweb.int/v2/jobs",
  totalCount: 57,
  count: 2,
  data: [ITALY_JOB, REMOTE_JOB],
}
