# Production readiness

This page separates what is implemented and hardened from what still needs real-device or
real-vendor validation. It is a status page, not a marketing page.

## Implemented and hardened

- Tenant isolation, roles (`owner`, `admin`, `member`, `auditor`), scoped API tokens and
  optional tenant binding.
- Authenticator-app MFA, passkeys, session revocation and step-up for sensitive actions.
- Entra OIDC SSO, SCIM 2.0 and Entra directory sync with delta cursors and locking.
- Apple manual enrollment, SCEP identity, APNs push, DDM, legacy profiles, certificates,
  custom declarations, FileVault escrow, installed-app inventory and device health.
- Apple Business Manager OAuth, device sync, MDM server assignment and signed ADE profile
  URLs.
- Apps & Books location tokens, asset sync, device licence assignment and release.
- Windows WSTEP enrollment, SyncML OMA-URI delivery, wipe/restart and Entra federated token
  validation.
- Autopilot hardware-hash import, Graph sync, deployment profiles and group assignment.
- Android Enterprise signup, enrollment tokens, Pub/Sub, policy delivery and commands.
- Audit search/export, outbound webhooks with HMAC signatures and retries, Stripe billing,
  plan limits, tenant export/import and scheduled backups.
- Security headers, request ids, structured logs, readiness checks, rate limits and
  optional Sentry-compatible error tracking.
- Cloudflare Workers deployment for the dashboard and API, and a Node gateway for
  .

## Validation gaps

These are implemented but not proven end to end in this repository.

| Area                    | Gap                                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Apple ADE               | `Authenticate` does not return the ADE profile; zero-touch needs the signed URL                                               |
| Apple FileVault         | Fixture-tested, not validated on real supervised hardware                                                                     |
| Apple app inventory     | Fixture-tested; manual refresh only                                                                                           |
| Apple CMS recovery key  | Raw payload returned; decryption is an operator step                                                                          |
| Windows federated Entra | Handshake fixture-tested, not real hardware                                                                                   |
| Windows Autopilot       | OOBE not validated; timezone not sent to Graph                                                                                |
| Windows inventory       | None                                                                                                                          |
| Android                 | Signup, Pub/Sub, QR/token enrollment, policy convergence and commands not validated against real Google Cloud/managed devices |
| Android apps            | Not implemented                                                                                                               |
| Compliance              | Derived health only; no policy engine or Conditional Access                                                                   |
| Bulk work               | Synchronous; no Cloudflare Queues or job ids                                                                                  |
| Backups                 | No off-site copy or restore drills; tenant bundles exclude members/devices/audit/SCEP                                         |
| Observability           | No metrics endpoint; readiness query is not cancelled on timeout                                                              |
| SSO                     | Entra OIDC only; no SAML, no IdP group-to-role mapping                                                                        |
| Migration               | No vendor connectors; CSV/export primitives only                                                                              |

## Production checklist

### Deployment

- [ ] `ORIGIN` is the public HTTPS origin.
- [ ] `AUTH_SECRET` is generated, backed up and not rotated without re-sealing.
- [ ] Hyperdrive points at a managed MySQL with TLS and `caching.disabled` is `true`.
- [ ] R2 bucket and Email Sending are configured.
- [ ] Migrations are applied before deploying code.
- [ ] `/api/health` and `/api/ready` return 200.
- [ ] Security headers are present.
- [ ] Rate-limit namespaces are configured.
- [ ] Sentry (or equivalent) is configured.
- [ ] Daily and hourly crons are enabled.

### Identity

- [ ] At least two owners.
- [ ] MFA or passkeys enrolled for owners/admins.
- [ ] SSO configured and tested.
- [ ] SCIM or directory sync tested.
- [ ] Break-glass recovery procedure documented and audited.

### Apple

- [ ] APNs certificate valid and monitored.
- [ ] Enrollment link tested on macOS and iOS.
- [ ] ABM credential uploaded and devices assigned.
- [ ] ADE profile URL tested.
- [ ] VPP token uploaded and a licence installed.
- [ ] FileVault escrow confirmed on a real device.
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
