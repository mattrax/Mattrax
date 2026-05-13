import { Effect, Layer } from "effect";
import { HttpApiClient } from "effect/unstable/httpapi";
import { ManagementBackend, ManagementNotSupported, UnknownDevice, ServerInitiatedUnenrollment, InternalServerError } from "@mattrax/management-backend";
import { managementApi } from "./http.ts";

export const ManagementBackendHttp = (baseUrl: string) =>
  Layer.effect(
    ManagementBackend,
    Effect.gen(function* () {
      const client = yield* HttpApiClient.make(managementApi, { baseUrl });

      return ManagementBackend.of({
        appleDeviceEvent: (scope, event) =>
          client.ManagementWebhook.appleDeviceEvent({ payload: { scope, event } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
            Effect.catchTag("UnknownDevice", () => Effect.fail(new UnknownDevice())),
            Effect.catchTag("InternalServerError", () => Effect.fail(new InternalServerError())),
          ),

        appleManagementCheckin: (scope) =>
          client.ManagementWebhook.appleManagementCheckin({ payload: { scope } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
            Effect.catchTag("UnknownDevice", () => Effect.fail(new UnknownDevice())),
            Effect.catchTag("ServerInitiatedUnenrollment", () => Effect.fail(new ServerInitiatedUnenrollment())),
            Effect.catchTag("InternalServerError", () => Effect.fail(new InternalServerError())),
          ),

        getAppleDeclarationTokens: (scope) =>
          client.ManagementWebhook.getAppleDeclarationTokens({ payload: { scope } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
            Effect.catchTag("UnknownDevice", () => Effect.fail(new UnknownDevice())),
            Effect.catchTag("InternalServerError", () => Effect.fail(new InternalServerError())),
          ),

        getAppleDeclarationItems: (scope) =>
          client.ManagementWebhook.getAppleDeclarationItems({ payload: { scope } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
            Effect.catchTag("UnknownDevice", () => Effect.fail(new UnknownDevice())),
            Effect.catchTag("InternalServerError", () => Effect.fail(new InternalServerError())),
          ),

        getAppleDeclaration: (scope, type, identifier) =>
          client.ManagementWebhook.getAppleDeclaration({ payload: { scope, type, identifier } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
            Effect.catchTag("UnknownDevice", () => Effect.fail(new UnknownDevice())),
            Effect.catchTag("InternalServerError", () => Effect.fail(new InternalServerError())),
          ),

        getAppleAsset: (identityCertificate, identifier) =>
          client.ManagementWebhook.getAppleAsset({ payload: { identityCertificate, identifier } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
            Effect.catchTag("UnknownDevice", () => Effect.fail(new UnknownDevice())),
            Effect.catchTag("InternalServerError", () => Effect.fail(new InternalServerError())),
          ),

        windowsDiscovery: (request) =>
          client.ManagementWebhook.windowsDiscovery({ payload: request }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
            Effect.catchTag("InternalServerError", () => Effect.fail(new InternalServerError())),
          ),

        getWindowsEnrollmentPolicy: (authToken) =>
          client.ManagementWebhook.getWindowsEnrollmentPolicy({ payload: { authToken } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
            Effect.catchTag("UnknownDevice", () => Effect.fail(new UnknownDevice())),
            Effect.catchTag("InternalServerError", () => Effect.fail(new InternalServerError())),
          ),

        windowsEnroll: (request) =>
          client.ManagementWebhook.windowsEnroll({ payload: request }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
            Effect.catchTag("UnknownDevice", () => Effect.fail(new UnknownDevice())),
            Effect.catchTag("InternalServerError", () => Effect.fail(new InternalServerError())),
          ),

        windowsManagementCheckin: (scope, request) =>
          client.ManagementWebhook.windowsManagementCheckin({ payload: { scope, request } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
            Effect.catchTag("UnknownDevice", () => Effect.fail(new UnknownDevice())),
            Effect.catchTag("InternalServerError", () => Effect.fail(new InternalServerError())),
          ),

        windowsDeviceEvent: (scope, event) =>
          client.ManagementWebhook.windowsDeviceEvent({ payload: { scope, event } }).pipe(
            Effect.catchTag("ManagementNotSupported", () => Effect.fail(new ManagementNotSupported())),
            Effect.catchTag("UnknownDevice", () => Effect.fail(new UnknownDevice())),
            Effect.catchTag("InternalServerError", () => Effect.fail(new InternalServerError())),
          ),

      });
    }),
  );
