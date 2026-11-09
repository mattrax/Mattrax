# Server overview

The whitelabel gateway is a Node-based HTTP service that terminates Apple MDM and SCEP
traffic. It contains no product-specific device policy, inventory, command scheduling, or
user-account logic. Instead it forwards management decisions and lifecycle events to a
webhook backend you control.

## Responsibilities

| Area       | Responsibility                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------- |
| Enrollment | Generates an Apple enrollment profile at `/mdm/apple/enroll`.                                   |
| Apple MDM  | Receives check-in, command results, checkout, token update and declarative management messages. |
| SCEP       | Serves CA capabilities, CA certificate, and PKI operations.                                     |
| Assets     | Proxies asset downloads from your management backend through `/mdm/apple/assets/:identifier`.   |
| Webhooks   | Calls your backend for events, commands, declarations, and assets.                              |
| Health     | Exposes `/health` for runtime checks.                                                           |

## Architecture

`mttx serve` starts one HTTP listener and composes the Effect layers for Apple MDM, SCEP,
filesystem persistence, and the management webhook client.

1. An Apple device calls the gateway.
2. The gateway parses and validates Apple protocol payloads.
3. It calls your management backend for a decision or to emit an event.
4. Your backend returns a command, declarative data, asset bytes, or a typed error.
5. The gateway translates that into the Apple protocol response.

The same protocol layers run in the Cloudflare Worker example (`apps/example-whitelabel`)
with D1/R2 persistence instead of the filesystem. `@mattrax/dm-apple`,
`@mattrax/management-backend-http`, and `@mattrax/scep` are shared; only the management
backend and persistence differ.

## Persistence

The Node gateway persists only SCEP CA state:

| File                     | Purpose                                                         |
| ------------------------ | --------------------------------------------------------------- |
| `<data-dir>/scep-ca.json` | SCEP CA certificate and private key used for device enrollment. |

Treat the data directory as sensitive production state. Back it up before replacing hosts
or moving to a new volume. Losing the SCEP CA breaks continuity for future enrollments
that depend on the existing CA identity.

The gateway deliberately does not persist devices. Your management backend is the source
of truth for device identity and lifecycle.

## Apple vendor certificate

Pass an Apple vendor certificate PEM with `--apple-vendor-cert`. The gateway extracts the
Apple MDM topic and embeds it in the enrollment profile. If the flag is omitted, or the
topic cannot be extracted, the profile falls back to
`com.apple.mgmt.External.placeholder`.

Use a real Apple MDM vendor certificate in production; placeholder-topic profiles will not
receive APNs push and may not be accepted by devices in managed environments.

## APNs and push

The gateway does not send APNs push notifications and does not store APNs certificates.
Your management backend owns the tenant's push certificate and is responsible for waking
devices after it changes policy.

- Single-tenant Node deployments can use `NodePushTransport` from `@mattrax/apns` for
  direct delivery with the tenant certificate.
- Single-tenant Workers deployments can use `MtlsPushTransport` with one mTLS binding per
  certificate.
- Multi-tenant hosted products should use `RelayPushTransport`, which HMAC-signs requests
  to a push relay.

The gateway has no APNs CSR endpoint. Generate the push CSR in your backend (or through
the Apple Push Certificates Portal directly) and keep the certificate and private key
there.

Without push, devices still check in and converge, just later.

## Branding

The gateway serves no HTML UI and has no branding configuration. Your product frontend,
enrollment page, emails, and domain are yours.

The generated Apple enrollment profile currently uses the fixed display name
`Mattrax Enrollment` and organisation `Mattrax` in `packages/dm-apple`. If you need
per-tenant profile branding, that requires changing the protocol package rather than a
gateway flag. The Cloud Enterprise path already stores tenant name/logo for its dashboard,
but the enrollment profile text is also fixed there today.
