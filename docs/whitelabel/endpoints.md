# HTTP surface

These are the endpoints exposed by the `mttx` gateway.

## Operator endpoints

| Method | Path                | Description                                              |
| ------ | ------------------- | -------------------------------------------------------- |
| `GET`  | `/health`           | Returns `{ "status": "ok" }`.                            |
| `GET`  | `/api/openapi.json` | Generated OpenAPI document for the gateway's Effect API. |

The example Worker also serves an interactive Scalar UI at `/docs`. The Node gateway does
not mount that UI; use the OpenAPI JSON.

## Apple MDM endpoints

| Method | Path                            | Description                                                                                                 |
| ------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET`  | `/mdm/apple/enroll`             | Returns an Apple enrollment profile as `application/x-apple-aspen-config`.                                  |
| `PUT`  | `/mdm/apple/mdm`                | Receives Apple MDM check-in, command results, checkout, token updates, and declarative management messages. |
| `GET`  | `/mdm/apple/assets/:identifier` | Returns an asset fetched from the management webhook backend, or `404`.                                     |

The MDM endpoint is registered outside the typed API builder so Apple's content types pass
through, including `application/x-apple-aspen-mdm-checkin` and
`application/x-apple-aspen-mdm`. Identity is read from the
`x-device-identity-certificate` header when present.

Declarative management sub-endpoints are multiplexed through the same `PUT /mdm/apple/mdm`
endpoint using the `Endpoint` field, for example `tokens`, `declaration-items`, `status`,
and `declaration/<type>/<identifier>`.

## SCEP endpoints

| Method | Path              | Query                 | Description                                                            |
| ------ | ----------------- | --------------------- | ---------------------------------------------------------------------- |
| `GET`  | `/mdm/apple/scep` | `operation=GetCACaps` | Returns supported SCEP capabilities as `text/plain`.                   |
| `GET`  | `/mdm/apple/scep` | `operation=GetCACert` | Returns the SCEP CA certificate.                                       |
| `POST` | `/mdm/apple/scep` | none                  | Handles PKIOperation requests and returns `application/x-pki-message`. |

Invalid operations return `400`; internal SCEP failures return `500`.

## Windows endpoints

The management webhook contract defines Windows discovery, policy, WSTEP enrollment and
SyncML management (`/webhook/windows/*`), and `packages/dm-windows` provides matching
device routes under `/mdm/windows/*`. The whitelabel gateway, `apps/mttx` and `apps/api`
mount them.

## Public origin

Set `--origin` to the externally reachable base URL. The gateway uses it when constructing
URLs that devices call back into, including asset URLs. A reverse proxy must preserve the
public host and TLS scheme; do not leave `--origin` at localhost in production.

## Error behavior

| Situation                              | Response                                  |
| -------------------------------------- | ----------------------------------------- |
| Unknown device or user in webhook      | Protocol-specific handling, often `200`   |
| Management feature unsupported         | Typed webhook error mapped by the gateway |
| Missing asset                          | `404`                                     |
| Malformed MDM plist                    | `500` with the error logged               |
| Rate limit (about 5 req/s per process) | `429` with `retry-after: 1`               |

`@mattrax/dm-apple` catches protocol failures and returns `200` for many MDM messages so
Apple does not retry a permanently failing request. Check gateway logs and your management
backend for the real error.
