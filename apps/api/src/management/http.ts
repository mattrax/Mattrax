import { Effect, Layer } from "effect";
import { HttpApiClient } from "effect/unstable/httpapi";
import { ManagementBackend, ManagementNotSupported } from "@mattrax/mdm-domain";
import { managementApi } from "@mattrax/mdm-domain";

export const ManagementBackendHttp = (baseUrl: string) =>
  Layer.effect(
    ManagementBackend,
    Effect.gen(function* () {
      const client = yield* HttpApiClient.make(managementApi, { baseUrl });

      return ManagementBackend.of({
        authenticateAppleDevice: (udid) =>
          client.ManagementWebhook.authenticateAppleDevice({ payload: { udid } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
          ),

        appleDeviceEvent: (deviceId, event) =>
          client.ManagementWebhook.appleDeviceEvent({ payload: { deviceId, event } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
          ),

        appleManagementCheckin: (deviceId) =>
          client.ManagementWebhook.appleManagementCheckin({ payload: { deviceId } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
          ),

        getAppleDeclarationTokens: (deviceId) =>
          client.ManagementWebhook.getAppleDeclarationTokens({ payload: { deviceId } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
          ),

        getAppleDeclarationItems: (deviceId) =>
          client.ManagementWebhook.getAppleDeclarationItems({ payload: { deviceId } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
          ),

        getAppleDeclaration: (deviceId, type, identifier) =>
          client.ManagementWebhook.getAppleDeclaration({ payload: { deviceId, type, identifier } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
          ),

        getApplePushInfo: (deviceId) =>
          client.ManagementWebhook.getApplePushInfo({ payload: { deviceId } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
          ),

        queueAppleCommand: (deviceId, requestType, payload) =>
          client.ManagementWebhook.queueAppleCommand({ payload: { deviceId, requestType, payload } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
          ),
      });
    }),
  );
