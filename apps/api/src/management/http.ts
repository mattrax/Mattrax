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
        appleCheckin: (deviceId: string) =>
          client.ManagementWebhook.appleCheckin({ payload: { deviceId } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
          ),
        authenticateAppleDevice: (info: any) =>
          client.ManagementWebhook.authenticateAppleDevice({ payload: info }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
          ),
        updateAppleEnrollment: (update: any) =>
          client.ManagementWebhook.updateAppleEnrollment({ payload: update }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
          ),
        getAppleDeviceByUdid: (udid: string) =>
          client.ManagementWebhook.getAppleDeviceByUdid({ payload: { udid } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
          ),
        getAppleDeclarationManifest: (deviceId: string) =>
          client.ManagementWebhook.getAppleDeclarationManifest({ payload: { deviceId } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
          ),
        getAppleDeclaration: (deviceId: string, type: string, identifier: string) =>
          client.ManagementWebhook.getAppleDeclaration({ payload: { deviceId, type, identifier } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
          ),
        reportDeviceEnrolled: (deviceId: string, info: any) =>
          client.ManagementWebhook.reportDeviceEnrolled({ payload: { deviceId, info } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
          ),
        reportCommandResult: (deviceId: string, result: any) =>
          client.ManagementWebhook.reportCommandResult({ payload: { deviceId, result } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
          ),
        reportDeclarationStatus: (deviceId: string, status: any) =>
          client.ManagementWebhook.reportDeclarationStatus({ payload: { deviceId, status } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
          ),
        reportDeviceInfo: (deviceId: string, info: any) =>
          client.ManagementWebhook.reportDeviceInfo({ payload: { deviceId, info } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
          ),
      });
    }),
  );
