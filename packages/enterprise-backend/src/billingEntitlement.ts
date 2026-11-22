import { Effect, Option, Schema } from "effect";
import { eq } from "drizzle-orm";
import { HttpRouter, HttpServerResponse } from "effect/http";
import type { HttpServerRequest } from "effect/http";
import { Db, schema } from "@mattrax/enterprise-core";

/**
 * Receive a billing entitlement from the services deployment.
 *
 * Billing state lives in the services database. The application keeps only a
 * cached plan and status on the organisation row so limit checks stay local.
 */
export type BillingEntitlementConfig = {
  readonly token?: string;
};

const EntitlementBody = Schema.Struct({
  organizationId: Schema.String,
  plan: Schema.String,
  status: Schema.optional(Schema.NullOr(Schema.String)),
});

const safeEqual = (left: string, right: string) => {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < length; index++)
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);

  return difference === 0;
};

const bearer = (request: HttpServerRequest.HttpServerRequest) => {
  const value = request.headers.authorization;
  const header = Array.isArray(value) ? value[0] : value;

  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;
};

export const billingEntitlementRoutes = (config: BillingEntitlementConfig) =>
  HttpRouter.add("POST", "/api/internal/billing/entitlement", (request) =>
    Effect.gen(function* () {
      if (!config.token) return HttpServerResponse.empty({ status: 503 });
      if (!safeEqual(bearer(request) ?? "", config.token))
        return HttpServerResponse.empty({ status: 401 });

      const body = yield* request.json.pipe(
        Effect.map((value) =>
          Option.getOrUndefined(Schema.decodeUnknownOption(EntitlementBody)(value)),
        ),
        Effect.catch(() => Effect.succeed(undefined)),
      );

      if (!body) return HttpServerResponse.empty({ status: 400 });

      const db = yield* Db;

      yield* db
        .update(schema.organization)
        .set({
          billingPlan: body.plan,
          billingStatus: body.status ?? null,
          updatedAt: new Date(),
        })
        .where(eq(schema.organization.id, body.organizationId));

      return HttpServerResponse.empty({ status: 204 });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("Billing entitlement update failed", cause).pipe(
          Effect.as(HttpServerResponse.empty({ status: 500 })),
        ),
      ),
    ),
  );
