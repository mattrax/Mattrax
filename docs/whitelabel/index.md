# Whitelabel

Mattrax Whitelabel is the self-hosted MDM gateway for teams building their own device management product on top of Mattrax. It exposes Apple enrollment, MDM, SCEP, and asset endpoints, then delegates product-specific decisions to your management backend over HTTP webhooks.

The server implementation lives in `apps/server/` and is packaged as `@mattrax/server`.

## Contents

| Page                                 | Description                                                     |
| ------------------------------------ | --------------------------------------------------------------- |
| [Server Overview](./server.md)       | Architecture, runtime responsibilities, and persistence.        |
| [Running Locally](./running.md)      | Development and binary usage.                                   |
| [HTTP Surface](./endpoints.md)       | Public device-facing endpoints and generated OpenAPI endpoint.  |
| [Management Webhooks](./webhooks.md) | Webhook contract your backend must implement.                   |
| [Deployment](./deployment.md)        | Production configuration, data storage, and operational checks. |

## Download

While it is in private beta, please reach out to [hello@mattrax.app](mailto:hello@mattrax.app) for access. We can host the management server for you, or can provide a binary which can be deployed on any Linux server. We want to work directly with implementors to ensure we are providing a solution that works well for your use case.
