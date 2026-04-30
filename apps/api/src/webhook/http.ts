import { Effect, Layer } from "effect";
import { HttpApiClient } from "effect/unstable/httpapi";
import { ManagementBackend, ManagementNotSupported } from "./layer";
import { managementApi } from "./domain/http";

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
