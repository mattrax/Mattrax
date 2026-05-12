# Deployment

Deploy the whitelabel server anywhere it can receive public HTTPS traffic from Apple devices and reach your management webhook backend.

## Production Command

For the standalone binary:

```sh
./mattrax-server serve \
  --port 3000 \
  --origin https://mdm.example.com \
  --webhook-url https://api.example.com/webhook \
  --data-dir /opt/mattrax-server \
  --apple-vendor-cert /etc/mattrax/apple-vendor.pem
```

## Configuration Checklist

| Setting | Production guidance |
| ------- | ------------------- |
| `--origin` | Use the public HTTPS origin devices can reach. Do not leave this as localhost. |
| `--webhook-url` | Use the base URL for your management backend webhook API. |
| `--data-dir` | Use a persistent, backed-up directory or volume. |
| `--apple-vendor-cert` | Provide the Apple MDM vendor certificate PEM so enrollment profiles use the correct topic. |
| TLS | Terminate HTTPS at a load balancer, reverse proxy, or the hosting platform. |

## Persistent Data

The server stores SCEP CA material in `scep-ca.json` under `--data-dir`. This file contains private key material and must be protected.

Recommended handling:

| Requirement | Reason |
| ----------- | ------ |
| Restrict filesystem permissions | Prevent unauthorized access to SCEP private key material. |
| Back up the data directory | Preserve enrollment continuity across host replacement. |
| Mount persistent storage | Avoid regenerating CA state on every deploy. |
| Exclude from source control | Prevent accidental key disclosure. |

## Health Checks

Use `GET /health` for load balancer and process health checks. A healthy server returns:

```json
{ "status": "ok" }
```

## Reverse Proxy Notes

The server constructs incoming request URLs from the `Host` header for request handling, while generated device-facing URLs should use the explicit `--origin` value. In production, ensure the reverse proxy preserves the intended host header and that `--origin` matches the public URL devices use.

## Operational Notes

The server logs startup configuration for the port, webhook backend, and data directory. MDM and SCEP handler errors are logged to stderr/stdout depending on the runtime environment.

On `SIGINT`, the server closes the HTTP listener and disposes the Effect HTTP handler layer.
