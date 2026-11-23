# Build a management backend

A management backend is the service that makes the device-management decisions for a
Mattrax deployment. The Mattrax gateway terminates the Apple, Windows and Android
protocols, authenticates devices, and then asks your backend what to do over a signed
webhook. You own enrollment records, policy, commands and inventory; Mattrax owns the
protocol and push plumbing.

```text
device ──► Mattrax gateway ──► POST /webhook/* ──► your backend
                 ▲                                     │
                 └──────── command / declaration ──────┘
```

The JavaScript SDK has two packages:

| Package                            | What it gives you                                                         |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `@mattrax/management-backend`      | The `ManagementBackend` Effect service and the domain payload types.      |
| `@mattrax/management-backend-http` | The HMAC-signed webhook transport — both the server handler and a client. |

Use this guide when you are building a whitelabel or self-hosted MDM product on top of
Mattrax. If you are managing a tenant through Mattrax Cloud, use the
[REST API](/api/) instead; the built-in enterprise backend already implements this
contract.

## Install

Both packages are workspace packages in the Mattrax monorepo, so depend on them from a
package in that workspace:

```json title="package.json"
{
  "dependencies": {
    "@mattrax/management-backend": "workspace:*",
    "@mattrax/management-backend-http": "workspace:*",
    "effect": "catalog:"
  }
}
```

They are built on [Effect](https://effect.website). A backend is an Effect `Layer`; the
transport is another `Layer` that needs it.

## Implement the contract

`ManagementBackend` is an Effect `Context.Service`. Implement its `Service` object and
provide it as a layer. Every method returns an `Effect`; failures are tagged values, not
thrown exceptions.

```ts title="backend.ts"
import { Effect, Layer } from "effect";
import { ManagementBackend, ManagementNotSupported } from "@mattrax/management-backend";

export const BackendLive = Layer.succeed(
  ManagementBackend,
  ManagementBackend.of({
    // Apple check-in events: Authenticate, TokenUpdate, CheckOut,
    // CommandResult, DeclarationStatus, ...
    appleDeviceEvent: (scope, event) =>
      Effect.gen(function* () {
        if (event._tag === "TokenUpdate") {
          // Persist event.pushToken and event.pushMagic against scope.udid.
        }

        if (event._tag === "CommandResult") {
          // event.commandUUID, event.status, event.errorDetail
        }
      }),

    // The device polled for work. Return the next command, a DDM sync token,
    // or Idle.
    appleManagementCheckin: () => Effect.succeed({ _tag: "Idle" } as const),

    getAppleBootstrapToken: () => Effect.succeed(null),

    appleReturnToServiceConfiguration: () => Effect.succeed({ enabled: false }),

    // DDM. If you do not deliver declarations, fail with
    // ManagementNotSupported (or return empty shapes) instead.
    getAppleDeclarationTokens: () => Effect.fail(new ManagementNotSupported()),
    getAppleDeclarationItems: () => Effect.fail(new ManagementNotSupported()),
    getAppleDeclaration: () => Effect.succeed(null),
    getAppleAsset: () => Effect.succeed(null),
    getAppleManifest: () => Effect.succeed(null),
    getAppleProfile: () => Effect.succeed(null),

    // Windows. An Apple-only deployment reports the methods it does not
    // implement rather than pretending they succeeded.
    windowsDiscovery: () => Effect.fail(new ManagementNotSupported()),
    getWindowsEnrollmentPolicy: () => Effect.fail(new ManagementNotSupported()),
    windowsEnroll: () => Effect.fail(new ManagementNotSupported()),
    windowsManagementCheckin: () => Effect.fail(new ManagementNotSupported()),
    windowsDeviceEvent: () => Effect.fail(new ManagementNotSupported()),
  }),
);
```

The two optional methods, `appleRecordFailure` and `windowsRecordFailure`, receive
protocol faults that happened above your backend (an unparseable plist, a bad SyncML
envelope). Implement them if you want those failures in your own audit history; the
device-facing response is unaffected either way.

### What each method is for

| Method                              | Called when                                                      | Return                                                          |
| ----------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| `appleDeviceEvent`                  | Any Apple check-in event, with a verified device/user scope      | `void`, or an inline ADE `enrollmentProfile` for `Authenticate` |
| `appleManagementCheckin`            | The device polls for work                                        | `{ _tag: "Idle" }`, a `Command`, or `{ _tag: "DdmSync" }`       |
| `getAppleBootstrapToken`            | The device asks for its escrowed bootstrap token                 | The raw token, or `null`                                        |
| `appleReturnToServiceConfiguration` | An ADE device is about to erase for return to service            | Wi-Fi profile and bootstrap token                               |
| `getAppleDeclarationTokens`         | DDM sync starts                                                  | `DdmTokens`                                                     |
| `getAppleDeclarationItems`          | DDM lists the declarations that changed                          | `DdmDeclarationItems`                                           |
| `getAppleDeclaration`               | The device fetches one declaration                               | A JSON declaration, or `null`                                   |
| `getAppleAsset`                     | The device fetches a DDM asset by identifier                     | `{ content, contentType }`, or `null`                           |
| `getAppleManifest`                  | An iPhone/iPad fetches the OTA manifest for an uploaded `.ipa`   | `{ content, contentType }`, or `null`                           |
| `getAppleProfile`                   | The device fetches a legacy `.mobileconfig` behind a declaration | `{ content, contentType }`, or `null`                           |
| `windowsDiscovery`                  | A Windows device starts enrollment from an email/URL             | `WindowsDiscoveryResponse`                                      |
| `getWindowsEnrollmentPolicy`        | WSTEP asks for the certificate policy                            | `WindowsEnrollmentPolicy`                                       |
| `windowsEnroll`                     | WSTEP submits a CSR                                              | `WindowsEnrollmentResult`                                       |
| `windowsManagementCheckin`          | A SyncML management session starts                               | `{ commands }`                                                  |
| `windowsDeviceEvent`                | Enrollment, check-in and command results                         | `void`                                                          |

## Serve the webhook

`managementWebhookHandlers` binds the contract to the HTTP routes under `/webhook/`. It
verifies the HMAC signature and timestamp on every request before calling your backend,
so the secret must match the gateway's `--webhook-secret` (or
`MATTRAX_WEBHOOK_SECRET`). Authentication fails closed: when the secret is missing, every
request is rejected rather than accepted unsigned.

```ts title="server.ts"
import { Layer } from "effect";
import { HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { managementApi, managementWebhookHandlers } from "@mattrax/management-backend-http";
import { BackendLive } from "./backend.ts";

const ApiLive = HttpApiBuilder.layer(managementApi, {
  // Optional: serve the contract's OpenAPI document beside the webhook.
  openapiPath: "/openapi.json",
}).pipe(
  Layer.provide(
    HttpApiBuilder.group(managementApi, "ManagementWebhook", (handlers) =>
      managementWebhookHandlers(handlers, {
        secret: process.env.WEBHOOK_SECRET,
      }),
    ),
  ),
  Layer.provideMerge(BackendLive),
);

// A web-standard fetch handler: export it from a Worker, Bun, Deno, or adapt
// it to node:http.
export const { handler } = HttpRouter.toWebHandler(ApiLive);
```

```ts title="worker.ts"
import { handler } from "./server.ts";

export default { fetch: handler };
```

The gateway calls these routes:

```http
POST /webhook/apple/event
POST /webhook/apple/checkin
POST /webhook/apple/bootstrap-token
POST /webhook/apple/return-to-service
POST /webhook/apple/declaration-tokens
POST /webhook/apple/declaration-items
POST /webhook/apple/declaration
POST /webhook/apple/asset
POST /webhook/apple/manifest
POST /webhook/apple/profile
POST /webhook/windows/discovery
POST /webhook/windows/policy
POST /webhook/windows/enroll
POST /webhook/windows/checkin
POST /webhook/windows/event
```

### Call a backend in another process

If the process serving the device protocols is separate from the process that owns device
state — a Mattrax gateway pointed at your hosted backend, for example — use
`ManagementBackendHttp` on the gateway side. It returns a `ManagementBackend` layer backed
by the same generated client and signs every request when you pass the secret:

```ts
import { ManagementBackendHttp } from "@mattrax/management-backend-http";

const BackendLive = ManagementBackendHttp({
  baseUrl: "https://mdm.example.com",
  secret: process.env.MATTRAX_WEBHOOK_SECRET,
});
```

Without a secret it logs a warning and sends unsigned requests, which a correctly
configured backend rejects. Set the same secret on both sides.

## Errors

Return tagged errors instead of throwing. The gateway maps them to the device protocol,
so the device never sees your HTTP status code.

| Error                         | Meaning                                                   | Device response                                                         |
| ----------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `ManagementNotSupported`      | You do not implement this capability                      | Optional check-in events are ignored; a required poll fails             |
| `UnknownDevice`               | The device is unknown, unenrolled or has an expired token | Apple `410 Gone` (device removes its profile); Windows enrollment error |
| `ServerInitiatedUnenrollment` | Stop managing this device                                 | Apple `410 Gone`                                                        |
| `InternalServerError`         | Your backend failed                                       | A retryable server error                                                |

Do not use `UnknownDevice` for a transient database outage: it tells the device to
unenroll. Use `InternalServerError` so the device retries.

## Idempotency and retries

Devices poll continuously and the gateway may retry. Assume every method can be called
more than once with the same input:

- Key command results by `commandUUID`, not by arrival order.
- Treat `TokenUpdate` as an upsert on the device and channel.
- Do not advance a DDM token or policy version twice for one request.
- Keep handlers fast. The device is waiting; hand long work to your own queue.

## Reference

- [SDK reference](/api/sdk/) — generated from the packages with TypeDoc.
- [Management webhook contract](/api/openapi#management-webhook-contract) — the wire
  contract, including the HMAC canonical string.
- [API reference](/api/reference/management) — the same routes as request/response tables.
