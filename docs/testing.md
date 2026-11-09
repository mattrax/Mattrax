# Testing

Mattrax has two complementary test layers. Both run in CI, and both are expected
to be green before a deployment.

## Unit and integration tests

```bash
pnpm test
```

Vitest projects live beside each package (`packages/*/vitest.config.ts` and
`apps/*/vitest.config.ts`). They cover:

- Apple MDM check-in, token update, declarative management, checkout and
  enrollment-profile shape (including the `com.apple.mdm.token` capability that
  Fleet requires).
- SCEP capabilities, PKCS#7 handling, certificate issuance and challenge
  validation.
- Windows WSTEP/SyncML serialization and enrollment.
- APNs CSR generation, certificate parsing, secret sealing and every push
  transport (Node, Workers mTLS, hosted relay, no-op).
- Enterprise handlers: tenant scoping, device/group/policy CRUD, APNs
  lifecycle, push fan-out, billing summaries and auth.
- Management webhook transport.

Run a single package with `pnpm vitest run --project <name>` or pass a file path.

## Browser tests (CDP)

```bash
pnpm web dev      # terminal one
pnpm test:e2e     # terminal two
```

Playwright drives Chrome through CDP by default (`channel: "chrome"`). The suite
creates unique users and tenants, so it can run against a disposable local or
staging database. Set:

- `E2E_BASE_URL` to target an already-running deployment instead of starting the
  dev server.
- `E2E_CHANNEL=bundled` to use Playwright's bundled Chromium (CI does this).

Coverage includes registration and login, tenant creation and switching,
collapsed-sidebar persistence, every sidebar section, the mobile drawer, tenant
settings tabs, the APNs wizard, group/policy CRUD, the policy editor and the
public enrollment page.

## Apple MDM parity suite

The Apple tests are adapted from Fleet's
[`server/mdm/apple`](https://github.com/fleetdm/fleet/tree/main/server/mdm/apple)
suite. Fleet's assertions around enrollment-profile payload structure, the
`com.apple.mdm.token` capability and SCEP capabilities are ported into the
`dm-apple` and `scep` Vitest projects. Keep those tests aligned when changing
the enrollment profile or SCEP surface.

## CI

`.github/workflows/ci.yml` runs:

1. Unit tests, typecheck and the documentation build.
2. The CDP browser suite against a MySQL service with Chromium.

To run the full stack locally, `pnpm db:up` starts MySQL, `pnpm db:migrate`
applies migrations, and `pnpm web dev` serves the dashboard and API Worker.
