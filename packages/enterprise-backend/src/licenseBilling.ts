import { Effect, Exit, Option, Schema } from "effect";
import { eq } from "drizzle-orm";
import { HttpRouter, HttpServerResponse } from "effect/http";
import type { HttpServerRequest } from "effect/http";
import { Layer } from "effect";
import { Db } from "@mattrax/enterprise-core";
import { StripeService } from "@mattrax/effect-stripe";
import type { StripeClientLike, StripeCustomer } from "@mattrax/effect-stripe";
import { schema } from "./schema.ts";

/**
 * Cloud billing for self-hosted deployments.
 *
 * A self-hosted deployment holds a licence key and calls these endpoints with
 * it. The cloud deployment owns the Stripe account, so the customer never needs
 * Stripe credentials in their own install. One licence maps to one Stripe
 * customer and one per-device subscription.
 */

type LicenseRow = typeof schema.deploymentLicense.$inferSelect;

type CustomerParams = {
  name: string;
  email?: string;
  metadata: { deploymentLicenseId: string; customerType: string };
};

type LicenseSummary = {
  plan: string;
  status?: string;
  billableDevices: number;
  deviceLimit: null;
  tenantLimit: null;
  devicesUsed: number;
  tenantsUsed: number;
  overDeviceLimit: boolean;
  overTenantLimit: boolean;
  limitsConfigured: boolean;
  subscriptionId: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  configured: boolean;
};

export type LicenseBillingConfig = { readonly priceId?: string };

const json = (body: Schema.Json, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

const problem = (message: string, status: number) => json({ message }, status);

const upstreamFailure = () => problem("Billing is temporarily unavailable.", 502);

const sha256 = async (value: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

const bearer = (request: HttpServerRequest.HttpServerRequest) => {
  const value = request.headers.authorization;

  return Array.isArray(value) ? value[0] : value;
};

const normalizedOrigin = (value: string): string | undefined => {
  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;

    return url.origin;
  } catch {
    return undefined;
  }
};

const OriginBody = Schema.Struct({ origin: Schema.String });

const PortalBody = Schema.Struct({
  origin: Schema.String,
  returnUrl: Schema.optional(Schema.NullOr(Schema.String)),
});

const CheckoutBody = Schema.Struct({
  origin: Schema.String,
  tenantId: Schema.optional(Schema.String),
  trialDays: Schema.optional(Schema.NullOr(Schema.Number)),
});

const UsageBody = Schema.Struct({
  origin: Schema.String,
  deviceCount: Schema.Number,
  tenantCount: Schema.Number,
});

const bodyOf = <A>(
  request: HttpServerRequest.HttpServerRequest,
  codec: Schema.Decoder<A>,
): Effect.Effect<A | undefined> =>
  request.json.pipe(
    Effect.map((body) => Option.getOrUndefined(Schema.decodeUnknownOption(codec)(body))),
    Effect.catch(() => Effect.succeed(undefined)),
  );

const authenticate = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const header = bearer(request);

    if (!header?.startsWith("Bearer ")) return undefined;

    const key = header.slice("Bearer ".length).trim();

    if (!key) return undefined;

    const hash = yield* Effect.promise(() => sha256(key));

    const [license] = yield* db
      .select()
      .from(schema.deploymentLicense)
      .where(eq(schema.deploymentLicense.licenseKeyHash, hash))
      .limit(1);

    return license;
  });

const bindOrigin = (license: LicenseRow, originValue: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const origin = normalizedOrigin(originValue);

    if (!origin) return undefined;

    if (license.origin && license.origin !== origin) return undefined;

    const now = new Date();

    yield* db
      .update(schema.deploymentLicense)
      .set({ origin: license.origin ?? origin, lastSeenAt: now, updatedAt: now })
      .where(eq(schema.deploymentLicense.id, license.id));

    return { ...license, origin: license.origin ?? origin, lastSeenAt: now };
  });

const ensureCustomer = (license: LicenseRow) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const stripe = Option.getOrUndefined(yield* Effect.serviceOption(StripeService));

    if (!stripe) return undefined;

    if (license.stripeCustomerId) return license.stripeCustomerId;

    const search = yield* Effect.exit(
      stripe.customers.search({
        query: `metadata["deploymentLicenseId"]:"${license.id}"`,
        limit: 1,
      }),
    );

    let customer: StripeCustomer | undefined = Exit.isSuccess(search)
      ? search.value.data[0]
      : undefined;

    if (!customer && Exit.isFailure(search)) {
      const page = yield* stripe.effect((client: StripeClientLike) =>
        client.customers.list({ limit: 100 }),
      );

      customer = page.data.find(
        (item: StripeCustomer) => item.metadata?.deploymentLicenseId === license.id,
      );
    }

    const customerParams: CustomerParams = {
      name: license.name,
      metadata: { deploymentLicenseId: license.id, customerType: "deployment" },
    };

    if (license.contactEmail) customerParams.email = license.contactEmail;

    customer ??= yield* stripe.customers.create(customerParams);

    yield* db
      .update(schema.deploymentLicense)
      .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
      .where(eq(schema.deploymentLicense.id, license.id));

    return customer.id;
  });

const summary = (license: LicenseRow, priceId: string | undefined) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const stripe = Option.getOrUndefined(yield* Effect.serviceOption(StripeService));

    let status = license.status;
    let periodEnd = license.periodEnd;
    let cancelAtPeriodEnd = license.cancelAtPeriodEnd;

    // The webhook is authoritative; this read fills the page after checkout
    // even when the webhook has not arrived yet.
    if (stripe && license.stripeSubscriptionId) {
      const remote = yield* Effect.exit(
        stripe.subscriptions.retrieve(license.stripeSubscriptionId),
      );

      if (Exit.isSuccess(remote)) {
        const subscription = remote.value;
        status = subscription.status ?? null;
        cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
        const item = subscription.items?.data?.[0];
        const seconds = item?.current_period_end ?? subscription.current_period_end;

        if (Schema.is(Schema.Number)(seconds) && Number.isFinite(seconds))
          periodEnd = new Date(seconds * 1000);

        yield* db
          .update(schema.deploymentLicense)
          .set({ status, periodEnd, cancelAtPeriodEnd, updatedAt: new Date() })
          .where(eq(schema.deploymentLicense.id, license.id));
      }
    }

    const result: LicenseSummary = {
      plan: license.plan,
      billableDevices: license.deviceCount,
      deviceLimit: null,
      tenantLimit: null,
      devicesUsed: license.deviceCount,
      tenantsUsed: license.tenantCount,
      overDeviceLimit: false,
      overTenantLimit: false,
      limitsConfigured: false,
      subscriptionId: license.stripeSubscriptionId,
      periodEnd: periodEnd ? periodEnd.toISOString() : null,
      cancelAtPeriodEnd,
      configured: Boolean(priceId) || license.stripeSubscriptionId !== null,
    };

    if (status) result.status = status;

    return result;
  });

const billingReturnUrl = (origin: string, tenantId: string | undefined): string => {
  if (!tenantId) return `${origin}/`;

  try {
    return `${origin}/t/${encodeURIComponent(tenantId)}/settings/billing`;
  } catch {
    return `${origin}/`;
  }
};

const safeReturnUrl = (origin: string, candidate: string | null | undefined): string => {
  const fallback = `${origin}/`;

  if (!candidate) return fallback;

  try {
    const url = new URL(candidate, fallback);

    return url.origin === origin ? url.toString() : fallback;
  } catch {
    return fallback;
  }
};

const routes = ({ priceId }: LicenseBillingConfig) =>
  Layer.mergeAll(
    HttpRouter.add("POST", "/api/platform/billing/summary", (request) =>
      Effect.gen(function* () {
        const license = yield* authenticate(request);

        if (!license) return problem("Unauthorized.", 401);

        const body = yield* bodyOf(request, OriginBody);

        if (!body) return problem("Invalid request body.", 400);

        const bound = yield* bindOrigin(license, body.origin);

        if (!bound) return problem("Licence origin does not match.", 403);

        // SAFETY: the summary contains only JSON primitives and arrays/objects
        // built above, so it satisfies Schema.Json at this response boundary.
        return json((yield* summary(bound, priceId)) as Schema.Json);
      }).pipe(Effect.catchCause(() => Effect.succeed(upstreamFailure()))),
    ),

    HttpRouter.add("POST", "/api/platform/billing/portal", (request) =>
      Effect.gen(function* () {
        const license = yield* authenticate(request);

        if (!license) return problem("Unauthorized.", 401);

        const body = yield* bodyOf(request, PortalBody);

        if (!body) return problem("Invalid request body.", 400);

        const bound = yield* bindOrigin(license, body.origin);

        if (!bound) return problem("Licence origin does not match.", 403);

        const stripe = Option.getOrUndefined(yield* Effect.serviceOption(StripeService));

        if (!stripe) return problem("Billing is not configured.", 503);

        const customer = yield* ensureCustomer(bound);

        if (!customer) return problem("Billing is not configured.", 503);

        const session = yield* stripe.billingPortal.sessions.create({
          customer,
          return_url: safeReturnUrl(bound.origin!, body.returnUrl),
        });

        if (!session.url) return upstreamFailure();

        const url = new URL(session.url);

        if (url.protocol !== "https:") return upstreamFailure();

        return json({ url: url.toString() });
      }).pipe(Effect.catchCause(() => Effect.succeed(upstreamFailure()))),
    ),

    HttpRouter.add("POST", "/api/platform/billing/checkout", (request) =>
      Effect.gen(function* () {
        const license = yield* authenticate(request);

        if (!license) return problem("Unauthorized.", 401);

        const body = yield* bodyOf(request, CheckoutBody);

        if (!body) return problem("Invalid request body.", 400);

        const bound = yield* bindOrigin(license, body.origin);

        if (!bound) return problem("Licence origin does not match.", 403);

        if (!priceId) return problem("Licence billing is not configured.", 503);

        const stripe = Option.getOrUndefined(yield* Effect.serviceOption(StripeService));

        if (!stripe) return problem("Billing is not configured.", 503);

        const customer = yield* ensureCustomer(bound);

        if (!customer) return problem("Billing is not configured.", 503);

        const returnUrl = billingReturnUrl(bound.origin!, body.tenantId);

        const quantity = Math.max(1, bound.deviceCount);

        const metadata = { deploymentLicenseId: bound.id, plan: "device" };

        const subscriptionData =
          body.trialDays == null
            ? { metadata }
            : { metadata, trial_period_days: Math.max(1, Math.floor(body.trialDays)) };

        const session = yield* stripe.checkout.sessions.create({
          mode: "subscription",
          customer,
          client_reference_id: bound.id,
          success_url: `${returnUrl}?checkout=success`,
          cancel_url: `${returnUrl}?checkout=cancelled`,
          line_items: [{ price: priceId, quantity }],
          metadata,
          subscription_data: subscriptionData,
          allow_promotion_codes: true,
        });

        if (!session.url) return upstreamFailure();

        const url = new URL(session.url);

        if (url.protocol !== "https:") return upstreamFailure();

        return json({ url: url.toString(), quantity });
      }).pipe(Effect.catchCause(() => Effect.succeed(upstreamFailure()))),
    ),

    HttpRouter.add("POST", "/api/platform/billing/invoices", (request) =>
      Effect.gen(function* () {
        const license = yield* authenticate(request);

        if (!license) return problem("Unauthorized.", 401);

        const body = yield* bodyOf(request, OriginBody);

        if (!body) return problem("Invalid request body.", 400);

        const bound = yield* bindOrigin(license, body.origin);

        if (!bound) return problem("Licence origin does not match.", 403);

        if (!bound.stripeCustomerId) return json({ invoices: [] });

        const stripe = Option.getOrUndefined(yield* Effect.serviceOption(StripeService));

        if (!stripe) return problem("Billing is not configured.", 503);

        const page = yield* stripe.invoices.list({
          customer: bound.stripeCustomerId,
          limit: 24,
        });

        return json({
          invoices: page.data.map((invoice) => ({
            id: invoice.id,
            number: invoice.number ?? null,
            status: invoice.status ?? null,
            total: invoice.total ?? 0,
            amountDue: invoice.amount_due ?? 0,
            amountPaid: invoice.amount_paid ?? 0,
            currency: invoice.currency ?? "usd",
            createdAt: new Date((invoice.created ?? 0) * 1000).toISOString(),
            periodStart: invoice.period_start
              ? new Date(invoice.period_start * 1000).toISOString()
              : null,
            periodEnd: invoice.period_end
              ? new Date(invoice.period_end * 1000).toISOString()
              : null,
            hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
            pdfUrl: invoice.invoice_pdf ?? null,
          })),
        });
      }).pipe(Effect.catchCause(() => Effect.succeed(upstreamFailure()))),
    ),

    HttpRouter.add("POST", "/api/platform/billing/usage", (request) =>
      Effect.gen(function* () {
        const license = yield* authenticate(request);

        if (!license) return problem("Unauthorized.", 401);

        const body = yield* bodyOf(request, UsageBody);

        if (!body) return problem("Invalid request body.", 400);

        const bound = yield* bindOrigin(license, body.origin);

        if (!bound) return problem("Licence origin does not match.", 403);

        const db = yield* Db;
        const now = new Date();

        yield* db
          .update(schema.deploymentLicense)
          .set({
            deviceCount: Math.max(0, Math.floor(body.deviceCount)),
            tenantCount: Math.max(0, Math.floor(body.tenantCount)),
            lastSeenAt: now,
            updatedAt: now,
          })
          .where(eq(schema.deploymentLicense.id, bound.id));

        if (priceId && bound.stripeSubscriptionId && bound.status !== "canceled") {
          const stripe = Option.getOrUndefined(yield* Effect.serviceOption(StripeService));

          if (stripe) {
            const remote = yield* Effect.exit(
              stripe.subscriptions.retrieve(bound.stripeSubscriptionId),
            );

            if (Exit.isSuccess(remote)) {
              const item = remote.value.items?.data?.[0];

              if (item?.id && item.price?.id === priceId) {
                const quantity = Math.max(1, Math.floor(body.deviceCount));

                if ((item.quantity ?? 0) !== quantity)
                  yield* stripe.subscriptions.update(bound.stripeSubscriptionId, {
                    items: [{ id: item.id, quantity }],
                    proration_behavior: "none",
                  });
              }
            }
          }
        }

        return json({ status: "ok" });
      }).pipe(Effect.catchCause(() => Effect.succeed(upstreamFailure()))),
    ),
  );

export const licenseBillingRoutes = (config: LicenseBillingConfig) => routes(config);
