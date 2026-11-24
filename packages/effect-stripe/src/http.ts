import type Stripe from "stripe";
import { Option, Schema } from "effect";

/** Stripe calls are usually sub-second; a hung one must not pin the request. */
export const STRIPE_REQUEST_TIMEOUT_MS = 15_000;

/** The Stripe SDK retries transient network failures itself; keep that bounded. */
export const STRIPE_MAX_NETWORK_RETRIES = 2;

/** Minimal Stripe object shapes used by billing. */
export type StripeCustomer = {
  readonly id: string;
  readonly name?: string | null;
  readonly email?: string | null;
  readonly metadata?: Readonly<Record<string, string>> | null;
};

export type StripeList<T> = {
  readonly data: ReadonlyArray<T>;
  readonly has_more?: boolean;
};

export type StripePortalSession = {
  readonly url?: string | null;
};

export type StripeSubscriptionItem = {
  readonly id: string;
  readonly quantity?: number | null;
  readonly price?: { readonly id?: string } | null;
  /** Current period end in Unix seconds (moved onto items in newer APIs). */
  readonly current_period_end?: number;
};

export type StripeSubscription = {
  readonly id: string;
  readonly status?: string;
  readonly cancel_at_period_end?: boolean;
  readonly metadata?: Readonly<Record<string, string>> | null;
  readonly customer?: string | { readonly id?: string } | null;
  readonly items?: { readonly data: ReadonlyArray<StripeSubscriptionItem> } | null;
  /** Older API versions keep the period end on the subscription. */
  readonly current_period_end?: number;
};

/** A hosted Checkout Session. Only the fields the redirect needs are typed. */
export type StripeCheckoutSession = {
  readonly id: string;
  readonly url?: string | null;
  readonly mode?: string | null;
  readonly status?: string | null;
  readonly payment_status?: string | null;
  readonly customer?: string | { readonly id?: string } | null;
  readonly subscription?: string | { readonly id?: string } | null;
  readonly client_reference_id?: string | null;
  readonly metadata?: Readonly<Record<string, string>> | null;
};

export type StripeInvoiceStatus = "draft" | "open" | "paid" | "uncollectible" | "void";

/** The invoice fields rendered in the dashboard. */
export type StripeInvoice = {
  readonly id: string;
  readonly number?: string | null;
  readonly status?: StripeInvoiceStatus | null;
  readonly total?: number | null;
  readonly amount_due?: number | null;
  readonly amount_paid?: number | null;
  readonly currency?: string | null;
  readonly created?: number | null;
  readonly period_start?: number | null;
  readonly period_end?: number | null;
  readonly hosted_invoice_url?: string | null;
  readonly invoice_pdf?: string | null;
};

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
 * production use the small fetch client below while tests and hosts can still
 * inject a real `Stripe` instance without the Worker bundling the SDK.
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
  readonly statusCode: number;

  constructor(status: number, body: DecodedStripeError, requestId: string | undefined) {
    super(body.message ?? `Stripe request failed with ${status}`);
    this.name = "StripeError";
    this.type =
      SDK_ERROR_NAMES.get(body.type ?? "") ??
      (body.code === "idempotency_key_in_use" ? "StripeIdempotencyError" : "StripeUnknownError");
    this.code = body.code;
    this.decline_code = body.decline_code;
    this.param = body.param;
    this.requestId = requestId;
    this.statusCode = status;
  }
}

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

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * A very small Stripe REST client.
 *
 * The app calls customer create/update/search/list, a billing portal session,
 * Checkout Session creation, invoices, and the subscription cancel/quantity
 * update used by tenant teardown and seat reconciliation, and verifies
 * webhooks. The official SDK brings its HTTP
 * stack, form encoder, event types and retry machinery into the Worker bundle
 * (~530KB), which is most of the remaining removable code. This client keeps
 * the observable behaviour: bearer auth, form encoding, bounded retries for
 * 409/429/5xx, `Retry-After`, timeouts and SDK-shaped errors.
 */
export class HttpStripeClient implements StripeClientLike {
  readonly #key: string;
  readonly #host: string;
  readonly #timeout: number;
  readonly #retries: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(key: string, config: StripeClientConfig = {}) {
    this.#key = key;
    this.#host = (config.host ?? DEFAULT_HOST).replace(/\/+$/, "");
    this.#timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.#retries = config.maxNetworkRetries ?? DEFAULT_RETRIES;
    this.#fetch = config.fetch ?? globalThis.fetch;
  }

  /** Exposed for tests that assert the deployment bounds. */
  getApiField(field: "timeout" | "maxNetworkRetries"): number {
    return field === "timeout" ? this.#timeout : this.#retries;
  }

  async #request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    params: URLSearchParams = new URLSearchParams(),
  ): Promise<T> {
    const url =
      method === "GET"
        ? `${this.#host}${path}${params.size > 0 ? `?${params.toString()}` : ""}`
        : `${this.#host}${path}`;

    const headers = new Headers({ authorization: `Bearer ${this.#key}` });

    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.#timeout),
    };

    if (method === "POST") {
      headers.set("content-type", "application/x-www-form-urlencoded");
      init.body = params.toString();
    }

    let lastError: Error = new Error("Stripe request failed");

    for (let attempt = 0; attempt <= this.#retries; attempt += 1) {
      let response: Response;

      try {
        response = await this.#fetch(url, {
          ...init,
          // A fresh deadline per attempt: a slow first try must not consume
          // the timeout budget of its retries.
          signal: AbortSignal.timeout(this.#timeout),
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === this.#retries) throw lastError;

        await sleep(500 * 2 ** attempt);
        continue;
      }

      const body: unknown = await response.json().catch(() => undefined);

      if (response.ok) {
        // SAFETY: `T` is the documented response shape for the endpoint called;
        // body is the JSON returned for that endpoint.
        return body as T;
      }

      const decoded = Option.getOrUndefined(decodeStripeError(body));

      const errorBody: DecodedStripeError = decoded
        ? "error" in decoded
          ? decoded.error
          : decoded
        : {};

      const stripeError = new StripeHttpError(
        response.status,
        errorBody,
        response.headers.get("request-id") ?? undefined,
      );

      if (!RETRYABLE_STATUS.has(response.status) || attempt === this.#retries) throw stripeError;

      lastError = stripeError;

      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 500 * 2 ** attempt);
    }

    throw lastError;
  }

  readonly customers = {
    create: (params: Parameters<StripeClientLike["customers"]["create"]>[0]) =>
      this.#request<StripeCustomer>(
        "POST",
        "/v1/customers",
        withMetadata(paramPairs(["name", params.name], ["email", params.email]), params.metadata),
      ),
    update: (id: string, params: Parameters<StripeClientLike["customers"]["update"]>[1]) =>
      this.#request<StripeCustomer>(
        "POST",
        `/v1/customers/${encodeURIComponent(id)}`,
        withMetadata(paramPairs(["name", params.name], ["email", params.email]), params.metadata),
      ),
    retrieve: (id: string) =>
      this.#request<StripeCustomer>("GET", `/v1/customers/${encodeURIComponent(id)}`),
    search: (params: Parameters<StripeClientLike["customers"]["search"]>[0]) =>
      this.#request<StripeList<StripeCustomer>>(
        "GET",
        "/v1/customers/search",
        paramPairs(["query", params.query], ["limit", params.limit]),
      ),
    list: (params: Parameters<StripeClientLike["customers"]["list"]>[0] = {}) =>
      this.#request<StripeList<StripeCustomer>>(
        "GET",
        "/v1/customers",
        paramPairs(["email", params.email], ["limit", params.limit]),
      ),
  };

  readonly billingPortal = {
    sessions: {
      create: (params: Parameters<StripeClientLike["billingPortal"]["sessions"]["create"]>[0]) =>
        this.#request<StripePortalSession>(
          "POST",
          "/v1/billing_portal/sessions",
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
            "subscription_data[trial_period_days]",
            String(subscription.trial_period_days),
          );

        for (const [key, value] of Object.entries(subscription?.metadata ?? {}))
          search.set(`subscription_data[metadata][${key}]`, value);

        return this.#request<StripeCheckoutSession>("POST", "/v1/checkout/sessions", search);
      },
    },
  };

  readonly invoices = {
    list: (params: StripeInvoiceListParams) =>
      this.#request<StripeList<StripeInvoice>>(
        "GET",
        "/v1/invoices",
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
      this.#request<StripeSubscription>("GET", `/v1/subscriptions/${encodeURIComponent(id)}`),
    // `DELETE /v1/subscriptions/:id` cancels immediately. Stripe keeps the
    // object readable with status `canceled`, so a retried teardown converges.
    cancel: (id: string) =>
      this.#request<StripeSubscription>("DELETE", `/v1/subscriptions/${encodeURIComponent(id)}`),
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

      return this.#request<StripeSubscription>(
        "POST",
        `/v1/subscriptions/${encodeURIComponent(id)}`,
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

const invalidSignature = (message: string) =>
  new StripeHttpError(400, { type: "invalid_request_error", message }, undefined);

/**
 * Verify a Stripe webhook signature and return the authenticated event.
 *
 * Matches the SDK's async verifier: HMAC-SHA256 over `timestamp.payload`, all
 * `v1` signatures are accepted, and events older than five minutes are
 * rejected to bound replay.
 */
export const verifyStripeSignature = async (
  payload: string,
  signature: string,
  secret: string,
  now = Date.now(),
): Promise<Stripe.Event> => {
  // An empty HMAC key is a misconfiguration, not an authenticated event. Fail
  // with the verifier's own error instead of letting WebCrypto throw a raw
  // DataError out of the request path.
  if (!secret) throw invalidSignature("Invalid signature");

  const parts = signature.split(",").map((part) => part.split("="));
  const timestamp = parts.find(([name]) => name === "t")?.[1];

  const signatures = parts
    .filter(([name]) => name === "v1")
    .map(([, value]) => value)
    .filter((value): value is string => value !== undefined);

  if (!timestamp || signatures.length === 0) throw invalidSignature("Invalid signature");

  const seconds = Number(timestamp);

  if (!Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > 300)
    throw invalidSignature("Timestamp outside the tolerance zone");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const expected = hex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)),
  );

  if (!signatures.some((candidate) => constantTimeEqual(candidate, expected)))
    throw invalidSignature("No matching signature");

  // SAFETY: the body is authenticated by the HMAC above and Stripe's event
  // contract is the only producer of this payload; the type is the SDK's.
  return JSON.parse(payload) as Stripe.Event;
};
