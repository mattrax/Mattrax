# Security

Mattrax protects accounts with passkeys, optional authenticator-app
two-factor authentication and step-up confirmation for sensitive actions. There
are no passwords to phish, reuse or reset.

For the recorded threat model, trust boundaries and accepted risks, see
[Threat model](/reference/threat-model). It maps each mitigation to the test suite
that exercises it.

## Account security

Open **Account** to manage:

- Passkeys (WebAuthn) add, rename and remove. Add more than one so a lost device
  cannot lock you out.
- Authenticator app (TOTP) enrollment, recovery codes, disable and regenerate.
- Active sessions with their client descriptor, and **Sign out everywhere**.
- API tokens.
- **Activity**: the account-scoped audit stream (sign-ins, credential changes,
  sessions, tokens, recovery). It pages with a cursor and exports CSV/JSON like
  the tenant audit log.

### Passkeys

Passkeys are the primary credential. They are phishing-resistant, user-verified
possession factors. Sign-up is email-first: the address receives a six-digit code
that is entered on the page (no callback link), and the passkey ceremony then
creates the account with that address already verified. Sign-in asks for the
email first, then offers the organisation's SSO when the address has one and the
passkey otherwise; the passkey ceremony is held to the address that was typed.
Adding or removing a key requires a recent passkey step-up. Removing a key
invalidates other sessions and refuses to remove the last passkey.

An account with a single passkey sees a warning in Account security: lose that
device and the only way back in is the recovery ceremony below.

The relying party is derived from `ORIGIN`, never from request input. The RP id is the
origin host; the allowlist is `ORIGIN` plus same-site `TRUSTED_ORIGINS`.

### Authenticator app

TOTP is optional and adds a second layer on top of the passkey:

1. Choose **Enable authenticator**.
2. Scan the QR code or enter the manual key.
3. Confirm a current code.
4. Store the one-time recovery codes.

TOTP secrets are stored as AES-GCM envelopes keyed from `AUTH_SECRET`. Recovery codes are
stored only as SHA-256 digests.

When TOTP is enabled, passkey sign-in becomes pending and requires a current
authenticator code or a recovery code. SSO assertions must likewise be combined
with the second factor. TOTP management requires a fresh passkey step-up.

## Email address changes

Changing the address is a two-sided ceremony, because the address is the account's
recovery channel:

1. Request the change from **Account → Email address**. The request itself needs a
   step-up grant.
2. The **new** address receives a confirmation link.
3. The **old** address receives a "your email address is being changed" notice with
   a single-use cancellation link, so the real owner sees the attempt even without
   signing in.
4. Only the confirmation link completes the change. Both links are single use and
   expire after one hour.

On completion the address is marked verified, and the account security revision is
bumped so every other session — which still carries the old address in its claims —
is invalidated. Uniqueness is re-checked inside the transaction; if someone
registered the target address in the meantime the request fails with `409` instead
of a database error. Request, completion and cancellation are recorded in
Account → Activity.

## Step-up

Sensitive actions require a recent confirmation. The browser asks for a passkey
or authenticator code, and the server issues a five-minute grant bound to the
account, session and action.

Actions:

`tenant-delete`, `tenant-mfa-policy`, `api-token-create`, `api-token-revoke`,
`mfa-enroll`, `mfa-disable`, `mfa-regenerate`, `email-change`,
`sessions-revoke-all`, `recovery-approve`, `recovery-key-reveal`,
`backup-download`, `device-command`, `billing-portal`, `sso-policy`,
`passkey-enroll`, `passkey-remove`.

If a grant is missing or expired, the API returns a 403 `StepUpRequired` with the action
and available factors. The browser retries with `x-mattrax-step-up: <grant>`.

:::tip Bearer tokens
API tokens are exempt from step-up because they are already an explicitly issued, scoped
credential. Protect them accordingly.
:::

## API tokens

Create tokens under **Account → API tokens**:

- Name.
- Scope: `read` or `write` (`write` implies `read`).
- Optional tenant binding.
- Optional expiry.

Tokens are shown once. Mattrax stores a SHA-256 hash and a prefix for display.

```bash
curl "$MATTRAX_URL/api/v1/account/api-tokens" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

Revocation is immediate. `lastUsedAt` is updated on use.

A token bound to one tenant cannot be used on another tenant; the API returns
`EnterpriseNotFound` to avoid leaking existence.

## SCIM tokens

SCIM provisioning credentials are managed under **Settings → Identity**:

- Each token is bound to one tenant and shown once; only its SHA-256 hash is
  stored.
- New tokens expire after 90 days unless you choose a date. The maximum
  lifetime is 365 days.
- The token list shows when each token expires and when it was last used. A
  token inside its final 14 days is flagged **rotation due**, and an expired
  token is rejected with `401` exactly like a revoked or unknown one.
- To rotate, create a replacement, update the IdP connector, then revoke the
  old token. Both work during the overlap.
- Tokens created before expiry existed have no date and stay valid until you
  rotate them; the list shows them as "No expiry set".

## Roles

| Role      | Read | Write | Delete |
| --------- | ---- | ----- | ------ |
| `owner`   | Yes  | Yes   | Yes    |
| `admin`   | Yes  | Yes   | No     |
| `member`  | Yes  | No    | No     |
| `auditor` | Yes  | No    | No     |

Write operations require owner or admin. Delete requires owner. Tenant deletion requires
owner and step-up.

## Tenant MFA requirement

The MFA requirement is a **tenant** property (`organization.require_mfa`), independent
of single sign-on. A tenant that signs in with passkeys can enforce it without any
identity provider:

1. Open **Settings → Identity → Multi-factor authentication**.
2. Enable **Require multi-factor authentication for every member**.

Chosen policy, deliberately strict:

- It applies to **every role**, including `member` and `auditor`. Read access to tenant
  data is what a borrowed session is after, so read-only roles are not exempt.
- Enabling it is refused while any member cannot satisfy it (no passkey and no
  authenticator app). That prevents turning the switch on and locking a colleague out.
  The API returns a 400 naming how many accounts are missing a factor.
- Account endpoints (`/v1/account/*`, `/v1/me`) are **not** tenant-scoped, so a member
  blocked by the requirement can still open Account settings, add a passkey and retry.
  An SSO-only member with no passkey yet can add their first one without a step-up,
  because the enrolment is authorised by the fresh session evidence instead.
- The effective value is returned from `/v1/me` as `mfaRequired` for any membership, not
  only owner/admin ones.
- Changing it requires a step-up (`tenant-mfa-policy`) and writes
  `tenant.mfa_policy_updated` to the tenant audit log with `{ "requireMfa": true|false }`.

The requirement used to live on the Entra SSO config. The migration backfills
`organization.require_mfa` from `sso_config.require_mfa`; the SSO form now reports and
updates the tenant property so existing deployments keep working.

## Sessions

List and revoke sessions:

```text
GET    /api/v1/account/sessions
DELETE /api/v1/account/sessions/:sessionId
POST   /api/v1/account/sessions/revoke-all
```

Each session reports its client descriptor — browser, platform and device class — plus
`lastUsedAt` and which row is the current session. The descriptor is captured on the
first authenticated request of the session, because the auth library owns session
creation and its row carries no request context. Only the browser/platform family is
kept, never the raw `User-Agent`, and the client address is stored as a salted SHA-256
prefix (see [Operations](/admin/operations#data-retention)).

`revoke-all` ("Sign out everywhere") requires a step-up (`sessions-revoke-all`), deletes
every session row including the caller's and bumps the account security revision. The
dashboard sends the user back to sign in.

Disabling TOTP, removing a passkey, changing the email or completing a recovery bumps
the auth revision and invalidates existing sessions.

The dashboard also keeps a short-lived, signed snapshot of the signed-in shell so pages
render without an API round trip. Those same actions (and signing out or revoking the
current session) clear the snapshot and its signed revision cookie in the API response,
so the next page load resolves the new state from bootstrap instead of painting the old
shell. A session revoked in a different browser cannot rewrite this browser's cookies;
that case is bounded by the snapshot's five-minute lifetime, and every data request is
re-authorised regardless.

## Break-glass account recovery

Passkeys cannot be reset by email, so losing every device used to mean a database
surgery. The recovery ceremony is self-service and fully audited:

1. **Proof of email.** On the sign-in screen choose _Recover access_, enter the account's
   verified address. Mattrax emails a single-use proof link (30 minutes). The response is
   identical whether or not the address exists, so the endpoint cannot enumerate
   accounts. Requests are rate limited per address and per client (three per hour).
2. **Owner approval, when the account is shared.** If the account is an owner of a tenant
   that has another owner, a _different_ owner must approve. The other owners receive an
   approval link that opens **Settings → Identity**; approving requires a signed-in owner
   session with a step-up (`recovery-approve`). The account being recovered can never
   approve itself, and a read-only member of that tenant cannot approve.
3. **Completion.** Only after proof (and approval, when required) is a single-use
   completion link (15 minutes) minted and emailed to the account's verified address. It
   signs the account in through the auth `recoverySignIn` strategy, so the session goes
   through the normal revision and policy checks. Every other session is invalidated by
   the revision bump.

The ceremony never removes, replaces or weakens an existing credential — the "last
passkey cannot be removed" rule is untouched. Afterwards the user lands on **Account**
and enrols a new passkey (Account security nudges single-passkey accounts to add a
second).

Starting, approving, cancelling and completing a recovery are all written to
Account → Activity (`account.recovery_*`), and every status transition is a conditional
update, so a link works once even under concurrent requests.

### Deployments without a working mailer

Self-hosted installs that have no mailer cannot use the emailed links. The supported
operator path is a documented SQL ceremony: mint a completion token for the account and
have the operator deliver it out of band. See
[Operations](/admin/operations#operator-account-recovery). It writes the same audit
entries and must be recorded in the incident log.

## Device identity and profile integrity

- Apple enrollment profiles are CMS-signed with the tenant's SCEP CA (or an explicit
  deployment signing identity). A modified profile fails signature verification, and a
  deployment without usable signing material refuses to serve the download rather than
  serving an unsigned plist. See [Apple profile signing](/platforms/apple/#profile-signing).
- Every tenant owns its SCEP CA. Rotating or importing one CA cannot affect another
  tenant. A rotation is staged, not destructive: the successor CA signs new and renewed
  identities while the retired certificate stays a verification anchor until it expires, so
  existing devices keep checking in and renew without re-enrolling. Only the certificate is
  retained — a retired CA can never sign again. The overlap and its deadlines are exposed
  by `credential-health` and the SCEP identity endpoint, and every rotation is audited with
  both fingerprints. An **import** is different: it is a deliberate trust-root change and
  revokes the identities issued by the previous CA. See
  [Tenant SCEP CA](/platforms/apple/#tenant-scep-ca).
- The tenant CA is valid for five years and rotates automatically 400 days before expiry.
  Credential health exposes its expiry, rotation state and retiring anchors. A failed or due
  rotation is audited and logged; the expiry email to owners/admins follows the shared
  credential schedule (30 and 7 days before expiry). It is an online issuing CA, so the
  five-year life is intentionally shorter than an offline root's.
- The deployment origin's TLS certificate is probed hourly (throttled to one observation an
  hour) and the result is stored with its expiry, subject/issuer and chain validation
  state. An expiring, expired or untrusted origin certificate is logged and surfaced in
  credential health before devices fail to connect.
- DDM asset URLs are bound to one device and expire. Unenrolling or deleting the device
  revokes its outstanding links. Profile URLs stay device-bound and are refreshed whenever
  the profile content changes. See [DDM](/platforms/apple/ddm#signed-profile-and-asset-urls).

## Limitations

- There is no conditional UI/passkey autofill yet.
- There is no password fallback.
- There is no SAML SSO; Entra OIDC only.
- There is no per-user MFA opt-out for tenants that require it.
- A rejected first-factor passkey assertion carries no account identity, so it cannot be
  written to the account audit stream. It is rate limited and visible in access logs;
  every attributable failure (authenticator/step-up challenge, email change, recovery)
  is audited.
- Break-glass recovery needs a working mailer or the operator SQL path; there is no
  command-line recovery tool yet.

## Next

- [Threat model](/reference/threat-model)
- [Identity and access](/admin/identity)
- [Troubleshooting](/operations/troubleshooting)
