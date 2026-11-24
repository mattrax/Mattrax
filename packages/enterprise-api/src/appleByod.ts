import { Effect, Layer, Stream } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Db, schema } from "@mattrax/enterprise-core";
import { EnterpriseService } from "@mattrax/enterprise-domain";
import { appleByodTokenProblem } from "./appleByodDocument.js";

/**
 * Account-driven Apple User Enrollment (BYOD) endpoints.
 *
 * Apple's client flow (iOS 15/iPadOS 15 and later) is:
 *
 * 1. GET /.well-known/com.apple.remotemanagement?user-identifier=...&model-family=...
 *    -> {"Servers":[{"Version":"mdm-byod","BaseURL":"..."}]}
 * 2. POST the signed enrollment request to BaseURL.
 *    -> 401 with WWW-Authenticate: Bearer method="apple-as-web", url="..."
 * 3. The web-auth URL is opened in ASWebAuthenticationSession; the tenant's IdP
 *    signs the user in (the callback is the existing Entra SSO callback).
 * 4. The callback returns 308 to
 *    apple-remotemanagement-user-login://authentication-results?access-token=...
 * 5. POST the same signed request to BaseURL with Authorization: Bearer ...
 *    -> 200 and the signed BYOD enrollment profile.
 *
 * The access token is single-use, short-lived and bound to the tenant, the
 * authenticated Mattrax account, the Managed Apple Account and a SHA-256 of the
 * device request body. Redemption is one conditional UPDATE, so a replayed
 * callback URL or token cannot install a second profile.
 */

const MAX_ENROLLMENT_BODY_BYTES = 64 * 1024;

const CHALLENGE_TTL_MILLIS = 10 * 60 * 1000;
const BYOD_WINDOW_MILLIS = 60_000;
const BYOD_PER_IP_LIMIT = 30;
const byodWindows = new Map<string, { count: number; resetAt: number }>();

/** Cheap per-isolate limiter, matching the public mobileconfig endpoint. */
const allowByodRequest = (ip: string | null | undefined) => {
  const key = ip?.trim() || "local";
  const timestamp = Date.now();
  const entry = byodWindows.get(key);

  if (!entry || entry.resetAt <= timestamp) {
    byodWindows.set(key, { count: 1, resetAt: timestamp + BYOD_WINDOW_MILLIS });

    if (byodWindows.size > 10_000) {
      for (const [candidate, value] of byodWindows)
        if (value.resetAt <= timestamp) byodWindows.delete(candidate);
    }

    return true;
  }

  entry.count += 1;

  return entry.count <= BYOD_PER_IP_LIMIT;
};

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (value: Uint8Array | string) => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const buffer = new ArrayBuffer(bytes.byteLength);

  new Uint8Array(buffer).set(bytes);

  const digest = await crypto.subtle.digest("SHA-256", buffer);

  return hex(new Uint8Array(digest));
};

const json = (body: unknown, status: number) =>
  HttpServerResponse.jsonUnsafe(body as never, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const text = (body: string, status: number) =>
  HttpServerResponse.text(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });

/** The public origin, which differs from the loopback URL in a self-host. */
const publicOrigin = (request: {
  readonly url: string;
  readonly headers: Record<string, string | undefined>;
}) => {
  const url = new URL(request.url, "http://localhost");
  const configured = request.headers["x-mattrax-public-origin"]?.trim();
  const host =
    request.headers["x-mattrax-public-host"]?.trim() ||
    request.headers.host?.trim() ||
    url.host;

  if (configured) {
    try {
      const parsed = new URL(configured);

      if (parsed.protocol === "https:" || parsed.hostname === "localhost")
        return parsed.origin;
    } catch {
      // Fall through to the request origin.
    }
  }

  const protocol =
    url.protocol === "http:" && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)
      ? "https:"
      : url.protocol;

  return protocol + "//" + host;
};

export const appleByodPublicHost = (request: {
  readonly url: string;
  readonly headers: Record<string, string | undefined>;
}) => {
  const configured = request.headers["x-mattrax-public-host"]?.trim();

  if (configured) return configured.toLowerCase();

  const header = request.headers.host?.trim();

  if (header) return header.toLowerCase();

  return new URL(request.url, "http://localhost").host.toLowerCase();
};

const bearerToken = (header: string | undefined) => {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();

  return token && token.length >= 20 && token.length <= 512 ? token : undefined;
};

const disposition = (filename: string) =>
  'attachment; filename="' + filename.replaceAll('"', "") + '"';

/**
 * Read a request body without buffering an unbounded upload. The stream is
 * abandoned as soon as it crosses the limit, so a hostile client cannot make
 * the Worker allocate megabytes before the size check.
 */
export const readBoundedBody = (
  request: {
    readonly stream: Stream.Stream<Uint8Array, unknown>;
  },
  limit: number,
): Effect.Effect<{ readonly ok: true; readonly body: Uint8Array } | { readonly ok: false }, never> =>
  Effect.gen(function* () {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const result = yield* Stream.runForEach(request.stream, (chunk) => {
      total += chunk.byteLength;

      if (total > limit) return Effect.fail("too_large" as const);

      chunks.push(chunk);

      return Effect.void;
    }).pipe(
      Effect.match({
        onFailure: () => "failed" as const,
        onSuccess: () => "ok" as const,
      }),
    );

    if (result !== "ok") return { ok: false as const };

    const body = new Uint8Array(total);
    let offset = 0;

    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return { ok: true as const, body };
  });

/** Build the discovery response so its content type and cache policy are testable. */
export const appleByodDiscoveryResponse = (result: { status: number; body: unknown }) =>
  HttpServerResponse.jsonUnsafe(result.body as never, {
    status: result.status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });

export const appleByodRoutes = Layer.mergeAll(
  HttpRouter.add("GET", "/.well-known/com.apple.remotemanagement", (request) =>
    Effect.gen(function* () {
      const service = yield* EnterpriseService;
      const result = yield* service.appleByodDiscovery(appleByodPublicHost(request));

      return appleByodDiscoveryResponse(result);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("Apple BYOD discovery failed", cause).pipe(
          Effect.as(
            json({ error: "The Apple device management service is temporarily unavailable." }, 503),
          ),
        ),
      ),
    ),
  ),
  HttpRouter.add("POST", "/mdm/apple/byod/:organizationId/enroll", (request) =>
    Effect.gen(function* () {
      const service = yield* EnterpriseService;
      const db = yield* Db;
      const url = new URL(request.url, "http://localhost");
      const organizationId = url.pathname.split("/")[4] ?? "";

      if (!organizationId) return text("Unknown tenant.", 404);

      if (
        !allowByodRequest(
          request.headers["cf-connecting-ip"] ?? request.headers["x-forwarded-for"],
        )
      )
        return text("Too many enrollment attempts. Wait a minute and try again.", 429);

      const bounded = yield* readBoundedBody(request, MAX_ENROLLMENT_BODY_BYTES);

      if (!bounded.ok) return text("The enrollment request is too large.", 413);

      const body = bounded.body;

      if (body.byteLength === 0) return text("An enrollment request body is required.", 400);

      const host = appleByodPublicHost(request);
      const config = yield* db.query.appleByodConfig.findFirst({
        where: { organizationId },
      });

      if (!config || !config.enabled)
        return text("Account-driven enrollment is not enabled for this organisation.", 403);

      if (config.domain && config.domain !== host)
        return text("The discovery document and enrollment host do not match.", 403);

      if (config.hardwareValidationRequired && !config.hardwareValidatedAt)
        return text(
          "Account-driven enrollment has not completed real-device validation for this organisation.",
          403,
        );

      const requestHash = yield* Effect.tryPromise(() => sha256Hex(body)).pipe(
        Effect.catch(() => Effect.succeed("")),
      );

      if (!requestHash) return text("The enrollment request could not be read.", 400);

      const token = bearerToken(request.headers.authorization);

      if (token) {
        const tokenHash = yield* Effect.tryPromise(() => sha256Hex(token)).pipe(
          Effect.catch(() => Effect.succeed("")),
        );

        if (!tokenHash) return text("Invalid enrollment token.", 401);

        const enrollment = yield* db.query.appleByodEnrollment.findFirst({
          where: { tokenHash },
        });
        const now = new Date();

        const problem = enrollment
          ? appleByodTokenProblem({
              organizationId,
              storedOrganizationId: enrollment.organizationId,
              requestHash,
              storedRequestHash: enrollment.requestHash,
              managedAppleAccount: enrollment.managedAppleAccount,
              tokenExpiresAt: enrollment.tokenExpiresAt,
              tokenConsumedAt: enrollment.tokenConsumedAt,
              now,
            })
          : "expired";

        if (!enrollment || problem)
          return text("The enrollment token is invalid or has expired.", 401);

        // Single use: only one concurrent redemption can observe one row.
        const claimed = yield* db
          .update(schema.appleByodEnrollment)
          .set({ tokenConsumedAt: now, updatedAt: now })
          .where(
            and(
              eq(schema.appleByodEnrollment.id, enrollment.id),
              eq(schema.appleByodEnrollment.organizationId, organizationId),
              isNull(schema.appleByodEnrollment.tokenConsumedAt),
              gt(schema.appleByodEnrollment.tokenExpiresAt, now),
            ),
          );

        if (claimed.affectedRows !== 1)
          return text("The enrollment token has already been used or has expired.", 401);

        const profile = yield* service
          .getAppleByodEnrollmentProfile({
            organizationId,
            managedAppleAccount: enrollment.managedAppleAccount,
            byodEnrollmentId: enrollment.id,
          })
          .pipe(Effect.catch(() => Effect.succeed(undefined)));

        if (!profile)
          return text(
            "The BYOD enrollment profile could not be issued. Contact your administrator.",
            503,
          );

        return HttpServerResponse.uint8Array(profile.profile, {
          contentType: "application/x-apple-aspen-config",
          headers: {
            "content-disposition": disposition(profile.filename),
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        });
      }

      // No bearer token: mint a device-bound challenge and ask the client to
      // start the web-authentication session. Expired rows are inert and are
      // left for operational cleanup rather than failing this request.
      const timestamp = new Date();
      const id = crypto.randomUUID().replaceAll("-", "").slice(0, 24);

      yield* db.insert(schema.appleByodEnrollment).values({
        id,
        organizationId,
        requestHash,
        challengeExpiresAt: new Date(timestamp.getTime() + CHALLENGE_TTL_MILLIS),
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      const authorizeUrl = new URL(publicOrigin(request) + "/mdm/apple/byod/authorize");
      authorizeUrl.searchParams.set("challenge", id);

      return HttpServerResponse.empty({
        status: 401,
        headers: {
          "www-authenticate": 'Bearer method="apple-as-web", url="' + authorizeUrl.toString() + '"',
          "cache-control": "no-store",
        },
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("Apple BYOD enrollment request failed", cause).pipe(
          Effect.as(text("The BYOD enrollment service is temporarily unavailable.", 503)),
        ),
      ),
    ),
  ),
);
