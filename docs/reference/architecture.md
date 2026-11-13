# Architecture

Mattrax is a TypeScript monorepo. Protocol code is shared; product decisions are not. That
boundary keeps protocol handling independent from product state.

## Layers

| Layer               | Packages / apps                                                                 | Responsibility                                 |
| ------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| Protocol            | `dm-apple`, `dm-windows`, `dm-android`, `scep`, `soap`, `plist`, `policy-apple` | Wire protocols and payloads                    |
| Management contract | `management-backend`, `management-backend-http`                                 | Interface and HMAC webhook binding             |
| Hosted management   | `management-backend-enterprise`, `apps/api`                                     | Enterprise implementation                      |
| Product contracts   | `enterprise-domain`                                                             | Effect HTTP contracts and schemas              |
| Product backends    | `enterprise-backend`                                                            | Handlers, services, integrations               |
| Data                | `enterprise-core`                                                               | Drizzle/MySQL schema, R2, secrets, plan limits |
| Surfaces            | `apps/web`, `apps/api`, `apps/apns-relay`                                       | Dashboard, API, push relay                     |

## Cloud topology

```text
Browser ──► Mattrax web Worker (public)
              │  /api/*, /mdm/*, /scim/*
              ▼
           API Worker (service binding)
              ├── MySQL via Hyperdrive
              ├── R2 (application files, backups)
              ├── Email Sending
              └── APNs relay / vendor cert
```

The API Worker has no public route. Only the web Worker is exposed, which gives one origin
for cookies, CSP and WebAuthn.

## Request pipeline

1. Request id resolution.
2. Rate limiting (edge binding or per-isolate fallback).
3. Liveness short-circuit.
4. Readiness check for `/api/ready`.
5. Strip caller-supplied identity headers.
6. Rebuild identity from Cloudflare mTLS (`request.cf.tlsClientAuth`).
7. Build the per-request Effect layer.
8. Route through the HTTP contract.
9. Structured request log and optional error capture.
10. `x-request-id` on the response.

## Tenancy and auth

- Tenants are rows with isolated data and branding.
- Membership is `(user, tenant, role)`.
- Session cookie `__Host-mattrax_session`.
- Bearer tokens `mtx_...`, hashed at rest, scoped and optionally tenant-bound.
- Step-up grants are bound to account, session and action.
- Tenant-scoped queries always include the organization id.

## Secrets

| Secret                                    | Used for                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `AUTH_SECRET`                             | Sessions, sealed APNs/SCEP/device secrets, webhook secrets, WSTEP tokens |
| `CLOUD_APPLE_VENDOR_*`                    | APNs CSR signing                                                         |
| `APNS_RELAY_SECRET`                       | HMAC to the push relay                                                   |
| `STRIPE_*`                                | Billing                                                                  |
| `AZURE_CLIENT_SECRET`                     | Entra OIDC/Graph                                                         |
| `ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON` | AMAPI                                                                    |

Secrets are AES-GCM sealed with `AUTH_SECRET` before storage. Rotating `AUTH_SECRET`
requires re-sealing; there is no online re-wrap.

## Data model

Core tables:

- `organization` (tenant), `user`, `member`, `invitation`.
- `device`, `device_apple`, `device_secret`, `device_command`, `device_declaration`,
  `device_application`.
- `enterprise_group`, `group_device`, `group_policy`, `device_policy`.
- `policy`, `configuration`, `policy_deployment`.
- `application`, `application_group`, `application_device`.
- `apple_push_certificate`, `apple_push_key`, `apple_business_manager`, `abm_device`,
  `vpp_token`, `vpp_asset`, `device_vpp_assignment`.
- `autopilot_profile`, `autopilot_device`, `android_enterprise`, `android_device`.
- `audit_log`, `webhook_endpoint`, `webhook_delivery`, `backup_run`, `subscription`.

Migrations live in `apps/api/migrations` and are applied with Drizzle Kit.

## Protocol boundaries

- Apple: `PUT /mdm/apple/mdm`, SCEP, assets and signed profiles.
- Windows: discovery, policy, enroll and SyncML management.
- Android: AMAPI client, Pub/Sub receiver and policy delivery.
- Whitelabel: the same protocol routes, with the management contract over HTTP.

## Design constraints

- No Cloudflare Queues. Bulk work is synchronous with bounded concurrency.
- Health and inventory aggregation is application-side, not indexed.
- Dynamic groups are evaluated in application code.
- The API is versioned in the path (`/v1`).
- Additive response fields are not breaking changes.

## Key files

| File                                                    | Why                                     |
| ------------------------------------------------------- | --------------------------------------- |
| `apps/api/src/index.ts`                                 | Worker composition and request pipeline |
| `packages/enterprise-domain/src/enterprise.ts`          | REST contract                           |
| `packages/enterprise-backend/src/enterpriseHandlers.ts` | Enterprise handlers                     |
| `packages/management-backend-enterprise/src/index.ts`   | Apple/Windows management                |
| `packages/enterprise-core/src/schema.ts`                | Database schema                         |
| `packages/management-backend-http/src/layer.ts`         | Webhook signing                         |
| `packages/scep/src/pkcs7.ts`                            | SCEP CA and certificate issuance        |

## Next

- [Production readiness](/reference/production-readiness)
