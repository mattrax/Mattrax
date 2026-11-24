# Shared TypeScript projects

The production base config excludes tests so declaration builds contain only
runtime code. `pnpm typecheck` then runs three dedicated projects:

- `tsconfig.tests.json` checks unit tests across packages and apps.
- `tsconfig.tooling.json` checks package and app scripts plus build configs.
- `tsconfig.portable.json` checks the designated browser-safe roots without Node
  typings: `@mattrax/email`, `@mattrax/management-backend`, and
  `@mattrax/crypto`.

## Enterprise test coverage

`tsconfig.tests.json` includes the enterprise API and backend suites, so the
blocking `pnpm typecheck` command checks their fixtures alongside every other
unit test. A focused check remains available for quicker iteration:

```sh
pnpm typecheck:legacy-tests
```
