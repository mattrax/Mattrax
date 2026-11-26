import { createHash } from "node:crypto";
import { Effect, Layer } from "effect";
import type { Schema } from "effect";
import { FetchHttpClient, HttpRouter, HttpServerResponse } from "effect/http";
import { MysqlClient } from "@effect/sql-mysql2";
import { NodeRuntime } from "@effect/platform-node";
import { NodePushTransport } from "@mattrax/apns";
import {
  billingWebhookRoutes,
  deploymentLicenseIdForKeyHash,
  hostedBillingRoutes,
  licenseBillingRoutes,
  makeEntitlementSync,
  ServicesDbService,
  servicesSchema,
  tenantEntitlement,
} from "@mattrax/enterprise-billing";
import { parsePlanLimits } from "@mattrax/enterprise-core";
import { databaseConfigFromUrl, mysqlClientOptions } from "@mattrax/cloud-services";
import { StripeService } from "@mattrax/effect-stripe";
import { apnsRoutes } from "./apns.ts";
import { createRelayAnalytics } from "./analytics.ts";
import { migrateDatabase } from "./migrate.ts";
import { makeHttpServerLayer } from "./server.ts";

const port = Number(process.env.PORT ?? 8788);
const databaseUrl = process.env.DATABASE_URL?.trim();
const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
const servicesToken = process.env.SERVICES_TOKEN?.trim();
const cloudUrl = process.env.MATTRAX_CLOUD_URL?.trim();
const deviceMonthlyPriceId = process.env.STRIPE_DEVICE_MONTHLY_PRICE_ID?.trim();
const licensePriceId = process.env.STRIPE_LICENSE_PRICE_ID?.trim();
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
const planLimits = parsePlanLimits(process.env.MATTRAX_PLAN_LIMITS);

// Opt-in deployment-identity analytics. Without POSTHOG_KEY every call is a
// no-op; see ./analytics.ts for what is and is not sent.
const relayAnalytics = createRelayAnalytics({
  key: process.env.POSTHOG_KEY,
  host: process.env.POSTHOG_HOST,
  environment: process.env.POSTHOG_ENVIRONMENT,
  release: process.env.MATTRAX_RELEASE,
});

if (!databaseUrl) throw new Error("DATABASE_URL is required");

const database = MysqlClient.layer(mysqlClientOptions(databaseConfigFromUrl(databaseUrl)));

const servicesDb = ServicesDbService.layer.pipe(Layer.provide(database));
const stripe = stripeKey ? StripeService.make(stripeKey) : undefined;
const stripeLayer = stripe ? Layer.succeed(StripeService, stripe) : Layer.empty;
const apns = NodePushTransport();

const entitlementSync =
  cloudUrl && servicesToken
    ? makeEntitlementSync({ url: cloudUrl, token: servicesToken })
    : undefined;

const json = (body: Schema.Json, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

const health = Effect.succeed(
  json({
    status: "ok",
    apns: apns.name,
    billing: Boolean(stripeKey),
    licenseBilling: Boolean(stripeKey && licensePriceId),
  }),
);

const dbHealth = Effect.gen(function* () {
  const db = yield* ServicesDbService;
  const rows = yield* db
    .select({ id: servicesSchema.deploymentLicense.id })
    .from(servicesSchema.deploymentLicense)
    .limit(1);

  return json({ status: "ok", licenses: rows.length });
});

/**
 * After a webhook commits, push the tenant's entitlement to the application
 * deployment. The application caches the plan on its organisation row so limit
 * checks stay local. A failure is returned to Stripe so the event is retried.
 */
const onApplied = (
  result: { readonly tenantId?: string; readonly licenseId?: string },
  db: import("@mattrax/enterprise-billing").ServicesDb,
) =>
  Effect.gen(function* () {
    if (!result.tenantId || !entitlementSync) return;

    const subscription = yield* tenantEntitlement(db, result.tenantId);

    if (!subscription)
      return yield* Effect.fail(new Error("Billing entitlement is missing its subscription."));

    yield* entitlementSync({
      organizationId: result.tenantId,
      plan: subscription.plan,
      status: subscription.status,
      revision: subscription.revision,
    });
  });

const routes = Layer.mergeAll(
  // The service origin is machine-facing; people who land here go to the app.
  HttpRouter.add("GET", "/", HttpServerResponse.redirect("https://mattrax.app", { status: 302 })),
  HttpRouter.add("GET", "/health", () => health),
  HttpRouter.add("GET", "/health/db", () => dbHealth),
  apnsRoutes({
    token: servicesToken,
    transport: apns,
    analytics: relayAnalytics,
    authorizeLicense: (token) =>
      Effect.gen(function* () {
        const db = yield* ServicesDbService;
        const licenseId = yield* deploymentLicenseIdForKeyHash(db, sha256(token));

        return licenseId ? { kind: "licensed", licenseId } : undefined;
      }),
  }),
  licenseBillingRoutes({ priceId: licensePriceId }),
  hostedBillingRoutes({
    token: servicesToken,
    priceId: deviceMonthlyPriceId,
    planLimits,
  }),
  billingWebhookRoutes({
    webhookSecret,
    deviceMonthlyPriceId,
    onApplied,
  }),
);

const appLayer = routes.pipe(
  Layer.provideMerge(servicesDb),
  Layer.provideMerge(stripeLayer),
  Layer.provide(FetchHttpClient.layer),
);

const serverLayer = makeHttpServerLayer(appLayer, { port, host: "0.0.0.0" });

await migrateDatabase({
  databaseUrl,
  migrationsDirectory: new URL("../migrations", import.meta.url).pathname,
});

// The billing route Layers erase their requirement types; their database and
// Stripe dependencies are provided by appLayer above.
NodeRuntime.runMain(Layer.launch(serverLayer as Layer.Layer<unknown, unknown>));

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
