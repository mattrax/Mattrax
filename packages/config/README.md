# Shared TypeScript projects

The production base config excludes tests so declaration builds contain only
runtime code. `pnpm typecheck` then runs three dedicated projects:

- `tsconfig.tests.json` checks unit tests across packages and apps.
- `tsconfig.tooling.json` checks package and app scripts plus build configs.
- `tsconfig.portable.json` checks the designated browser-safe roots without Node
  typings: `@mattrax/email`, `@mattrax/management-backend`, and
  `@mattrax/crypto`.

## Legacy enterprise test exception

`tsconfig.tests.json` excludes `packages/enterprise-api/tests` and
`packages/enterprise-backend/tests`. These suites predate the Effect 4 migration
and currently produce 294 diagnostics: 186 in `enterprise-api` and 108 in
`enterprise-backend`.

The failures are fixture drift rather than production type errors:

- removed `EnterpriseServiceConfig.stripeClient` fields and other stale request
  or row shapes;
- the old one-argument `HttpApiBuilder.group` call shape;
- untyped fake-database callbacks and `unknown` JSON response bodies;
- strict-null checks on optional fixture fields;
- Effect layer and environment requirements that changed in Effect 4.

Reproduce the exact diagnostics with:

```sh
pnpm typecheck:legacy-tests
```

The suites can join the blocking CI project after their domain owners migrate
those fixtures. The Stripe SDK injection test and the MDM compliance suite have
already been migrated and are included in `tsconfig.tests.json`.
