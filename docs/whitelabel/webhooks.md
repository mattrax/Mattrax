# Management Webhooks

The whitelabel server calls your management backend for product-specific behavior. Configure the backend base URL with `--webhook-url`.

All webhook endpoints are under the `/webhook` prefix relative to the configured base URL.

## Endpoints

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `POST` | `/webhook/apple/event` | Receives Apple device lifecycle and status events. |
| `POST` | `/webhook/apple/checkin` | Returns the next management action for a device check-in. |
| `POST` | `/webhook/apple/declaration-tokens` | Returns declarative management tokens. |
| `POST` | `/webhook/apple/declaration-items` | Returns declarative management item identifiers and server tokens. |
| `POST` | `/webhook/apple/declaration` | Returns one declarative management declaration. |
| `POST` | `/webhook/apple/asset` | Returns one asset by identifier. |

## Scope

Most webhook requests include a `scope` object identifying the device or user channel.

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

`identityCertificate` may be omitted when Apple did not provide `x-device-identity-certificate`.

## Device Events

`POST /webhook/apple/event`

Request body:

```json
{
  "scope": { "_tag": "device", "udid": "DEVICE-UDID", "mdmOrigin": { "url": "https://mdm.example.com" } },
  "event": { "_tag": "Authenticate", "serialNumber": "C02...", "model": "MacBookPro", "osVersion": "15.0" }
}
```

Supported event tags are:

| Tag | Description |
| --- | ----------- |
| `Authenticate` | Enrollment authentication data such as serial number, model, and OS version. |
| `TokenUpdate` | Push token, push magic, MDM topic, and channel. |
| `CheckOut` | Device unenrolled. |
| `CommandResult` | Result for a previously issued imperative MDM command. |
| `DeclarationStatus` | Declarative device management status report. |

## Check-In Decisions

`POST /webhook/apple/checkin`

Return exactly one management manifest:

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

`DdmSync` and `Command` are mutually exclusive because the underlying Apple protocol can only perform one response path for a check-in.

## Declarative Management

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

`POST /webhook/apple/declaration` receives `scope`, `type`, and `identifier`, then returns either a declaration object or `null`.

## Assets

`POST /webhook/apple/asset`

Request body:

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

The whitelabel server decodes `content` and serves the bytes from `/mdm/apple/assets/:identifier`.

## Errors

Webhook endpoints may return typed errors understood by the server:

| Error | Meaning |
| ----- | ------- |
| `ManagementNotSupported` | The requested management feature is not supported. |
| `UnknownDevice` | The device or user is unknown to your backend. |
| `ServerInitiatedUnenrollment` | Your backend wants the device unenrolled during check-in. |
| `InternalServerError` | Generic backend failure. |

The HTTP client layer maps these typed responses into server-side protocol behavior.
