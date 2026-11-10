# Production readiness

This page tracks what is required to run mattRAXe for real fleets, what was
recently hardened, and what remains. It is intentionally separate from the
architecture notes in the porting plan.

## Recently hardened

- Cloud MDM/SCEP/Windows routes now receive their service layers, so
  `/mdm/apple/scep`, `/mdm/apple/mdm` and `/mdm/windows/*` no longer return 500
  from a missing service.
- Password-reset and passwordless email delivery is awaited inside the request
  instead of being dropped by a request-scoped scheduler. Delivery failures are
  logged.
- The development mailbox is restricted to loopback origins (or an explicit
  remote opt-in plus shared secret).
- Whitelabel management webhooks fail closed when no secret is configured.
- Product-key signatures use one shared hex encoding and timing-safe comparison.
- Cloud Windows MDM returns an explicit configuration response until a tenant
  is pinned; the docs no longer advertise an automatic tenant fallback.
- The dashboard Worker sends CSP, HSTS, `X-Frame-Options`, `nosniff` and a
  referrer policy. Preview URLs are disabled in production.
- Migration snapshots are present for every migration and `db:generate`
  produces no spurious diff.
- Daily maintenance runs via a Worker Cron Trigger: expired invitations, stale
  devices, expired auth proofs/sessions and audit retention.
- Device lists have server-side search, filters, sort, pagination and CSV export.
  Group detail loads only its own devices.
- `maxDevices = 0` means unlimited, and the enrollment page shows the Windows
  discovery URL and an accurate Android availability state.
- Device health rolls up enrollment state, last-seen age, declaration failures,
  FileVault and battery condition, reported disk pressure, and identity state,
  with a tenant dashboard summary and device detail card.
- DDM status items are persisted as device inventory (FileVault, battery health,
  model number, client capabilities, disk usage) with a tolerant parser for
  nested and flattened keys, exposed through the API, device detail and CSV
  export.
- Credential monitoring summarizes APNs and SCEP CA expiry with days-left
  badges on the tenant dashboard and a `GET /v1/tenants/:tenantId/credential-health`
  endpoint. Daily maintenance writes one audit event per tenant per expiry
  threshold (30/7/expired) per day; there is no email delivery yet.
- SCEP identities can be revoked per device; unenrollment/deletion revokes
  device-scoped certificates and renewal rejects revoked identities.

## Remaining production work

### P0 — required before selling to a real fleet

- **Apple ADE/ABM and VPP.** Zero-touch enrollment and Apps & Books licences are
  not implemented. Requires an ABM account and a supervised device to validate.
- **Android Enterprise delivery.** The AMAPI client exists, but enterprise
  signup, Pub/Sub handling and policy push are not mounted. Requires a Google
  Cloud project and a managed Android device. Until then Android must stay
  explicitly unavailable.
- **Tenant-scoped Windows enrollment.** Cloud Windows is deployment-wide until
  the discovery URL/token carries a tenant. Federated Entra enrollment is not
  implemented.
- **Apple per-device SCEP revocation.** Apple identities are tenant-scoped, not
  device-scoped, so per-device revocation currently applies to Windows only.
  Bind the issued certificate fingerprint to the device at check-in.
- **Global SCEP CA protection.** The CA private key is stored unencrypted in
  MySQL. Seal it with the application secret or a KMS key and document backup,
  rotation and recovery.
- **Stripe billing enforcement.** There is no webhook consumer and no
  subscription writes, so plans/seats are not enforced. Add a signature-verified
  webhook, subscription upsert and user-facing Stripe errors.

### P1 — operational and enterprise requirements

- **Audit log filtering/export/retention UI.** Backend retention exists; add
  query params, pagination, CSV/JSON export and system-actor events.
- **RBAC and scoped API tokens.** Current roles are owner/admin/member;
  tokens are account-wide. Add read-only/auditor roles, per-resource
  permissions and tenant/scoped tokens.
- **Generic SAML SSO and IdP group → role mapping.** Entra OIDC is supported;
  Okta/Google/OneLogin need SAML.
- **Scheduled/background work for large fleets.** Device policy/group pushes
  are still sequential in the request; move them to Queues (or at least bounded
  concurrency + `waitUntil`) and track retries.
- **Entra directory sync at scale.** Run as a background job with a lock,
  per-page transactions and incremental delta advancement.
- **Tenant branding.** Use `organization.logo` and a branding profile in the
  enrollment page, emails, Apple profile and DDM management declaration.
- **Policy conflict precedence and exclusions.** Assignments are additive; add
  priority, include/exclude scope and an effective-policy preview for a device.
- **Backups and tenant export/import.** Document and automate MySQL + R2
  backup/restore, and add a tenant export bundle.
- **Observability and abuse protection.** Add structured request logs, error
  tracking, dependency readiness checks and shared rate limiting for
  auth/SCEP/MDM/enrollment endpoints.
- **Credential expiry notifications.** Daily maintenance records an audit event
  per tenant/threshold, but no email is sent. Wire the audit event to the
  owner/admin mailbox once delivery dedupe is centralized.
- **Outbound timeouts and idempotency.** Add `AbortSignal.timeout` to APNs,
  Graph, Stripe and relay calls; make webhook/command delivery retry-safe.

### P2 — product polish

- Outbound customer webhooks for enrollment/compliance events.
- Android QR/deep-link enrollment once AMAPI delivery lands.
- Split or serve the large Windows policy catalogue without shipping 17 MB.
- CSV formula-injection policy and export truncation signalling.
