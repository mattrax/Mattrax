# Server Overview

The whitelabel server is a Node-based HTTP service that terminates Apple MDM and SCEP protocol traffic. It does not contain product-specific device policy, inventory, or command scheduling logic. Instead, it forwards management decisions and lifecycle events to a webhook backend that you control.

## Responsibilities

The server handles:

| Area           | Responsibility                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Enrollment     | Generates an Apple enrollment profile at `/mdm/apple/enroll`.                                  |
| Apple MDM      | Receives check-in, command, declarative management, and checkout messages at `/mdm/apple/mdm`. |
| SCEP           | Serves SCEP CA capabilities, CA certificate, and PKIOperation requests at `/mdm/apple/scep`.   |
| Assets         | Proxies asset downloads from your management backend through `/mdm/apple/assets/:identifier`.  |
| Webhook bridge | Calls your backend for events, commands, declarations, and assets.                             |
| Health         | Exposes `/health` for runtime checks.                                                          |

## Architecture

The CLI and starts the HTTP server, composes the Effect layers for Apple MDM, SCEP, filesystem persistence, and the management webhook client.

At runtime the flow is:

1. Apple devices call the whitelabel server.
2. The server parses Apple protocol payloads and validates known message shapes.
3. The server calls your management webhook backend when it needs a decision or needs to emit an event.
4. Your backend returns commands, declarative management data, assets, or protocol errors.
5. The server converts the response into the Apple protocol response expected by the device.

## Persistence

The server currently persists SCEP CA state in the configured data directory. The file is named `scep-ca.json` and contains the generated CA certificate, private key material, and creation timestamp.

Treat the data directory as sensitive production state:

| File           | Purpose                                                         |
| -------------- | --------------------------------------------------------------- |
| `scep-ca.json` | SCEP CA certificate and private key used for device enrollment. |

Back up this directory before replacing hosts or redeploying to a new persistent volume. Losing the SCEP CA can break future enrollment flows that depend on the existing CA identity.

## Apple Vendor Certificate

The server accepts an optional Apple vendor certificate PEM file using `--apple-vendor-cert`. When provided, the server extracts the Apple MDM topic from the certificate and uses it in enrollment profile generation. If omitted or if the topic cannot be extracted, the server falls back to `com.apple.mgmt.External.placeholder`.

Use a real Apple MDM vendor certificate in production.
