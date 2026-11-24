import { Effect, Option, Schema } from "effect";
import { OUTBOUND_TIMEOUTS, fetchWithTimeout } from "@mattrax/net";
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
  readonly fetch?: typeof globalThis.fetch;
};

const BillingUrl = Schema.Struct({ url: Schema.String, quantity: Schema.optional(Schema.Number) });

const ErrorBody = Schema.Struct({ message: Schema.optional(Schema.String) });

const failure = (message: string) => new EnterpriseStripeError({ message });

const endpoint = (base: string, path: string) => {
  const url = new URL(path, base.endsWith("/") ? base : `${base}/`);

  if (url.protocol !== "https:") throw new Error("MATTRAX_SERVICES_URL must be an https: URL");

  return url.toString();
};

export const makeRemoteBillingService = ({
  url,
  licenseKey,
  origin,
  fetch = globalThis.fetch,
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

      const response = yield* Effect.tryPromise({
        try: () =>
          fetchWithTimeout(
            target,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${licenseKey}`,
                "content-type": "application/json",
                accept: "application/json",
              },
              body: JSON.stringify({ origin, ...body }),
            },
            { timeoutMs: OUTBOUND_TIMEOUTS.billing, fetch },
          ),
        catch: () => failure("The billing service is unavailable. Try again shortly."),
      });

      const text = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => failure("The billing service returned an unreadable response."),
      });

      if (!response.ok) {
        const parsed = Option.getOrUndefined(Schema.decodeUnknownOption(ErrorBody)(safeJson(text)));

        return yield* Effect.fail(
          failure(parsed?.message ?? "The billing service rejected the request."),
        );
      }

      return safeJson(text);
    });

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
