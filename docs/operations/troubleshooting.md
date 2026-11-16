# Troubleshooting

Start with the health endpoints and the request id. Most enrollment failures are
configuration, not code.

## Enrollment

### The enrollment page says a platform is unavailable

- Apple: APNs certificate uploaded, valid and not expired; Apple toggle enabled.
- Windows: Windows toggle enabled; the tenant token is fresh.
- Android: service account configured, signup completed, Android toggle enabled.
- Plan limit or tenant device cap reached.

### Apple profile downloads but will not install

- Open the link in Safari. Some in-app browsers cannot install profiles.
- The signing chain must be trusted; a self-signed origin certificate is not enough.
- The profile must not be expired.
- A previously installed profile with the same identifier must be removed first.

### Apple device enrolls but receives no policy

1. Device status is `enrolled`.
2. The device is in a group with an included policy, or has a direct include.
3. The policy has at least one configuration.
4. APNs is configured and the push health is not failing.
5. Wait for the next check-in or press **Sync**.

Use `GET /devices/:id/effective-policy` to see the resolution trace.

### Apple device shows an invalid push token

The token is no longer valid. The device must re-enroll. Check `push-health` and the device
activity timeline.

### SCEP failures

- The deployment has `AUTH_SECRET` (without it SCEP fails closed).
- The enrollment challenge has not expired (one hour by default; see
  `MATTRAX_ENROLLMENT_PROFILE_TTL_SECONDS`) and was issued for the same tenant as the
  SCEP URL (`/mdm/apple/scep/<organizationId>`). Challenges are one-time, and changing
  the enrollment settings or resetting the enrollment invalidates unused ones.
- A profile installed before upgrading to per-tenant CAs points at the old
  `/mdm/apple/scep` URL, which now returns `410`. Download the enrollment profile again.
- The device is still `enrolled` for renewal.
- The identity certificate has not been revoked, and the tenant CA has not been rotated
  since it was issued.
- The tenant CA private key can be opened with the current `AUTH_SECRET` (a rotated secret
  makes stored CA keys unreadable; Mattrax fails closed rather than replacing the CA).

### Windows link expired

The message "This Windows enrollment link is invalid or has expired" means the signed
tenant token is older than seven days. Reload the enrollment page for a fresh link.

### Windows enrollment succeeds but no policy

- The policy kind is `mttx.windows.custom.<id>`.
- The device is assigned to the policy.
- The device has polled since the change; there is no push.
- Check the SyncML status in the command history.

### Android `EnterpriseNotConfigured`

The deployment is missing `ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON`, or the value is not
valid JSON. Android stays unavailable until it is set.

### Android Pub/Sub 401

- The OIDC audience must match `ANDROID_MANAGEMENT_PUBSUB_AUDIENCE` or the default
  endpoint URL.
- The token's service account email must match the configured account.
- The subscription must be a push subscription.

## Apple Business Manager

| Symptom                          | Check                                                                 |
| -------------------------------- | --------------------------------------------------------------------- |
| Upload rejected                  | PKCS#8 EC P-256 key, Client/Key/Team ids, correct scope               |
| Sync says migration required     | Legacy DEP `.p7m` token; create a Business API key                    |
| Sync fails over 5,000 devices    | Apple page cap; narrow the org scope                                  |
| Assignment fails                 | Valid tenant APNs certificate; MDM server created with it             |
| Profile URL 404                  | Device `REMOVED`, unassigned, or profile revision changed             |
| No zero-touch at Setup Assistant | ADE profile is not returned by `Authenticate`; install the signed URL |

## Apps & Books

| Symptom              | Check                                                    |
| -------------------- | -------------------------------------------------------- |
| Token rejected       | Location token, not a legacy VPP token; not expired      |
| Install fails closed | Device-assignable asset, available licence, active token |
| No eligible devices  | Only enrolled Apple devices with a serial                |
| App not in inventory | Run **Refresh applications**                             |
| Release rejected     | Asset not revocable or assignment already revoked        |

## Policies

- A configuration is rejected: check the kind, the `<id>` suffix (≤20 alphanumeric) and the
  platform-specific schema.
- A custom `.mobileconfig` is rejected: valid plist, `PayloadType: Configuration`,
  identifier, display name and at least one payload; no `com.apple.mdm`.
- A policy does not win: check direct excludes, direct includes, group excludes, priority
  and recency in the effective-policy trace.
- Windows OMA-URI is ignored: duplicate URIs resolve by lexicographic policy id; check the
  effective policy.

## Webhooks

| Symptom                | Check                                                               |
| ---------------------- | ------------------------------------------------------------------- |
| 401 from your endpoint | Verify `X-Mattrax-Signature` with the raw body and a 300s tolerance |
| No deliveries          | Endpoint enabled, event filter matches, URL is HTTPS and public     |
| Repeated failures      | Check `consecutiveFailures`, delivery history and your 5s timeout   |
| Retry missing          | Retries run daily for rows younger than 24h, max 3 attempts         |

## MFA and passkey lockout

Passkeys cannot be reset by email. Keep at least two passkeys per administrator and
store TOTP recovery codes safely.

If an administrator still has a signed-in session, add a new passkey from **Account →
Security** before removing the lost one.

If they have no session and no passkey, another owner must re-provision the account
after verifying identity. There is no server-side way to mint a passkey: delete the
account's credential state, remove the account, and send a fresh invitation so the user
can register a new passkey. Audit the operation.

Authenticator app:

```sql
-- Replace :user_id with the account id. Bumps the auth revision so every
-- existing session is invalidated.
DELETE FROM auth_totp_factor
 WHERE JSON_UNQUOTE(JSON_EXTRACT(state, '$.subjectId')) = :user_id;
UPDATE `user` SET totp_enabled = false, auth_revision = UUID() WHERE id = :user_id;
```

Passkeys:

```sql
-- Inspect and deactivate every credential before re-provisioning the account.
UPDATE auth_passkeyCredentials SET active = false WHERE subject_id = :user_id;
DELETE FROM auth_passkeyFlows
 WHERE JSON_UNQUOTE(JSON_EXTRACT(snapshot, '$.context.target.revision.subjectId')) = :user_id;
UPDATE `user` SET passkey_enabled = false, auth_revision = UUID() WHERE id = :user_id;
```

Audit the operation and have the user register a new passkey immediately.

## SSR shell and bootstrap

Every authenticated page render should reuse `__Host-mattrax_ssr` for five minutes. If
Workers Issues is full of `[ssr] AUTH_SECRET is not configured…` or `[ssr] A bootstrap
token failed edge verification…`, the two Workers disagree:

- `AUTH_SECRET` is missing on `mattrax`, or its value differs from `mattrax-api`.
  Re-set both from the same secret and redeploy; the log never includes the value.
- The dashboard still renders correctly while this is wrong — bootstrap is the authority —
  but each navigation repeats membership/role queries and reissues a token. Treat the
  error as a performance and configuration defect, not a security bypass.
- The web Worker holds the platform root secret for verification. Keep its environment
  as restricted as the API Worker's until a dedicated `SSR_TOKEN_SECRET` exists.

Placement verification: `mattrax-api` must be pinned to the region nearest the database
(`placement.region = aws:us-east-1` for the hosted DigitalOcean MySQL instance), and
`mattrax` must stay `placement.mode = off` so static assets and HTML are served at the
nearest edge. If `/api/ready` (a single `SELECT 1`) is slow from the deployment region,
the API isolate is not landing in its pinned region: check the deployment's placement
metadata and the database origin's location before changing anything else.

## Dashboard error screens

A render failure is caught by the dashboard, landing, docs or policy-editor error
boundary instead of blanking the page. The screen shows a short explanation, **Try
again** (re-renders the failed subtree), **Reload page**, and an **Error ID** such as
`ERR-9F3C21AB`.

- Quote the error id in a support report. The same id is attached to the
  `$exception` event in PostHog (property `error_id`), together with
  `error_boundary` (`dashboard`, `landing`, `policy-editor`, `docs` or `app`) and the
  path. PostHog autocapture does not see Solid's boundary errors, so this explicit
  report is the only browser-side trace.
- **Try again** only helps when the failure was transient (a render that read stale
  state). If it recurs, reload; if the reload lands on the same screen, the boundary
  is reporting a genuine defect rather than a lost query.
- Signing out, or the session expiring, clears the query cache and every open tab
  through the cross-tab channel; the error screen is not a substitute for that.

## Database and migrations

- `/api/ready` returns 503: check MySQL reachability, Hyperdrive configuration and
  credentials.
- Migrations fail: use the individual `DATABASE_*` variables, not a URL. Apply migrations
  before deploying code that needs them.
- `db:generate` produces an unexpected diff: check `apps/cloud/src/db/schema.ts` re-exports
  the enterprise schema and that migration snapshots are committed.

## Rate limits

A 429 includes `Retry-After`. If legitimate traffic is limited, configure the matching
Cloudflare Rate Limiting namespace or raise the client backoff. Do not disable limits
globally.

## Whitelabel gateway

| Symptom                    | Check                                                                      |
| -------------------------- | -------------------------------------------------------------------------- |
| `/webhook/*` returns 500   | `--webhook-secret` matches; timestamp within 300s                          |
| SCEP fails                 | `--auth-secret` set; challenge minted with the same secret                 |
| Enrollment profile missing | The gateway returns 410 at `/mdm/apple/enroll`; serve the profile yourself |
| Apple push not delivered   | The gateway never pushes; your backend owns push                           |
| Licence check exits        | `--product-key` invalid or revoked; check `--platform-url`                 |

## Getting help

Include the `x-request-id`, timestamp, tenant id, platform and the exact operation. Never
include tokens, private keys or recovery keys.
