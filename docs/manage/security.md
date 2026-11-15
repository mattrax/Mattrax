# Security

Mattrax protects accounts with passkeys, optional authenticator-app
two-factor authentication and step-up confirmation for sensitive actions. There
are no passwords to phish, reuse or reset.

For the recorded threat model, trust boundaries and accepted risks, see
[Threat model](/reference/threat-model). It maps each mitigation to the test suite
that exercises it.

## Account security

Open **Account → Security** to manage:

- Passkeys (WebAuthn) add, rename and remove. Add more than one so a lost device
  cannot lock you out.
- Authenticator app (TOTP) enrollment, recovery codes, disable and regenerate.
- Active sessions and API tokens.

### Passkeys

Passkeys are the only way to sign in. They are phishing-resistant, user-verified
possession factors, and registration creates the account and its first passkey in
one step. Adding or removing a key requires a recent passkey step-up. Removing a
key invalidates other sessions and refuses to remove the last passkey.

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

## Step-up

Sensitive actions require a recent confirmation. The browser asks for a passkey
or authenticator code, and the server issues a five-minute grant bound to the
account, session and action.

Actions:

`tenant-delete`, `api-token-create`, `api-token-revoke`, `mfa-enroll`,
`mfa-disable`, `mfa-regenerate`, `recovery-key-reveal`, `backup-download`,
`device-command`, `billing-portal`, `sso-policy`, `passkey-enroll`,
`passkey-remove`.

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

A tenant can require MFA for owners and admins:

1. Open **Settings → Identity**.
2. Enable **Require MFA for administrators**.

Owners and admins without a passkey (or an authenticator app) are blocked from the
tenant's APIs with a 403 and prompted to enroll. Members keep read access.

## Sessions

List and revoke sessions:

```text
GET    /api/v1/account/sessions
DELETE /api/v1/account/sessions/:sessionId
```

Disabling TOTP, removing a passkey or changing the email bumps the auth revision and
invalidates existing sessions.

## Break-glass recovery

Passkeys cannot be reset by email. If an administrator loses every passkey, another
owner can clear the account's passkey factors in the database after verifying identity,
then the user registers a new passkey. The SQL is in
[Troubleshooting](/operations/troubleshooting#mfa-and-passkey-lockout). Audit the operation
and have the user enroll a new passkey immediately.

## Limitations

- There is no conditional UI/passkey autofill yet.
- There is no password fallback. Accounts created before passkeys were required must
  enrol a passkey through the operator recovery procedure.
- There is no SAML SSO; Entra OIDC only.
- There is no per-user MFA opt-out for tenants that require it.
- There is no break-glass CLI; recovery is a database operation.

## Next

- [Threat model](/reference/threat-model)
- [Identity and access](/admin/identity)
- [Troubleshooting](/operations/troubleshooting)
