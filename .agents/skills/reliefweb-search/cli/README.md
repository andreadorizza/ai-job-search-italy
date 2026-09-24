# reliefweb-cli

A CLI for ReliefWeb Jobs (UN OCHA): humanitarian, development, NGO and UN
vacancies, read through the official ReliefWeb API v2. It has zero runtime
dependencies.

It needs a **pre-approved appname** (free, reviewed by ReliefWeb). Request it
via the form linked at <https://apidoc.reliefweb.int/parameters#appname>, then:

```bash
export RELIEFWEB_APPNAME=<your-approved-appname>
```

```bash
bun install
bun run typecheck
bun run test        # offline; the live smoke test runs only when RELIEFWEB_APPNAME is set
```

```bash
bun run src/cli.ts search -q "data" --remote -c ict --limit 5 --format table
bun run src/cli.ts search -l Italy --jobage 30 --format table
bun run src/cli.ts detail 4221508 --format plain
```

`../url-reference.md` has the endpoint, the request body, the filter mapping,
and the access and robots findings. `../SKILL.md` has the output contract and
the setup step.
