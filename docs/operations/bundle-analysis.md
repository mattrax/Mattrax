# Bundle analysis

Two numbers matter, and they move for different reasons:

- **First paint** is the JavaScript a route needs before it renders. Deferring
  interaction-only code improves this without deleting it.
- **Total output** is every client chunk the deploy serves. Lazy loading does
  not change it; only removing or replacing dependencies does.

## Build with the Rolldown report

```sh
MATTRAX_PERF_REPORT=1 pnpm --filter @mattrax/web build
```

The report lands in
`apps/web/node_modules/.rolldown/report/.cloudflare/output/v1/workers/`:

- `default/assets` — the browser client.
- `default/bundle` — the dashboard Worker.
- `mattrax-api/bundle` — the API/MDM Worker.

Read `entry.md` first; it indexes `chunks.md`, `packages.md`, `modules.md`
and `graph.md`.

## Ask Perf Kit what to move

Run these in `apps/web` against the report you care about:

```sh
pnpm exec perf-kit graph --report node_modules/.rolldown/report/.cloudflare/output/v1/workers/default/assets
pnpm exec perf-kit what-if <module> --report <report-dir>
pnpm exec perf-kit cut <module> --report <report-dir>
pnpm exec perf-kit why <module> --report <report-dir>
```

`graph` ranks modules by retained size: the bytes a dynamic import removes
from the initial load. `what-if` prices one deferral (or a combined plan) and
lists the exact modules. `cut` finds the fewest import statements to change
when several paths reach a module. `why` prints the chain from the entry.

A module is only a candidate when the first render does not need it. Load it
behind the interaction that does, and keep the same trigger visible so the page
does not jump:

- a policy designer gets a loading state beside its toolbar;
- a YAML parser is imported after a file is chosen (JSON stays on `JSON.parse`);
- a map dialog keeps its trigger button and warms after paint;
- a menu or drawer is mounted on first open.

## Baselines

The client build is dominated by the Solid runtime, the UI primitives and the
Effect/enterprise API client; these are present on every route. Route-level
deferrals are worthwhile but do not change total output:

| Surface             |    Before |     After |
| ------------------- | --------: | --------: |
| Policy import route | 2012.8 KB | 1844.2 KB |
| Policy design route | 2135.8 KB | 1901.7 KB |
| Public designer     | 1896.9 KB |  757.6 KB |
| Dashboard shell     | 1883.6 KB | 1871.9 KB |

For the API Worker, use the same graph commands against
`mattrax-api/bundle`. Its startup closure is dominated by `effect`,
`mysql2`, `drizzle-orm`, `pkijs` and the auth stack. Defer only modules that
a request does not need before dispatch; moving everything behind one global
`import()` trades startup for first-request latency.

## Verify

- `pnpm test` and `pnpm exec tsc -b`.
- A production client build must not emit sourcemaps; only report builds do.
- Check `INEFFECTIVE_DYNAMIC_IMPORT` warnings. A module that is still imported
  statically by another path stays in the initial chunk.
- Use `pnpm bundle:check` for the Worker upload budget after a server change.
