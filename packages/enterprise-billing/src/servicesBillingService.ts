import { Effect, identity, Layer, Option, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import {
  BillingInvoicesResponse,
  BillingSummary,
  EnterpriseStripeError,
} from "@mattrax/enterprise-domain";
import { BILLING_REQUEST_TIMEOUT_MS } from "./remoteBillingService.ts";
import type { BillingOperations, BillingUsage } from "./billingService.ts";

/**
 * Hosted tenant billing through the services deployment.
 *
 * Cloud sends the tenant identity and a usage snapshot; services owns the
 * Stripe account, the customer mapping and the subscription rows. The Cloud
 * deployment never needs a Stripe secret.
 */

export type ServicesBillingOptions = {
  /** Services origin, e.g. `https://services.mattrax.app`. */
  readonly url: string;
  /** Cloud-to-services bearer token. */
  readonly token: string;
  /** Public origin of this deployment, used for Stripe return URLs. */
  readonly origin: string;
  /** Injected fetch seam for tests; production uses the shared HttpClient. */
  readonly fetch?: typeof globalThis.fetch;
  /** Shared Effect transport supplied by the composition root. */
  readonly httpClient?: HttpClient.HttpClient;
};

const BillingUrl = Schema.Struct({ url: Schema.String, quantity: Schema.optional(Schema.Number) });

const Reclamation = Schema.Literals(["cancelled", "at_period_end", "none"]);

const ErrorBody = Schema.Struct({ message: Schema.optional(Schema.String) });

const failure = (message: string) => new EnterpriseStripeError({ message });

const endpoint = (base: string, path: string) => {
  const url = new URL(path, base.endsWith("/") ? base : `${base}/`);

  if (url.protocol !== "https:") throw new Error("MATTRAX_SERVICES_URL must be an https: URL");

  return url.toString();
};

const safeJson = (text: string): Schema.Json | undefined => {
  try {
    return Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(JSON.parse(text)));
  } catch {
    return undefined;
  }
};

const fetchClientLayer = (fetchImpl: typeof globalThis.fetch) =>
  FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchImpl)));

export const makeServicesBillingService = ({
  url,
  token,
  origin,
  fetch,
  httpClient,
}: ServicesBillingOptions): BillingOperations => {
  const post = (
    path: string,
    body: Readonly<Record<string, Schema.Json>>,
  ): Effect.Effect<Schema.Json | undefined, EnterpriseStripeError> =>
    Effect.gen(function* () {
      const target = yield* Effect.try({
        try: () => endpoint(url, path),
        catch: (cause) => failure(cause instanceof Error ? cause.message : "Invalid services URL"),
      });

      const client =
        httpClient ?? Option.getOrUndefined(yield* Effect.serviceOption(HttpClient.HttpClient));

      if (!client)
        return yield* Effect.fail(failure("The services HTTP client is not configured."));

      // The deadline covers the response body as well as the headers.
      const exchange = Effect.gen(function* () {
        const response = yield* client.execute(
          HttpClientRequest.post(target).pipe(
            HttpClientRequest.bearerToken(token),
            HttpClientRequest.acceptJson,
            HttpClientRequest.bodyText(JSON.stringify(body), "application/json"),
          ),
        );

        return { status: response.status, text: yield* response.text };
      }).pipe(
        Effect.mapError(() =>
          failure("The services deployment is unavailable. Try again shortly."),
        ),
        Effect.timeoutOrElse({
          duration: BILLING_REQUEST_TIMEOUT_MS,
          orElse: () =>
            Effect.fail(
              failure(
                `The services deployment did not answer within ${BILLING_REQUEST_TIMEOUT_MS}ms.`,
              ),
            ),
        }),
      );

      const { status, text } = yield* exchange;

      if (status < 200 || status > 299) {
        const parsed = Option.getOrUndefined(Schema.decodeUnknownOption(ErrorBody)(safeJson(text)));

        return yield* Effect.fail(
          failure(parsed?.message ?? "The services deployment rejected the request."),
        );
      }

      return safeJson(text);
    }).pipe(fetch ? Effect.provide(fetchClientLayer(fetch)) : identity);

  const decode = <A>(codec: Schema.Decoder<A>, value: Schema.Json | undefined) =>
    Option.match(Schema.decodeUnknownOption(codec)(value), {
      onNone: () => Effect.fail(failure("The services deployment returned an invalid response.")),
      onSome: (decoded) => Effect.succeed(decoded),
    });

  const tenantBody = (organization: { id: string; name: string }) => ({
    id: organization.id,
    name: organization.name,
  });

  const usageBody = (usage: BillingUsage) => ({
    organizationId: usage.organizationId ?? null,
    deviceCount: usage.deviceCount,
    devicesUsed: usage.devicesUsed ?? usage.deviceCount,
    tenantCount: usage.tenantCount,
  });

  return {
    summary: ({ organizationId, accountId, organization, usage }) =>
      Effect.gen(function* () {
        const body = yield* post("/v1/billing/hosted/summary", {
          organizationId,
          accountId,
          organization: tenantBody(organization),
          usage: usageBody(usage),
        });

        return yield* decode(BillingSummary, body);
      }),

    portal: ({ tenantId, organization, returnUrl }) =>
      Effect.gen(function* () {
        const body = yield* post("/v1/billing/hosted/portal", {
          origin,
          tenantId,
          organization: tenantBody(organization),
          returnUrl: returnUrl ?? null,
        });

        const decoded = yield* decode(BillingUrl, body);

        return { url: decoded.url };
      }),

    checkout: ({ tenantId, organization, request, usage }) =>
      Effect.gen(function* () {
        const body = yield* post("/v1/billing/hosted/checkout", {
          origin,
          tenantId,
          organization: tenantBody(organization),
          usage: usageBody(usage),
          request: { trialDays: request.trialDays ?? null },
        });

        const decoded = yield* decode(BillingUrl, body);

        return { url: decoded.url, quantity: decoded.quantity ?? 1 };
      }),

    invoices: ({ organization }) =>
      Effect.gen(function* () {
        const body = yield* post("/v1/billing/hosted/invoices", {
          organization: tenantBody(organization),
        });

        return yield* decode(BillingInvoicesResponse, body);
      }),

    reportUsage: (usage) =>
      post("/v1/billing/hosted/usage", {
        ...usageBody(usage),
        organizationId: usage.organizationId ?? null,
      }).pipe(Effect.asVoid),

    renameTenant: ({ tenantId, name }) =>
      post("/v1/billing/hosted/rename", { tenantId, name }).pipe(Effect.asVoid),

    preflightTenantDeletion: ({ tenantId }) =>
      post("/v1/billing/hosted/teardown/preflight", { tenantId }).pipe(Effect.asVoid),

    cancelTenant: ({ tenantId }) =>
      Effect.gen(function* () {
        const body = yield* post("/v1/billing/hosted/teardown", { tenantId });

        return yield* decode(Reclamation, body);
      }),
  };
};
