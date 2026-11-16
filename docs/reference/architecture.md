# Architecture

Mattrax is a TypeScript monorepo. Protocol code is shared; product decisions are not. That
boundary keeps protocol handling independent from product state.

## Layers

| Layer               | Packages / apps                                                 | Responsibility                                 |
| ------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| Protocol            | `dm-apple`, `dm-windows`, `dm-android`, `scep`, `soap`, `plist` | Wire protocols and payloads                    |
| Management contract | `management-backend`, `management-backend-http`                 | Interface and HMAC webhook binding             |
| Hosted management   | `management-backend-enterprise`, `apps/api`                     | Enterprise implementation                      |
| Product contracts   | `enterprise-domain`                                             | Effect HTTP contracts and schemas              |
| Product backends    | `enterprise-backend`                                            | Handlers, services, integrations               |
| Data                | `enterprise-core`                                               | Drizzle/MySQL schema, R2, secrets, plan limits |
| Surfaces            | `apps/web`, `apps/api`, `apps/apns-relay`, `apps/mail-relay`    | Dashboard, API, push and SMTP relays           |

## Cloud topology

```text
Browser ──► Mattrax web Worker (public)
              │  /api/*, /mdm/*, /scim/*
              ▼
           API Worker (service binding)
              ├── MySQL via Hyperdrive
              ├── R2 (application files, backups)
              ├── Email: Cloudflare Email Sending, Resend/Postmark, or the
              │   self-hosted mail-relay sidecar (SMTP)
              ├── email_outbox (queued transactional mail, drained by cron)
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
- Session client descriptors are captured on first authenticated use (the auth library
  owns session creation) and store a browser/platform family plus a salted address digest,
  never the raw `User-Agent` or address.
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
- `device` (identity, management name, physical name, the cross-platform inventory
  columns, Windows security/join state and the applied OMA-URI delivery set),
  `device_apple` (policy delivery mode, ADE awaiting-setup/configured state, Return to
  Service request clocks and the security-report clocks),
  `device_secret` (sealed recovery key, bootstrap token, activation-lock bypass code,
  managed local-admin password and Recovery Lock password), `device_command` (device or one
  Apple user channel via `user_id`), `device_apple_user` (per-user Apple channel: identity names, push credentials,
  bind time, last check-in and reported profiles), `device_declaration`,
  `device_application` (Apple bundle ids, Android package names and Windows product/registry
  keys share one table).
- `enterprise_group`, `group_device`, `group_policy`, `device_policy`.
- `attribute_definition` (tenant registry: key, label, type, options, required,
  visibility), `device_attribute` (one canonical value per device and definition with the
  writing user and timestamp), `enrollment_question` (which attributes the public
  enrollment page asks for) and `enrollment_answer` (answers keyed by tenant and serial
  until the device checks in).
- `policy`, `configuration`, `policy_deployment`.
- `application`, `application_group`, `application_device`.
- `script`, `script_assignment` (device or group target, tenant-scoped), `script_execution`
  (queued/terminal run per device with capped output and a unique
  `(device, script, dedupe_key)` index). `organization.scripts_enabled` is the tenant
  opt-out.
- `apple_push_certificate`, `apple_push_key`, `apple_business_manager`, `abm_device`,
  `vpp_token`, `vpp_asset`, `device_vpp_assignment`.
- `scep_ca` (one active CA per tenant, unique `organization_id`), `scep_ca_trust`
  (certificate-only, `onDelete: cascade` retained CAs and their trust deadline during a
  rotation overlap), `scep_challenge`, `scep_issued_certificate` (now records the issuing
  CA's SHA-256 fingerprint).
- `server_certificate_health` (one row for the deployment origin: the latest scheduled TLS
  probe with expiry, subject/issuer, chain length, validation result and probe error).
- `apple_fde_escrow_key` (one per tenant: escrow certificate plus the AES-GCM-sealed
  private key used to unwrap CMS recovery keys).
- `autopilot_profile`, `autopilot_device`, `android_enterprise`, `android_device` (AMAPI
  resource name, policy hash and the Android-only inventory columns).
- `audit_log`, `webhook_endpoint`, `webhook_delivery`, `backup_run`, `subscription`,
  and `email_outbox` (one row per transactional message, claimed and retried by the
  cron with exponential backoff and a permanent-failure audit entry).
- `account_audit_log` (account-scoped audit, nullable `subject_user_id` so the deletion
  record survives), `account_session_context` (client descriptor per session id),
  `account_email_change` (single-use confirm/cancel token digests) and `account_recovery`
  (proof/approval/completion token digests for break-glass recovery).
- `organization.require_mfa` is the tenant-wide MFA requirement; `sso_config.require_mfa`
  is legacy and only read by the backfill migration.
- `tenant_deletion`: the teardown journal (no foreign key to `organization`, so it
  survives the row) and the retry record for device unenroll, Stripe cancellation, object
  reclamation and the final delete.

Migrations live in `apps/api/migrations` and are applied with Drizzle Kit.

## Script execution

Scripts are a product feature with a device-facing edge:

1. The dashboard queues a manual run (or an assignment changes).
2. Apple check-in builds one `com.mattrax.script` `.mobileconfig` per assigned script and
   installs it with the existing `InstallProfile` command. The diff comes from the
   device's command history, like legacy policy delivery, so no extra state table is
   needed. A queued run changes the payload's `RunID`.
3. The on-device agent (`apps/agent`) runs the body on its trigger and posts the result to
   `POST /api/v1/script-agent/results` with an HMAC device token derived from
   `AUTH_SECRET`. The token embeds the device id; the handler resolves the device and
   filters by its organization, so a token can never cross tenants.
4. The server caps and redacts output again, stores the terminal row, and writes a
   `script.run_completed`/`script.run_failed` audit entry against the device.
5. Maintenance expires queued runs past their 24-hour deadline and prunes terminal history
   past 30 days.

The agent group (`ScriptAgentApi`) is deliberately not part of the browser client
contract: it authenticates with a device token and no session.

Windows has no arbitrary-script CSP; Microsoft's supported route is an agent (the Intune
Management Extension is the same design). The agent sync endpoint returns assigned scripts
and pending run ids for a Windows agent. Android Management API exposes no script command,
so Android devices are skipped with a reason.

## Protocol boundaries

- Apple: `PUT /mdm/apple/mdm`, `/mdm/apple/scep/<organizationId>`, expiring
  device-bound asset URLs and signed profiles.
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
