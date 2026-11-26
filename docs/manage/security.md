# Security

Mattrax protects accounts with passkeys, optional authenticator-app
two-factor authentication and step-up confirmation for sensitive actions. There
are no passwords to phish, reuse or reset.

For the recorded threat model, trust boundaries and accepted risks, see
[Threat model](/reference/threat-model). It maps each mitigation to the test suite
that exercises it.

## Certificate security

Mattrax issues its own SCEP identity for device mTLS. Enterprise certificates for Wi-Fi,
VPN and S/MIME are separate policy profiles: a trusted root, a PKCS profile or an imported
PFX. See [Policies → Certificate profiles](/manage/policies#certificate-profiles).

The PFX and its password are sealed with AES-256-GCM under `AUTH_SECRET` in a dedicated
row. The policy configuration stores only public leaf metadata (subject, expiry,
fingerprint) and a material digest, so the API, deployment snapshots and tenant exports
never carry the key material. The upload is parsed as PKCS#12, the password is verified and
the supplied leaf certificate must match a certificate in the file; metadata is derived
from the PFX rather than trusted from the request. Restoring a tenant bundle therefore
leaves certificate profiles without material until the PKCS#12 is uploaded again, and a
rollback that would pair old metadata with different material is refused. Rotating
`AUTH_SECRET` requires re-uploading certificate material, just like APNs keys and escrowed
secrets.

Two delivery copies are protected as well. Legacy Apple `InstallProfile` commands seal
their payload in `device_command` and decrypt only at dispatch and installed-profile
reconciliation. Windows `PFXCertBlob`/`PFXCertPassword` command payloads are sealed for the
same reason.
Apple identity assets are served only with the signed per-device token and after
re-resolving that device's effective policy; a tenant-wide mTLS certificate is enough only
for a public certificate/root asset, never for an identity.

SCEP challenges are one-time and tenant-bound; SCEP CA keys are sealed with the same
deployment secret and record retirement windows so a rotated CA can verify but never sign
again.

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

The tenant log (**Settings → Audit log**) is the place to investigate a device. It keeps
account actions and MDM traffic together: check-ins, policy deliveries, status reports,
command results and failures. MDM rows use the system actor and record the protocol, the
device id, the verified client address and the identity certificate serial/fingerprint —
never the certificate itself or a payload body. A failed check-in therefore answers who,
when, which device and why without exposing secrets. Check-ins are folded per device and
window; the dashboard shows the fold count so a polling device is not confused with a
delivery.

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
`scim-token-create`, `mfa-enroll`, `mfa-disable`, `mfa-regenerate`,
`email-change`, `sessions-revoke-all`, `recovery-approve`,
`recovery-key-reveal`, `device-handover`, `backup-download`, `backup-pin`,
`backup-delete`, `backup-restore`, `cutover-export`, `cutover-import`,
`device-command`, `android-disconnect`, `script-change`, `script-run`,
`billing-portal`, `sso-policy`, `scep-ca-rotate`, `scep-ca-import`,
`passkey-enroll`, `passkey-remove`.

Most additive writes need the resource's write permission but no step-up: creating a
policy or a script has no existing object to protect. Credential creation is the
exception — creating an API token (`api-token-create`) or a SCIM token
(`scim-token-create`) still requires step-up, because the token itself is a durable
credential. Changing an existing object is not enough on its own: editing a
policy, group, tenant profile or device assignment needs only the write permission.
Step-up is reserved for the actions listed above — deleting a tenant, changing its MFA
or SSO policy, editing/assigning/running/deleting a script or toggling scripts for the
tenant, changing or removing a sign-in credential, changing the account email or
revoking every session, issuing a device command or handover, disconnecting Android,
rotating/importing the SCEP CA, downloading/pinning/deleting/restoring a backup, and
exporting/importing a cutover archive.

If a grant is missing or expired, the API returns a 403 `StepUpRequired` with the action
and available factors. The browser retries with `x-mattrax-step-up: <grant>`.

:::tip Bearer tokens
Requests authenticated with a bearer API token are exempt from step-up because the token
is already an explicitly issued, scoped credential. Creating or revoking a token still
requires step-up. Protect tokens accordingly.
:::

## Four-eyes approvals

Step-up proves the **same** administrator is present. It does not prove a **different**
person agreed to a destructive change. Four-eyes approval adds that second signature for
the actions a tenant chooses to gate.

Approval policies are optional. When no policy matches an action, the endpoint behaves
exactly as before: step-up still applies where it already did, and nothing else changes.

### Gated actions

A policy can name any of these action keys:

| Action key         | Endpoint(s)                                                       |
| ------------------ | ----------------------------------------------------------------- |
| `device.wipe`      | Device actions `wipe` and `return-to-service` (mode is bound)     |
| `tenant.delete`    | Delete the tenant                                                 |
| `tenant.export`    | Export tenant data, including the encrypted cutover archive       |
| `policy.delete`    | Bulk policy deletion, and a backup restore (it replaces policies) |
| `script.run`       | Run a script                                                      |
| `script.write`     | Create, edit, delete or reassign a script                         |
| `backup.download`  | Download a tenant backup                                          |
| `api-token.create` | Create an API token bound to the tenant                           |

`device.wipe` and `script.run` accept a **scope**: the whole tenant, a device, or a
group. Other actions are tenant-wide. `api-token.create` covers tokens bound to the
tenant; an account-wide token is reviewed by the first tenant the account belongs to, because a
token with no owning tenant can be used against every one of them. When scopes overlap,
the most specific policy wins (device, then group, then tenant); ties prefer the policy with the higher approval count,
then the newest. The request stores the policy id and the rules it was created under, so
editing a policy affects new requests, not in-flight ones.

### Request and approve

1. The caller runs the action as usual. If a policy matches and no approval id is
   supplied, **nothing executes**. The API returns a 403 `ApprovalRequired` naming the
   pending request; an approved request returns the same error with `status: "approved"`
   and the message asks the caller to retry.
2. Eligible administrators open **Settings → Approvals**. The queue shows the requester,
   the action, a metadata-only summary, the approvals needed and the decisions so far.
   They approve with an optional note or reject with a required note.
3. The requester retries the original request with
   `x-mattrax-approval: <request id>`. The server checks the state, expiry, requester,
   canonical payload and single-use before executing. The dashboard keeps the blocked
   call in memory and offers **Retry with this approval** on the approved request; after
   a reload, run the action again and retry from the request it names.

Approvals are bound to a canonical SHA-256 digest of the action, policy, resource and
targets. An approval for one device, one set of script targets, one script body, one
backup or one API-token scope cannot be reused for another. A request names the number of
distinct approvers required, **excluding the requester**: the requester can never approve
their own request.

Requests last 24 hours. Expiry is enforced both when the queue is read and immediately
before execution; an approved request that is not used in time expires. Execution consumes
the request atomically, so two retries cannot both run the action. Decisions and the status
flip run in one transaction with the request row locked, so concurrent approvers cannot
leave a request at N of N while still pending. The payload summary is metadata only — device
counts, ids, script names, token scopes and similar — and never a secret; the script body
itself is hashed with canonical JSON, not stored.

Terminal approval history is deleted after 90 days by the daily maintenance sweep. Pending
requests are never pruned. A tenant owner deleting their **account** cannot take a tenant
with it when that tenant has a `tenant.delete` policy: the operator must delete the tenant
explicitly so another administrator can approve it or the owner can break-glass.

Bearer credentials (API tokens and MCP connections) can **request** approval but can never
**approve**: decisions require a signed-in administrator session.

### Who can approve

An approver needs `approvals.write` and then the configured requirement from the policy:

- a permission (for example `devices.command`), checked against the approver's effective
  role in that tenant; or
- a built-in role, which is a floor: an owner can approve anything an administrator can.
  A custom role never satisfies a built-in role requirement.

A member without the configured permission is rejected with a typed
`EnterpriseForbidden` naming the permission or role. Policy configuration itself requires
`approvals.write`. Owners and administrators have it by default; members and auditors do
not.

### Break-glass

An owner can bypass a policy when a second administrator is genuinely unavailable. Send
`x-mattrax-approval-break-glass: <reason>` on the original request. The reason is
mandatory (maximum 1,000 characters), only a built-in owner can use it, and bearer
credentials are refused. The server records a prominent `approval.break_glass_used` audit
event with the action, policy and reason, plus the normal consumption event, then runs the
action. Break-glass is a deliberate exception for an emergency, not an administrative
shortcut. While the blocked call is still in the browser session, **Settings → Approvals →
Mine** offers **Break-glass and run** with the mandatory reason field.

### Audit

The tenant audit log records:

- `approval.policy_created`, `approval.policy_updated`, `approval.policy_deleted`;
- `approval.requested` (with the effective requester RBAC);
- `approval.approved` and `approval.rejected` (with the approver's effective RBAC);
- `approval.cancelled`;
- `approval.expired` (system actor);
- `approval.consumed` (execution);
- `approval.break_glass_used`.

A gated request that is blocked returns a 403 `ApprovalRequired` with `requestId` and
`status` (`pending` or `approved`), so a client can prompt for the decision and retry
with the header. Expired, consumed and payload-mismatched approvals return typed
`EnterpriseBadRequest`/`EnterpriseConflict` errors.

## API tokens

Create tokens under **Account → API tokens**:

- Name.
- Permissions: pick groups (No access / Read / Write) and expand to individual
  permissions. The picker only offers permissions your role holds in at least
  one tenant.
- Tenant binding. A tenant member should usually create a token bound to that tenant, so
  it is governed by that tenant's `api-token.create` policy. An account-wide token is
  reviewed by the first tenant the account belongs to that has such a policy.
- Optional expiry.

The token's grant is a ceiling, never a grant: every request also checks your
current role in the tenant. Tokens with a narrow grant cannot manage account
settings such as API tokens, passkeys or the profile.

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
