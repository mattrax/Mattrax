# MDM compliance CLI

A standalone device emulator and protocol compliance checker for Mattrax's
Apple, Windows, Android and SCEP management endpoints. It runs real protocol
requests through the production route layers in-process, with deterministic
device fixtures and mocked management backends.

## Run

```bash
pnpm --filter @mattrax/mdm-compliance start
```

Or invoke the source entrypoint directly:

```bash
pnpm exec tsx apps/mdm-compliance/src/index.ts
```

## Filters

```bash
# One protocol
pnpm --filter @mattrax/mdm-compliance start -- --platform apple

# One or more categories
pnpm --filter @mattrax/mdm-compliance start -- --category certificates,day-n

# Text search over ids, names, descriptions and categories
pnpm --filter @mattrax/mdm-compliance start -- --check renewal

# Machine-readable output for CI
pnpm --filter @mattrax/mdm-compliance start -- --json

# List without executing
pnpm --filter @mattrax/mdm-compliance start -- --list
```

The CLI exits non-zero when any check fails. `--fail-fast` stops at the first
failure and `--timeout` sets a per-check deadline.

## What it exercises

| Platform | Coverage                                                                                                                                                                                                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple    | Enrollment profile, Authenticate, device/user TokenUpdate, CheckOut, command poll/ack/error, ClearPasscode binary payloads, bootstrap token escrow, DDM tokens/items/declarations/status, signed profile and asset URLs, 410 unenrollment, malformed input, required message signatures, APNs token rotation and DDM re-sync |
| Windows  | Discovery, policy and renewal windows, WSTEP enrollment, provisioning document and tenant-token preservation, SyncML session/status/ack/Get/Replace/Exec/Final handling, SOAP faults, unknown devices, re-enrollment                                                                                                         |
| Android  | Signup callback state checks, Pub/Sub envelope and base64/JSON validation, OIDC bearer verification, notification-type/state/command mapping, ENROLLMENT/COMMAND delivery, message-id idempotency, policy compile/merge/hash stability and day-N policy changes                                                              |
| SCEP     | GetCACaps, GetCACert, PKCSReq issuance, CertRep success/failure attributes, challenge rejection, malformed CMS, CSR integrity, CA reuse, renewal, unknown/expired identities and foreign signers                                                                                                                             |

Checks tagged `day-N` cover operations that happen after initial enrollment,
such as certificate renewal, APNs token rotation, DDM re-sync and policy
changes.

## Architecture

- `src/harness/*` builds real Effect route layers with mocked
  `ManagementBackend`, `ScepRepository`, `AndroidManagement` and an in-memory
  database.
- `src/fixtures/*` generates PKI material (CA, CSR, PKCSReq, CertRep parsing)
  at runtime, so no checked-in protocol fixtures are required.
- `src/checks/*` contains the protocol assertions.
- `src/runner.ts` filters, executes and reports checks.

The checks are local-only and never contact Apple, Google, Microsoft or a live
Mattrax deployment.
