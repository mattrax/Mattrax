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
- The enrollment challenge has not expired (seven days).
- The device is still `enrolled` for renewal.
- The identity certificate has not been revoked.

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

If an administrator loses every factor, another owner can reset it after verifying identity.

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
-- Deactivate rather than delete so the audit trail and counters remain.
UPDATE auth_passkeyCredentials SET active = false WHERE subject_id = :user_id;
DELETE FROM auth_passkeyFlows
 WHERE JSON_UNQUOTE(JSON_EXTRACT(snapshot, '$.context.target.revision.subjectId')) = :user_id;
UPDATE `user` SET passkey_enabled = false, auth_revision = UUID() WHERE id = :user_id;
```

Audit the operation and have the user enroll a new factor immediately.

## Database and migrations

- `/api/ready` returns 503: check MySQL reachability, Hyperdrive configuration and
  credentials.
- Migrations fail: use the individual `DATABASE_*` variables, not a URL. Apply migrations
  before deploying code that needs them.
- `db:generate` produces an unexpected diff: check `apps/api/src/db/schema.ts` re-exports
  the enterprise schema and that migration snapshots are committed.

## Rate limits

A 429 includes `Retry-After`. If legitimate traffic is limited, configure the matching
Cloudflare Rate Limiting namespace or raise the client backoff. Do not disable limits
globally.

## Whitelabel gateway

| Symptom                    | Check                                                                      |
| -------------------------- | -------------------------------------------------------------------------- |
| `/webhook/*` returns 401   | `--webhook-secret` matches; timestamp within 300s                          |
| SCEP fails                 | `--auth-secret` set; challenge minted with the same secret                 |
| Enrollment profile missing | The gateway returns 410 at `/mdm/apple/enroll`; serve the profile yourself |
| Apple push not delivered   | The gateway never pushes; your backend owns push                           |
| Licence check exits        | `--product-key` invalid or revoked; check `--platform-url`                 |

## Getting help

Include the `x-request-id`, timestamp, tenant id, platform and the exact operation. Never
include tokens, private keys or recovery keys.
