# Self-hosted instances

Mattrax Cloud can issue product keys for self-hosted and whitelabel deployments.
The **Instances** page in the dashboard lists the keys your account has issued,
their reported user/device counts, and when each instance last checked in.

## Create a key

1. Open **Instances** in the sidebar.
2. Choose **Register instance** and add a description (for example
   `Production EU`).
3. Copy the `MTLX-…` key immediately. Only its hash and a display prefix are
   stored.

## Key lifecycle

- An instance is **active** while it has checked in within the last 48 hours.
- A key that has never checked in is shown as active until it is used.
- **Revoke** permanently stops the key from validating. The self-hosted licence
  monitor exits after repeated invalid checks.

## Verification protocol

Self-hosted instances verify their key by calling:

```http
POST /api/platform/instances/verify
x-mattrax-key: MTLX-…
x-mattrax-timestamp: <unix seconds>
x-mattrax-signature: <hex HMAC-SHA256(key, "<timestamp>.<userCount>:<deviceCount>")>
content-type: application/json

{"userCount": 12, "deviceCount": 480}
```

Timestamps must be within five minutes. A successful response updates the
instance's counts and last-seen time. Unknown keys return `{"valid":false}`;
revoked keys return `{"valid":false,"revoked":true}`.

The hosted Cloud API signs APNs CSRs and relays email on behalf of instances in
the production deployment; those endpoints are not part of this repository yet.
