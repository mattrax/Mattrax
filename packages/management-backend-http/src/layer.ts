import { Effect, Layer, Match, Schema } from "effect";
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

const toManagementError = (error: { readonly _tag?: string }): ManagementError =>
  Match.value(error._tag).pipe(
    Match.when("ManagementNotSupported", () => new ManagementNotSupported()),
    Match.when("UnknownDevice", () => new UnknownDevice()),
    Match.orElse(() => new InternalServerError()),
  );

const toCheckinError = (error: {
  readonly _tag?: string;
}): ManagementError | ServerInitiatedUnenrollment =>
  Match.value(error._tag).pipe(
    Match.when("ServerInitiatedUnenrollment", () => new ServerInitiatedUnenrollment()),
    Match.orElse(() => toManagementError(error)),
  );

const normalize = <A, E extends { readonly _tag?: string | undefined }, R>(
  effect: Effect.Effect<A, E, R>,
) => effect.pipe(Effect.mapError(toManagementError));

const normalizeCheckin = <A, E extends { readonly _tag?: string | undefined }, R>(
  effect: Effect.Effect<A, E, R>,
) => effect.pipe(Effect.mapError(toCheckinError));

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

export type ManagementBackendHttpOptions = {
  readonly baseUrl: string;
  /** When set, every webhook request is HMAC-signed. */
  readonly secret?: string;
};

const signRequest = (secret: string, operation: string, payload: Schema.Json | undefined) =>
  Effect.gen(function* () {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const digest = yield* sha256(JSON.stringify(payload ?? null));
    const signature = yield* hmac(secret, `${operation}.${timestamp}.${digest}`);

    return {
      "x-mattrax-timestamp": timestamp,
      "x-mattrax-signature": signature,
    };
  });

interface WebhookOperationOptions {
  readonly payload?: Schema.Json;
  readonly headers?: Readonly<Record<string, string>>;
}

const CallableSchema = Schema.instanceOf(Function);

const signingClient = <Client extends { ManagementWebhook: Record<string, unknown> }>(
  client: Client,
  secret: string,
): Client =>
  // SAFETY: The generated client exposes one callable operation per webhook endpoint. The proxy delegates each call to that same operation after adding signature headers, so the surface and return types are unchanged; only per-operation property types are erased while wrapping.
  ({
    ...client,
    ManagementWebhook: new Proxy(client.ManagementWebhook, {
      get(target, property) {
        if (!Schema.is(Schema.String)(property)) {
          return undefined;
        }

        const value = target[property];

        if (!Schema.is(CallableSchema)(value)) return value;

        return (options: WebhookOperationOptions = {}) =>
          Effect.flatMap(signRequest(secret, property, options.payload), (headers) =>
            value({
              ...options,
              headers: { ...options.headers, ...headers },
            }),
          );
      },
    }),
  }) as Client;

export const ManagementBackendHttp = (input: string | ManagementBackendHttpOptions) =>
  Layer.effect(
    ManagementBackend,
    Effect.gen(function* () {
      const options = Schema.is(Schema.String)(input) ? { baseUrl: input } : input;

      if (!options.secret)
        console.error(
          "ManagementBackendHttp has no webhook secret; requests will be unsigned and a correctly configured backend will reject them. Set WEBHOOK_SECRET / MATTRAX_WEBHOOK_SECRET.",
        );
      const raw = yield* HttpApiClient.make(managementApi, { baseUrl: options.baseUrl });
      const client = options.secret ? signingClient(raw, options.secret) : raw;

      return ManagementBackend.of({
        getAppleBootstrapToken: (scope) =>
          client.ManagementWebhook.getAppleBootstrapToken({ payload: { scope } }).pipe(
            Effect.mapError(toManagementError),
          ),
        appleReturnToServiceConfiguration: (scope) =>
          client.ManagementWebhook.appleReturnToServiceConfiguration({
            payload: { scope },
          }).pipe(Effect.mapError(toManagementError)),
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

        getAppleAsset: (identityCertificate, identifier, token) =>
          normalize(
            client.ManagementWebhook.getAppleAsset({
              payload: { identityCertificate, identifier, token },
            }),
          ),

        getAppleProfile: (policyId, kind) =>
          normalize(client.ManagementWebhook.getAppleProfile({ payload: { policyId, kind } })),

        windowsDiscovery: (request) =>
          normalize(client.ManagementWebhook.windowsDiscovery({ payload: request })),

        getWindowsEnrollmentPolicy: (authToken, context) =>
          normalize(
            client.ManagementWebhook.getWindowsEnrollmentPolicy({
              payload: { authToken, tenantToken: context?.tenantToken },
            }),
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
