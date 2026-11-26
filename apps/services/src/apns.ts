import { ByteSize, Clock, Effect, Layer, Option, Schema } from "effect";
import { HttpIncomingMessage, HttpRouter, HttpServerResponse } from "effect/http";
import type { HttpServerRequest } from "effect/http";
import type { ApnsPushTransport } from "@mattrax/apns";
import type { RelayAnalytics, RelayAnalyticsAuth } from "./analytics.ts";
import { verifyRelaySignature } from "./relayAuth.ts";

const maxBodySize = ByteSize.kibibytes(64);

const ApnsBody = Schema.Struct({
  pushToken: Schema.String,
  pushMagic: Schema.String,
  topic: Schema.String,
  certPem: Schema.String,
  privateKeyPem: Schema.String,
});

const ApnsBodyJson = Schema.fromJsonString(ApnsBody);

const json = (body: Schema.Json, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

const problem = (message: string, status: number) => json({ message }, status);

type ApnsRoutesOptions<E, R> = {
  readonly token?: string;
  readonly transport: ApnsPushTransport;
  readonly analytics: Pick<RelayAnalytics, "push">;
  readonly authorizeLicense: (token: string) => Effect.Effect<RelayAnalyticsAuth | undefined, E, R>;
};

export const apnsRoutes = <E, R>(options: ApnsRoutesOptions<E, R>) => {
  const apnsHandler = (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      if (request.method !== "POST") return problem("Method not allowed.", 405);

      // The Node adapter maps BodyTooLarge to 413. Other read failures remain
      // failures instead of being misreported as an empty, malformed APNs body.
      const body = yield* request.text;

      let authorized = false;
      // Only a licence-authenticated request has a deployment to identify; the
      // hosted Cloud relay authenticates with the shared services token.
      let deployment: RelayAnalyticsAuth = { kind: "shared-secret" };
      const timestamp = request.headers["x-apns-timestamp"];
      const signature = request.headers["x-apns-signature"];
      const timestampValue = Array.isArray(timestamp) ? timestamp[0] : timestamp;
      const signatureValue = Array.isArray(signature) ? signature[0] : signature;
      const now = yield* Clock.currentTimeMillis;
      const signatureResult = verifyRelaySignature({
        token: options.token,
        timestamp: timestampValue,
        signature: signatureValue,
        body,
        now,
      });

      if (signatureResult === "stale") return problem("Stale signature.", 401);
      if (signatureResult === "invalid") return problem("Invalid signature.", 401);
      if (signatureResult === "ok") authorized = true;

      if (!authorized) {
        const value = request.headers.authorization;
        const header = Array.isArray(value) ? value[0] : value;
        const token = header?.startsWith("Bearer ")
          ? header.slice("Bearer ".length).trim()
          : undefined;

        if (!token) return problem("Unauthorized.", 401);

        const auth = yield* options.authorizeLicense(token);

        if (!auth) return problem("Unauthorized.", 401);

        deployment = auth;
      }

      const input = Option.getOrUndefined(Schema.decodeUnknownOption(ApnsBodyJson)(body));

      if (!input) return problem("Invalid APNs request.", 400);

      return yield* Effect.match(options.transport.push(input), {
        onFailure: (error) => {
          options.analytics.push(deployment, "error");
          const message = error instanceof Error ? error.message : "APNs relay failed";

          return problem(message, /timed out/i.test(message) ? 504 : 502);
        },
        onSuccess: () => {
          options.analytics.push(deployment, "ok");

          return HttpServerResponse.empty({ status: 204 });
        },
      });
    }).pipe(Effect.provideService(HttpIncomingMessage.MaxBodySize, maxBodySize));

  return Layer.mergeAll(
    HttpRouter.add("POST", "/v1/apns/push", apnsHandler),
    HttpRouter.add("POST", "/apns", apnsHandler),
  );
};
