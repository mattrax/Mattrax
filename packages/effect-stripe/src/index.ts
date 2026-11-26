import { Cause, Context, Data, Effect, Exit, Layer, Option, Schema } from "effect";
import {
  HttpStripeClient,
  STRIPE_MAX_NETWORK_RETRIES,
  STRIPE_REQUEST_TIMEOUT_MS,
  verifyStripeSignature,
} from "./http.ts";
import type { StripeClientConfig, StripeClientLike, StripeWebhookEvent } from "./http.ts";

export {
  HttpStripeClient,
  STRIPE_MAX_NETWORK_RETRIES,
  STRIPE_REQUEST_TIMEOUT_MS,
  verifyStripeSignature,
  type StripeClientConfig,
  type StripeClientLike,
  type StripeCheckoutSession,
  type StripeCheckoutSessionParams,
  type StripeCustomer,
  type StripeInvoice,
  type StripeInvoiceListParams,
  type StripeInvoiceStatus,
  type StripeList,
  type StripePortalSession,
  type StripeSubscription,
  type StripeSubscriptionItem,
  type StripeSubscriptionUpdateParams,
  type StripeWebhookEvent,
  StripeCheckoutSessionSchema,
  StripeCustomerSchema,
  StripeInvoiceSchema,
  StripeInvoiceStatusSchema,
  StripePortalSessionSchema,
  StripeSubscriptionItemSchema,
  StripeSubscriptionSchema,
  StripeWebhookEventSchema,
} from "./http.ts";

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

type CustomerCreate = StripeClientLike["customers"]["create"];

type CustomerUpdate = StripeClientLike["customers"]["update"];

type CustomerRetrieve = StripeClientLike["customers"]["retrieve"];

type CustomerSearch = StripeClientLike["customers"]["search"];

type CustomerList = StripeClientLike["customers"]["list"];

type BillingPortalSessionCreate = StripeClientLike["billingPortal"]["sessions"]["create"];

type CheckoutSessionCreate = StripeClientLike["checkout"]["sessions"]["create"];

type InvoiceList = StripeClientLike["invoices"]["list"];

type SubscriptionRetrieve = StripeClientLike["subscriptions"]["retrieve"];

type SubscriptionCancel = StripeClientLike["subscriptions"]["cancel"];

type SubscriptionUpdate = StripeClientLike["subscriptions"]["update"];

export interface EffectStripeClient {
  readonly effect: <A>(
    f: (client: StripeClientLike) => PromiseLike<A>,
  ) => Effect.Effect<A, StripeError>;
  readonly customers: {
    readonly create: (
      ...args: Parameters<CustomerCreate>
    ) => Effect.Effect<Awaited<ReturnType<CustomerCreate>>, StripeError>;
    readonly update: (
      ...args: Parameters<CustomerUpdate>
    ) => Effect.Effect<Awaited<ReturnType<CustomerUpdate>>, StripeError>;
    readonly retrieve: (
      ...args: Parameters<CustomerRetrieve>
    ) => Effect.Effect<Awaited<ReturnType<CustomerRetrieve>>, StripeError>;
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
  readonly checkout: {
    readonly sessions: {
      readonly create: (
        ...args: Parameters<CheckoutSessionCreate>
      ) => Effect.Effect<Awaited<ReturnType<CheckoutSessionCreate>>, StripeError>;
    };
  };
  readonly invoices: {
    readonly list: (
      ...args: Parameters<InvoiceList>
    ) => Effect.Effect<Awaited<ReturnType<InvoiceList>>, StripeError>;
  };
  readonly subscriptions: {
    readonly retrieve: (
      ...args: Parameters<SubscriptionRetrieve>
    ) => Effect.Effect<Awaited<ReturnType<SubscriptionRetrieve>>, StripeError>;
    readonly cancel: (
      ...args: Parameters<SubscriptionCancel>
    ) => Effect.Effect<Awaited<ReturnType<SubscriptionCancel>>, StripeError>;
    readonly update: (
      ...args: Parameters<SubscriptionUpdate>
    ) => Effect.Effect<Awaited<ReturnType<SubscriptionUpdate>>, StripeError>;
  };
}

/** Effect operations over an injected Promise-based Stripe SDK client. */
export interface WrappedStripeClient extends EffectStripeClient {
  readonly client: StripeClientLike;
}

/** Effect operations over the bundled HttpClient-backed Stripe adapter. */
export interface HttpEffectStripeClient extends EffectStripeClient {
  readonly client: HttpStripeClient;
}

const StripeErrorPayload = Schema.Struct({
  message: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  code: Schema.optional(Schema.String),
  decline_code: Schema.optional(Schema.String),
  declineCode: Schema.optional(Schema.String),
  param: Schema.optional(Schema.String),
  requestId: Schema.optional(Schema.String),
  request_id: Schema.optional(Schema.String),
  statusCode: Schema.optional(Schema.Number),
  raw: Schema.optional(
    Schema.Struct({
      type: Schema.optional(Schema.String),
      code: Schema.optional(Schema.String),
      decline_code: Schema.optional(Schema.String),
      param: Schema.optional(Schema.String),
      requestId: Schema.optional(Schema.String),
      request_id: Schema.optional(Schema.String),
      statusCode: Schema.optional(Schema.Number),
    }),
  ),
});

const errorDetails = (cause: unknown): StripeErrorDetails => {
  const value = Option.getOrUndefined(Schema.decodeUnknownOption(StripeErrorPayload)(cause));
  const raw = value?.raw;
  const text = Schema.is(Schema.String)(cause) ? cause : "Unknown Stripe error";

  return {
    message: cause instanceof Error ? cause.message : (value?.message ?? text),
    type: value?.type ?? raw?.type,
    code: value?.code ?? raw?.code,
    declineCode: value?.decline_code ?? value?.declineCode ?? raw?.decline_code,
    param: value?.param ?? raw?.param,
    requestId: value?.requestId ?? value?.request_id ?? raw?.requestId ?? raw?.request_id,
    statusCode: value?.statusCode ?? raw?.statusCode,
    cause,
  };
};

export const toStripeError = (cause: unknown): StripeError => {
  const details = errorDetails(cause);

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

export const makeEffectStripeClient = (client: StripeClientLike): WrappedStripeClient => {
  const effect = <A>(f: (client: StripeClientLike) => PromiseLike<A>) => tryStripe(() => f(client));

  return {
    client,
    effect,
    customers: {
      create: (...args) => effect((stripe) => stripe.customers.create(...args)),
      update: (...args) => effect((stripe) => stripe.customers.update(...args)),
      retrieve: (...args) => effect((stripe) => stripe.customers.retrieve(...args)),
      search: (...args) => effect((stripe) => stripe.customers.search(...args)),
      list: (...args) => effect((stripe) => stripe.customers.list(...args)),
    },
    billingPortal: {
      sessions: {
        create: (...args) => effect((stripe) => stripe.billingPortal.sessions.create(...args)),
      },
    },
    checkout: {
      sessions: {
        create: (...args) => effect((stripe) => stripe.checkout.sessions.create(...args)),
      },
    },
    invoices: {
      list: (...args) => effect((stripe) => stripe.invoices.list(...args)),
    },
    subscriptions: {
      retrieve: (...args) => effect((stripe) => stripe.subscriptions.retrieve(...args)),
      cancel: (...args) => effect((stripe) => stripe.subscriptions.cancel(...args)),
      update: (...args) => effect((stripe) => stripe.subscriptions.update(...args)),
    },
  };
};

const runCancellablePromise = <A, E>(
  effect: Effect.Effect<A, E>,
  signal: AbortSignal,
): Promise<A> =>
  new Promise<A>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error("Stripe request aborted"));
      return;
    }

    const fiber = Effect.runFork(effect);
    let settled = false;
    let removeObserver: () => void = () => undefined;
    const onAbort = () => fiber.interruptUnsafe();
    const cleanup = () => {
      settled = true;
      signal.removeEventListener("abort", onAbort);
      removeObserver();
    };

    removeObserver = fiber.addObserver((exit) => {
      cleanup();

      if (Exit.isSuccess(exit)) resolve(exit.value);
      else reject(Cause.squash(exit.cause));
    });

    if (settled) removeObserver();
    else signal.addEventListener("abort", onAbort, { once: true });
  });

const promiseClient = (client: HttpStripeClient, signal: AbortSignal): StripeClientLike => ({
  customers: {
    create: (params) => runCancellablePromise(client.customers.create(params), signal),
    update: (id, params) => runCancellablePromise(client.customers.update(id, params), signal),
    retrieve: (id) => runCancellablePromise(client.customers.retrieve(id), signal),
    search: (params) => runCancellablePromise(client.customers.search(params), signal),
    list: (params) => runCancellablePromise(client.customers.list(params), signal),
  },
  billingPortal: {
    sessions: {
      create: (params) =>
        runCancellablePromise(client.billingPortal.sessions.create(params), signal),
    },
  },
  checkout: {
    sessions: {
      create: (params) => runCancellablePromise(client.checkout.sessions.create(params), signal),
    },
  },
  invoices: {
    list: (params) => runCancellablePromise(client.invoices.list(params), signal),
  },
  subscriptions: {
    retrieve: (id) => runCancellablePromise(client.subscriptions.retrieve(id), signal),
    cancel: (id) => runCancellablePromise(client.subscriptions.cancel(id), signal),
    update: (id, params) => runCancellablePromise(client.subscriptions.update(id, params), signal),
  },
});

export const makeEffectHttpStripeClient = (client: HttpStripeClient): HttpEffectStripeClient => {
  const request = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(Effect.mapError(toStripeError));

  return {
    client,
    effect: (f) =>
      Effect.tryPromise({
        try: (signal) => f(promiseClient(client, signal)),
        catch: toStripeError,
      }),
    customers: {
      create: (...args) => request(client.customers.create(...args)),
      update: (...args) => request(client.customers.update(...args)),
      retrieve: (...args) => request(client.customers.retrieve(...args)),
      search: (...args) => request(client.customers.search(...args)),
      list: (...args) => request(client.customers.list(...args)),
    },
    billingPortal: {
      sessions: {
        create: (...args) => request(client.billingPortal.sessions.create(...args)),
      },
    },
    checkout: {
      sessions: {
        create: (...args) => request(client.checkout.sessions.create(...args)),
      },
    },
    invoices: {
      list: (...args) => request(client.invoices.list(...args)),
    },
    subscriptions: {
      retrieve: (...args) => request(client.subscriptions.retrieve(...args)),
      cancel: (...args) => request(client.subscriptions.cancel(...args)),
      update: (...args) => request(client.subscriptions.update(...args)),
    },
  };
};

export class StripeService extends Context.Service<StripeService, EffectStripeClient>()(
  "StripeService",
) {
  /**
   * Build a client with explicit outbound bounds. The fetch client retries
   * network failures and 409/429/5xx responses itself, so
   * `maxNetworkRetries` is the only retry loop we want; callers may still
   * override both values (e.g. tests).
   */
  static readonly make = (apiKey: string, config?: StripeClientConfig): HttpEffectStripeClient =>
    makeEffectHttpStripeClient(new HttpStripeClient(apiKey, config));

  static readonly layer = (
    apiKey: string,
    config?: StripeClientConfig,
  ): Layer.Layer<StripeService> => Layer.succeed(StripeService, StripeService.make(apiKey, config));
}

export const StripeServiceLive = (apiKey: string, config?: StripeClientConfig) =>
  StripeService.layer(apiKey, config);

export const StripeServiceFromClient = (client: StripeClientLike) =>
  Layer.succeed(StripeService, makeEffectStripeClient(client));

/**
 * Verify a webhook payload against the `Stripe-Signature` header and return the
 * parsed event. Uses WebCrypto so it works on Workers without Node's
 * synchronous crypto primitives.
 */
export const verifyStripeWebhookSignature = (
  payload: string,
  signature: string,
  secret: string,
): Effect.Effect<StripeWebhookEvent, StripeError> =>
  verifyStripeSignature(payload, signature, secret).pipe(Effect.mapError(toStripeError));

export const STRIPE_DEFAULTS = {
  timeout: STRIPE_REQUEST_TIMEOUT_MS,
  maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
} as const;
