# Mattrax

Mattrax is open device management infrastructure for Apple and Windows fleets. This
repository contains the product surfaces, protocol implementations, and the self-hosted
gateway used by whitelabel deployments.

## Products

| Surface                  | What it is                                                                                                                        | Where it runs                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Mattrax Cloud**        | The hosted Enterprise product: dashboard, REST API, tenant enrollment, Apple MDM and SCEP.                                        | Cloudflare Workers (`apps/api`, `apps/web`) |
| **Mattrax Enterprise**   | The product layer for tenants, members, devices, groups, policies, billing and API tokens.                                        | `packages/enterprise-*`, served by Cloud    |
| **Mattrax Whitelabel**   | A protocol gateway for building your own MDM product. It terminates Apple MDM and SCEP traffic and calls your management backend. | `apps/mttx` (Node) or a Worker (example)    |
| **Mattrax Platform API** | Endpoints for platform services such as licensing and MDM root certificates. Currently only a health/status stub.                 | `apps/api`                                  |

::: warning Whitelabel data-layer separation
The whitelabel gateway is **not** an Enterprise deployment. It contains no device,
group, policy, or billing database, and it must never import `@mattrax/enterprise-*`.
All product decisions are delegated to the management backend you control. See
[Whitelabel](./whitelabel/).
:::

## Supported platforms

| Platform    | Status                                                                                                                                                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Apple**   | Supported. Enrollment profile, SCEP identity certificate, MDM check-in, APNs credentials and declarative management (DDM) configuration delivery.                                                                                         |
| **Windows** | Preview. Discovery, WSTEP certificate issuance and SyncML check-in are mounted in `apps/api` and `apps/mttx`. Policy/command delivery is the next phase; configure `WINDOWS_ORGANIZATION_ID` so Windows devices land in the right tenant. |
| **Android** | Not available. There is no Android device-management backend in this repository. The enrollment toggle is present but does not provide a working enrollment flow.                                                                         |

## How the pieces fit

```text
Cloud dashboard (apps/web)
        │  service binding
        ▼
Cloud API Worker (apps/api)
        ├── Enterprise API        tenants, devices, groups, policies, billing, tokens
        ├── Apple MDM + SCEP      /mdm/apple/*
        ├── Windows MDM          /mdm/windows/*
        └── management backend    DB-backed implementation (@mattrax/management-backend-enterprise)

Whitelabel gateway (apps/mttx)
        ├── Apple MDM + SCEP      /mdm/apple/*
        └── management webhook    HTTP calls to your backend (@mattrax/management-backend-http)
```

Both deployments share the same protocol packages (`@mattrax/dm-apple`, `@mattrax/scep`)
and the same management-backend contract. Only the management backend differs: Cloud uses
a database-backed implementation, whitelabel uses HTTP webhooks.

## Next steps

- [Quick start](./quick-start) — enroll your first device and apply a policy.
- [Self-hosting](./self-hosting) — deploy Cloud on Cloudflare or run the whitelabel gateway.
- [Enterprise overview](./enterprise/overview) — tenants, roles, billing and API tokens.
- [Whitelabel](./whitelabel/) — the management webhook contract and gateway operations.
