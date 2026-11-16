# anti-slop

Vendored from https://github.com/dmmulroy/anti-slop (fork: `k-mistele/anti-slop`)
at revision `5360c123dfe89a20edab7b277099dd423247a8dd` on 2026-11-15.

The rules are intentionally local and may be customized for this repository.
Upstream license: MIT (see `LICENSE`).

## Local policy

Enabled additions from upstream:

- `max-ternary-depth` — ternary chains deeper than two levels become lookups,
  `switch`, or named decision functions.
- `no-conditional-spread` replaces the narrower
  `no-conditional-empty-object-spread`. This copy only flags object and JSX
  spreads: those decide which *properties* exist. Element and argument spreads
  are left alone because `...[maybe ?? []]` is an explicit default, not a hidden
  shape.
- `no-reprovide-ambient-service` — a service yielded from the environment is
  left in `R` instead of being re-provided with `Effect.provideService`.
- `no-manual-tagged-type` — required `_tag` declarations must come from a
  tagged Schema/Data constructor. Optional `_tag` properties are boundary
  probes (`{ readonly _tag?: string }`) and are allowed.
- `prefer-tagged-error-handling` — `Predicate.isTagged` inside a broad Effect
  catch handler should be `Effect.catchTag`/`catchTags`.

Upstream changes kept:

- `no-unsafe-dictionary-type` and `shared/type-alias-resolution` use explicit
  `.length > 0` checks instead of truthiness.
- `no-manual-tagged-construction` also rejects required `_tag` class fields.

Local deviations:

- `no-manual-tagged-construction` still only treats *literal* `_tag` values as
  construction, and skips `Match.when`/`Match.not` patterns. Test fixtures and
  wire envelopes legitimately build `_tag` objects from data.
- `require-readable-spacing` keeps the repository policy that allows adjacent
  single-line bindings to stay grouped (see the rule's source).
