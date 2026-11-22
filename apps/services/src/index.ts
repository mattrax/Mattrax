import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import type { HttpServerRequest } from "effect/http";
import { MysqlClient } from "@effect/sql-mysql2";
import mysql from "mysql2/promise";
import { NodePushTransport } from "@mattrax/apns";
import { billingWebhookRoutes, licenseBillingRoutes } from "@mattrax/enterprise-billing";
import { Db, schema } from "@mattrax/enterprise-core";
import { StripeService } from "@mattrax/effect-stripe";

const port = Number(process.env.PORT ?? 8788);
const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
const relaySecret = process.env.APNS_RELAY_SECRET?.trim();
const deviceMonthlyPriceId = process.env.STRIPE_DEVICE_MONTHLY_PRICE_ID?.trim();
const licensePriceId = process.env.STRIPE_LICENSE_PRICE_ID?.trim();
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const database = (() => {
  const url = new URL(process.env.DATABASE_URL!);
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

const licensePool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  connectionLimit: 4,
  timezone: "Z",
});

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const bearerToken = (request: HttpServerRequest.HttpServerRequest) => {
  const value = request.headers.authorization;
  const header = Array.isArray(value) ? value[0] : value;

  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;
};

const stripe = stripeKey ? StripeService.make(stripeKey) : undefined;
const stripeLayer = stripe ? Layer.succeed(StripeService, stripe) : Layer.empty;
const apns = NodePushTransport();

const json = (body: Schema.Json, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

const problem = (message: string, status: number) => json({ message }, status);

const relaySignature = (timestamp: string, body: string) =>
  createHmac("sha256", relaySecret ?? "")
    .update(`${timestamp}.${body}`)
    .digest("hex");

const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);

  return a.length === b.length && timingSafeEqual(a, b);
};

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
    const timestamp = request.headers["x-apns-timestamp"];
    const signature = request.headers["x-apns-signature"];
    const timestampValue = Array.isArray(timestamp) ? timestamp[0] : timestamp;
    const signatureValue = Array.isArray(signature) ? signature[0] : signature;

    if (relaySecret && timestampValue && signatureValue) {
      if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestampValue)) > 300)
        return problem("Stale signature.", 401);
      if (!safeEqual(relaySignature(timestampValue, body), signatureValue))
        return problem("Invalid signature.", 401);

      authorized = true;
    }

    if (!authorized) {
      const token = bearerToken(request);

      if (!token) return problem("Unauthorized.", 401);

      const [rows] = yield* Effect.promise(() =>
        licensePool.query("SELECT id FROM deployment_license WHERE license_key_hash = ? LIMIT 1", [
          sha256(token),
        ]),
      );

      if ((rows as ReadonlyArray<unknown>).length === 0) return problem("Unauthorized.", 401);
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
          const message = error instanceof Error ? error.message : "APNs relay failed";

          return problem(message, /timed out/i.test(message) ? 504 : 502);
        },
        onSuccess: () => HttpServerResponse.empty({ status: 204 }),
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
  const db = yield* Db;
  const rows = yield* db
    .select({ id: schema.deploymentLicense.id })
    .from(schema.deploymentLicense)
    .limit(1);

  return json({ status: "ok", licenses: rows.length });
});

const routes = Layer.mergeAll(
  HttpRouter.add("GET", "/health", () => health),
  HttpRouter.add("GET", "/health/db", () => dbHealth),
  HttpRouter.add("POST", "/v1/apns/push", apnsHandler),
  HttpRouter.add("POST", "/apns", apnsHandler),
  licenseBillingRoutes({ priceId: licensePriceId }),
  billingWebhookRoutes({
    webhookSecret,
    deviceMonthlyPriceId,
  }),
);

const databaseAndDb = Db.layer.pipe(Layer.provide(database));

const appLayer = routes.pipe(Layer.provideMerge(databaseAndDb), Layer.provideMerge(stripeLayer));

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
