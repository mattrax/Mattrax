# What is Mattrax?

Mattrax is device management infrastructure for Apple, Windows and Android fleets. It is
built as a set of product surfaces that share the same protocol and management layers, so
a hosted deployment, a self-hosted deployment and a whitelabel gateway behave the same way
on the wire.

| Surface                | What you get                                                                                         | Runs on                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Mattrax Cloud**      | Dashboard, REST API, MDM endpoints, tenant isolation, SSO/SCIM, audit, webhooks, billing and backups | Two Cloudflare Workers plus MySQL, R2 and Email |
| **Self-hosted Cloud**  | The same product on infrastructure you control                                                       | Cloudflare Workers, Hyperdrive, R2 and MySQL    |
| **Whitelabel gateway** | Apple and Windows protocol termination for your own product, with a management webhook you implement | Node 22 (`mttx serve`) or the example Worker    |
| **Protocol packages**  | Apple MDM, Windows MDM, Android Management, SCEP, APNs and the management contract                   | TypeScript workspace packages                   |

:::tip Choosing a path
If you want a dashboard and an API for a fleet, start with [Quick start](/getting-started/quick-start).
If you are embedding device management into your own product, read
[Whitelabel](/operations/whitelabel/) before deploying anything — it is a gateway, not a
cut-down Cloud server.
:::

## Platform support

The code paths below are implemented. "Validation" is separate: some flows are covered by
fixtures and unit tests but have not yet been exercised against real hardware or a real
vendor tenant.

| Capability             | Apple                                                                                          | Windows                                   | Android                                |
| ---------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------- |
| Enrollment             | Profile link + SCEP + MDM payload                                                              | WSTEP discovery/policy/enroll             | AMAPI enrollment token / QR            |
| Zero-touch             | ABM/ADE assignment (profile delivery caveat)                                                   | Autopilot import and profiles             | Google signup + policy                 |
| Policy delivery        | DDM declarations + legacy profiles                                                             | SyncML OMA-URI                            | AMAPI policy                           |
| Push                   | APNs                                                                                           | Device polling                            | Google Pub/Sub                         |
| Remote actions         | Sync, lock, wipe, restart, shutdown, clear passcode, install app, security info, app inventory | Wipe, restart                             | Wipe, restart, lock, policy sync       |
| Inventory              | DDM status items, `SecurityInfo`, installed applications                                       | Minimal (Autopilot metadata)              | Model, manufacturer, serial, OS, state |
| Compliance             | Derived device health (not a policy engine)                                                    | Derived device health                     | Derived device health                  |
| Real-device validation | Partial; see [readiness](/reference/production-readiness)                                      | Partial; Entra/Autopilot OOBE outstanding | Outstanding                            |

## How the pieces fit

```text
┌──────────────────────────────────────────────────────────────┐
│ Dashboard, docs, public enrollment            apps/web       │
│        │ service binding                                     │
│        ▼                                                     │
│ API + MDM + SCIM + SSO + billing              apps/api       │
│        │                                                     │
│        ├── enterprise-backend  (tenants, policies, devices)  │
│        ├── management-backend-enterprise (Apple/Windows)     │
│        └── dm-android          (AMAPI + Pub/Sub)             │
└──────────────────────────────────────────────────────────────┘

Whitelabel:  device ──► mttx gateway ──► your management webhook
```

The hosted product and the gateway deliberately do not share product state. Whitelabel
deployments import the protocol and management layers, never `@mattrax/enterprise-*`.

## Where to go next

- [Quick start](/getting-started/quick-start) — create a tenant and enroll a device.
- [Core concepts](/getting-started/concepts) — tenants, groups, policies and assignments.
- [Apple](/platforms/apple/) · [Windows](/platforms/windows/) · [Android](/platforms/android/)
- [Manage devices](/manage/devices) — search, inventory, health and actions.
- [Self-hosting](/operations/self-hosting) — run Cloud on your own Cloudflare account.
- [REST API](/api/) and [API reference](/api/reference).
- [Migration](/migration/) — move from another MDM.
