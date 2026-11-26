import { Data, Effect, Layer, Option, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { parseAppleStoreLookup } from "@mattrax/enterprise-domain";
import { ApplicationStoreService } from "@mattrax/enterprise-domain";
import type {
  ApplicationStoreLookupInput,
  ApplicationStoreLookupOutcome,
} from "@mattrax/enterprise-domain";

/**
 * iTunes Search API lookup for one App Store storefront.
 *
 * The API is public and keyless. Passing `country` selects the storefront, so
 * the same bundle id can resolve to a different `trackId` when a vendor
 * publishes per-market records, and to no result when the app is unavailable
 * in that store.
 */

export const APP_STORE_LOOKUP_BASE_URL = "https://itunes.apple.com";

/** A public lookup must never hold a request open when the API stalls. */
export const APP_STORE_LOOKUP_TIMEOUT_MS = 10_000;

export type AppStoreLookupConfig = {
  /** Override for tests or an egress proxy; defaults to the runtime `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly baseUrl?: string;
};

/** Internal failure; the public outcome folds it into a message for the UI. */
class AppStoreLookupFailed extends Data.TaggedError("AppStoreLookupFailed")<{
  readonly message: string;
}> {}

const httpClientLayer = (fetchImpl?: typeof globalThis.fetch) =>
  fetchImpl === undefined
    ? FetchHttpClient.layer
    : FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchImpl)));

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const safeJson = (text: string): Schema.Json | undefined => {
  try {
    return Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(JSON.parse(text)));
  } catch {
    return undefined;
  }
};

export const lookupAppStoreApplication = (input: {
  readonly region: string;
  readonly storeId?: string | null;
  readonly bundleId?: string | null;
  readonly config?: AppStoreLookupConfig;
}): Effect.Effect<ApplicationStoreLookupOutcome> =>
  Effect.gen(function* () {
    const params = new URLSearchParams({ country: input.region });

    // Bundle ids are global, so prefer them: a legacy id recorded for another
    // storefront will not necessarily resolve in this one even though the app is
    // present, while the bundle id finds the region-specific record.
    const bundleId = input.bundleId?.trim();

    if (bundleId) params.set("bundleId", bundleId);
    else if (input.storeId?.trim()) params.set("id", input.storeId.trim());
    else
      return {
        ok: false,
        error: "Add an App Store ID or bundle ID before checking availability.",
      } as const;

    const baseUrl = (input.config?.baseUrl ?? APP_STORE_LOOKUP_BASE_URL).replace(/\/+$/, "");
    const url = `${baseUrl}/lookup?${params.toString()}`;
    const timeoutMs = input.config?.timeoutMs ?? APP_STORE_LOOKUP_TIMEOUT_MS;
    const client = yield* HttpClient.HttpClient;

    // One deadline covers the response body as well as the headers, so a
    // stalled lookup fails like a hung connect instead of pinning the request.
    const exchange = Effect.gen(function* () {
      const response = yield* client.execute(
        HttpClientRequest.get(url).pipe(HttpClientRequest.acceptJson),
      );

      return { status: response.status, text: yield* response.text };
    }).pipe(
      Effect.mapError(
        (cause) =>
          new AppStoreLookupFailed({
            message: `The App Store lookup failed: ${describeCause(cause)}`,
          }),
      ),
      Effect.timeoutOrElse({
        duration: timeoutMs,
        orElse: () =>
          Effect.fail(
            new AppStoreLookupFailed({
              message: `The App Store lookup timed out after ${timeoutMs}ms.`,
            }),
          ),
      }),
    );

    const { status, text } = yield* exchange;

    if (status < 200 || status > 299)
      return {
        ok: false,
        error: `The App Store lookup returned HTTP ${status} for ${input.region}.`,
      } as const;

    return { ok: true, lookup: parseAppleStoreLookup(safeJson(text), input.region) } as const;
  }).pipe(
    Effect.catch((error) => Effect.succeed({ ok: false, error: error.message } as const)),
    Effect.provide(httpClientLayer(input.config?.fetch)),
  );

export const makeApplicationStoreService = (
  config: AppStoreLookupConfig = {},
): ApplicationStoreService["Service"] =>
  ApplicationStoreService.of({
    lookup: (input: ApplicationStoreLookupInput) => lookupAppStoreApplication({ ...input, config }),
  });

export const applicationStoreServiceLayer = (config: AppStoreLookupConfig = {}) =>
  Layer.succeed(ApplicationStoreService, makeApplicationStoreService(config));
