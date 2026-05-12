# HTTP Surface

These are the device-facing and operator-facing endpoints exposed by `apps/server/`.

## Operator Endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/health` | Returns `{ "status": "ok" }`. Use for health checks. |
| `GET` | `/api/openapi.json` | Generated OpenAPI document for the Effect HTTP API surface. |

## Apple MDM Endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/mdm/apple/enroll` | Returns an Apple enrollment profile as `application/x-apple-aspen-config`. |
| `PUT` | `/mdm/apple/mdm` | Receives Apple MDM check-in, command result, checkout, token update, and declarative management messages. |
| `GET` | `/mdm/apple/assets/:identifier` | Returns an asset fetched from the management webhook backend. |

The raw MDM endpoint accepts Apple protocol content types directly, including `application/x-apple-aspen-mdm-checkin` and `application/x-apple-aspen-mdm`.

## SCEP Endpoints

| Method | Path | Query | Description |
| ------ | ---- | ----- | ----------- |
| `GET` | `/mdm/apple/scep` | `operation=GetCACaps` | Returns supported SCEP capabilities as `text/plain`. |
| `GET` | `/mdm/apple/scep` | `operation=GetCACert` | Returns the SCEP CA certificate. |
| `POST` | `/mdm/apple/scep` | none | Handles SCEP PKIOperation requests and returns `application/x-pki-message`. |

Invalid SCEP operations return `400`. Internal SCEP errors return `500`.

## Public Origin

Set `--origin` to the externally reachable base URL for the server. The MDM service uses this value when constructing URLs that devices will call back into, including asset URLs.
