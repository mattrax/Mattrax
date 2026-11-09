# Architecture and porting notes

This page is the working migration and architecture reference. The production
`mattrax/mttx` repository is the behavioural reference; `oscartbeaumont/mattraxe` is the
target architecture. It is intentionally linked here so the engineering notes stay
discoverable, but it is not an operator guide.

## Non-negotiables

- Keep the sidebar layout in `apps/web` and redesign the product around it.
- Tenant switcher, collapsed sidebar, and navigation must work in production.
- The management layer (`@mattrax/management-backend*`) stays separate from the
  data/product layer (`@mattrax/enterprise-*`, `apps/api`). Whitelabel deployments
  talk to a management webhook; they must never import enterprise code.
- Every feature is verified with automated tests. Browser flows use Playwright
  over CDP; Apple protocol tests are ported/adapted from Fleet.

## Layers

```
protocol packages          dm-apple, dm-windows, scep, soap, plist, policy-apple
        │
management contract        management-backend (protocol-neutral events)
        ├── management-backend-enterprise   hosted DB-backed implementation
        └── management-backend-http         whitelabel webhook transport
product contracts          enterprise-domain, platform-api
product backends           enterprise-backend, platform-backend
data                       enterprise-core (Drizzle/MySQL/R2/APNs secrets)
apps                       api (Cloud), web (dashboard), mttx (self-hosted)
```

## Phases

### Phase 0 — Foundation (done)

- Local dev: `.dev.vars` template, `scripts/dev-cert.mjs`, configurable
  `ORIGIN`/`AUTH_RESET_URL`/`TRUSTED_ORIGINS`.
- Persist the active tenant (`user.active_tenant_id`) and honour it in `/me`.
- Fix tenant switcher (Kobalte portal/context, persisted selection).
- Fix collapsed sidebar (label hiding, cookie persistence, tooltips).
- Real dashboard overview instead of a redirect.
- Error boundary, docs route, dropdown context fixes.

### Phase 1 — Apple management parity

- APNs: CSR generation, certificate upload/validation, encrypted key storage,
  expiry metadata, and push transport abstraction.
- Push integration for device sync, unenroll, group/policy sync, token update.
- Policy compiler: `mttx.apple.device|custom|certificate|declaration` →
  DDM declarations, legacy profile URLs, certificate assets.
- Real `.mobileconfig` preview and validation.
- Per-tenant SCEP challenge bound to the enrollment (no static challenge).
- Enrollment profile branding/topic per tenant and platform toggles.
- DDM inventory persistence (battery, FileVault, capabilities).
- Asset delivery for certificates and profiles.

### Phase 2 — Windows

- Mount `dm-windows` routes in `apps/api` and `apps/mttx`.
- Implement enterprise Windows discovery/enrollment/check-in to the level the
  production reference supports (enrollment + identity certificate), with a
  clear "coming soon" for policy management.

### Phase 3 — Product UI

- Sidebar-first redesign for: dashboard, devices (+detail), groups (+detail),
  policies (+editor), enrollment wizard, tenant settings tabs, account.
- Settings: General, Administrators, Identity, Enrollment, Management (APNs).
- Search/sort/selection tables, detail sidebars, recents, command palette.
- Account sessions list/revoke, profile/email/password, API tokens.
- Docs and landing parity (quick start, self-hosting).

### Phase 4 — Verification

- Vitest coverage for every new backend unit and integration path.
- Playwright CDP suite for login, tenant switching, collapsed sidebar,
  navigation, CRUD, enrollment, settings, policy editor.
- Apple MDM suite adapted from Fleet (`server/mdm/apple`) covering enrollment,
  authentication, token update, declarative management, SCEP and profile
  delivery.
- CI workflow running format, typecheck, unit tests and browser tests.

## APNs architecture note

Apple MDM push certificates are per-tenant. Cloudflare Workers cannot attach a
dynamic client certificate to `fetch`; the mTLS binding is deployed per
certificate. Therefore `@mattrax/apns` exposes a transport interface:

- `NodePushTransport` — direct delivery for self-hosted (`apps/mttx`).
- `MtlsPushTransport` — a preconfigured Worker mTLS binding for single-tenant
  whitelabel deployments.
- `RelayPushTransport` — HMAC-signed requests to a push relay for hosted
  multi-tenant Cloud.

The Cloud Worker is intended to use the relay when `APNS_RELAY_URL` is configured.
In the current tree the Cloud API does not instantiate a push transport, so push is
reported as unavailable while devices still poll (DDM) and policy still converges. The
whitelabel gateway never pushes; its management backend owns delivery.

## Status

Completed in this branch:

- [x] Configurable origins, local dev secrets and HTTPS dev certificates.
- [x] Persisted active tenant, working tenant switcher, collapsed sidebar and
      mobile drawer, real dashboard and route error boundary.
- [x] Playwright CDP suite for auth, navigation, tenant switching, settings,
      CRUD, enrollment and the command palette.
- [x] APNs CSR generation, certificate validation, sealed private keys and
      per-tenant setup UI.
- [x] Push transports (Node, Workers mTLS, hosted relay, no-op) and push on
      token update, sync, unenroll and scope changes.
- [x] Tabbed tenant settings, administrators/invitations (secure acceptance
      links), APNs wizard, billing, account profile/tokens/sessions/deletion.
- [x] Sidebar-first dashboards, tables (search/sort/columns/selection/loading),
      group/policy editors, enrollment page and command palette.
- [x] Production documentation, testing guide and CI workflow.

Remaining after this branch:

- [ ] Windows routes mounted in the Cloud and self-hosted apps (the protocol
      package exists, enrollment certificate issuance is next).
- [ ] Invitation delivery email (links are generated and can be shared).
- [ ] Passwordless email-code sign-in.
- [x] Self-hosted instance product keys, listing, revocation and HMAC verify.
- [ ] Hosted push relay deployment and whitelabel webhook HMAC signing.
- [ ] Fleet-derived Apple suite expanded to real device fixtures in CI.
