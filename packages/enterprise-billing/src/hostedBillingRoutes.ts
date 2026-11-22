import { Effect, Layer, Option, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import type { HttpServerRequest } from "effect/http";
import type { PlanLimitsConfig } from "@mattrax/enterprise-core";
import { StripeService } from "@mattrax/effect-stripe";
import { Db } from "./db.ts";
import { makeStripeBillingService } from "./billingService.ts";

/**
 * Hosted-tenant billing routes used by the application deployment.
 *
 * Every route is machine-to-machine and authenticated with the shared
 * `SERVICES_TOKEN`. Users never reach these endpoints directly; the
 * application authorizes the request and supplies the tenant and usage.
 */

export type HostedBillingConfig = {
  readonly token?: string;
  readonly priceId?: string;
  readonly planLimits?: PlanLimitsConfig;
};

const json = (body: Schema.Json, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

const problem = (message: string, status: number) => json({ message }, status);

/** Length-independent comparison so a token cannot be guessed byte-by-byte. */
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

const Organization = Schema.Struct({ id: Schema.String, name: Schema.String });

const Usage = Schema.Struct({
  organizationId: Schema.optional(Schema.NullOr(Schema.String)),
  deviceCount: Schema.Number,
  devicesUsed: Schema.Number,
  tenantCount: Schema.Number,
});

const SummaryBody = Schema.Struct({
  organizationId: Schema.String,
  accountId: Schema.String,
  organization: Organization,
  usage: Usage,
});

const PortalBody = Schema.Struct({
  origin: Schema.String,
  tenantId: Schema.String,
  organization: Organization,
  returnUrl: Schema.optional(Schema.NullOr(Schema.String)),
});

const CheckoutBody = Schema.Struct({
  origin: Schema.String,
  tenantId: Schema.String,
  organization: Organization,
  usage: Usage,
  request: Schema.optional(
    Schema.NullOr(Schema.Struct({ trialDays: Schema.optional(Schema.NullOr(Schema.Number)) })),
  ),
});

const InvoicesBody = Schema.Struct({ organization: Organization });

const RenameBody = Schema.Struct({ tenantId: Schema.String, name: Schema.String });

const TeardownBody = Schema.Struct({ tenantId: Schema.String });

const readJson = <A>(
  request: HttpServerRequest.HttpServerRequest,
  codec: Schema.Decoder<A>,
): Effect.Effect<A | undefined> =>
  request.json.pipe(
    Effect.map((body) => Option.getOrUndefined(Schema.decodeUnknownOption(codec)(body))),
    Effect.catch(() => Effect.succeed(undefined)),
  );

const originOf = (value: string) => {
  try {
    const url = new URL(value);

    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
};

export const hostedBillingRoutes = (config: HostedBillingConfig) =>
  Layer.mergeAll(
    HttpRouter.add("POST", "/v1/billing/hosted/summary", (request) =>
      Effect.gen(function* () {
        if (!config.token) return problem("Hosted billing is not configured.", 503);
        if (!safeEqual(bearer(request) ?? "", config.token)) return problem("Unauthorized.", 401);

        const body = yield* readJson(request, SummaryBody);

        if (!body) return problem("Invalid billing request.", 400);

        const db = yield* Db;
        const stripe = Option.getOrUndefined(yield* Effect.serviceOption(StripeService));
        const billing = makeStripeBillingService({
          db,
          origin: "https://mattrax.app",
          stripe,
          deviceMonthlyPriceId: config.priceId,
          planLimits: config.planLimits,
        });

        return yield* billing
          .summary({
            ...body,
            usage: { ...body.usage, organizationId: body.usage.organizationId ?? undefined },
          })
          .pipe(
            Effect.match({
              onFailure: (error) => problem(error.message, 502),
              onSuccess: (summary) => json(summary),
            }),
          );
      }),
    ),

    HttpRouter.add("POST", "/v1/billing/hosted/portal", (request) =>
      Effect.gen(function* () {
        if (!config.token) return problem("Hosted billing is not configured.", 503);
        if (!safeEqual(bearer(request) ?? "", config.token)) return problem("Unauthorized.", 401);

        const body = yield* readJson(request, PortalBody);

        if (!body) return problem("Invalid billing request.", 400);

        const origin = originOf(body.origin);

        if (!origin) return problem("Invalid billing origin.", 400);

        const db = yield* Db;
        const stripe = Option.getOrUndefined(yield* Effect.serviceOption(StripeService));
        const billing = makeStripeBillingService({
          db,
          origin,
          stripe,
          deviceMonthlyPriceId: config.priceId,
          planLimits: config.planLimits,
        });

        return yield* billing
          .portal({
            tenantId: body.tenantId,
            organization: body.organization,
            returnUrl: body.returnUrl ?? null,
          })
          .pipe(
            Effect.match({
              onFailure: (error) => problem(error.message, 502),
              onSuccess: (result) => json(result),
            }),
          );
      }),
    ),

    HttpRouter.add("POST", "/v1/billing/hosted/checkout", (request) =>
      Effect.gen(function* () {
        if (!config.token) return problem("Hosted billing is not configured.", 503);
        if (!safeEqual(bearer(request) ?? "", config.token)) return problem("Unauthorized.", 401);

        const body = yield* readJson(request, CheckoutBody);

        if (!body) return problem("Invalid billing request.", 400);

        const origin = originOf(body.origin);

        if (!origin) return problem("Invalid billing origin.", 400);

        const db = yield* Db;
        const stripe = Option.getOrUndefined(yield* Effect.serviceOption(StripeService));
        const billing = makeStripeBillingService({
          db,
          origin,
          stripe,
          deviceMonthlyPriceId: config.priceId,
          planLimits: config.planLimits,
        });

        return yield* billing
          .checkout({
            tenantId: body.tenantId,
            organization: body.organization,
            request: {
              trialDays: body.request?.trialDays ?? undefined,
            },
            usage: { ...body.usage, organizationId: body.usage.organizationId ?? undefined },
          })
          .pipe(
            Effect.match({
              onFailure: (error) => problem(error.message, 502),
              onSuccess: (result) => json(result),
            }),
          );
      }),
    ),

    HttpRouter.add("POST", "/v1/billing/hosted/invoices", (request) =>
      Effect.gen(function* () {
        if (!config.token) return problem("Hosted billing is not configured.", 503);
        if (!safeEqual(bearer(request) ?? "", config.token)) return problem("Unauthorized.", 401);

        const body = yield* readJson(request, InvoicesBody);

        if (!body) return problem("Invalid billing request.", 400);

        const db = yield* Db;
        const stripe = Option.getOrUndefined(yield* Effect.serviceOption(StripeService));
        const billing = makeStripeBillingService({
          db,
          origin: "https://mattrax.app",
          stripe,
          deviceMonthlyPriceId: config.priceId,
          planLimits: config.planLimits,
        });

        return yield* billing.invoices({ organization: body.organization }).pipe(
          Effect.match({
            onFailure: (error) => problem(error.message, 502),
            onSuccess: (result) => json(result),
          }),
        );
      }),
    ),

    HttpRouter.add("POST", "/v1/billing/hosted/usage", (request) =>
      Effect.gen(function* () {
        if (!config.token) return problem("Hosted billing is not configured.", 503);
        if (!safeEqual(bearer(request) ?? "", config.token)) return problem("Unauthorized.", 401);

        const body = yield* readJson(request, Usage);

        if (!body || !body.organizationId) return problem("Invalid usage report.", 400);

        const db = yield* Db;
        const stripe = Option.getOrUndefined(yield* Effect.serviceOption(StripeService));
        const billing = makeStripeBillingService({
          db,
          origin: "https://mattrax.app",
          stripe,
          deviceMonthlyPriceId: config.priceId,
          planLimits: config.planLimits,
        });

        return yield* billing.reportUsage({ ...body, organizationId: body.organizationId }).pipe(
          Effect.match({
            onFailure: (error) => problem(error.message, 502),
            onSuccess: () => json({ status: "ok" }),
          }),
        );
      }),
    ),

    HttpRouter.add("POST", "/v1/billing/hosted/rename", (request) =>
      Effect.gen(function* () {
        if (!config.token) return problem("Hosted billing is not configured.", 503);
        if (!safeEqual(bearer(request) ?? "", config.token)) return problem("Unauthorized.", 401);

        const body = yield* readJson(request, RenameBody);

        if (!body) return problem("Invalid billing request.", 400);

        const db = yield* Db;
        const stripe = Option.getOrUndefined(yield* Effect.serviceOption(StripeService));
        const billing = makeStripeBillingService({
          db,
          origin: "https://mattrax.app",
          stripe,
          deviceMonthlyPriceId: config.priceId,
          planLimits: config.planLimits,
        });

        return yield* billing.renameTenant(body).pipe(
          Effect.match({
            onFailure: (error) => problem(error.message, 502),
            onSuccess: () => json({ status: "ok" }),
          }),
        );
      }),
    ),

    HttpRouter.add("POST", "/v1/billing/hosted/teardown/preflight", (request) =>
      Effect.gen(function* () {
        if (!config.token) return problem("Hosted billing is not configured.", 503);
        if (!safeEqual(bearer(request) ?? "", config.token)) return problem("Unauthorized.", 401);

        const body = yield* readJson(request, TeardownBody);

        if (!body) return problem("Invalid billing request.", 400);

        const db = yield* Db;
        const stripe = Option.getOrUndefined(yield* Effect.serviceOption(StripeService));
        const billing = makeStripeBillingService({
          db,
          origin: "https://mattrax.app",
          stripe,
          deviceMonthlyPriceId: config.priceId,
          planLimits: config.planLimits,
        });

        return yield* billing.preflightTenantDeletion(body).pipe(
          Effect.match({
            onFailure: (error) => problem(error.message, 502),
            onSuccess: () => json({ status: "ok" }),
          }),
        );
      }),
    ),

    HttpRouter.add("POST", "/v1/billing/hosted/teardown", (request) =>
      Effect.gen(function* () {
        if (!config.token) return problem("Hosted billing is not configured.", 503);
        if (!safeEqual(bearer(request) ?? "", config.token)) return problem("Unauthorized.", 401);

        const body = yield* readJson(request, TeardownBody);

        if (!body) return problem("Invalid billing request.", 400);

        const db = yield* Db;
        const stripe = Option.getOrUndefined(yield* Effect.serviceOption(StripeService));
        const billing = makeStripeBillingService({
          db,
          origin: "https://mattrax.app",
          stripe,
          deviceMonthlyPriceId: config.priceId,
          planLimits: config.planLimits,
        });

        return yield* billing.cancelTenant(body).pipe(
          Effect.match({
            onFailure: (error) => problem(error.message, 502),
            onSuccess: (status) => json(status),
          }),
        );
      }),
    ),
  );
