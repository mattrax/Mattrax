import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { ManagementBackend } from "@mattrax/management-backend";
import { managementWebhookGroup } from "./http.ts";

export const managementWebhookHandlers = (
  handlers: HttpApiBuilder.Handlers.FromGroup<typeof managementWebhookGroup>,
) =>
  handlers
    .handle("appleDeviceEvent", ({ payload }) =>
      Effect.gen(function* () {
        const backend = yield* ManagementBackend;
        yield* backend.appleDeviceEvent(payload.scope, payload.event);
      }),
    )
    .handle("appleManagementCheckin", ({ payload }) =>
      Effect.gen(function* () {
        const backend = yield* ManagementBackend;
        return yield* backend.appleManagementCheckin(payload.scope);
      }),
    )
    .handle("getAppleDeclarationTokens", ({ payload }) =>
      Effect.gen(function* () {
        const backend = yield* ManagementBackend;
        return yield* backend.getAppleDeclarationTokens(payload.scope);
      }),
    )
    .handle("getAppleDeclarationItems", ({ payload }) =>
      Effect.gen(function* () {
        const backend = yield* ManagementBackend;
        return yield* backend.getAppleDeclarationItems(payload.scope);
      }),
    )
    .handle("getAppleDeclaration", ({ payload }) =>
      Effect.gen(function* () {
        const backend = yield* ManagementBackend;
        return yield* backend.getAppleDeclaration(payload.scope, payload.type, payload.identifier);
      }),
    )
    .handle("getAppleAsset", ({ payload }) =>
      Effect.gen(function* () {
        const backend = yield* ManagementBackend;
        return yield* backend.getAppleAsset(payload.identityCertificate, payload.identifier);
      }),
    )
    .handle("windowsDiscovery", ({ payload }) =>
      Effect.gen(function* () {
        const backend = yield* ManagementBackend;
        return yield* backend.windowsDiscovery(payload);
      }),
    )
    .handle("getWindowsEnrollmentPolicy", ({ payload }) =>
      Effect.gen(function* () {
        const backend = yield* ManagementBackend;
        return yield* backend.getWindowsEnrollmentPolicy(payload.authToken);
      }),
    )
    .handle("windowsEnroll", ({ payload }) =>
      Effect.gen(function* () {
        const backend = yield* ManagementBackend;
        return yield* backend.windowsEnroll(payload);
      }),
    )
    .handle("windowsManagementCheckin", ({ payload }) =>
      Effect.gen(function* () {
        const backend = yield* ManagementBackend;
        return yield* backend.windowsManagementCheckin(payload.scope, payload.request);
      }),
    )
    .handle("windowsDeviceEvent", ({ payload }) =>
      Effect.gen(function* () {
        const backend = yield* ManagementBackend;
        yield* backend.windowsDeviceEvent(payload.scope, payload.event);
      }),
    );
