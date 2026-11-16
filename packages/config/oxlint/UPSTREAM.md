# Vendored anti-slop

Source: https://github.com/K-Mistele/anti-slop

Synced from commit `b7c1619b4d51b4815e89ba3700a975a6ec54b8c3` on 2026-11-17, excluding the
model-backed Jev and diff-rule runners. The local plugin keeps two extra rules
(`no-layout-animating-transition`, `require-media-dimensions`) and this repository's
`vitest.config.ts`.

To update:

1. Clone the upstream repository.
2. Copy `src/` over `packages/config/oxlint/`, keeping the two extra rule files.
3. Re-add their imports and registrations to `index.ts`.
4. Run `pnpm lint`, `pnpm test`, and the normal CI checks.
