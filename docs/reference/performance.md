# Performance and accessibility budgets

Mattrax ships static guards for the two regressions that hurt page experience most:
layout-shifting media and layout-animating motion. Lighthouse CI records the lab
budgets for the public pages.

## Lighthouse CI

```sh
pnpm lighthouse
```

`pnpm lighthouse` runs `lhci autorun` with `startServerCommand: "pnpm web dev"`,
so the dev server must be able to bind `http://localhost:9050`. The command starts
it automatically and stops it afterwards. Reports are written to
`.lighthouseci/` (ignored by Git). Locally each page is sampled once; CI samples
each page three times and uses the median.

The public pages covered are:

- `/`
- `/login`
- `/register`
- `/designer`

Authenticated dashboard pages (`/t/:tenantId/...`) are **not** covered by the
public Lighthouse CI run yet: they need a seeded tenant and a signed-in session,
which the current anonymous run does not provision.

### Budgets

All assertions are errors in `.lighthouserc.cjs`. The categories are Lighthouse's
mobile, simulated-throttling preset.

| Assertion                | Budget   |
| ------------------------ | -------- |
| `performance`            | score 1  |
| `accessibility`          | score 1  |
| `best-practices`         | score 1  |
| `seo`                    | score 1  |
| `agentic-browsing`       | score 1  |
| Largest Contentful Paint | ≤ 1.5 s  |
| Cumulative Layout Shift  | ≤ 0.01   |
| Total Blocking Time      | ≤ 150 ms |
| First Contentful Paint   | ≤ 1.2 s  |
| Console errors           | 0        |

### Production baseline (2026-11-14)

Recorded against `https://e.mattrax.app` with Lighthouse 13.6.0:

| Page        | Performance | LCP       | CLS |
| ----------- | ----------- | --------- | --- |
| `/`         | 100         | 0.9–1.1 s | 0   |
| `/login`    | 100         | 0.9–1.1 s | 0   |
| `/register` | 100         | 0.9–1.1 s | 0   |
| `/designer` | 100         | 0.9–1.1 s | 0   |

Category, accessibility, SEO and agentic-browsing scores were repaired after that
recording. A local Lighthouse 13.6.0 run on 2026-11-14 reports **1 for
performance-independent categories on every public page**:

| Page | Perf | A11y | Best practices | SEO | Agentic | CLS |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | 69* | 100 | 100 | 100 | 100 | 0.002 |
| `/login` | 73* | 100 | 100 | 100 | 100 | 0 |
| `/register` | 73* | 100 | 100 | 100 | 100 | 0 |
| `/designer` | 70* | 100 | 100 | 100 | 100 | 0.001 |

*Dev-server performance numbers; production remains 100.

### Local limitation

The budgets are production budgets. A local run against `pnpm web dev` cannot
meet the timing budgets even when the production build scores 100: dev mode
serves unbundled modules with HMR, and the bundled preview serves uncompressed
CSS and JavaScript. On a development machine the same pages measure roughly
2.2–2.6 s FCP/LCP and 0.9–1.1 s TBT, while CLS and every non-performance category
still pass. Treat local performance failures as an asset-serving and dev-mode
artefact, not a regression; use the production baseline above for the real
numbers. The CI job is therefore advisory until the preview server compresses
assets (or the job targets a deployed preview environment).

## Static guards

`tools/oxlint/anti-slop` runs through `pnpm lint` (and `vp lint`). Two rules
target the layout-shift and jank sources directly:

- `anti-slop/no-layout-animating-transition` rejects `transition-all`,
  `transition-[...]` property lists that include width, height, inset, margin,
  padding or gap, and `animate-[...]` values that begin with one of those
  properties. Animate `transform` and `opacity` instead
  (`transition-transform`, `transition-[transform,opacity]`, `animate-spin`).
  `transition-colors` and `transition-shadow` are valid and are not flagged.
- `anti-slop/require-media-dimensions` requires `<img>`, `<video>` and
  `<iframe>` to reserve their box with explicit `width`/`height` attributes, an
  `aspect-ratio` style or `aspect-*` class, or fixed `h-`/`w-`/`size-` classes.
  Empty or spread-only media is ignored because the values cannot be proven
  statically.

Both rules have table-driven tests under
`tools/oxlint/anti-slop/rules/*.test.ts`; `pnpm test` includes them.

### Accessibility rules

The same oxlint config enables eslint-plugin-jsx-a11y's recommended rules
(`jsx-a11y/*`) for SolidJS JSX. Four rules are intentionally off:

- `label-has-associated-control` — Solid uses `for`, not React's `htmlFor`, and
  the shared `<Label>` primitive forwards its association through spread props,
  so the rule reports every label. Re-enable if upstream learns `for`.
- `control-has-associated-label` — off in the upstream recommendation and noisy
  for components whose children are dynamic.
- `prefer-tag-over-role` — suggests replacing deliberate `role="status"` live
  regions and Kobalte `role="group"` containers with elements that change the
  layout.
- `anchor-ambiguous-text` — off upstream and advisory only.

The remaining violations are real violations to fix, not suppressed with
comments.
