# Management backend (TypeScript)

The whitelabel contract is a TypeScript service interface plus an HTTP webhook binding. You
can run the gateway in-process with your backend, or over HTTP with HMAC signatures.

## Service interface

```ts
import { Context } from "effect";
import type { Effect } from "effect";

export class ManagementBackend extends Context.Service<
  ManagementBackend,
  ManagementBackend.Service
>()("ManagementBackend") {}

export declare namespace ManagementBackend {
  interface Service {
    appleDeviceEvent(
      scope: CheckinScope,
      event: AppleDeviceEvent,
    ): Effect<void, ManagementNotSupported | UnknownDevice | InternalServerError>;

    getAppleBootstrapToken(
      scope: CheckinScope,
    ): Effect<string | null, ManagementNotSupported | UnknownDevice | InternalServerError>;

    appleManagementCheckin(
      scope: CheckinScope,
    ): Effect<
      ManagementManifest,
      ManagementNotSupported | UnknownDevice | InternalServerError | ServerInitiatedUnenrollment
    >;

    getAppleDeclarationTokens(scope: CheckinScope): Effect<DdmTokens /* … */>;
    getAppleDeclarationItems(scope: CheckinScope): Effect<DdmDeclarationItems /* … */>;
    getAppleDeclaration(
      scope: CheckinScope,
      type: string,
      identifier: string,
    ): Effect<Record<string, unknown> | null /* … */>;
    getAppleAsset(
      identityCertificate: string | undefined,
      identifier: string,
      token?: string,
    ): Effect<{ content: Uint8Array; contentType: string } | null /* … */>;
    getAppleProfile?(
      policyId: string,
      kind: string,
    ): Effect<{ content: Uint8Array; contentType: string } | null /* … */>;

    windowsDiscovery(request: WindowsDiscoveryRequest): Effect<WindowsDiscoveryResponse /* … */>;
    getWindowsEnrollmentPolicy(
      authToken: string,
      context?: WindowsEnrollmentContext,
    ): Effect<WindowsEnrollmentPolicy /* … */>;
    windowsEnroll(request: WindowsEnrollmentRequest): Effect<WindowsEnrollmentResult /* … */>;
    windowsManagementCheckin(
      scope: WindowsManagementScope,
      request: WindowsManagementRequest,
    ): Effect<WindowsManagementResponse /* … */>;
    windowsDeviceEvent(
      scope: WindowsManagementScope,
      event: WindowsDeviceEvent,
    ): Effect<void /* … */>;
  }
}
```

## Apple types

```ts
type CheckinScope =
  | {
      _tag: "device";
      udid: string;
      identityCertificate?: string;
      identityCertificateFingerprintSha256?: string;
      identityCertificateSerial?: string;
      mdmOrigin: MdmOrigin;
    }
  | {
      _tag: "user";
      udid: string;
      identityCertificate?: string;
      identityCertificateFingerprintSha256?: string;
      identityCertificateSerial?: string;
      userId: string;
      userShortName?: string;
      mdmOrigin: MdmOrigin;
    };

type AppleDeviceEvent =
  | { _tag: "Authenticate" /* … */ }
  | { _tag: "TokenUpdate" /* … */ }
  | { _tag: "CheckOut" /* … */ }
  | { _tag: "BootstrapToken" /* … */ }
  | { _tag: "CommandResult" /* … */ }
  | { _tag: "DeclarationStatus" /* … */ };

type ManagementManifest =
  | { _tag: "Idle" }
  | { _tag: "Command"; commandUUID: string; requestType: string; payload: unknown }
  | { _tag: "DdmSync"; serverToken: string };

type DdmTokens = {
  activationsToken: string;
  configurationsToken: string;
  assetsToken: string;
  managementToken: string;
  declarationsToken: string;
};
```

`MdmOrigin` has one helper:

```ts
const origin = new MdmOrigin({ url: "https://mdm.example.com" });
origin.assetUrl("policy.asset"); // https://mdm.example.com/mdm/apple/assets/policy.asset
```

## Windows types

| Type                        | Purpose                                                                   |
| --------------------------- | ------------------------------------------------------------------------- |
| `WindowsDiscoveryRequest`   | Device discovery; carries auth policies, origin and optional tenant token |
| `WindowsDiscoveryResponse`  | Auth policy (`OnPremise`/`Federated`), service URLs                       |
| `WindowsEnrollmentPolicy`   | Key length, certificate validity, renewal period, WSTEP auth token        |
| `WindowsEnrollmentRequest`  | Auth token, CSR, device identity, context                                 |
| `WindowsEnrollmentResult`   | Signed certificate, CA identity, username, secret, provider id            |
| `WindowsManagementRequest`  | SyncML session, statuses and alerts                                       |
| `WindowsManagementResponse` | Commands to return                                                        |

## HTTP client

Use `ManagementBackendHttp` when the gateway and backend are separate processes:

```ts
import { ManagementBackendHttp } from "@mattrax/management-backend-http";

const layer = ManagementBackendHttp({
  baseUrl: "https://api.example.com",
  secret: process.env.MATTRAX_WEBHOOK_SECRET!,
});
```

The client signs every request:

```text
timestamp = floor(Date.now() / 1000)
digest    = sha256hex(JSON.stringify(payload ?? null))
signature = hmacSha256Hex(secret, `${operation}.${timestamp}.${digest}`)

x-mattrax-timestamp: <timestamp>
x-mattrax-signature: <signature>
```

## HTTP server handlers

Implement the same contract behind `managementWebhookHandlers`:

```ts
import { HttpApiBuilder } from "effect/http-api";
import {
  managementWebhookGroup,
  managementWebhookHandlers,
} from "@mattrax/management-backend-http";

const group = HttpApiBuilder.group(api, "ManagementWebhook", (handlers) =>
  managementWebhookHandlers(handlers, { secret: process.env.WEBHOOK_SECRET }),
);
```

The handler factory verifies the timestamp (300-second window), recomputes the digest and
HMAC, and compares in constant time. It **fails closed** when no secret is configured.

## Webhook endpoints

| Method | Path                                | Body                                           | Response                             |
| ------ | ----------------------------------- | ---------------------------------------------- | ------------------------------------ |
| `POST` | `/webhook/apple/event`              | `{ scope, event }`                             | empty                                |
| `POST` | `/webhook/apple/checkin`            | `{ scope }`                                    | `ManagementManifest`                 |
| `POST` | `/webhook/apple/bootstrap-token`    | `{ scope }`                                    | `string \| null`                     |
| `POST` | `/webhook/apple/declaration-tokens` | `{ scope }`                                    | `DdmTokens`                          |
| `POST` | `/webhook/apple/declaration-items`  | `{ scope }`                                    | `DdmDeclarationItems`                |
| `POST` | `/webhook/apple/declaration`        | `{ scope, type, identifier }`                  | declaration or `null`                |
| `POST` | `/webhook/apple/asset`              | `{ identityCertificate?, identifier, token? }` | `{ content, contentType }` or `null` |
| `POST` | `/webhook/apple/profile`            | `{ policyId, kind }`                           | `{ content, contentType }` or `null` |
| `POST` | `/webhook/windows/discovery`        | `WindowsDiscoveryRequest`                      | `WindowsDiscoveryResponse`           |
| `POST` | `/webhook/windows/policy`           | `{ authToken, tenantToken? }`                  | `WindowsEnrollmentPolicy`            |
| `POST` | `/webhook/windows/enroll`           | `WindowsEnrollmentRequest`                     | `WindowsEnrollmentResult`            |
| `POST` | `/webhook/windows/checkin`          | `{ scope, request }`                           | `WindowsManagementResponse`          |
| `POST` | `/webhook/windows/event`            | `{ scope, event }`                             | empty                                |

Asset and profile `content` is base64 over HTTP; in-process it is `Uint8Array`. `null`
becomes a 404.

## Errors

| Error                         | Meaning                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| `ManagementNotSupported`      | This backend does not implement that platform                          |
| `UnknownDevice`               | The device or tenant cannot be resolved                                |
| `ServerInitiatedUnenrollment` | The check-in should return 410 and the device should remove management |
| `InternalServerError`         | Backend failure                                                        |

`UnknownDevice` on a management check-in is treated as idle by the Apple handler.

## Example

A minimal in-memory backend:

```ts
import { Effect, Layer } from "effect";
import { ManagementBackend, ManagementNotSupported } from "@mattrax/management-backend";

const backend = {
  appleDeviceEvent: (scope, event) =>
    Effect.sync(() => {
      console.log(scope.udid, event._tag);
    }),
  appleManagementCheckin: () => Effect.succeed({ _tag: "Idle" as const }),
  getAppleBootstrapToken: () => Effect.succeed(null),
  getAppleDeclarationTokens: () =>
    Effect.succeed({
      activationsToken: "1",
      configurationsToken: "1",
      assetsToken: "1",
      managementToken: "1",
      declarationsToken: "1",
    }),
  getAppleDeclarationItems: () =>
    Effect.succeed({
      activations: [],
      configurations: [],
      assets: [],
      management: [],
    }),
  getAppleDeclaration: () => Effect.succeed(null),
  getAppleAsset: () => Effect.succeed(null),
  windowsDiscovery: () => Effect.fail(new ManagementNotSupported()),
  getWindowsEnrollmentPolicy: () => Effect.fail(new ManagementNotSupported()),
  windowsEnroll: () => Effect.fail(new ManagementNotSupported()),
  windowsManagementCheckin: () => Effect.fail(new ManagementNotSupported()),
  windowsDeviceEvent: () => Effect.fail(new ManagementNotSupported()),
};

const layer = Layer.succeed(ManagementBackend, backend);
```

For a complete D1-backed implementation, read `apps/example-whitelabel/src/management.ts`.

## Testing

- Use `ManagementBackendHttp` against a local HTTP server and assert the signature header.
- Replay a stale timestamp and expect a 401.
- Assert `null` asset/profile responses become 404.
- Test `ServerInitiatedUnenrollment` returns 410.
- Test an unknown UDID on check-in returns an idle manifest.

## Next

- [Whitelabel enrollment](/operations/whitelabel/enrollment)
- [Gateway deployment](/operations/whitelabel/deployment)
