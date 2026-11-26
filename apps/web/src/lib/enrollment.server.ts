import { getRequestEvent } from "@solidjs/web";
import { Effect, Option, Schema } from "effect";
import { HttpBody, HttpClientRequest, HttpClientResponse } from "effect/http";
import { runApiEffect } from "~/server/api";
import { ApiClient } from "~/server/api-client";
import {
  AndroidEnrollment,
  EnrollmentQuestion,
  EnrollmentResponse,
  PlatformEnrollment,
  TenantBranding,
  WindowsEnrollment,
} from "@mattrax/enterprise-domain/client";
import { ENROLLMENT_STATUS_HEADER, enrollmentLookupFailure } from "~/lib/enrollment-lookup";

/**
 * The API serialises optional numbers as null in the public enrollment
 * payload (deviceLimit.limit/used), which the strict domain type models as
 * absent. Decode a representation that accepts both and normalise afterwards.
 */
const ServerDeviceLimit = Schema.Struct({
  reached: Schema.Boolean,
  plan: Schema.String,
  limit: Schema.optional(Schema.NullOr(Schema.Number)),
  used: Schema.optional(Schema.NullOr(Schema.Number)),
});

const ServerEnrollmentResponse = Schema.Union([
  Schema.Struct({
    name: Schema.String,
    branding: TenantBranding,
    authenticated: Schema.Literal(false),
  }),
  Schema.Struct({
    name: Schema.String,
    branding: TenantBranding,
    authenticated: Schema.Literal(true),
    apple: PlatformEnrollment,
    windows: WindowsEnrollment,
    android: AndroidEnrollment,
    assetTag: Schema.Boolean,
    questions: Schema.optional(Schema.Array(EnrollmentQuestion)),
    deviceLimit: Schema.optional(ServerDeviceLimit),
  }),
]);

const decodeEnrollmentResponse = Schema.decodeUnknownOption(EnrollmentResponse);

export type PublicEnrollmentLookup =
  | { readonly status: "found"; readonly enrollment: EnrollmentResponse }
  | { readonly status: "expired" }
  | { readonly status: "invalid" }
  | { readonly status: "unavailable" };

const requestHeaders = () => {
  const event = getRequestEvent();
  const cookie = event?.request.headers.get("cookie");
  const ip = event?.request.headers.get("cf-connecting-ip");

  return {
    accept: "application/json",
    ...(cookie ? { cookie } : {}),
    ...(ip ? { "cf-connecting-ip": ip } : {}),
  };
};

/** Effect seam used by SSR and transport tests; no ambient fetch is involved. */
export const lookupPublicEnrollmentEffect = (
  id: string,
  code: string,
): Effect.Effect<PublicEnrollmentLookup, never, ApiClient> =>
  Effect.gen(function* () {
    const client = yield* ApiClient;
    const event = getRequestEvent();
    const url = new URL(
      "/api/v1/enrollment/" + encodeURIComponent(id),
      event?.request.url ?? "https://mattrax.invalid",
    );

    if (code) url.searchParams.set("code", code);

    const response = yield* client
      .execute(HttpClientRequest.get(url, { headers: requestHeaders() }))
      .pipe(Effect.catch(() => Effect.succeed(undefined)));

    if (response === undefined) return { status: "unavailable" };

    if (response.status < 200 || response.status >= 300) {
      const explicitlyExpired = response.headers[ENROLLMENT_STATUS_HEADER] === "expired";

      yield* client.discard(response).pipe(Effect.catch(() => Effect.void));

      return { status: enrollmentLookupFailure(response.status, explicitlyExpired) };
    }

    const decoded = yield* client.bounded(response, 1024 * 1024).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(ServerEnrollmentResponse)),
      Effect.catch(() => Effect.succeed(undefined)),
    );

    if (decoded === undefined) return { status: "invalid" };

    // Normalise the nullable optional numbers before the domain schema checks
    // the payload the client will receive.
    const normalized =
      decoded.authenticated === true && decoded.deviceLimit
        ? {
            ...decoded,
            deviceLimit: {
              ...decoded.deviceLimit,
              limit: decoded.deviceLimit.limit ?? undefined,
              used: decoded.deviceLimit.used ?? undefined,
            },
          }
        : decoded;

    const enrollment = Option.getOrUndefined(decodeEnrollmentResponse(normalized));

    return enrollment === undefined ? { status: "invalid" } : { status: "found", enrollment };
  });

/**
 * The public enrollment link's state, resolved before the page renders.
 * Without this the page could only show "Verifying…" until the client bundle
 * hydrated. A no-JS device can also submit the native form.
 */
export async function lookupPublicEnrollment(
  id: string,
  code: string,
): Promise<PublicEnrollmentLookup> {
  "use server";

  return await runApiEffect(lookupPublicEnrollmentEffect(id, code));
}

const ErrorBody = Schema.Struct({ message: Schema.optional(Schema.String) });

const StoredBody = Schema.Struct({ stored: Schema.optional(Schema.Number) });

export type SubmitEnrollmentAnswersResult =
  | { readonly ok: true; readonly stored: number }
  | { readonly ok: false; readonly message: string };

/** Effect seam for the public enrollment submission. */
export const submitPublicEnrollmentAnswersEffect = (
  id: string,
  input: {
    readonly code?: string;
    readonly serial: string;
    readonly name?: string;
    readonly assetTag?: string;
    readonly answers: Readonly<Record<string, string>>;
  },
): Effect.Effect<SubmitEnrollmentAnswersResult, never, ApiClient> =>
  Effect.gen(function* () {
    const client = yield* ApiClient;
    const event = getRequestEvent();
    const url = new URL(
      "/api/v1/enrollment/" + encodeURIComponent(id) + "/answers",
      event?.request.url ?? "https://mattrax.invalid",
    );
    const headers = { ...requestHeaders(), "content-type": "application/json" };
    const response = yield* client
      .execute(
        HttpClientRequest.post(url, {
          headers,
          body: HttpBody.jsonUnsafe(input),
        }),
      )
      .pipe(Effect.catch(() => Effect.succeed(undefined)));

    if (response === undefined)
      return { ok: false, message: "Enrollment is temporarily unavailable. Try again shortly." };

    const body = yield* client.bounded(response, 64 * 1024).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Unknown)),
      Effect.catch(() => Effect.succeed(undefined)),
    );

    if (response.status < 200 || response.status >= 300) {
      const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(ErrorBody)(body));

      return {
        ok: false,
        message:
          decoded?.message ??
          "The enrollment details could not be saved. Check the values and try again.",
      };
    }

    const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(StoredBody)(body));

    return { ok: true, stored: decoded?.stored ?? 0 };
  });

/** Store answers through the same injectable API boundary as SSR preload. */
export async function submitPublicEnrollmentAnswers(
  id: string,
  input: {
    readonly code?: string;
    readonly serial: string;
    readonly name?: string;
    readonly assetTag?: string;
    readonly answers: Readonly<Record<string, string>>;
  },
): Promise<SubmitEnrollmentAnswersResult> {
  "use server";

  return await runApiEffect(submitPublicEnrollmentAnswersEffect(id, input));
}
