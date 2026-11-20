# Production readiness

This page separates what is implemented and hardened from what still needs real-device or
real-vendor validation. It is a status page, not a marketing page.

## Implemented and hardened

- Tenant isolation, roles (`owner`, `admin`, `member`, `auditor`), scoped API tokens and
  optional tenant binding.
- Passkey authentication with optional authenticator-app MFA, session revocation and step-up for sensitive actions.
- Entra OIDC SSO, SCIM 2.0 and Entra directory sync with delta cursors and locking.
- Apple manual enrollment with CMS-signed profiles, per-tenant SCEP CAs (bootstrap,
  import, automatic five-year rotation with a verification overlap, expiry/health
  reporting), APNs push with key/topic/expiry health and renewal alerts, DDM with
  capability/OS gating and a legacy-profile
  fallback, OS-scoped declaration delivery, expiring device-bound asset links,
  certificates, custom declarations, per-tenant FileVault escrow keys with CMS unwrap on
  reveal, activation-lock bypass-code collection, Recovery Lock, installed-app inventory
  and device health. macOS/Shared iPad user channels are authenticated per device, store
  per-user push credentials and profiles, and carry per-user commands.
- Apple Business Manager OAuth, device sync, MDM server assignment, automatic ADE
  enrollment (Apple-signed Setup Assistant request), setup gating with
  `DeviceConfigured`, managed local administrators, Return to Service, and
  short-lived per-device profile links for manual installs.
- Apps & Books location tokens, asset sync, device licence assignment and release,
  automatic daily sync and catalogue entries created from purchased apps.
- Apple application delivery: manifest/store installs, uploaded `.pkg` installs through
  signed device-bound asset URLs, policy-attached applications and managed app
  configuration.
- Windows MSI delivery through `EnterpriseDesktopAppManagement`, with the command result
  and the daily MSI inventory reporting status.
- Android application delivery through the Managed Google Play policy, including install
  type and managed configuration from policy fragments.
- Third-party application templates (Chrome, Edge, Firefox, Slack, Zoom, Teams, VS Code,
  1Password) in the policy designer, stored as data.
- Scripts: tenant-scoped script resources (bash/zsh/sh/PowerShell, root or user,
  timeouts, secret environment values, manual/install/login/logout/network/interval/cron
  triggers), device and group assignment, a per-device execution queue with idempotency and
  24-hour expiry, capped and redacted stdout/stderr, per-device run history, a device
  timeline entry per agent-reported run, 30-day retention and a tenant opt-out. Apple
  delivery is a `com.mattrax.script` profile executed by `mattraxd` in `apps/mattraxd` (the
  release workflow signs and notarizes it when the credentials exist); `mattraxd` posts
  token-authenticated results. Step-up and audit cover
  every change and run.
- Windows WSTEP enrollment, SyncML OMA-URI `Replace`/`Delete` delivery with applied-state
  tracking and command history, wipe/restart/unenroll, security inventory (BitLocker, TPM,
  Secure Boot, domain/Entra join) and Entra federated token validation.
- Autopilot hardware-hash import, Graph sync, deployment profiles and group assignment.
- Android Enterprise signup, enrollment tokens, Pub/Sub, policy delivery, device
  inventory, installed-application inventory and commands.
- Tenant-defined device attributes: a typed registry (text, number, boolean, date,
  select), per-device values with merge/clear semantics, searchable and filterable device
  columns, `attribute:<key>` CSV import/export, custom enrollment questions validated by
  type and requiredness, and audit entries for every write.
- Policy variables (`${device.name}`, `${device.serial}`, `${device.model}`,
  `${tenant.name}` and `${attribute.<key>}`) resolved per device at compile time for
  Apple declarations, legacy profiles and Windows SyncML; unknown names fail validation
  and `$${...}` escapes.
- Audit search/export, outbound webhooks with HMAC signatures, retries and a
  30-day delivery history with payload inspection and replay, Stripe billing
  with a transactional event-id ledger, Checkout, seat reconciliation and
  invoices, plan limits, tenant export/import, scheduled
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
- Cloudflare Workers deployment for the dashboard and API, and a single Node
  container image for self-hosting.

## Validation gaps

These are implemented but not proven end to end in this repository.

| Area                      | Gap                                                                                                                                                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple ADE                 | Setup gating and the ADE enrollment endpoint are implemented; zero-touch depends on registering the ADE cloud-configuration `url`/`await_device_configured` manually because Apple's Business API does not expose it. The inline `Authenticate` profile is unverified and likely ignored by hardware |
| Apple user channel        | `UserAuthenticate`, per-user `TokenUpdate`/`CheckOut`, delivery and results are fixture-tested; not validated on a real macOS or Shared iPad login                                                                                                                                                   |
| Apple BYOD                | User-enrollment check-in is supported, but account-driven enrollment is not hosted: it needs a Managed Apple Account, tenant-domain service discovery and a sign-in page                                                                                                                             |
| Apple FileVault           | Escrow key generation, CMS unwrap and rotation are fixture-tested; not validated on real supervised hardware                                                                                                                                                                                         |
| Apple app inventory       | Fixture-tested; refreshed daily by maintenance and on demand, not validated on real hardware                                                                                                                                                                                                         |
| Apple activation lock     | Bypass-code collection and Recovery Lock are fixture-tested; not validated on real Apple silicon                                                                                                                                                                                                     |
| Windows federated Entra   | Handshake fixture-tested, not real hardware                                                                                                                                                                                                                                                          |
| Windows Autopilot         | OOBE not validated; timezone not sent to Graph                                                                                                                                                                                                                                                       |
| Windows inventory         | None                                                                                                                                                                                                                                                                                                 |
| Windows security          | BitLocker/TPM/Secure Boot/join nodes are fixture-tested, not validated across every Windows edition                                                                                                                                                                                                  |
| Windows unenroll          | Server-initiated and `1226` device-initiated paths are unit-tested, not validated on real hardware                                                                                                                                                                                                   |
| Android                   | Signup, Pub/Sub, QR/token enrollment, work-profile/fully-managed provisioning, policy convergence, reconciliation and commands are fixture-tested; not validated against real Google Cloud/managed devices                                                                                           |
| Android apps              | Assigned apps merge into the policy (one entry per package) and are fixture-tested; no real-device validation and no Play approval flow                                                                                                                                                              |
| Apple app delivery        | Manifest, store and uploaded `.pkg` installs are fixture-tested; not validated on real supervised hardware                                                                                                                                                                                           |
| Windows apps              | MSI install jobs and result reporting are unit-tested; not validated against real Windows hardware                                                                                                                                                                                                   |
| Third-party app catalogue | Settings are sourced from vendor/ProfileManifests data and validated by tests; not reviewed by the vendors                                                                                                                                                                                           |
| Apple OS scoping          | Delivery filtering is fixture-tested against Apple's published `supportedOS`; not confirmed on every OS build                                                                                                                                                                                        |
| Scripts                   | Profile encoding, queueing, redaction, retention, result ingestion and the agent's trigger/redaction/update logic are fixture-tested; the release workflow builds and signs the pkg, but no Developer ID/notary credentials are configured here and it has not run on real hardware |
| Windows scripts           | Windows MDM has no arbitrary-script CSP; the API and agent contract exist and CI builds the Windows executable, but script delivery and Authenticode signing are not configured                                                                    |
| Android scripts           | Unsupported by the Android Management API; devices are skipped with a reason rather than silently ignored                                                                                                                                                                                            |
| Compliance                | Derived health only; no policy engine or Conditional Access                                                                                                                                                                                                                                          |
| Bulk work                 | Synchronous; no Cloudflare Queues or job ids                                                                                                                                                                                                                                                         |
| Transactional email       | Queued in `email_outbox`, retried hourly with exponential backoff and a 5-attempt cap; a permanent failure is audited but not re-driven automatically                                                                                                                                                |
| Backups                   | No off-site copy or restore drills; tenant bundles exclude members, devices, audit history and SCEP identities (direct device assignments are included)                                                                                                                                              |
| Tenant teardown           | One attempt owns a pending deletion for a 10-minute lease; Apple unenroll depends on a check-in racing the delete, and Windows devices always need manual retirement                                                                                                                                 |
| Observability             | No metrics endpoint; readiness checks are bounded but the underlying query is not cancelled on timeout                                                                                                                                                                                               |
| SSO                       | Entra OIDC only; no SAML, no IdP group-to-role mapping                                                                                                                                                                                                                                               |
| Account recovery          | Ceremony, rate limits and approval rules are unit-tested; not yet rehearsed against a real mailer or a self-hosted operator run                                                                                                                                                                      |
| MCP OAuth                 | Route-level boundary tests cover redirect, PKCE, client binding, code/refresh single use; not driven by a real MCP client                                                                                                                                                                            |
| Ledger retention          | `stripe_event` and expired SCIM token rows have no scheduled prune yet                                                                                                                                                                                                                               |
| Migration                 | No vendor connectors; CSV/export primitives only                                                                                                                                                                                                                                                     |

## Production checklist

### Deployment

- [ ] `ORIGIN` is the public HTTPS origin.
- [ ] `AUTH_SECRET` is generated, backed up and not rotated without re-sealing.
- [ ] Hyperdrive points at a managed MySQL with TLS and `caching.disabled` is `true`.
- [ ] R2 bucket and an email transport are configured (`EMAIL`, `MAIL_TRANSPORT` with
      `MAIL_FROM`, or `MATTRAX_EMAIL_DISABLED=1` for an intentional opt-out), and
      `/api/ready` reports `mailer: ok` or `skipped`.
- [ ] Migrations are applied before deploying code.
- [ ] `/api/health` and `/api/ready` return 200.
- [ ] The hourly origin certificate probe has recorded an observation
      (`server_certificate_health`), and credential health reports it as `ok` and
      `authorized`. A self-hosted proxy certificate is still the operator's to renew.
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

- [ ] APNs certificate valid and monitored. Credential health reports the key/topic match,
      and 30/7/expiry emails reach an owner. Renew at
      <https://identity.apple.com/pushcert/> with **Renew**, not Create, then upload it.
- [ ] Tenant SCEP CA health checked (`identity/scep` or `credential-health`): rotation not
      overdue, no `untrustedIdentities`, and any `retiring` CA lists the identities still
      relying on it.
- [ ] Enrollment link tested on macOS and iOS.
- [ ] ABM credential uploaded and devices assigned.
- [ ] ADE profile `url` points at `/api/v1/abm/ade/enroll` and a real device completes
      Setup Assistant without installing a profile by hand.
- [ ] Setup gating observed: the device stays at Remote Management until
      `DeviceConfigured` is acknowledged, and the console shows **Awaiting setup**.
- [ ] Return to Service performed on an iPhone/iPad with a Wi-Fi policy and an escrowed
      bootstrap token, and the re-enrolment recorded on the timeline.
- [ ] VPP token uploaded and a licence installed.
- [ ] FileVault escrow key generated, escrow profile deployed and a key revealed on a real Mac.
- [ ] Activation Lock bypass code collected before Activation Lock is enabled, and revealed.
- [ ] Recovery Lock set, verified and cleared on Apple silicon.
- [ ] Pre-DDM fallback confirmed: a macOS 12/iOS 14 device receives profiles, not a DDM sync.
- [ ] App inventory refresh confirmed.
- [ ] Manifest, App Store/VPP and uploaded `.pkg` installs each confirmed on a Mac (and an
      iOS manifest install on an iPhone).
- [ ] Uploaded package URL expires and a re-check-in installs without re-adding the app.
- [ ] `mattraxd` is signed with a Developer ID, the pkg is notarized and stapled,
      and a script runs on a real Mac with a manual run and an interval trigger. The
      `release-agent.yml` secrets are documented in `apps/mattraxd/README.md`.
- [ ] Script output redaction is verified with a secret environment value.

### Windows

- [ ] Tenant-scoped discovery URL tested.
- [ ] WSTEP enrollment and certificate renewal tested.
- [ ] OMA-URI policy applied and verified.
- [ ] An MSI installs through `EnterpriseDesktopAppManagement` and appears as managed in the
      MSI inventory.
- [ ] Entra SSO tested.
- [ ] Autopilot pilot completed.
- [ ] Federated enrollment tested in a lab.

### Android

- [ ] Service account and Pub/Sub configured.
- [ ] Signup completed.
- [ ] QR/token enrollment tested.
- [ ] Policy convergence verified.
- [ ] An assigned Managed Google Play app is installed and a removed assignment uninstalls
      it.
- [ ] Commands verified.

### Operations

- [ ] MySQL and R2 backups running.
- [ ] A restore has been rehearsed.
- [ ] Credential expiry alerts reach an owner.
- [ ] Webhook signing verified by the receiver.
- [ ] Audit retention and export tested.
- [ ] Incident runbook and contact list exist.

## Known backlog themes

- Real-device validation for Apple security commands, ADE setup/Return to Service,
  Windows federated/Autopilot and Android.
- Compliance/conditional access integration.
- Queues/job ids for bulk operations.
- Off-site backups and restore drills.
- Metrics and indexed fleet aggregation.
- SAML SSO and role mapping.
- Vendor migration connectors.
- Android Google device deletion.

## Next

- [Architecture](/reference/architecture)
- [Troubleshooting](/operations/troubleshooting)
