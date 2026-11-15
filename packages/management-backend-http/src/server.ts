import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import type { HttpServerRequest } from "effect/http/HttpServerRequest";
import { InternalServerError, ManagementBackend } from "@mattrax/management-backend";
import { managementWebhookGroup } from "./http.ts";

const encoder = new TextEncoder();

const toHex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256 = (value: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", encoder.encode(value))).pipe(
    Effect.map(toHex),
  );

const hmac = (secret: string, value: string) =>
  Effect.gen(function* () {
    const key = yield* Effect.promise(() =>
      crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      ),
    );

    return toHex(
      yield* Effect.promise(() => crypto.subtle.sign("HMAC", key, encoder.encode(value))),
    );
  });

const timingSafeEqual = (left: string, right: string) => {
  const a = encoder.encode(left);
  const b = encoder.encode(right);

  if (a.length !== b.length) return false;
  let difference = 0;

  for (let index = 0; index < a.length; index++) difference |= a[index]! ^ b[index]!;

  return difference === 0;
};

const verifySignature = <Payload>(
  request: HttpServerRequest,
  operation: string,
  payload: Payload,
  secret: string | undefined,
): Effect.Effect<void, InternalServerError> =>
  Effect.gen(function* () {
    // Authentication must fail closed. A deployment that forgets to configure
    // `WEBHOOK_SECRET` must not accept anonymous management traffic, so every
    // request errors with a logged configuration failure instead.
    if (!secret) {
      console.error(
        "Management webhook rejected: WEBHOOK_SECRET is not configured. Set the same secret on the gateway and this backend.",
      );

      return yield* Effect.fail(new InternalServerError());
    }

    const timestamp = request.headers["x-mattrax-timestamp"];
    const signature = request.headers["x-mattrax-signature"];

    if (!timestamp || !signature || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300)
      return yield* Effect.fail(new InternalServerError());
    const digest = yield* sha256(JSON.stringify(payload ?? null));
    const expected = yield* hmac(secret, `${operation}.${timestamp}.${digest}`);

    if (!timingSafeEqual(expected, signature)) return yield* Effect.fail(new InternalServerError());
  });

export type ManagementWebhookOptions = {
  /**
   * Shared HMAC secret. Required: when unset every webhook request is rejected
   * with `InternalServerError` so authentication can never fail open.
   */
  readonly secret?: string;
};

export const managementWebhookHandlers = (
  handlers: HttpApiBuilder.Handlers.FromGroup<typeof managementWebhookGroup>,
  options: ManagementWebhookOptions = {},
) =>
  handlers
    .handle("appleDeviceEvent", ({ request, payload }) =>
      Effect.gen(function* () {
        yield* verifySignature(request, "appleDeviceEvent", payload, options.secret);
        const backend = yield* ManagementBackend;
        yield* backend.appleDeviceEvent(payload.scope, payload.event);
      }),
    )
    .handle("appleManagementCheckin", ({ request, payload }) =>
      Effect.gen(function* () {
        yield* verifySignature(request, "appleManagementCheckin", payload, options.secret);
        const backend = yield* ManagementBackend;

        return yield* backend.appleManagementCheckin(payload.scope);
      }),
    )
    .handle("getAppleBootstrapToken", ({ request, payload }) =>
      Effect.gen(function* () {
        yield* verifySignature(request, "getAppleBootstrapToken", payload, options.secret);
        const backend = yield* ManagementBackend;

        return yield* backend.getAppleBootstrapToken(payload.scope);
      }),
    )
    .handle("getAppleDeclarationTokens", ({ request, payload }) =>
      Effect.gen(function* () {
        yield* verifySignature(request, "getAppleDeclarationTokens", payload, options.secret);
        const backend = yield* ManagementBackend;

        return yield* backend.getAppleDeclarationTokens(payload.scope);
      }),
    )
    .handle("getAppleDeclarationItems", ({ request, payload }) =>
      Effect.gen(function* () {
        yield* verifySignature(request, "getAppleDeclarationItems", payload, options.secret);
        const backend = yield* ManagementBackend;

        return yield* backend.getAppleDeclarationItems(payload.scope);
      }),
    )
    .handle("getAppleDeclaration", ({ request, payload }) =>
      Effect.gen(function* () {
        yield* verifySignature(request, "getAppleDeclaration", payload, options.secret);
        const backend = yield* ManagementBackend;

        return yield* backend.getAppleDeclaration(payload.scope, payload.type, payload.identifier);
      }),
    )
    .handle("getAppleAsset", ({ request, payload }) =>
      Effect.gen(function* () {
        yield* verifySignature(request, "getAppleAsset", payload, options.secret);
        const backend = yield* ManagementBackend;

        return yield* backend.getAppleAsset(
          payload.identityCertificate,
          payload.identifier,
          payload.token,
        );
      }),
    )
    .handle("getAppleProfile", ({ request, payload }) =>
      Effect.gen(function* () {
        yield* verifySignature(request, "getAppleProfile", payload, options.secret);
        const backend = yield* ManagementBackend;

        if (!backend.getAppleProfile) return null;

        return yield* backend.getAppleProfile(payload.policyId, payload.kind);
      }),
    )
    .handle("windowsDiscovery", ({ request, payload }) =>
      Effect.gen(function* () {
        yield* verifySignature(request, "windowsDiscovery", payload, options.secret);
        const backend = yield* ManagementBackend;

        return yield* backend.windowsDiscovery(payload);
      }),
    )
    .handle("getWindowsEnrollmentPolicy", ({ request, payload }) =>
      Effect.gen(function* () {
        yield* verifySignature(request, "getWindowsEnrollmentPolicy", payload, options.secret);
        const backend = yield* ManagementBackend;

        return yield* backend.getWindowsEnrollmentPolicy(payload.authToken, {
          tenantToken: payload.tenantToken,
        });
      }),
    )
    .handle("windowsEnroll", ({ request, payload }) =>
      Effect.gen(function* () {
        yield* verifySignature(request, "windowsEnroll", payload, options.secret);
        const backend = yield* ManagementBackend;

        return yield* backend.windowsEnroll(payload);
      }),
    )
    .handle("windowsManagementCheckin", ({ request, payload }) =>
      Effect.gen(function* () {
        yield* verifySignature(request, "windowsManagementCheckin", payload, options.secret);
        const backend = yield* ManagementBackend;

        return yield* backend.windowsManagementCheckin(payload.scope, payload.request);
      }),
    )
    .handle("windowsDeviceEvent", ({ request, payload }) =>
      Effect.gen(function* () {
        yield* verifySignature(request, "windowsDeviceEvent", payload, options.secret);
        const backend = yield* ManagementBackend;
        yield* backend.windowsDeviceEvent(payload.scope, payload.event);
      }),
    );
