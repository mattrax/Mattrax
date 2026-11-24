import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import type { HttpServerRequest } from "effect/http";
import { MysqlClient } from "@effect/sql-mysql2";
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
import { StripeService } from "@mattrax/effect-stripe";
import { createRelayAnalytics } from "./analytics.ts";
import type { RelayAnalyticsAuth } from "./analytics.ts";
import { migrateDatabase } from "./migrate.ts";
import { verifyRelaySignature } from "./relayAuth.ts";

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

const database = (() => {
  const url = new URL(databaseUrl);
  const databaseName = url.pathname.replace(/^\//, "");

  if (!url.hostname || !databaseName)
    throw new Error("DATABASE_URL must include a host and database");

  const sslMode = (
    url.searchParams.get("ssl-mode") ??
    url.searchParams.get("sslmode") ??
    ""
  ).toUpperCase();
  const ssl = url.searchParams.get("ssl")?.toLowerCase();
  const sslOptions =
    sslMode === "DISABLED" || ssl === "false"
      ? undefined
      : sslMode === "REQUIRED" || ssl === "true"
        ? { rejectUnauthorized: false }
        : sslMode === "VERIFY_CA" || sslMode === "VERIFY_IDENTITY"
          ? { rejectUnauthorized: true }
          : undefined;

  return MysqlClient.layer({
    host: url.hostname,
    port: Number(url.port || 3306),
    username: decodeURIComponent(url.username),
    password: Redacted.make(decodeURIComponent(url.password)),
    database: databaseName,
    poolConfig: { disableEval: true, timezone: "Z", ...(sslOptions ? { ssl: sslOptions } : {}) },
    disablePreparedStatements: true,
  });
})();

const servicesDb = ServicesDbService.layer.pipe(Layer.provide(database));
const stripe = stripeKey ? StripeService.make(stripeKey) : undefined;
const stripeLayer = stripe ? Layer.succeed(StripeService, stripe) : Layer.empty;
const apns = NodePushTransport();

const entitlementSync =
  cloudUrl && servicesToken
    ? makeEntitlementSync({ url: cloudUrl, token: servicesToken })
    : undefined;

const json = (body: Schema.Json, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

const problem = (message: string, status: number) => json({ message }, status);

const ApnsBody = Schema.Struct({
  pushToken: Schema.String,
  pushMagic: Schema.String,
  topic: Schema.String,
  certPem: Schema.String,
  privateKeyPem: Schema.String,
});

const apnsHandler = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    if (request.method !== "POST") return problem("Method not allowed.", 405);

    const body = yield* request.text.pipe(Effect.catch(() => Effect.succeed("")));

    if (body.length > 64 * 1024) return problem("Request body too large.", 413);

    let authorized = false;
    // Only a licence-authenticated request has a deployment to identify; the
    // hosted Cloud relay authenticates with the shared services token.
    let deployment: RelayAnalyticsAuth = { kind: "shared-secret" };
    const timestamp = request.headers["x-apns-timestamp"];
    const signature = request.headers["x-apns-signature"];
    const timestampValue = Array.isArray(timestamp) ? timestamp[0] : timestamp;
    const signatureValue = Array.isArray(signature) ? signature[0] : signature;
    const signatureResult = verifyRelaySignature({
      token: servicesToken,
      timestamp: timestampValue,
      signature: signatureValue,
      body,
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

      const db = yield* ServicesDbService;
      const licenseId = yield* deploymentLicenseIdForKeyHash(db, sha256(token));

      if (!licenseId) return problem("Unauthorized.", 401);

      deployment = { kind: "licensed", licenseId };
    }

    const input = Option.getOrUndefined(
      Schema.decodeUnknownOption(ApnsBody)(
        (() => {
          try {
            return JSON.parse(body);
          } catch {
            return undefined;
          }
        })(),
      ),
    );

    if (!input) return problem("Invalid APNs request.", 400);

    return yield* Effect.match(
      Effect.tryPromise(() => Effect.runPromise(apns.push(input))),
      {
        onFailure: (error) => {
          relayAnalytics.push(deployment, "error");
          const message = error instanceof Error ? error.message : "APNs relay failed";

          return problem(message, /timed out/i.test(message) ? 504 : 502);
        },
        onSuccess: () => {
          relayAnalytics.push(deployment, "ok");

          return HttpServerResponse.empty({ status: 204 });
        },
      },
    );
  });

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

    yield* entitlementSync({
      organizationId: result.tenantId,
      plan: subscription?.plan ?? "free",
      status: subscription?.status ?? null,
    });
  });

const routes = Layer.mergeAll(
  // The service origin is machine-facing; people who land here go to the app.
  HttpRouter.add("GET", "/", HttpServerResponse.redirect("https://mattrax.app", { status: 302 })),
  HttpRouter.add("GET", "/health", () => health),
  HttpRouter.add("GET", "/health/db", () => dbHealth),
  HttpRouter.add("POST", "/v1/apns/push", apnsHandler),
  HttpRouter.add("POST", "/apns", apnsHandler),
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

const appLayer = routes.pipe(Layer.provideMerge(servicesDb), Layer.provideMerge(stripeLayer));

const { handler } = HttpRouter.toWebHandler(appLayer, { disableLogger: true });

const origin = `http://127.0.0.1:${port}`;

const headersFrom = (request: IncomingMessage) => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(
      name,
      Array.isArray(value) ? value.join(name.toLowerCase() === "cookie" ? "; " : ", ") : value,
    );
  }

  return headers;
};

const toRequest = (request: IncomingMessage): Request => {
  const method = request.method ?? "GET";
  const body: BodyInit | undefined =
    method === "GET" || method === "HEAD" ? undefined : (Readable.toWeb(request) as BodyInit);
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers: headersFrom(request),
    ...(body ? { body } : {}),
    ...(body ? { duplex: "half" as const } : {}),
  };

  return new Request(new URL(request.url ?? "/", origin), init);
};

const writeResponse = async (response: Response, target: ServerResponse) => {
  target.statusCode = response.status;
  if (response.statusText) target.statusMessage = response.statusText;

  const cookies = response.headers.getSetCookie();
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() !== "set-cookie") target.setHeader(name, value);
  });
  if (cookies.length > 0) target.setHeader("set-cookie", cookies);

  if (response.body === null) {
    target.end();
    return;
  }

  await pipeline(Readable.fromWeb(response.body as never), target);
};

await migrateDatabase({
  databaseUrl,
  migrationsDirectory: new URL("../migrations", import.meta.url).pathname,
});

const server = createServer((request, response) => {
  void (async () => {
    try {
      await writeResponse(await handler(toRequest(request), undefined as never), response);
    } catch (error) {
      console.error("services request failed", error);
      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader("content-type", "text/plain; charset=utf-8");
      }
      response.end("Internal Server Error");
    }
  })();
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Mattrax services listening on :${port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
