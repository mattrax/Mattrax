# Security

Mattrax protects accounts with passwords, authenticator-app MFA, passkeys and step-up
confirmation for sensitive actions.

## Account security

Open **Account → Security** to manage:

- Password.
- Authenticator app (TOTP) enrollment, recovery codes, disable and regenerate.
- Passkeys (WebAuthn) add, rename and remove.
- Active sessions and API tokens.

### Authenticator app

1. Choose **Enable authenticator**.
2. Scan the QR code or enter the manual key.
3. Confirm a current code.
4. Store the one-time recovery codes.

TOTP secrets are stored as AES-GCM envelopes keyed from `AUTH_SECRET`. Recovery codes are
stored only as SHA-256 digests.

Accounts with MFA must sign in with password **plus** the second factor. Email codes and
SSO assertions are possession-only and cannot replace the password factor.

### Passkeys

Passkeys are phishing-resistant, user-verified possession factors. They satisfy MFA on
their own and work for passwordless and SSO-only accounts. Adding or removing a key
requires a recent step-up. Removing a key invalidates other sessions and refuses to leave
the account without a usable sign-in method.

The relying party is derived from `ORIGIN`, never from request input. The RP id is the
origin host; the allowlist is `ORIGIN` plus same-site `TRUSTED_ORIGINS`.

## Step-up

Sensitive actions require a recent confirmation. The browser asks for a password,
authenticator code or passkey, and the server issues a five-minute grant bound to the
account, session and action.

Actions:

`tenant-delete`, `api-token-create`, `api-token-revoke`, `mfa-disable`, `mfa-regenerate`,
`recovery-key-reveal`, `backup-download`, `device-command`, `billing-portal`,
`sso-policy`, `passkey-enroll`, `passkey-remove`.

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

Owners and admins without an authenticator or passkey are blocked from the tenant's APIs
with a 403 and prompted to enroll. Members keep read access.

## Sessions

List and revoke sessions:

```text
GET    /api/v1/account/sessions
DELETE /api/v1/account/sessions/:sessionId
```

Disabling MFA, removing a passkey or changing the email bumps the auth revision and
invalidates existing sessions.

## Break-glass recovery

If an administrator loses every factor, another owner can reset the factor in the database
after verifying identity. The SQL is in
[Troubleshooting](/operations/troubleshooting#mfa-and-passkey-lockout). Audit the operation
and have the user enroll a new factor immediately.

## Limitations

- There is no conditional UI/passkey autofill yet.
- There is no SAML SSO; Entra OIDC only.
- There is no per-user MFA opt-out for tenants that require it.
- There is no break-glass CLI; recovery is a database operation.

## Next

- [Identity and access](/admin/identity)
- [Troubleshooting](/operations/troubleshooting)
