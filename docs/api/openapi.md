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

## Generating a client

```bash
curl -s https://e.mattrax.app/api/openapi.json -o openapi.json
npx openapi-typescript openapi.json -o src/mattrax-api.d.ts
```

The document includes request and response schemas for the Enterprise API. Protocol routes
(`/mdm/*`) and the management webhook contract are separate:

- Protocol routes are documented in [Apple](/platforms/apple/), [Windows](/platforms/windows/)
  and [Android](/platforms/android/).
- The whitelabel contract is documented in
  [Management backend](/operations/whitelabel/management-backend).

## Notes

- The document is generated at build time from the deployed code. A self-hosted deployment
  may expose endpoints added after the Cloud document was generated.
- Authentication is not described by an OpenAPI security scheme in every route; use the
  `Authorization` header described in [REST API](/api/).
- Scalar is served from a CDN. If your CSP blocks it, use the JSON document directly.

## Next

- [REST API](/api/)
- [API reference](/api/reference)
