# Whitelabel gateway

The whitelabel gateway lets you embed Mattrax's Apple and Windows device-management
protocols in your own product. It is a protocol gateway, not a cut-down Enterprise server:
it has no tenants, devices, groups, policies, billing or dashboard. You own the product and
the data; Mattrax terminates the vendor protocols and calls your management backend.

## Architecture

```text
Apple / Windows device
        │  MDM, SCEP, WSTEP, SyncML
        ▼
  mttx gateway (Node)  ──HMAC-signed webhooks──►  your management backend
        │                                              │
        └── SCEP CA on disk                            └── your database, UI, push
```

The gateway:

- Serves `/mdm/apple/*`, `/mdm/windows/*` and `/health`.
- Generates and stores a SCEP CA in `<data-dir>/scep-ca.json`, sealed with your auth secret.
- Forwards every device event to your backend over the management webhook contract.
- Never stores devices, policies, commands or push credentials.
- Never pushes to APNs. Your backend owns push delivery.

## What you implement

You implement the `ManagementBackend` contract:

- Apple check-in events, management manifests, DDM tokens/items/declarations, assets and
  profiles.
- Windows discovery, enrollment policy, enrollment and management check-in.
- Your own enrollment UI and profile generation.
- Push delivery and device state.

## Packages

The gateway and contract live in the workspace:

| Package                            | Purpose                                          |
| ---------------------------------- | ------------------------------------------------ |
| `@mattrax/management-backend`      | Service interface, types and errors              |
| `@mattrax/management-backend-http` | HTTP client and server handlers for the contract |
| `@mattrax/dm-apple`                | Apple MDM routes, handlers and profile builder   |
| `@mattrax/dm-windows`              | Windows WSTEP/SyncML routes and service          |
| `@mattrax/scep`                    | SCEP CA, PKI operations and challenge helpers    |
| `@mattrax/apns`                    | APNs transports and certificate helpers          |
| `@mattrax/policy-apple`            | Apple declaration/profile/command schemas        |

:::warning Workspace packages
These packages are `private`, version `0.0.0`, and export raw TypeScript source. They are
not published to npm. Consume them inside this monorepo or build/publish your own artifacts.
:::

## Choose your path

| You want…                                  | Use                                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| A hosted product with a dashboard          | [Mattrax Cloud](/getting-started/quick-start)                                                             |
| To run the full product yourself           | [Self-hosting](/operations/self-hosting)                                                                  |
| To embed Apple/Windows MDM in your product | This gateway                                                                                              |
| A working reference implementation         | [`apps/example-whitelabel`](https://github.com/oscartbeaumont/mattraxe/tree/main/apps/example-whitelabel) |

## Responsibilities

| Area               | Gateway          | Your backend                               |
| ------------------ | ---------------- | ------------------------------------------ |
| Apple MDM protocol | Yes              | —                                          |
| SCEP CA            | Yes (on disk)    | Back up the data directory and auth secret |
| Device state       | No               | Yes                                        |
| Policies           | No               | Yes                                        |
| Enrollment profile | No (returns 410) | Yes                                        |
| APNs push          | No               | Yes                                        |
| Windows protocol   | Yes              | Yes (implement Windows methods)            |
| Dashboard/UI       | No               | Yes                                        |

## Limitations

- `/mdm/apple/enroll` returns 410 in the shared handler. You must serve the enrollment
  profile yourself. See [Whitelabel enrollment](/operations/whitelabel/enrollment).
- The example Worker implements Apple only; its Windows methods return
  `ManagementNotSupported`.
- The gateway does not schedule pushes, send credential-expiry emails or run maintenance.
- The Node gateway applies a per-process limit of about 5 requests per second by default.
  Set `--rate-limit` or run multiple instances behind a proxy.
- The gateway does not expose a Scalar UI. It serves `/api/openapi.json`.
- There is no published gateway Docker image; build the server and package it yourself.

## Next

- [Management backend (TypeScript)](/operations/whitelabel/management-backend)
- [Whitelabel enrollment](/operations/whitelabel/enrollment)
- [Gateway deployment](/operations/whitelabel/deployment)
