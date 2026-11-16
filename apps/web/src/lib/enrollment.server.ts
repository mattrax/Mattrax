import { getRequestEvent } from "@solidjs/web";
import { fetchApi } from "~/server/api";
import {
  AndroidEnrollment,
  EnrollmentQuestion,
  EnrollmentResponse,
  PlatformEnrollment,
  TenantBranding,
  WindowsEnrollment,
} from "@mattrax/enterprise-domain/client";
import { Option, Schema } from "effect";

/**
 * The API serialises optional numbers as `null` in the public enrollment
 * payload (`deviceLimit.limit`/`used`), which the strict domain type models as
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

const decodeEnrollment = Schema.decodeUnknownOption(ServerEnrollmentResponse);

const decodeEnrollmentResponse = Schema.decodeUnknownOption(EnrollmentResponse);

/**
 * The public enrollment link's state, resolved before the page renders.
 *
 * Without this the page could only show "Verifying…" until the client bundle
 * hydrated. The API endpoint is public and needs no session, so a server
 * function can answer it from the Worker's service binding and the SSR pass can
 * render the password form (or the platform instructions) in the first HTML
 * response. A no-JS device can then submit the native form.
 */
export type PublicEnrollmentLookup =
  | { readonly status: "found"; readonly enrollment: EnrollmentResponse }
  | { readonly status: "invalid" }
  | { readonly status: "unavailable" };

export async function lookupPublicEnrollment(
  id: string,
  code: string,
): Promise<PublicEnrollmentLookup> {
  "use server";

  const event = getRequestEvent();

  const url = new URL(
    `/api/v1/enrollment/${encodeURIComponent(id)}`,
    event?.request.url ?? "https://mattrax.invalid",
  );

  if (code) url.searchParams.set("code", code);

  const headers = new Headers({ accept: "application/json" });
  const cookie = event?.request.headers.get("cookie");
  const ip = event?.request.headers.get("cf-connecting-ip");

  if (cookie) headers.set("cookie", cookie);

  if (ip) headers.set("cf-connecting-ip", ip);

  let response: Response;

  try {
    response = await fetchApi(new Request(url, { headers }));
  } catch {
    return { status: "unavailable" };
  }

  if (response.status === 404) return { status: "invalid" };

  if (!response.ok) return { status: "unavailable" };

  const body = await response.json().catch(() => undefined);

  const decoded = Option.getOrUndefined(decodeEnrollment(body));

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
}

const ErrorBody = Schema.Struct({ message: Schema.optional(Schema.String) });

const StoredBody = Schema.Struct({ stored: Schema.optional(Schema.Number) });

export type SubmitEnrollmentAnswersResult =
  | { readonly ok: true; readonly stored: number }
  | { readonly ok: false; readonly message: string };

/**
 * Store answers to a tenant's custom enrollment questions. The public
 * enrollment page is served by the Worker, so the submission goes through the
 * service binding rather than exposing the API origin to the browser.
 */
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

  const event = getRequestEvent();

  const url = new URL(
    `/api/v1/enrollment/${encodeURIComponent(id)}/answers`,
    event?.request.url ?? "https://mattrax.invalid",
  );

  const headers = new Headers({ accept: "application/json", "content-type": "application/json" });
  const cookie = event?.request.headers.get("cookie");
  const ip = event?.request.headers.get("cf-connecting-ip");

  if (cookie) headers.set("cookie", cookie);

  if (ip) headers.set("cf-connecting-ip", ip);

  let response: Response;

  try {
    response = await fetchApi(
      new Request(url, { method: "POST", headers, body: JSON.stringify(input) }),
    );
  } catch {
    return { ok: false, message: "Enrollment is temporarily unavailable. Try again shortly." };
  }

  const body = await response.json().catch(() => undefined);

  if (!response.ok) {
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
}
