# OpenAPI

The API publishes an OpenAPI 3 document generated from the Effect HTTP contract.

## Cloud

```text
https://e.mattrax.app/api/openapi.json
```

Interactive Scalar UI:

```text
https://e.mattrax.app/api/docs
```

The UI is a static page that loads the document from the same origin. It is public; the
API calls you make from it still need a session or bearer token.

## Self-hosted

The same paths on your origin:

```text
https://<your-origin>/api/openapi.json
https://<your-origin>/api/docs
```

## Whitelabel gateway

The gateway serves:

```text
https://<gateway>/api/openapi.json
```

It has no Scalar UI. Import the document into your own tooling.

## Management webhook contract

A customer management backend implements the routes under `/webhook/`; see
[Build a management backend](/api/management-backend) for the SDK and a working handler.
The contract is
published as its own document because the Mattrax Cloud API never serves those routes:

```text
https://e.mattrax.app/api/webhooks/openapi.json
https://<your-origin>/api/webhooks/openapi.json
```

Every request carries two headers:

- `x-mattrax-timestamp`: Unix timestamp in seconds.
- `x-mattrax-signature`: HMAC-SHA256, lowercase hex, over the canonical string:

```text
${operation}.${timestamp}.${sha256hex(JSON.stringify(body ?? null))}
```

`operation` is the bare endpoint identifier (`appleManagementCheckin`), not the prefixed
OpenAPI operation id (`ManagementWebhook.appleManagementCheckin`). The timestamp must be
within 300 seconds of the server clock.

## Generating a client

```bash
curl -s https://e.mattrax.app/api/openapi.json -o openapi.json
npx openapi-typescript openapi.json -o src/mattrax-api.d.ts
```

For the management webhook:

```bash
curl -s https://e.mattrax.app/api/webhooks/openapi.json -o management-webhook.json
npx openapi-typescript management-webhook.json -o src/management-webhook.d.ts
```

The Cloud document includes request and response schemas for the Enterprise API. Protocol
routes (`/mdm/*`) are documented separately:

- Protocol routes are documented in [Apple](/platforms/apple/), [Windows](/platforms/windows/)
  and [Android](/platforms/android/).

## Notes

- The document is generated at build time from the deployed code.
- Authentication is not described by an OpenAPI security scheme in every route; use the
  `Authorization` header described in [REST API](/api/).
- Scalar is served from a CDN. If your CSP blocks it, use the JSON document directly.

## Next

- [REST API](/api/)
- [API reference](/api/reference/)
