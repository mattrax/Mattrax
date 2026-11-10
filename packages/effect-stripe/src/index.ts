import { Context, Data, Effect, Layer } from "effect";
import Stripe from "stripe";
import { OUTBOUND_TIMEOUTS, STRIPE_MAX_NETWORK_RETRIES } from "@mattrax/net";

export interface StripeErrorDetails {
  readonly message: string;
  readonly type?: string;
  readonly code?: string;
  readonly declineCode?: string;
  readonly param?: string;
  readonly requestId?: string;
  readonly statusCode?: number;
  readonly cause?: unknown;
}

export class StripeCardError extends Data.TaggedError("StripeCardError")<StripeErrorDetails> {}
export class StripeRateLimitError extends Data.TaggedError(
  "StripeRateLimitError",
)<StripeErrorDetails> {}
export class StripeInvalidRequestError extends Data.TaggedError(
  "StripeInvalidRequestError",
)<StripeErrorDetails> {}
export class StripeApiError extends Data.TaggedError("StripeApiError")<StripeErrorDetails> {}
export class StripeConnectionError extends Data.TaggedError(
  "StripeConnectionError",
)<StripeErrorDetails> {}
export class StripeAuthenticationError extends Data.TaggedError(
  "StripeAuthenticationError",
)<StripeErrorDetails> {}
export class StripePermissionError extends Data.TaggedError(
  "StripePermissionError",
)<StripeErrorDetails> {}
export class StripeIdempotencyError extends Data.TaggedError(
  "StripeIdempotencyError",
)<StripeErrorDetails> {}
export class StripeSignatureVerificationError extends Data.TaggedError(
  "StripeSignatureVerificationError",
)<StripeErrorDetails> {}
export class StripeUnknownError extends Data.TaggedError(
  "StripeUnknownError",
)<StripeErrorDetails> {}

export type StripeError =
  | StripeCardError
  | StripeRateLimitError
  | StripeInvalidRequestError
  | StripeApiError
  | StripeConnectionError
  | StripeAuthenticationError
  | StripePermissionError
  | StripeIdempotencyError
  | StripeSignatureVerificationError
  | StripeUnknownError;

type StripeClient = Stripe;
type StripeConfig = ConstructorParameters<typeof Stripe>[1];
type CustomerCreate = StripeClient["customers"]["create"];
type CustomerSearch = StripeClient["customers"]["search"];
type CustomerList = StripeClient["customers"]["list"];
type BillingPortalSessionCreate = StripeClient["billingPortal"]["sessions"]["create"];

export interface EffectStripeClient {
  readonly client: StripeClient;
  readonly effect: <A>(
    f: (client: StripeClient) => PromiseLike<A>,
  ) => Effect.Effect<A, StripeError>;
  readonly customers: {
    readonly create: (
      ...args: Parameters<CustomerCreate>
    ) => Effect.Effect<Awaited<ReturnType<CustomerCreate>>, StripeError>;
    readonly search: (
      ...args: Parameters<CustomerSearch>
    ) => Effect.Effect<Awaited<ReturnType<CustomerSearch>>, StripeError>;
    readonly list: (
      ...args: Parameters<CustomerList>
    ) => Effect.Effect<Awaited<ReturnType<CustomerList>>, StripeError>;
  };
  readonly billingPortal: {
    readonly sessions: {
      readonly create: (
        ...args: Parameters<BillingPortalSessionCreate>
      ) => Effect.Effect<Awaited<ReturnType<BillingPortalSessionCreate>>, StripeError>;
    };
  };
}

const getString = (value: Record<string, unknown>, key: string) => {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
};

const getNumber = (value: Record<string, unknown>, key: string) => {
  const field = value[key];
  return typeof field === "number" ? field : undefined;
};

const errorDetails = (error: unknown): StripeErrorDetails => {
  if (typeof error !== "object" || error === null) {
    return { message: typeof error === "string" ? error : "Unknown Stripe error", cause: error };
  }

  const value = error as Record<string, unknown>;
  const raw =
    typeof value.raw === "object" && value.raw !== null
      ? (value.raw as Record<string, unknown>)
      : undefined;

  return {
    message:
      error instanceof Error
        ? error.message
        : (getString(value, "message") ?? "Unknown Stripe error"),
    type: getString(value, "type") ?? (raw ? getString(raw, "type") : undefined),
    code: getString(value, "code") ?? (raw ? getString(raw, "code") : undefined),
    declineCode:
      getString(value, "decline_code") ??
      getString(value, "declineCode") ??
      (raw ? getString(raw, "decline_code") : undefined),
    param: getString(value, "param") ?? (raw ? getString(raw, "param") : undefined),
    requestId:
      getString(value, "requestId") ??
      getString(value, "request_id") ??
      (raw ? getString(raw, "request_id") : undefined),
    statusCode: getNumber(value, "statusCode") ?? (raw ? getNumber(raw, "statusCode") : undefined),
    cause: error,
  };
};

export const toStripeError = (error: unknown): StripeError => {
  const details = errorDetails(error);

  switch (details.type) {
    case "StripeCardError":
      return new StripeCardError(details);
    case "StripeRateLimitError":
      return new StripeRateLimitError(details);
    case "StripeInvalidRequestError":
      return new StripeInvalidRequestError(details);
    case "StripeAPIError":
      return new StripeApiError(details);
    case "StripeConnectionError":
      return new StripeConnectionError(details);
    case "StripeAuthenticationError":
      return new StripeAuthenticationError(details);
    case "StripePermissionError":
      return new StripePermissionError(details);
    case "StripeIdempotencyError":
      return new StripeIdempotencyError(details);
    case "StripeSignatureVerificationError":
      return new StripeSignatureVerificationError(details);
    default:
      return new StripeUnknownError(details);
  }
};

export const tryStripe = <A>(try_: () => PromiseLike<A>): Effect.Effect<A, StripeError> =>
  Effect.tryPromise({
    try: try_,
    catch: toStripeError,
  });

export const makeEffectStripeClient = (client: StripeClient): EffectStripeClient => {
  const effect = <A>(f: (client: StripeClient) => PromiseLike<A>) => tryStripe(() => f(client));

  return {
    client,
    effect,
    customers: {
      create: (...args) => effect((stripe) => stripe.customers.create(...args)),
      search: (...args) => effect((stripe) => stripe.customers.search(...args)),
      list: (...args) => effect((stripe) => stripe.customers.list(...args)),
    },
    billingPortal: {
      sessions: {
        create: (...args) => effect((stripe) => stripe.billingPortal.sessions.create(...args)),
      },
    },
  };
};

export class StripeService extends Context.Service<StripeService, EffectStripeClient>()(
  "StripeService",
) {
  /**
   * Build a client with explicit outbound bounds. Stripe's SDK retries network
   * failures and 5xx/429 responses itself, so `maxNetworkRetries` is the only
   * retry loop we want; callers may still override both values (e.g. tests).
   */
  static readonly make = (apiKey: string, config?: StripeConfig): EffectStripeClient =>
    makeEffectStripeClient(
      new Stripe(apiKey, {
        timeout: OUTBOUND_TIMEOUTS.stripe,
        maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
        ...config,
      }),
    );

  static readonly layer = (apiKey: string, config?: StripeConfig): Layer.Layer<StripeService> =>
    Layer.succeed(StripeService, StripeService.make(apiKey, config));
}

export const StripeServiceLive = (apiKey: string, config?: StripeConfig) =>
  StripeService.layer(apiKey, config);

export const StripeServiceFromClient = (client: StripeClient) =>
  Layer.succeed(StripeService, makeEffectStripeClient(client));

/**
 * Verify a webhook payload against the `Stripe-Signature` header and return the
 * parsed event. Uses the async constructor so it works on Workers/WebCrypto
 * without Node's synchronous crypto primitives.
 */
export const verifyStripeWebhookSignature = (
  payload: string,
  signature: string,
  secret: string,
): Effect.Effect<Stripe.Event, StripeError> =>
  Effect.tryPromise({
    try: () => Stripe.webhooks.constructEventAsync(payload, signature, secret),
    catch: toStripeError,
  });

/** Exposed for tests that need to generate signature headers without a network call. */
export { default as StripeClient } from "stripe";

export type { Stripe };
