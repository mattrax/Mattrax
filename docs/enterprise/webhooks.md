# Outbound webhooks

Enterprise tenants can send device lifecycle and enrollment events to an HTTPS
endpoint they control. Webhooks are configured per tenant under **Settings →
Integrations**, or with the API below. They are separate from the inbound
management webhooks used by the whitelabel gateway.

Only a tenant **owner** or **admin** can list or change webhook endpoints.

## Events

| Event                        | When it fires                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `device.enrolled`            | An Apple device completes its first authenticated check-in.                     |
| `device.unenrolled`          | A device checks out, is removed, or becomes stale and is marked unenrolled.     |
| `device.command_failed`      | A command result first moves to `failed` (not-now is not emitted).              |
| `device.declaration_invalid` | A DDM declaration first reports an invalid/failed state.                        |
| `device.push_invalid_token`  | APNs rejects a device token for the first time since the last success.          |
| `device.compliance_changed`  | The derived device health rollup changes level (healthy/attention/critical).    |
| `policy.deployment_failed`   | A policy change applied, but at least one APNs wake-up delivery failed.         |
| `enrollment.attempt_failed`  | A public enrollment attempt failed (bad password, disabled, limit, SCEP error). |

Endpoints subscribe to a list of events. An **empty list means every event**,
including events added in future releases. The test button sends a synthetic
`webhook.test` event that always bypasses the filter.

## Payload

```json
{
  "id": "evt_6f1d0c9a8b7e4d2c1a0f",
  "type": "device.enrolled",
  "occurredAt": "2026-11-11T10:00:00.000Z",
  "organizationId": "org_123",
  "data": {
    "platform": "apple",
    "serial": "C02ABCDEFGHI",
    "model": "MacBookPro18,3",
    "targetType": "device",
    "targetId": "dev_123"
  }
}
```

Payloads are deliberately small and secret-free. They never contain APNs keys,
SCEP private keys, enrollment passwords, API tokens or raw client IPs.

## Signature

Every request includes:

| Header                | Value                                                         |
| --------------------- | ------------------------------------------------------------- |
| `X-Mattrax-Event`     | Event type, for example `device.enrolled`                     |
| `X-Mattrax-Delivery`  | Event id (`evt_...`); stable across retries                   |
| `X-Mattrax-Timestamp` | Unix seconds used in the signature                            |
| `X-Mattrax-Signature` | `t=<unix-seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>` |

The MAC is computed over the **exact raw request body** (JSON as sent, no
re-serialisation). Verify it before trusting the payload, and reject timestamps
more than **five minutes** old to limit replay. The comparison should be
constant-time.

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

const verify = (secret: string, rawBody: string, header: string) => {
  const parts = Object.fromEntries(
    header.split(",").map((part) => part.trim().split("=") as [string, string]),
  );
  const timestamp = Number(parts.t);
  if (!Number.isSafeInteger(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const received = Buffer.from(parts.v1 ?? "", "utf8");
  return (
    received.length === expected.length && timingSafeEqual(received, Buffer.from(expected, "utf8"))
  );
};
```

Signing secrets look like `whsec_...`. They are stored sealed with the
deployment `AUTH_SECRET` and are only returned once, when the endpoint is
created or its secret is rotated. The dashboard shows only the last four
characters afterwards.

## Delivery, retries and limits

- Each attempt has a **5 second** deadline. A request never waits on a customer
  endpoint indefinitely.
- A single delivery is made inline with the device action. Failures are
  recorded and never fail the device action, audit write or policy update.
- Recent failed deliveries are retried by daily maintenance, with a maximum of
  **3 recorded attempts** and no retry of rows older than 24 hours.
- Delivery history is deleted after **30 days**.
- HTTP 2xx is success. Any other status, timeout, TLS error or network error is
  a failure; `consecutiveFailures` on the endpoint increments until a success.
- Redirects are not followed, so an allowed URL cannot redirect to an internal
  host.

### SSRF protection

Only `https` URLs are accepted and URLs with embedded credentials are rejected.
The following are blocked:

- `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.lan`, `*.home.arpa`
  and other reserved/internal suffixes;
- single-label hostnames (they can only resolve on an internal search domain);
- IPv4 loopback, RFC 1918, link-local, CGNAT, documentation, benchmark and
  multicast ranges;
- IPv6 loopback, unspecified, link-local, unique-local, multicast and
  documentation ranges, including IPv4-mapped private addresses.

The guard is syntax-based. Workers `fetch` does not expose DNS answers, so a
public hostname that resolves to a private address is not rejected locally; rely
on the platform's egress controls for that case. The URL is re-checked at
delivery time as well as when it is saved.

## API

```bash
# List endpoints (owner/admin)
curl -s "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/webhooks" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"

# Create one. The response includes the signing secret exactly once.
curl -s -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/webhooks" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://hooks.example.com/mattrax",
    "description": "Production SIEM",
    "events": ["device.enrolled", "device.unenrolled"],
    "enabled": true
  }'

# Update, rotate the secret, send a test, delete
curl -s -X PATCH "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/webhooks/$WEBHOOK_ID" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"enabled":false}'

curl -s -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/webhooks/$WEBHOOK_ID/rotate-secret" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"

curl -s -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/webhooks/$WEBHOOK_ID/test" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"

curl -s -X DELETE "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/webhooks/$WEBHOOK_ID" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

Deleting an endpoint cascades its delivery history. Tenant deletion removes all
of its endpoints and deliveries.
