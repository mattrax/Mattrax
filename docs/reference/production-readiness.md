# Production readiness

This page separates what is implemented and hardened from what still needs real-device or
real-vendor validation. It is a status page, not a marketing page.

## Implemented and hardened

- Tenant isolation, roles (`owner`, `admin`, `member`, `auditor`), scoped API tokens and
  optional tenant binding.
- Passkey authentication with optional authenticator-app MFA, session revocation and step-up for sensitive actions.
- Entra OIDC SSO, SCIM 2.0 and Entra directory sync with delta cursors and locking.
- Apple manual enrollment with CMS-signed profiles, per-tenant SCEP CAs (bootstrap,
  import, rotation), APNs push, DDM with capability/OS gating and a legacy-profile
  fallback, OS-scoped declaration delivery, expiring device-bound asset links,
  certificates, custom declarations, per-tenant FileVault escrow keys with CMS unwrap on
  reveal, activation-lock bypass-code collection, Recovery Lock, installed-app inventory
  and device health.
- Apple Business Manager OAuth, device sync, MDM server assignment and signed ADE profile
  URLs.
- Apps & Books location tokens, asset sync, device licence assignment and release.
- Windows WSTEP enrollment, SyncML OMA-URI `Replace`/`Delete` delivery with applied-state
  tracking and command history, wipe/restart/unenroll, security inventory (BitLocker, TPM,
  Secure Boot, domain/Entra join) and Entra federated token validation.
- Autopilot hardware-hash import, Graph sync, deployment profiles and group assignment.
- Android Enterprise signup, enrollment tokens, Pub/Sub, policy delivery, device
  inventory, installed-application inventory and commands.
- Audit search/export, outbound webhooks with HMAC signatures and retries, Stripe billing
  with a transactional event-id ledger, plan limits, tenant export/import, scheduled
  backups with pin/unpin/delete and in-place restore, and complete tenant teardown
  (device unenroll, billing cancellation, object reclamation, retry journal).
- SCIM bearer tokens with a 90-day default expiry (365-day cap), expired-token rejection
  and rotation reminders.
- Security headers, request ids, structured logs, readiness checks for database, object
  storage and mailer (storage and mailer probes are memoised per isolate for 30 seconds
  so a readiness poller does not write to the bucket on every request), rate limits
  (credential buckets fail closed if a configured edge limiter is unavailable) and
  optional PostHog product analytics and error tracking.
- An SSR shell snapshot bound to a signed session-revision cookie and invalidated on
  sign-out, session revoke, passkey removal, TOTP disable and email change.
- A per-deployment `/sitemap.xml` and `/robots.txt` generated from the request origin,
  `Organization` JSON-LD on the landing page and `BreadcrumbList` JSON-LD on every
  documentation page. Public pages and docs render without JavaScript; the dashboard
  renders a styled notice instead of an empty shell.
- Cloudflare Workers deployment for the dashboard and API, and a Node gateway for
  .

## Validation gaps

These are implemented but not proven end to end in this repository.

| Area                    | Gap                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Apple ADE               | `Authenticate` does not return the ADE profile; zero-touch needs the signed URL                                                 |
| Apple FileVault         | Escrow key generation, CMS unwrap and rotation are fixture-tested; not validated on real supervised hardware                    |
| Apple app inventory     | Fixture-tested; refreshed daily by maintenance and on demand, not validated on real hardware                                    |
| Apple activation lock   | Bypass-code collection and Recovery Lock are fixture-tested; not validated on real Apple silicon                                |
| Windows federated Entra | Handshake fixture-tested, not real hardware                                                                                     |
| Windows Autopilot       | OOBE not validated; timezone not sent to Graph                                                                                  |
| Windows inventory       | None                                                                                                                            |
| Windows security        | BitLocker/TPM/Secure Boot/join nodes are fixture-tested, not validated across every Windows edition                             |
| Windows unenroll        | Server-initiated and `1226` device-initiated paths are unit-tested, not validated on real hardware                              |
| Android                 | Signup, Pub/Sub, QR/token enrollment, policy convergence and commands not validated against real Google Cloud/managed devices   |
| Android apps            | Inventory ingested from `applicationReports`; no app distribution, not validated on real devices                                |
| Apple OS scoping        | Delivery filtering is fixture-tested against Apple's published `supportedOS`; not confirmed on every OS build                   |
| Compliance              | Derived health only; no policy engine or Conditional Access                                                                     |
| Bulk work               | Synchronous; no Cloudflare Queues or job ids                                                                                    |
| Backups                 | No off-site copy or restore drills; tenant bundles exclude members/devices/audit/SCEP                                           |
| Tenant teardown         | Apple unenroll depends on a check-in racing the delete; Windows devices always need manual retirement and are reported as such  |
| Observability           | No metrics endpoint; readiness checks are bounded but the underlying query is not cancelled on timeout                          |
| SSO                     | Entra OIDC only; no SAML, no IdP group-to-role mapping                                                                          |
| Account recovery        | Ceremony, rate limits and approval rules are unit-tested; not yet rehearsed against a real mailer or a self-hosted operator run |
| MCP OAuth               | Route-level boundary tests cover redirect, PKCE, client binding, code/refresh single use; not driven by a real MCP client       |
| Ledger retention        | `stripe_event` and expired SCIM token rows have no scheduled prune yet                                                          |
| Migration               | No vendor connectors; CSV/export primitives only                                                                                |

## Production checklist

### Deployment

- [ ] `ORIGIN` is the public HTTPS origin.
- [ ] `AUTH_SECRET` is generated, backed up and not rotated without re-sealing.
- [ ] Hyperdrive points at a managed MySQL with TLS and `caching.disabled` is `true`.
- [ ] R2 bucket and Email Sending are configured.
- [ ] Migrations are applied before deploying code.
- [ ] `/api/health` and `/api/ready` return 200.
- [ ] Security headers are present.
- [ ] `/robots.txt` names `<origin>/sitemap.xml`, and `/sitemap.xml` lists every public
      page and docs page but no `/dashboard`, `/t/` or `/api/` URL.
- [ ] Rate-limit namespaces are configured for every bucket. A deployment without one
      still builds, but credential routes use the weaker per-isolate fallback instead of
      failing closed.
- [ ] PostHog project key is configured for analytics and error tracking.
- [ ] Daily and hourly crons are enabled.

### Identity

- [ ] At least two owners.
- [ ] At least two passkeys (and optionally TOTP) enrolled for owners/admins.
- [ ] SSO configured and tested.
- [ ] SCIM or directory sync tested.
- [ ] SCIM tokens have an expiry and a documented rotation date.
- [ ] Break-glass recovery rehearsed: the procedure is documented and audited, and at least
      one owner knows how to approve a co-owner's recovery and how to run the operator path
      when the mailer is down.

### Apple

- [ ] APNs certificate valid and monitored.
- [ ] Enrollment link tested on macOS and iOS.
- [ ] ABM credential uploaded and devices assigned.
- [ ] ADE profile URL tested.
- [ ] VPP token uploaded and a licence installed.
- [ ] FileVault escrow key generated, escrow profile deployed and a key revealed on a real Mac.
- [ ] Activation Lock bypass code collected before Activation Lock is enabled, and revealed.
- [ ] Recovery Lock set, verified and cleared on Apple silicon.
- [ ] Pre-DDM fallback confirmed: a macOS 12/iOS 14 device receives profiles, not a DDM sync.
- [ ] App inventory refresh confirmed.

### Windows

- [ ] Tenant-scoped discovery URL tested.
- [ ] WSTEP enrollment and certificate renewal tested.
- [ ] OMA-URI policy applied and verified.
- [ ] Entra SSO tested.
- [ ] Autopilot pilot completed.
- [ ] Federated enrollment tested in a lab.

### Android

- [ ] Service account and Pub/Sub configured.
- [ ] Signup completed.
- [ ] QR/token enrollment tested.
- [ ] Policy convergence verified.
- [ ] Commands verified.

### Operations

- [ ] MySQL and R2 backups running.
- [ ] A restore has been rehearsed.
- [ ] Credential expiry alerts reach an owner.
- [ ] Webhook signing verified by the receiver.
- [ ] Audit retention and export tested.
- [ ] Incident runbook and contact list exist.

## Known backlog themes

- Zero-touch ADE profile delivery.
- Real-device validation for Apple security commands, Windows federated/Autopilot and
  Android.
- Compliance/conditional access integration.
- Queues/job ids for bulk operations.
- Off-site backups and restore drills.
- Metrics and indexed fleet aggregation.
- SAML SSO and role mapping.
- Vendor migration connectors.
- Windows inventory and app deployment.
- Android app management and Google device deletion.

## Next

- [Architecture](/reference/architecture)
- [Troubleshooting](/operations/troubleshooting)
