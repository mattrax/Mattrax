import type { Schema } from "effect";
import { Effect, Layer } from "effect";
import type { HttpServerRequest } from "effect/http";
import { FetchHttpClient } from "effect/http";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { Db } from "@mattrax/enterprise-core";
import type { PlanLimitsConfig } from "@mattrax/enterprise-core";
import type { AndroidDeliveryError } from "@mattrax/enterprise-backend";
import { completeAndroidSignup, handleAndroidPubSub } from "@mattrax/enterprise-backend";
import type { AndroidDeliveryConfig } from "@mattrax/enterprise-backend";
import { PubSubOidcVerifierLive } from "@mattrax/dm-android";
import { catchCausePreservingInterrupts } from "./errorBoundary.js";

const json = (body: Schema.Json, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

export type AndroidRoutesOptions = {
  readonly origin: string;
  readonly authSecret?: string;
  readonly config?: AndroidDeliveryConfig;
  readonly planLimits?: PlanLimitsConfig;
  /** Override the JWKS transport in tests. */
  readonly jwksFetch?: typeof globalThis.fetch;
  /** Reuse the remote key set across rebuilt hosted request layers. */
  readonly sharedJwks?: boolean;
};

const statusFor = (kind: AndroidDeliveryError["kind"]): number => {
  switch (kind) {
    case "not_configured":
      return 503;
    case "unauthorized":
      return 401;
    case "invalid_state":
    case "invalid_payload":
      return 400;
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    case "upstream":
      return 502;
  }
};

/**
 * Google-hosted signup callback and Pub/Sub push receiver.
 *
 * Both endpoints are mounted on the API Worker rather than the dashboard:
 * Google redirects to the API origin and Pub/Sub posts directly to it. The
 * signup callback is authenticated by an HMAC-signed state token bound to the
 * tenant; the Pub/Sub endpoint by Google's OIDC JWT.
 */
export const androidRoutes = (options: AndroidRoutesOptions) => {
  const jwksClient = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, options.jwksFetch ?? globalThis.fetch)),
    Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { redirect: "manual" })),
  );
  const pubsubVerifier = PubSubOidcVerifierLive(
    {
      audience:
        options.config?.pubsubAudience ??
        `${options.origin.replace(/\/+$/, "")}/api/v1/android/pubsub`,
      serviceAccountEmail: options.config?.serviceAccount.clientEmail ?? "",
      jwksUri: options.config?.jwksUri,
    },
    { sharedJwks: options.sharedJwks },
  ).pipe(Layer.provide(jwksClient), Layer.orDie);

  const callback = (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const url = new URL(request.url, "http://localhost");
      const state = url.searchParams.get("state") ?? "";
      const enterpriseToken = url.searchParams.get("enterpriseToken") ?? "";

      if (!state || !enterpriseToken)
        return json({ error: "Missing Android signup state or enterprise token" }, 400);
      const db = yield* Db;

      const result = yield* completeAndroidSignup({
        db,
        config: options.config,
        authSecret: options.authSecret,
        state,
        enterpriseToken,
      });

      const location = `${options.origin.replace(/\/+$/, "")}/t/${encodeURIComponent(result.organizationId)}/settings/management?android=connected`;

      return HttpServerResponse.empty({
        status: 302,
        headers: { location, "cache-control": "no-store" },
      });
    }).pipe(
      Effect.catchTag("AndroidDeliveryError", (error) =>
        Effect.succeed(json({ error: error.message }, statusFor(error.kind))),
      ),
      catchCausePreservingInterrupts((cause) =>
        Effect.gen(function* () {
          yield* Effect.logError("Android signup callback failed", cause);

          return json({ error: "Android signup failed" }, 500);
        }),
      ),
    );

  const pubsub = (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const db = yield* Db;
      const header = request.headers["authorization"];
      const authorization = Array.isArray(header) ? header[0] : header;
      const body = yield* request.text;

      const result = yield* handleAndroidPubSub({
        db,
        config: options.config,
        authSecret: options.authSecret,
        origin: options.origin,
        planLimits: options.planLimits,
        authorization,
        body,
      });

      return json(result);
    }).pipe(
      Effect.catchTag("AndroidDeliveryError", (error) =>
        Effect.succeed(json({ error: error.message }, statusFor(error.kind))),
      ),
      catchCausePreservingInterrupts((cause) =>
        Effect.gen(function* () {
          yield* Effect.logError("Android Pub/Sub handling failed", cause);

          return json({ error: "Android Pub/Sub handling failed" }, 500);
        }),
      ),
    );

  return Layer.mergeAll(
    HttpRouter.add("GET", "/api/v1/android/signup/callback", callback),
    HttpRouter.add("POST", "/api/v1/android/pubsub", pubsub),
  ).pipe(Layer.provideMerge(pubsubVerifier));
};
