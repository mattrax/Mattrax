import { Effect, Layer, Option, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import {
  BillingInvoicesResponse,
  BillingSummary,
  EnterpriseStripeError,
} from "@mattrax/enterprise-domain";
import type { BillingOperations } from "./billingService.ts";

/**
 * Billing for a self-hosted deployment.
 *
 * The operator pays the Mattrax vendor for the whole deployment. This client
 * forwards the customer-facing operations and usage reports to the cloud
 * deployment, which owns the Stripe account and the subscription. The local
 * deployment never needs Stripe credentials.
 */

export type RemoteBillingOptions = {
  /** Cloud origin, e.g. `https://e.mattrax.app`. */
  readonly url: string;
  /** Deployment license key; sent only in the Authorization header. */
  readonly licenseKey: string;
  /** Public origin of this deployment, used for Stripe return URLs. */
  readonly origin: string;
  /** Override for tests or an egress proxy; defaults to the runtime `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
};

const BillingUrl = Schema.Struct({ url: Schema.String, quantity: Schema.optional(Schema.Number) });

const ErrorBody = Schema.Struct({ message: Schema.optional(Schema.String) });

/** Licence calls are routine and must fail fast rather than pin a request. */
export const BILLING_REQUEST_TIMEOUT_MS = 15_000;

const failure = (message: string) => new EnterpriseStripeError({ message });

const endpoint = (base: string, path: string) => {
  const url = new URL(path, base.endsWith("/") ? base : `${base}/`);

  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("MATTRAX_BILLING_URL must be an http(s) URL");

  return url.toString();
};

const httpClientLayer = (fetchImpl?: typeof globalThis.fetch) =>
  fetchImpl === undefined
    ? FetchHttpClient.layer
    : FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchImpl)));

export const makeRemoteBillingService = ({
  url,
  licenseKey,
  origin,
  fetch,
}: RemoteBillingOptions): BillingOperations => {
  const post = (
    path: string,
    body: Readonly<Record<string, Schema.Json>>,
  ): Effect.Effect<Schema.Json | undefined, EnterpriseStripeError> =>
    Effect.gen(function* () {
      const target = yield* Effect.try({
        try: () => endpoint(url, path),
        catch: (cause) => failure(cause instanceof Error ? cause.message : "Invalid billing URL"),
      });

      const client = yield* HttpClient.HttpClient;

      // The deadline covers the response body as well as the headers.
      const exchange = Effect.gen(function* () {
        const response = yield* client.execute(
          HttpClientRequest.post(target).pipe(
            HttpClientRequest.bearerToken(licenseKey),
            HttpClientRequest.acceptJson,
            HttpClientRequest.bodyText(JSON.stringify({ origin, ...body }), "application/json"),
          ),
        );

        return { status: response.status, text: yield* response.text };
      }).pipe(
        Effect.mapError(() => failure("The billing service is unavailable. Try again shortly.")),
        Effect.timeoutOrElse({
          duration: BILLING_REQUEST_TIMEOUT_MS,
          orElse: () =>
            Effect.fail(
              failure(`The billing service did not answer within ${BILLING_REQUEST_TIMEOUT_MS}ms.`),
            ),
        }),
      );

      const { status, text } = yield* exchange;

      if (status < 200 || status > 299) {
        const parsed = Option.getOrUndefined(Schema.decodeUnknownOption(ErrorBody)(safeJson(text)));

        return yield* Effect.fail(
          failure(parsed?.message ?? "The billing service rejected the request."),
        );
      }

      return safeJson(text);
    }).pipe(Effect.provide(httpClientLayer(fetch)));

  const decode = <A>(schema: Schema.Decoder<A>, value: Schema.Json | undefined) =>
    Option.match(Schema.decodeUnknownOption(schema)(value), {
      onNone: () => Effect.fail(failure("The billing service returned an invalid response.")),
      onSome: (decoded) => Effect.succeed(decoded),
    });

  return {
    summary: () =>
      Effect.gen(function* () {
        const body = yield* post("/api/platform/billing/summary", {});

        return yield* decode(BillingSummary, body);
      }),

    portal: ({ returnUrl }) =>
      Effect.gen(function* () {
        const body = yield* post("/api/platform/billing/portal", {
          returnUrl: returnUrl ?? null,
        });

        const decoded = yield* decode(BillingUrl, body);

        return { url: decoded.url };
      }),

    checkout: ({ tenantId, request }) =>
      Effect.gen(function* () {
        const body = yield* post("/api/platform/billing/checkout", {
          tenantId,
          trialDays: request.trialDays ?? null,
        });

        const decoded = yield* decode(BillingUrl, body);

        return { url: decoded.url, quantity: decoded.quantity ?? 1 };
      }),

    invoices: () =>
      Effect.gen(function* () {
        const body = yield* post("/api/platform/billing/invoices", {});

        return yield* decode(BillingInvoicesResponse, body);
      }),

    reportUsage: ({ deviceCount, tenantCount }) =>
      post("/api/platform/billing/usage", { deviceCount, tenantCount }).pipe(Effect.asVoid),

    renameTenant: () => Effect.void,

    preflightTenantDeletion: () => Effect.void,

    cancelTenant: () => Effect.succeed("none"),
  };
};

const safeJson = (text: string): Schema.Json | undefined => {
  try {
    return Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(JSON.parse(text)));
  } catch {
    return undefined;
  }
};
