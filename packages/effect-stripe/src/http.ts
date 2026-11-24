import { Clock, Duration, Effect, Option, Result, Schedule, Schema } from "effect";
import {
  FetchHttpClient,
  Headers as HttpHeaders,
  HttpBody,
  HttpClient,
  HttpClientRequest,
} from "effect/http";

/** Stripe calls are usually sub-second; a hung one must not pin the request. */
export const STRIPE_REQUEST_TIMEOUT_MS = 15_000;

/** Retry transient failures at most twice after the initial attempt. */
export const STRIPE_MAX_NETWORK_RETRIES = 2;

const OptionalString = Schema.optional(Schema.NullOr(Schema.String));
const Metadata = Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.String)));
const StripeObjectReference = Schema.Struct({ id: Schema.optional(Schema.String) });

export const StripeCustomerSchema = Schema.Struct({
  id: Schema.String,
  name: OptionalString,
  email: OptionalString,
  metadata: Metadata,
});

export type StripeCustomer = typeof StripeCustomerSchema.Type;

const listSchema = <A>(item: Schema.ConstraintDecoder<A>) =>
  Schema.Struct({
    data: Schema.Array(item),
    has_more: Schema.optional(Schema.Boolean),
  });

export type StripeList<T> = {
  readonly data: ReadonlyArray<T>;
  readonly has_more?: boolean;
};

export const StripePortalSessionSchema = Schema.Struct({
  url: OptionalString,
});

export type StripePortalSession = typeof StripePortalSessionSchema.Type;

export const StripeSubscriptionItemSchema = Schema.Struct({
  id: Schema.String,
  quantity: Schema.optional(Schema.NullOr(Schema.Number)),
  price: Schema.optional(Schema.NullOr(StripeObjectReference)),
  /** Current period end in Unix seconds (moved onto items in newer APIs). */
  current_period_end: Schema.optional(Schema.Number),
});

export type StripeSubscriptionItem = typeof StripeSubscriptionItemSchema.Type;

export const StripeSubscriptionSchema = Schema.Struct({
  id: Schema.String,
  status: OptionalString,
  cancel_at_period_end: Schema.optional(Schema.Boolean),
  metadata: Metadata,
  customer: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, StripeObjectReference]))),
  items: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        data: Schema.Array(StripeSubscriptionItemSchema),
      }),
    ),
  ),
  /** Older API versions keep the period end on the subscription. */
  current_period_end: Schema.optional(Schema.Number),
});

export type StripeSubscription = typeof StripeSubscriptionSchema.Type;

/** A hosted Checkout Session. Only the fields the redirect needs are typed. */
export const StripeCheckoutSessionSchema = Schema.Struct({
  id: Schema.String,
  url: OptionalString,
  mode: OptionalString,
  status: OptionalString,
  payment_status: OptionalString,
  customer: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, StripeObjectReference]))),
  subscription: Schema.optional(
    Schema.NullOr(Schema.Union([Schema.String, StripeObjectReference])),
  ),
  client_reference_id: OptionalString,
  metadata: Metadata,
});

export type StripeCheckoutSession = typeof StripeCheckoutSessionSchema.Type;

export const StripeInvoiceStatusSchema = Schema.Literals([
  "draft",
  "open",
  "paid",
  "uncollectible",
  "void",
]);

export type StripeInvoiceStatus = typeof StripeInvoiceStatusSchema.Type;

/** The invoice fields rendered in the dashboard. */
export const StripeInvoiceSchema = Schema.Struct({
  id: Schema.String,
  number: OptionalString,
  status: Schema.optional(Schema.NullOr(StripeInvoiceStatusSchema)),
  total: Schema.optional(Schema.NullOr(Schema.Number)),
  amount_due: Schema.optional(Schema.NullOr(Schema.Number)),
  amount_paid: Schema.optional(Schema.NullOr(Schema.Number)),
  currency: OptionalString,
  created: Schema.optional(Schema.NullOr(Schema.Number)),
  period_start: Schema.optional(Schema.NullOr(Schema.Number)),
  period_end: Schema.optional(Schema.NullOr(Schema.Number)),
  hosted_invoice_url: OptionalString,
  invoice_pdf: OptionalString,
});

export type StripeInvoice = typeof StripeInvoiceSchema.Type;

/**
 * The authenticated webhook envelope used by billing. Stripe's resource union
 * stays open here; the billing layer decodes the object for each event type.
 */
export const StripeWebhookEventSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  data: Schema.Struct({
    object: Schema.Record(Schema.String, Schema.Unknown),
  }),
});

export type StripeWebhookEvent = typeof StripeWebhookEventSchema.Type;

export type StripeCheckoutSessionParams = {
  readonly mode: "subscription";
  readonly success_url: string;
  readonly cancel_url: string;
  readonly customer?: string;
  readonly client_reference_id?: string;
  readonly line_items: ReadonlyArray<{ readonly price: string; readonly quantity: number }>;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly subscription_data?: {
    readonly trial_period_days?: number;
    readonly metadata?: Readonly<Record<string, string>>;
  };
  readonly allow_promotion_codes?: boolean;
};

export type StripeSubscriptionUpdateParams = {
  readonly cancel_at_period_end?: boolean;
  /** Existing items only; a price change is never performed by this client. */
  readonly items?: ReadonlyArray<{ readonly id: string; readonly quantity: number }>;
  readonly proration_behavior?: "create_prorations" | "none" | "always_invoice";
  readonly metadata?: Readonly<Record<string, string>>;
};

export type StripeInvoiceListParams = {
  readonly customer: string;
  readonly limit?: number;
  readonly status?: StripeInvoiceStatus;
  readonly starting_after?: string;
};

export type StripeClientConfig = {
  readonly timeout?: number;
  readonly maxNetworkRetries?: number;
  /** Override the API base (tests and local proxies). */
  readonly host?: string;
  /** Test seam; defaults to the global fetch. */
  readonly fetch?: typeof globalThis.fetch;
};

/**
 * The subset of the Stripe SDK that this app calls. Keeping it structural lets
 * tests and hosts inject a real `Stripe` instance without the Worker bundling
 * the SDK.
 */
export interface StripeClientLike {
  readonly customers: {
    readonly create: (params: {
      readonly name?: string;
      readonly email?: string;
      readonly metadata?: Readonly<Record<string, string>>;
    }) => Promise<StripeCustomer>;
    readonly update: (
      id: string,
      params: {
        readonly name?: string;
        readonly email?: string;
        readonly metadata?: Readonly<Record<string, string>>;
      },
    ) => Promise<StripeCustomer>;
    readonly retrieve: (id: string) => Promise<StripeCustomer>;
    readonly search: (params: {
      readonly query: string;
      readonly limit?: number;
    }) => Promise<StripeList<StripeCustomer>>;
    readonly list: (params?: {
      readonly email?: string;
      readonly limit?: number;
    }) => Promise<StripeList<StripeCustomer>>;
  };
  readonly billingPortal: {
    readonly sessions: {
      readonly create: (params: {
        readonly customer: string;
        readonly return_url: string;
      }) => Promise<StripePortalSession>;
    };
  };
  readonly checkout: {
    readonly sessions: {
      readonly create: (params: StripeCheckoutSessionParams) => Promise<StripeCheckoutSession>;
    };
  };
  readonly invoices: {
    readonly list: (params: StripeInvoiceListParams) => Promise<StripeList<StripeInvoice>>;
  };
  /**
   * Subscription lifecycle used by tenant teardown and seat reconciliation.
   * Cancel is idempotent at the Stripe API level and never bills again.
   */
  readonly subscriptions: {
    readonly retrieve: (id: string) => Promise<StripeSubscription>;
    readonly cancel: (id: string) => Promise<StripeSubscription>;
    readonly update: (
      id: string,
      params: StripeSubscriptionUpdateParams,
    ) => Promise<StripeSubscription>;
  };
}

const DEFAULT_HOST = "https://api.stripe.com";
const DEFAULT_TIMEOUT = STRIPE_REQUEST_TIMEOUT_MS;
const DEFAULT_RETRIES = STRIPE_MAX_NETWORK_RETRIES;
const RETRYABLE_STATUS = new Set([409, 429, 500, 502, 503, 504]);

const SDK_ERROR_NAMES = new Map([
  ["card_error", "StripeCardError"],
  ["rate_limit_error", "StripeRateLimitError"],
  ["invalid_request_error", "StripeInvalidRequestError"],
  ["api_error", "StripeAPIError"],
  ["api_connection_error", "StripeConnectionError"],
  ["authentication_error", "StripeAuthenticationError"],
  ["permission_error", "StripePermissionError"],
  ["idempotency_error", "StripeIdempotencyError"],
]);

const StripeErrorBody = Schema.Struct({
  type: Schema.optional(Schema.String),
  code: Schema.optional(Schema.String),
  decline_code: Schema.optional(Schema.String),
  param: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
});

const StripeErrorResponse = Schema.Struct({ error: StripeErrorBody });

type DecodedStripeError = typeof StripeErrorBody.Type;

const decodeStripeError = Schema.decodeUnknownOption(
  Schema.Union([StripeErrorResponse, StripeErrorBody]),
);

class StripeHttpError extends Error {
  readonly type: string;
  readonly code: string | undefined;
  readonly decline_code: string | undefined;
  readonly param: string | undefined;
  readonly requestId: string | undefined;
  readonly statusCode: number | undefined;
  readonly retryable: boolean;
  readonly retryAfter: Duration.Duration;
  readonly cause: unknown;

  constructor(
    status: number | undefined,
    body: DecodedStripeError,
    requestId: string | undefined,
    options: {
      readonly retryable?: boolean;
      readonly retryAfter?: Duration.Duration;
      readonly cause?: unknown;
    } = {},
  ) {
    super(body.message ?? `Stripe request failed with ${status ?? "no response"}`);
    this.name = "StripeError";
    this.type =
      SDK_ERROR_NAMES.get(body.type ?? "") ??
      (body.code === "idempotency_key_in_use" ? "StripeIdempotencyError" : "StripeUnknownError");
    this.code = body.code;
    this.decline_code = body.decline_code;
    this.param = body.param;
    this.requestId = requestId;
    this.statusCode = status;
    this.retryable = options.retryable ?? false;
    this.retryAfter = options.retryAfter ?? Duration.zero;
    this.cause = options.cause;
  }
}

const connectionError = (cause: unknown): StripeHttpError =>
  new StripeHttpError(
    undefined,
    {
      type: "api_connection_error",
      message: cause instanceof Error ? cause.message : "Stripe connection failed",
    },
    undefined,
    { retryable: true, cause },
  );

const timeoutError = (): StripeHttpError =>
  new StripeHttpError(
    undefined,
    { type: "api_connection_error", message: "Stripe request timed out" },
    undefined,
    { retryable: true },
  );

const invalidResponse = (message: string, cause: unknown): StripeHttpError =>
  new StripeHttpError(undefined, { message }, undefined, { cause });

const paramPairs = (
  ...entries: ReadonlyArray<readonly [string, string | number | undefined]>
): URLSearchParams => {
  const search = new URLSearchParams();

  for (const [key, value] of entries) {
    if (value !== undefined) search.set(key, String(value));
  }

  return search;
};

const withMetadata = (
  search: URLSearchParams,
  metadata: Readonly<Record<string, string>> | undefined,
): URLSearchParams => {
  for (const [key, value] of Object.entries(metadata ?? {})) search.set(`metadata[${key}]`, value);

  return search;
};

const retryAfterDelay = (header: string | undefined, now: number): Duration.Duration => {
  if (!header) return Duration.zero;

  const parsed = HttpHeaders.parseRetryAfter(header);

  return Result.isSuccess(parsed)
    ? HttpHeaders.retryAfterDelay(parsed.success, now)
    : Duration.zero;
};

const shouldRetryStatus = (status: number, guidance: string | undefined): boolean => {
  const normalized = guidance?.trim().toLowerCase();

  if (normalized === "false") return false;
  if (normalized === "true") return true;

  return RETRYABLE_STATUS.has(status);
};

/**
 * A very small Stripe REST client.
 *
 * Requests run on Effect's HttpClient. Each attempt has its own deadline, and
 * retries use the Effect clock so parent interruption stops both in-flight
 * requests and backoff sleeps. POSTs carry one idempotency key for every
 * attempt of the logical request.
 */
export class HttpStripeClient {
  readonly #key: string;
  readonly #host: string;
  readonly #timeout: number;
  readonly #retries: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(key: string, config: StripeClientConfig = {}) {
    this.#key = key;
    this.#host = (config.host ?? DEFAULT_HOST).replace(/\/+$/, "");
    this.#timeout = Math.max(1, config.timeout ?? DEFAULT_TIMEOUT);
    this.#retries = Math.max(0, Math.floor(config.maxNetworkRetries ?? DEFAULT_RETRIES));
    this.#fetch = config.fetch ?? globalThis.fetch;
  }

  /** Exposed for tests that assert the deployment bounds. */
  getApiField(field: "timeout" | "maxNetworkRetries"): number {
    return field === "timeout" ? this.#timeout : this.#retries;
  }

  #run<A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>): Effect.Effect<A, E> {
    return effect.pipe(
      Effect.provideService(FetchHttpClient.Fetch, this.#fetch),
      Effect.provide(FetchHttpClient.layer),
    );
  }

  #request<A>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    schema: Schema.ConstraintDecoder<A>,
    params: URLSearchParams = new URLSearchParams(),
  ): Effect.Effect<A, StripeHttpError> {
    const url =
      method === "GET"
        ? `${this.#host}${path}${params.size > 0 ? `?${params.toString()}` : ""}`
        : `${this.#host}${path}`;
    const idempotencyKey = method === "POST" ? crypto.randomUUID() : undefined;

    let request = HttpClientRequest.make(method)(url).pipe(
      HttpClientRequest.setHeader("authorization", `Bearer ${this.#key}`),
    );

    if (method === "POST")
      request = request.pipe(
        HttpClientRequest.setHeader("content-type", "application/x-www-form-urlencoded"),
        HttpClientRequest.setHeader("idempotency-key", idempotencyKey!),
        HttpClientRequest.setBody(
          HttpBody.text(params.toString(), "application/x-www-form-urlencoded"),
        ),
      );

    const attempt = Effect.gen(function* () {
      const response = yield* HttpClient.execute(request);

      if (response.status >= 200 && response.status < 300) {
        const body = yield* response.json.pipe(
          Effect.mapError((cause) => invalidResponse("Stripe returned invalid JSON", cause)),
        );

        return yield* Effect.try({
          try: () => Schema.decodeUnknownSync(schema)(body),
          catch: (cause) => invalidResponse("Stripe returned an invalid response", cause),
        });
      }

      const body = yield* response.json.pipe(Effect.catch(() => Effect.succeed(undefined)));
      const decoded = Option.getOrUndefined(decodeStripeError(body));
      const errorBody: DecodedStripeError = decoded
        ? "error" in decoded
          ? decoded.error
          : decoded
        : {};
      const now = yield* Clock.currentTimeMillis;
      const retryAfter = retryAfterDelay(response.headers["retry-after"], now);

      return yield* Effect.fail(
        new StripeHttpError(response.status, errorBody, response.headers["request-id"], {
          retryable: shouldRetryStatus(response.status, response.headers["stripe-should-retry"]),
          retryAfter,
        }),
      );
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof StripeHttpError ? cause : connectionError(cause),
      ),
      Effect.timeoutOrElse({
        duration: this.#timeout,
        orElse: () => Effect.fail(timeoutError()),
      }),
    );

    const schedule = Schedule.exponential("500 millis").pipe(
      Schedule.setInputType<StripeHttpError>(),
      Schedule.upTo({ times: this.#retries }),
      Schedule.modifyDelay(({ duration, input }) =>
        Effect.succeed(Duration.max(duration, input.retryAfter)),
      ),
    );

    const retried = Effect.retry(attempt, {
      schedule,
      while: (error) => error.retryable,
    });

    return this.#run(retried);
  }

  readonly customers = {
    create: (params: Parameters<StripeClientLike["customers"]["create"]>[0]) =>
      this.#request(
        "POST",
        "/v1/customers",
        StripeCustomerSchema,
        withMetadata(paramPairs(["name", params.name], ["email", params.email]), params.metadata),
      ),
    update: (id: string, params: Parameters<StripeClientLike["customers"]["update"]>[1]) =>
      this.#request(
        "POST",
        `/v1/customers/${encodeURIComponent(id)}`,
        StripeCustomerSchema,
        withMetadata(paramPairs(["name", params.name], ["email", params.email]), params.metadata),
      ),
    retrieve: (id: string) =>
      this.#request("GET", `/v1/customers/${encodeURIComponent(id)}`, StripeCustomerSchema),
    search: (params: Parameters<StripeClientLike["customers"]["search"]>[0]) =>
      this.#request(
        "GET",
        "/v1/customers/search",
        listSchema(StripeCustomerSchema),
        paramPairs(["query", params.query], ["limit", params.limit]),
      ),
    list: (params: Parameters<StripeClientLike["customers"]["list"]>[0] = {}) =>
      this.#request(
        "GET",
        "/v1/customers",
        listSchema(StripeCustomerSchema),
        paramPairs(["email", params.email], ["limit", params.limit]),
      ),
  };

  readonly billingPortal = {
    sessions: {
      create: (params: Parameters<StripeClientLike["billingPortal"]["sessions"]["create"]>[0]) =>
        this.#request(
          "POST",
          "/v1/billing_portal/sessions",
          StripePortalSessionSchema,
          paramPairs(["customer", params.customer], ["return_url", params.return_url]),
        ),
    },
  };

  readonly checkout = {
    sessions: {
      create: (params: StripeCheckoutSessionParams) => {
        const search = withMetadata(
          paramPairs(
            ["mode", params.mode],
            ["success_url", params.success_url],
            ["cancel_url", params.cancel_url],
            ["customer", params.customer],
            ["client_reference_id", params.client_reference_id],
            [
              "allow_promotion_codes",
              params.allow_promotion_codes === undefined
                ? undefined
                : params.allow_promotion_codes
                  ? "true"
                  : "false",
            ],
          ),
          params.metadata,
        );

        params.line_items.forEach((item, index) => {
          search.set(`line_items[${index}][price]`, item.price);
          search.set(`line_items[${index}][quantity]`, String(item.quantity));
        });

        const subscription = params.subscription_data;

        if (subscription?.trial_period_days !== undefined)
          search.set(
            `subscription_data[trial_period_days]`,
            String(subscription.trial_period_days),
          );

        for (const [key, value] of Object.entries(subscription?.metadata ?? {}))
          search.set(`subscription_data[metadata][${key}]`, value);

        return this.#request("POST", "/v1/checkout/sessions", StripeCheckoutSessionSchema, search);
      },
    },
  };

  readonly invoices = {
    list: (params: StripeInvoiceListParams) =>
      this.#request(
        "GET",
        "/v1/invoices",
        listSchema(StripeInvoiceSchema),
        paramPairs(
          ["customer", params.customer],
          ["limit", params.limit],
          ["status", params.status],
          ["starting_after", params.starting_after],
        ),
      ),
  };

  readonly subscriptions = {
    retrieve: (id: string) =>
      this.#request("GET", `/v1/subscriptions/${encodeURIComponent(id)}`, StripeSubscriptionSchema),
    // `DELETE /v1/subscriptions/:id` cancels immediately. Stripe keeps the
    // object readable with status `canceled`, so a retried teardown converges.
    cancel: (id: string) =>
      this.#request(
        "DELETE",
        `/v1/subscriptions/${encodeURIComponent(id)}`,
        StripeSubscriptionSchema,
      ),
    update: (id: string, params: StripeSubscriptionUpdateParams) => {
      const search = withMetadata(
        paramPairs(
          [
            "cancel_at_period_end",
            params.cancel_at_period_end === undefined
              ? undefined
              : params.cancel_at_period_end
                ? "true"
                : "false",
          ],
          ["proration_behavior", params.proration_behavior],
        ),
        params.metadata,
      );

      params.items?.forEach((item, index) => {
        search.set(`items[${index}][id]`, item.id);
        search.set(`items[${index}][quantity]`, String(item.quantity));
      });

      return this.#request(
        "POST",
        `/v1/subscriptions/${encodeURIComponent(id)}`,
        StripeSubscriptionSchema,
        search,
      );
    },
  };
}

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

const constantTimeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;

  let difference = 0;

  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);

  return difference === 0;
};

const invalidSignature = (message: string, cause?: unknown): StripeHttpError =>
  new StripeHttpError(
    400,
    { type: "invalid_request_error", message },
    undefined,
    cause === undefined ? {} : { cause },
  );

/**
 * Verify a Stripe webhook signature and decode the authenticated event envelope.
 *
 * Matches the SDK's verifier: HMAC-SHA256 over `timestamp.payload`, all `v1`
 * signatures are accepted, and events outside the five-minute replay window
 * are rejected. The current time comes from the active Effect clock.
 */
export const verifyStripeSignature = (
  payload: string,
  signature: string,
  secret: string,
): Effect.Effect<StripeWebhookEvent, StripeHttpError> =>
  Effect.gen(function* () {
    // An empty HMAC key is a misconfiguration, not an authenticated event.
    if (!secret) return yield* Effect.fail(invalidSignature("Invalid signature"));

    const parts = signature.split(",").map((part) => {
      const separator = part.indexOf("=");

      return separator === -1
        ? [part.trim(), undefined]
        : [part.slice(0, separator).trim(), part.slice(separator + 1)];
    });
    const timestamp = parts.find(([name]) => name === "t")?.[1];

    const signatures = parts
      .filter(([name]) => name === "v1")
      .map(([, value]) => value)
      .filter((value): value is string => value !== undefined);

    if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0)
      return yield* Effect.fail(invalidSignature("Invalid signature"));

    const seconds = Number(timestamp);
    const now = yield* Clock.currentTimeMillis;

    if (!Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > 300)
      return yield* Effect.fail(invalidSignature("Timestamp outside the tolerance zone"));

    const key = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(secret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        ),
      catch: (cause) => invalidSignature("Invalid signature", cause),
    });

    const expected = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle
          .sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`))
          .then(hex),
      catch: (cause) => invalidSignature("Invalid signature", cause),
    });

    if (!signatures.some((candidate) => constantTimeEqual(candidate, expected)))
      return yield* Effect.fail(invalidSignature("No matching signature"));

    return yield* Effect.try({
      try: () => Schema.decodeUnknownSync(StripeWebhookEventSchema)(JSON.parse(payload)),
      catch: (cause) => invalidSignature("Invalid Stripe event payload", cause),
    });
  });
