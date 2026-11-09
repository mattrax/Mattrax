# `@mattrax/apns`

Effect service for Apple Push Notification Service (APNs) MDM wake-up pushes,
plus the certificate lifecycle helpers used by the management API.

## Transports

A deployment picks one transport and provides `ApnsService`:

| Transport                                                   | Use case                                                                                                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NodePushTransport` (`ApnsServiceNode` / `ApnsServiceLive`) | Self-hosted and single-certificate deployments. Attaches the tenant certificate through `node:https` HTTP/2.                                              |
| `MtlsPushTransport` (`ApnsServiceMtls`)                     | Whitelabel Workers with a preconfigured mTLS Fetcher binding (one binding per certificate).                                                               |
| `RelayPushTransport` (`ApnsServiceRelay`)                   | Hosted multi-tenant Cloud. POSTs an HMAC-SHA256 signed request to `APNS_RELAY_URL` because a single Worker cannot select a client certificate per tenant. |
| `NoopPushTransport` (`ApnsServiceNoop`)                     | Fallback when no transport is configured. `push` fails with a clear `ApnsError`; devices still poll so declarative management converges.                  |

Cloud uses the relay when `APNS_RELAY_URL` and `APNS_RELAY_SECRET` are set,
otherwise it falls back to the no-op transport.

## Certificate lifecycle

`packages/enterprise-backend` exposes:

- `GET /v1/tenants/:tenantId/apns/csr` — generates/reuses an RSA-2048 key,
  returns the base64 Apple CSR plist (`PushCertCertificateChain`,
  `PushCertRequestCSR`, `PushCertSignature`). The private key is sealed with
  AES-GCM derived from `AUTH_SECRET` before it is stored.
- `POST /v1/tenants/:tenantId/apns` — validates the uploaded certificate
  (topic, validity, key match) and stores the certificate plus the re-sealed
  private key.

When `CLOUD_APPLE_VENDOR_CERT`/`CLOUD_APPLE_VENDOR_KEY` are configured the CSR
includes Apple's chain and a PKCS#1 v1.5 signature. Without them the plist still
works for a manually signed certificate.
