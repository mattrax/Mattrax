# Whitelabel enrollment

The shared Apple handler returns **410** at `/mdm/apple/enroll` because it cannot mint a
tenant-bound challenge. A whitelabel deployment must serve its own enrollment profile.

This is by design: your product owns the enrollment UX, the device record and the tenant
decision.

## What the profile needs

An Apple enrollment profile contains:

- A SCEP payload pointing at `<origin>/mdm/apple/scep` with a challenge.
- An MDM payload pointing at `<origin>/mdm/apple/mdm` with the APNs topic and SCEP
  identity reference.

Use the helpers from `@mattrax/dm-apple` and `@mattrax/scep`:

```ts
import { Effect } from "effect";
import { buildAppleEnrollmentProfile } from "@mattrax/dm-apple";
import { serializePlist } from "@mattrax/plist";
import { createScepChallenge } from "@mattrax/scep";

const challenge = await createScepChallenge(crypto.randomUUID(), process.env.AUTH_SECRET!, {
  ttlSeconds: 60 * 60 * 24 * 7,
});

const profile = await Effect.runPromise(
  serializePlist(
    buildAppleEnrollmentProfile({
      origin: process.env.ORIGIN!,
      topic,
      organizationId: "whitelabel",
      organizationName: process.env.BRAND_NAME ?? "Acme",
      supportEmail: process.env.SUPPORT_EMAIL,
      challenge,
    }),
  ),
);

return new Response(profile, {
  headers: { "content-type": "application/x-apple-aspen-config" },
});
```

`topic` is the APNs topic. Derive it from your Apple vendor certificate:

```ts
import { extractTopicFromCertPem } from "@mattrax/dm-apple";

const topic = extractTopicFromCertPem(process.env.APNS_CERT!);
```

## Required configuration

| Value             | Why                                           |
| ----------------- | --------------------------------------------- |
| `ORIGIN`          | Absolute URLs in the profile                  |
| `AUTH_SECRET`     | Signs the SCEP challenge and seals the CA key |
| APNs certificate  | Supplies the MDM topic and push credentials   |
| Organization name | Display name and SCEP subject                 |

If any is missing, return `503` with a clear message. Do not serve a profile with a
placeholder topic.

## Challenge lifetime

`createScepChallenge(id, secret, { ttlSeconds })` produces
`<id>.<expiresAt>.<hmac>`; without `ttlSeconds` it produces a non-expiring
`<id>.<hmac>`.

Use a short lifetime for public enrollment links (for example 7 days) and bind the id to
your enrollment record. The gateway verifies the challenge against the same
`AUTH_SECRET` when the device posts a SCEP PKCSReq.

## Example Worker

`apps/example-whitelabel` intercepts `/mdm/apple/enroll` before the shared router:

```ts
if (url.pathname === "/mdm/apple/enroll" && request.method === "GET") {
  const authSecret = env.AUTH_SECRET;
  const topic = env.APNS_CERT ? extractTopicFromCertPem(env.APNS_CERT) : null;
  if (!env.ORIGIN || !topic || !authSecret)
    return new Response("Apple MDM enrollment is not configured", { status: 503 });

  const challenge = await createScepChallenge(crypto.randomUUID(), authSecret);
  const profile = await Effect.runPromise(
    serializePlist(
      buildAppleEnrollmentProfile({
        origin: env.ORIGIN,
        topic,
        organizationId: "whitelabel",
        organizationName: env.BRAND_NAME || "Mattrax",
        supportEmail: env.SUPPORT_EMAIL,
        challenge,
      }),
    ),
  );

  return new Response(profile, {
    headers: { "content-type": "application/x-apple-aspen-config" },
  });
}
```

## SCEP CA

The gateway stores the CA at `<data-dir>/scep-ca.json`:

```json
{
  "certPem": "-----BEGIN CERTIFICATE-----...",
  "privateKeyJwk": { "v": 1, "sealed": "..." },
  "createdAt": "2026-11-11T00:00:00.000Z"
}
```

- The private key is sealed with AES-256-GCM keyed from `AUTH_SECRET`.
- A legacy plaintext key is sealed on first read.
- A missing or wrong secret fails closed; the gateway never regenerates the CA.
- Back up the data directory **and** the auth secret together.

## Windows enrollment

The gateway mounts the Windows protocol routes, but there is no shared Windows enrollment
page. You must:

1. Mint a tenant/enrollment token your backend understands.
2. Give the device a discovery URL such as
   `<origin>/mdm/windows/discovery?tenant=<token>`.
3. Implement the Windows methods in your `ManagementBackend`.

The example Worker returns `ManagementNotSupported` for Windows, so it is Apple-only. The
Cloud enterprise backend implements Windows; use it as a reference.

## Branding

The gateway serves:

```text
GET /branding.json
```

```json
{
  "displayName": "Acme",
  "logo": "https://cdn.example.com/logo.png",
  "supportEmail": "it@acme.example",
  "brandColor": "#1c1917"
}
```

Use this in your enrollment UI so the profile and the page agree.

## Push

The gateway never pushes. Your backend owns APNs delivery. Options:

- Direct HTTP/2 with the tenant certificate (`NodePushTransport`).
- A Workers mTLS binding (`MtlsPushTransport`).
- The included relay (`apps/apns-relay`) with HMAC signing (`RelayPushTransport`).

Without push, devices still converge by polling.

## Checklist

- [ ] `/mdm/apple/enroll` returns a profile with the correct topic.
- [ ] The challenge expires and is verified by SCEP.
- [ ] The SCEP CA is backed up with `AUTH_SECRET`.
- [ ] `/branding.json` matches the UI.
- [ ] Push delivery is implemented and monitored.
- [ ] Windows discovery and the Windows backend methods are implemented, or Windows is
      explicitly disabled.

## Next

- [Gateway deployment](/operations/whitelabel/deployment)
- [Management backend](/operations/whitelabel/management-backend)
