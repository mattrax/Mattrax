# Management webhooks

The gateway calls your management backend for product-specific behaviour. Configure the
backend **base URL** with `--webhook-url`; the gateway appends the `/webhook` prefix
itself.

```bash
# Correct: base URL only
--webhook-url https://api.example.com

# Wrong: the gateway would call /webhook/webhook/apple/event
--webhook-url https://api.example.com/webhook
```

Every endpoint below is relative to that base URL.

## Authentication and signing

Set the same secret on the gateway (`--webhook-secret` or
`MATTRAX_WEBHOOK_SECRET`) and on your management backend. When set, every gateway
request carries:

```http
x-mattrax-timestamp: <unix seconds>
x-mattrax-signature: <hex HMAC-SHA256(secret, "<operation>.<timestamp>.<sha256(json payload)>")>
```

`operation` is the contract method name (for example `appleDeviceEvent`). The
backend rejects missing, stale (±5 minutes), or invalid signatures. Use
`managementWebhookHandlers(handlers, { secret })` on the server side;
`ManagementBackendHttp({ baseUrl, secret })` signs the client side.

Also:

- Serve the webhook over HTTPS only.
- Put it on a private network or behind a proxy that requires mTLS or a shared
  bearer token as defence in depth.
- Validate the `scope` (`udid` / `deviceId`) against your own records; a caller
  with the secret can impersonate any device identifier.

## Endpoints

| Method | Path                                | Purpose                                         |
| ------ | ----------------------------------- | ----------------------------------------------- |
| `POST` | `/webhook/apple/event`              | Apple lifecycle and status events.              |
| `POST` | `/webhook/apple/checkin`            | Next management action for a device check-in.   |
| `POST` | `/webhook/apple/declaration-tokens` | Declarative management tokens.                  |
| `POST` | `/webhook/apple/declaration-items`  | Declarative item identifiers and server tokens. |
| `POST` | `/webhook/apple/declaration`        | One declarative declaration.                    |
| `POST` | `/webhook/apple/asset`              | One asset by identifier.                        |
| `POST` | `/webhook/windows/discovery`        | Windows discovery response.                     |
| `POST` | `/webhook/windows/policy`           | Windows enrollment policy.                      |
| `POST` | `/webhook/windows/enroll`           | Windows WSTEP enrollment.                       |
| `POST` | `/webhook/windows/checkin`          | Windows SyncML management.                      |
| `POST` | `/webhook/windows/event`            | Windows lifecycle events.                       |

The gateway exposes `/mdm/windows/*` routes for discovery, policy, enrollment and SyncML
management. The number of Windows devices a single gateway can serve depends on your
backend's enrollment-token and tenant routing rules.

## Scope

Most Apple webhook requests include a `scope` object identifying the device or user
channel.

Device scope:

```json
{
  "_tag": "device",
  "udid": "DEVICE-UDID",
  "identityCertificate": "PEM_OR_HEADER_VALUE",
  "mdmOrigin": {
    "url": "https://mdm.example.com"
  }
}
```

User scope:

```json
{
  "_tag": "user",
  "udid": "DEVICE-UDID",
  "identityCertificate": "PEM_OR_HEADER_VALUE",
  "userId": "USER-ID",
  "userShortName": "shortname",
  "mdmOrigin": {
    "url": "https://mdm.example.com"
  }
}
```

`identityCertificate` may be omitted when Apple did not provide
`x-device-identity-certificate`. `mdmOrigin.assetUrl(identifier)` is the URL the device
will use to fetch assets from the gateway.

Windows scope uses `deviceId` instead of `udid`:

```json
{
  "deviceId": "WINDOWS-DEVICE-ID",
  "identityCertificate": "PEM_OR_HEADER_VALUE",
  "mdmOrigin": { "url": "https://mdm.example.com" }
}
```

## Apple device events

`POST /webhook/apple/event`

```json
{
  "scope": {
    "_tag": "device",
    "udid": "DEVICE-UDID",
    "mdmOrigin": { "url": "https://mdm.example.com" }
  },
  "event": {
    "_tag": "Authenticate",
    "serialNumber": "C02...",
    "model": "MacBookPro",
    "osVersion": "15.0"
  }
}
```

| Tag                 | Fields                                                            | Meaning                                            |
| ------------------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| `Authenticate`      | `serialNumber?`, `model?`, `osVersion?`                           | Enrollment authentication data.                    |
| `TokenUpdate`       | `pushToken`, `pushMagic`, `topic`, `channel` (`device` or `user`) | Push credentials. Store these if you push.         |
| `CheckOut`          | —                                                                 | Device unenrolled.                                 |
| `CommandResult`     | `commandUUID`, `status`, `errorDetail?`, `queryResponses?`        | Result for a previously issued imperative command. |
| `DeclarationStatus` | `statusItems?`, `errors?`                                         | Declarative management status report.              |

`pushToken` is hex-encoded by the gateway before it is sent to your backend.

## Apple check-in decisions

`POST /webhook/apple/checkin` returns exactly one manifest.

Idle:

```json
{ "_tag": "Idle" }
```

Imperative command:

```json
{
  "_tag": "Command",
  "commandUUID": "command-uuid",
  "requestType": "DeviceInformation",
  "payload": {
    "Queries": ["DeviceName", "OSVersion"]
  }
}
```

Declarative management sync:

```json
{
  "_tag": "DdmSync",
  "serverToken": "server-token"
}
```

`DdmSync` and `Command` are mutually exclusive: one check-in can only follow one response
path in the Apple protocol. The gateway converts `DdmSync` into a `DeclarativeManagement`
command with a deterministic command UUID.

Unknown devices are treated as idle by the gateway for check-in.

## Declarative management

`POST /webhook/apple/declaration-tokens` returns:

```json
{
  "activationsToken": "token",
  "configurationsToken": "token",
  "assetsToken": "token",
  "managementToken": "token"
}
```

`POST /webhook/apple/declaration-items` returns:

```json
{
  "activations": [{ "identifier": "activation-id", "serverToken": "token" }],
  "configurations": [{ "identifier": "configuration-id", "serverToken": "token" }],
  "assets": [],
  "management": []
}
```

`POST /webhook/apple/declaration` receives `scope`, `type`, and `identifier`, then returns
either a declaration object or `null`.

## Assets

`POST /webhook/apple/asset`

```json
{
  "identityCertificate": "PEM_OR_HEADER_VALUE",
  "identifier": "asset-id"
}
```

Return either `null` or a base64-encoded asset:

```json
{
  "content": "BASE64_CONTENT",
  "contentType": "application/octet-stream"
}
```

The gateway decodes `content` and serves the bytes from
`/mdm/apple/assets/:identifier`. A `null` response becomes `404`.

## Windows contract (preview)

| Endpoint                     | Request                                                                                                         | Response                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `/webhook/windows/discovery` | `emailAddress?`, `requestVersion`, `deviceType`, `applicationVersion`, `osEdition`, `authPolicies`, `mdmOrigin` | `authPolicy`, `enrollmentVersion`, `enrollmentPolicyServiceUrl`, `enrollmentServiceUrl`, `authServiceUrl?` |
| `/webhook/windows/policy`    | `authToken`                                                                                                     | `minimalKeyLength`, `certificateValidityPeriodSeconds`, `renewalPeriodSeconds`, `authToken`                |
| `/webhook/windows/enroll`    | `authToken`, `csr`, `deviceId?`, `deviceName?`, `enrollmentType?`, `context`, `mdmOrigin`                       | `deviceId`, `signedCertificate`, `identityCertificate`, `username`, `secret`, `providerId`                 |
| `/webhook/windows/checkin`   | `scope`, `request` (`sessionID`, `msgID`, `source`, `target`, `statuses`, `alerts`)                             | `commands`: array of `kind`, `cmdID`, `locURI?`, `data?`, `format?`                                        |
| `/webhook/windows/event`     | `scope`, `event` (`Enrolled`, `ManagementCheckin`, `CommandResult`)                                             | Empty on success                                                                                           |

The current Cloud management backend answers all Windows methods with
`ManagementNotSupported`.

## Errors

Webhook endpoints may return typed errors understood by the gateway:

| Error                         | Meaning                                            |
| ----------------------------- | -------------------------------------------------- |
| `ManagementNotSupported`      | The requested management feature is not supported. |
| `UnknownDevice`               | The device or user is unknown to your backend.     |
| `ServerInitiatedUnenrollment` | Unenroll the device during check-in.               |
| `InternalServerError`         | Generic backend failure.                           |

The HTTP client maps these tags into gateway protocol behaviour. Unknown or malformed
responses are treated as internal errors.

## Local testing

```bash
pnpm mserver dev serve \
  --origin http://localhost:3000 \
  --webhook-url http://localhost:8787
```

Then exercise the contract with any HTTP client. The example Worker
(`apps/example-whitelabel`) implements a D1-backed version of the Apple contract and is a
useful reference for request/response shapes.
