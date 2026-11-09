import { Effect, Layer } from "effect";
import { HttpApiClient } from "effect/http-api";
import {
  ManagementBackend,
  ManagementNotSupported,
  UnknownDevice,
  ServerInitiatedUnenrollment,
  InternalServerError,
} from "@mattrax/management-backend";
import { managementApi } from "./http.ts";

type ManagementError = ManagementNotSupported | UnknownDevice | InternalServerError;

const toManagementError = (error: { readonly _tag?: string }): ManagementError => {
  switch (error._tag) {
    case "ManagementNotSupported":
      return new ManagementNotSupported();
    case "UnknownDevice":
      return new UnknownDevice();
    default:
      return new InternalServerError();
  }
};

const toCheckinError = (error: {
  readonly _tag?: string;
}): ManagementError | ServerInitiatedUnenrollment =>
  error._tag === "ServerInitiatedUnenrollment"
    ? new ServerInitiatedUnenrollment()
    : toManagementError(error);

const normalize = <A, E extends { readonly _tag?: string | undefined }, R>(
  effect: Effect.Effect<A, E, R>,
) => effect.pipe(Effect.mapError(toManagementError));

const normalizeNoDevice = <A, E extends { readonly _tag?: string | undefined }, R>(
  effect: Effect.Effect<A, E, R>,
) =>
  effect.pipe(
    Effect.mapError((error): ManagementNotSupported | InternalServerError =>
      error._tag === "ManagementNotSupported"
        ? new ManagementNotSupported()
        : new InternalServerError(),
    ),
  );

const normalizeCheckin = <A, E extends { readonly _tag?: string | undefined }, R>(
  effect: Effect.Effect<A, E, R>,
) => effect.pipe(Effect.mapError(toCheckinError));

export const ManagementBackendHttp = (baseUrl: string) =>
  Layer.effect(
    ManagementBackend,
    Effect.gen(function* () {
      const client = yield* HttpApiClient.make(managementApi, { baseUrl });

      return ManagementBackend.of({
        appleDeviceEvent: (scope, event) =>
          normalize(client.ManagementWebhook.appleDeviceEvent({ payload: { scope, event } })),

        appleManagementCheckin: (scope) =>
          normalizeCheckin(client.ManagementWebhook.appleManagementCheckin({ payload: { scope } })),

        getAppleDeclarationTokens: (scope) =>
          normalize(client.ManagementWebhook.getAppleDeclarationTokens({ payload: { scope } })),

        getAppleDeclarationItems: (scope) =>
          normalize(client.ManagementWebhook.getAppleDeclarationItems({ payload: { scope } })),

        getAppleDeclaration: (scope, type, identifier) =>
          normalize(
            client.ManagementWebhook.getAppleDeclaration({ payload: { scope, type, identifier } }),
          ),

        getAppleAsset: (identityCertificate, identifier) =>
          normalize(
            client.ManagementWebhook.getAppleAsset({
              payload: { identityCertificate, identifier },
            }),
          ),

        windowsDiscovery: (request) =>
          normalizeNoDevice(client.ManagementWebhook.windowsDiscovery({ payload: request })),

        getWindowsEnrollmentPolicy: (authToken) =>
          normalizeNoDevice(
            client.ManagementWebhook.getWindowsEnrollmentPolicy({ payload: { authToken } }),
          ),

        windowsEnroll: (request) =>
          normalize(client.ManagementWebhook.windowsEnroll({ payload: request })),

        windowsManagementCheckin: (scope, request) =>
          normalize(
            client.ManagementWebhook.windowsManagementCheckin({ payload: { scope, request } }),
          ),

        windowsDeviceEvent: (scope, event) =>
          normalize(client.ManagementWebhook.windowsDeviceEvent({ payload: { scope, event } })),
      });
    }),
  );
