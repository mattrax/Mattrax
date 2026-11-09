# Testing

Mattrax has two complementary test layers. Both run in CI, and both are expected
to be green before a deployment.

## Unit and integration tests

```bash
pnpm test
```

Vitest projects live beside each package (`packages/*/vitest.config.ts` and
`apps/*/vitest.config.ts`). They cover:

- Apple MDM check-in, token update, checkout, JSON declarative-management
  tokens/declaration items, base64 DDM status reports, declaration status
  persistence and enrollment-profile shape (including stable payload UUIDs and
  the `com.apple.mdm.token` capability that Fleet requires).
- Remote command delivery: queued commands on check-in, `Idle`/`NotNow` result
  handling, lock/erase/restart/shutdown/clear-passcode/InstallApplication
  payloads, and per-user Apple push credentials.
- SCEP capabilities, PKCS#7 handling, CSR signature verification, certificate
  issuance, client-auth EKU and challenge validation.
- Windows WSTEP/SyncML serialization, enrollment, SyncML policy delivery,
  response message IDs, certificate-required check-in and remote erase/reboot.
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
suite and Fleet's integration MDM tests. The ported cases live in:

- `packages/dm-apple/src/tests/fleet-port.test.ts` — enrollment profile
  structure, stable payload UUIDs, SCEP identity reference, server capabilities
  (`TestGenerateEnrollmentProfileMobileconfig`,
  `TestEnrollmentProfileServerCapabilities`).
- `packages/dm-apple/src/tests/handlers.test.ts` — check-in, command polling,
  JSON DDM endpoints and DDM status decoding.
- `packages/management-backend-enterprise/src/tests/policy.test.ts` — profile
  validation, Windows OMA-URI policy validation, asset declarations.
- `packages/management-backend-enterprise/src/tests/scep.test.ts` — SCEP
  challenge authentication and tenant binding.
- `packages/management-backend-enterprise/src/tests/windows.test.ts` — WSTEP
  enrollment, Windows policy/commands and certificate-required check-in.

Fleet is a Go project. To inspect or run its own suite:

```bash
git clone --depth 1 https://github.com/fleetdm/fleet.git ~/gh/fleetdm/fleet
cd ~/gh/fleetdm/fleet
go test ./server/mdm/apple/... ./server/mdm/scep/...
```

The machine running these tests needs Go 1.23+ and Fleet's database setup for
the integration tests (`server/service/*_test.go`). Our CI does not run the Go
suite; it runs the ported Vitest cases so protocol regressions fail in
`pnpm test`.

## Real-device checklist

Before shipping an MDM change, exercise these on a disposable macOS/iOS device
and a Windows VM:

1. Enroll through a tenant enrollment link; verify the profile installs one
   SCEP payload and one MDM payload.
2. Confirm `Authenticate`, `TokenUpdate` and a DDM `tokens` /
   `declaration-items` sync succeed.
3. Verify declarations appear as `active`/`valid` in `device_declaration` after
   a status report.
4. Change a policy and confirm the device re-syncs.
5. Queue lock/erase/restart/shutdown/clear-passcode and an app install; confirm
   each command result updates `device_command`.
6. On Windows, enroll, verify policy `Replace` commands and run erase/restart.
7. Re-enroll the device and confirm the new SCEP identity keeps the tenant OU.
   (Automatic SCEP renewal is not implemented; devices must re-enroll before the
   identity certificate expires.)

## CI

`.github/workflows/ci.yml` runs:

1. Unit tests, typecheck and the documentation build.
2. The CDP browser suite against a MySQL service with Chromium.

To run the full stack locally, `pnpm db:up` starts MySQL, `pnpm db:migrate`
applies migrations, and `pnpm web dev` serves the dashboard and API Worker.
