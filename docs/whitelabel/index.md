# Whitelabel

Mattrax Whitelabel is a self-hosted MDM gateway for teams building their own device
management product. It exposes Apple enrollment, MDM, SCEP, and asset endpoints, then
delegates every product decision to your management backend over HTTP webhooks.

The gateway implementation lives in the `mttx` CLI (`apps/mttx`) and is packaged as
`@mattrax/server`.

::: danger The management layer stays separate from the data layer
Whitelabel is a protocol gateway, not an Enterprise deployment. It must never import
`@mattrax/enterprise-*` or use the Enterprise database. It has no tenants, devices,
groups, policies, billing, dashboard, or API tokens.

```
Apple device ──► mttx gateway ──► your management backend (webhooks)
                      │
                      └── SCEP CA state (scep-ca.json)
```

Your backend owns devices, inventory, policy, commands, branding, and push delivery.
:::

## What the gateway does

| Area       | Responsibility                                                                |
| ---------- | ----------------------------------------------------------------------------- |
| Enrollment | Serves an Apple enrollment profile at `/mdm/apple/enroll`.                    |
| Apple MDM  | Receives check-in, command results, checkout, token updates and DDM messages. |
| SCEP       | Serves CA capabilities, CA certificate, and PKI operations.                   |
| Assets     | Proxies asset bytes fetched from your management backend.                     |
| Webhooks   | Calls your backend for events, commands, declarations, and assets.            |
| Health     | Exposes `/health`.                                                            |

It does **not** schedule commands, store inventory, compile policies, send APNs pushes,
render a dashboard, or provide user accounts.

## Contents

| Page                              | Description                                                       |
| --------------------------------- | ----------------------------------------------------------------- |
| [Server overview](./server)       | Architecture, runtime responsibilities, persistence and branding. |
| [Running locally](./running)      | Development, CLI flags, standalone binary, systemd and Docker.    |
| [HTTP surface](./endpoints)       | Device-facing and operator endpoints.                             |
| [Management webhooks](./webhooks) | The contract your backend implements, including Windows methods.  |
| [Deployment](./deployment)        | Production checklist, TLS, APNs, health and backups.              |

## Availability

Whitelabel is in private beta. Contact [hello@mattrax.app](mailto:hello@mattrax.app) for
access. Mattrax can host the gateway for you or provide a binary deployable on any Linux
server. We want to work directly with implementors so the contract fits real products.

## Choosing between Whitelabel and Cloud

| Need                                               | Use                              |
| -------------------------------------------------- | -------------------------------- |
| Ready-made dashboard, tenants, billing, policies   | [Mattrax Cloud](../self-hosting) |
| Your own product UI and data model, Apple MDM only | Whitelabel gateway               |
| Full Enterprise API with API tokens                | Cloud / Enterprise               |

If you need tenant management and policy storage, do not fork the gateway. Implement the
webhook contract in your own backend and keep the gateway stateless apart from its SCEP CA.
