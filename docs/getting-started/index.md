# What is Mattrax?

Mattrax is device management infrastructure for Apple, Windows and Android fleets. The
dashboard, REST API, MDM endpoints, SSO/SCIM, audit, webhooks, billing and backups all live
in one product, so every surface behaves the same way on the wire.

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

## Where to go next

- [Quick start](/getting-started/quick-start) — create a tenant and enroll a device.
- [Core concepts](/getting-started/concepts) — tenants, groups, policies and assignments.
- [Apple](/platforms/apple/) · [Windows](/platforms/windows/) · [Android](/platforms/android/)
- [Manage devices](/manage/devices) — search, inventory, health and actions.
- [REST API](/api/) and [API reference](/api/reference/).
- [Migration](/migration/) — move from another MDM.
