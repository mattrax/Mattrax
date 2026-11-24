/**
 * Cached SOFA macOS update feed.
 *
 * The dashboard, the device list and the device page all need the same feed.
 * Fetching it per request would make an upstream outage visible on every page
 * and would multiply requests to a third-party service, so the trimmed feed is
 * persisted in `software_update_feed` and reused for a cache window.
 *
 * Failure isolation is the important property here: this function never fails.
 * A timeout, a non-2xx response, malformed JSON, an invalid payload or a
 * database error returns a state with `available: false` (or a stale catalog)
 * and the caller treats every macOS device as `unknown` rather than "up to
 * date". A failed refresh is remembered both in the database and in the
 * service-layer cache, so a database write failure cannot turn every dashboard
 * request into another five-second timeout.
 */

import { Context, Data, Deferred, Effect, Layer, Option, Ref, Schema, Stream } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { eq } from "drizzle-orm";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { MacOsUpdateCatalog, parseSofaFeed } from "@mattrax/enterprise-domain";
import type { EnterpriseSchema } from "../schema.ts";

/** Public SOFA macOS feed. Operators can override it for a mirror. */
export const SOFA_MACOS_FEED_URL = "https://sofafeed.macadmins.io/v1/macos_data_feed.json";

/** One deployment-wide row: every tenant compares against the same releases. */
export const SOFA_MACOS_FEED_ID = "sofa-macos";

/** Refresh a cached feed after six hours; SOFA publishes at most daily. */
export const DEFAULT_SOFTWARE_UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;

/** Do not retry a failed refresh for fifteen minutes. */
export const DEFAULT_SOFTWARE_UPDATE_RETRY_MS = 15 * 60 * 1_000;

/** A slow feed must not hold a dashboard or device-list response open. */
export const DEFAULT_SOFTWARE_UPDATE_TIMEOUT_MS = 5_000;

/** SOFA is ~350 KB today; cap the response so a bad mirror cannot exhaust memory. */
export const MAX_SOFTWARE_UPDATE_FEED_BYTES = 4 * 1_024 * 1_024;

export type SoftwareUpdateCatalogState = {
  readonly catalog: MacOsUpdateCatalog | null;
  readonly sourceUrl: string;
  readonly available: boolean;
  /** True when the catalog is older than the cache window and the refresh failed. */
  readonly stale: boolean;
  readonly fetchedAt: string | null;
  /** Stable failure code; never an upstream body or a stack trace. */
  readonly error: string | null;
};

export type LoadSoftwareUpdateCatalogOptions = {
  readonly db: EnterpriseDb;
  readonly schema: EnterpriseSchema;
  readonly feedUrl?: string;
  readonly cacheTtlMs?: number;
  readonly retryAfterFailureMs?: number;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly disabled?: boolean;
  /** Injectable Effect client. Omit only for explicitly offline callers. */
  readonly httpClient?: HttpClient.HttpClient;
  /** Per-layer in-flight refresh and failure memory. */
  readonly cache?: SoftwareUpdateCache["Service"];
  /** Injectable clock so cache/cooldown boundaries are testable. */
  readonly now?: Date;
};

export type SoftwareUpdateFetchResult =
  | { readonly ok: true; readonly catalog: MacOsUpdateCatalog }
  | { readonly ok: false; readonly error: string };

type FailureCooldown = { readonly at: number; readonly error: string };

/**
 * Refresh coalescing and failure memory belong to a Layer, not the module.
 * Deferred shares the Effect result (including interruption) without leaving a
 * Promise behind or continuing an abandoned fetch for another waiter.
 */
export class SoftwareUpdateCache extends Context.Service<
  SoftwareUpdateCache,
  {
    readonly refresh: (
      key: string,
      load: Effect.Effect<SoftwareUpdateFetchResult>,
    ) => Effect.Effect<SoftwareUpdateFetchResult>;
    readonly failures: Ref.Ref<Map<string, FailureCooldown>>;
  }
>()("@mattrax/enterprise-backend/SoftwareUpdateCache") {
  static readonly make = Effect.gen(function* () {
    const inFlight = yield* Ref.make(
      new Map<string, Deferred.Deferred<SoftwareUpdateFetchResult>>(),
    );
    const failures = yield* Ref.make(new Map<string, FailureCooldown>());

    const refresh = Effect.fnUntraced(function* (
      key: string,
      load: Effect.Effect<SoftwareUpdateFetchResult>,
    ) {
      const candidate = yield* Deferred.make<SoftwareUpdateFetchResult>();
      const existing = yield* Ref.modify(inFlight, (current) => {
        const pending = current.get(key);

        return [pending, pending ? current : new Map(current).set(key, candidate)] as const;
      });

      if (existing) return yield* Deferred.await(existing);

      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const exit = yield* restore(load).pipe(Effect.exit);

          yield* Deferred.done(candidate, exit);
          yield* Ref.update(inFlight, (current) => {
            if (current.get(key) !== candidate) return current;

            const next = new Map(current);
            next.delete(key);

            return next;
          });

          return yield* exit;
        }),
      );
    });

    return SoftwareUpdateCache.of({ refresh, failures });
  });

  static readonly layer = Layer.effect(SoftwareUpdateCache, SoftwareUpdateCache.make);
}

class PayloadTooLarge extends Data.TaggedError("PayloadTooLarge")<{
  readonly reason: "payload_too_large";
}> {}

const feedKey = (sourceUrl: string) => `${SOFA_MACOS_FEED_ID}:${sourceUrl}`;

type BodyReadResult =
  | { readonly ok: true; readonly body: string }
  | { readonly ok: false; readonly error: string };

const joinChunks = (chunks: ReadonlyArray<Uint8Array>, total: number) => {
  const bytes = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
};

/** Read a response stream with a hard byte cap and cancel as soon as it is crossed. */
const readBodyWithLimit = (
  response: HttpClientResponse.HttpClientResponse,
  maxBytes: number,
): Effect.Effect<BodyReadResult> =>
  Effect.gen(function* () {
    const chunks: Array<Uint8Array> = [];
    let total = 0;

    yield* response.stream.pipe(
      Stream.runForEach((chunk) =>
        Effect.gen(function* () {
          const next = total + chunk.byteLength;

          if (next > maxBytes) return yield* new PayloadTooLarge({ reason: "payload_too_large" });

          chunks.push(chunk);
          total = next;
        }),
      ),
    );

    return { ok: true, body: new TextDecoder().decode(joinChunks(chunks, total)) } as const;
  }).pipe(
    Effect.catchTag("PayloadTooLarge", () =>
      Effect.succeed({ ok: false, error: "payload_too_large" } as const),
    ),
    Effect.catch(() => Effect.succeed({ ok: false, error: "read_failed" } as const)),
  );

const cancelResponseBody = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<void> =>
  Option.match(HttpClientResponse.toWeb(response), {
    onNone: () => Effect.void,
    onSome: (web) =>
      Effect.promise(async () => {
        await web.body?.cancel();
      }).pipe(Effect.catchCause(() => Effect.void)),
  });

const fetchFeed = (
  client: HttpClient.HttpClient,
  url: string,
  timeoutMs: number,
  maxBytes: number,
): Effect.Effect<SoftwareUpdateFetchResult> =>
  Effect.gen(function* () {
    const response = yield* client.execute(
      HttpClientRequest.get(url).pipe(HttpClientRequest.acceptJson),
    );

    if (response.status < 200 || response.status > 299) {
      const status = Math.trunc(response.status);

      yield* cancelResponseBody(response);

      return {
        ok: false,
        error: Number.isFinite(status) && status > 0 ? `http_${status}` : "http_error",
      } as const;
    }

    const declared = Number(response.headers["content-length"] ?? "");

    if (Number.isFinite(declared) && declared > maxBytes)
      return yield* cancelResponseBody(response).pipe(
        Effect.as({ ok: false, error: "payload_too_large" } as const),
      );

    const read = yield* readBodyWithLimit(response, maxBytes);

    if (!read.ok) return read;

    let json: Schema.Json | null;

    try {
      json = Option.getOrNull(Schema.decodeUnknownOption(Schema.Json)(JSON.parse(read.body)));
    } catch {
      return { ok: false, error: "invalid_json" } as const;
    }

    if (json === null) return { ok: false, error: "invalid_json" } as const;

    const catalog = parseSofaFeed(json);

    return catalog
      ? ({ ok: true, catalog } as const)
      : ({ ok: false, error: "invalid_feed" } as const);
  }).pipe(
    Effect.timeoutOrElse({
      duration: timeoutMs,
      orElse: () => Effect.succeed({ ok: false, error: "timeout" } as const),
    }),
    Effect.catch(() => Effect.succeed({ ok: false, error: "fetch_failed" } as const)),
  );

const decodeStoredCatalog = (payload: Schema.Json | null): MacOsUpdateCatalog | null =>
  Option.getOrNull(Schema.decodeUnknownOption(MacOsUpdateCatalog)(payload));

const unavailableState = (
  sourceUrl: string,
  error: string,
  catalog: MacOsUpdateCatalog | null = null,
  stale = false,
  fetchedAt: string | null = null,
): SoftwareUpdateCatalogState => ({
  catalog,
  sourceUrl,
  available: catalog !== null,
  stale,
  fetchedAt,
  error,
});

const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

const parseDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
};

type FeedRow = {
  readonly payload: Schema.Json | null;
  readonly sourceUrl: string;
  readonly fetchedAt: Date | null;
  readonly checkedAt: Date;
  readonly lastError: string | null;
};

/**
 * Load the cached catalog, refreshing it when the cache window has passed.
 *
 * Never fails: every error path returns a state the caller can render.
 */
export const loadSoftwareUpdateCatalog = (
  options: LoadSoftwareUpdateCatalogOptions,
): Effect.Effect<SoftwareUpdateCatalogState> => {
  const configuredUrl = options.feedUrl?.trim() || SOFA_MACOS_FEED_URL;

  const load = Effect.gen(function* () {
    const sourceUrl = configuredUrl;
    const key = feedKey(sourceUrl);
    const now = options.now ?? new Date();
    const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_SOFTWARE_UPDATE_CACHE_TTL_MS;
    const retryAfterFailureMs = options.retryAfterFailureMs ?? DEFAULT_SOFTWARE_UPDATE_RETRY_MS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_SOFTWARE_UPDATE_TIMEOUT_MS;
    const maxBytes = options.maxBytes ?? MAX_SOFTWARE_UPDATE_FEED_BYTES;
    const cache = options.cache ?? (yield* SoftwareUpdateCache.make);

    if (options.disabled) return unavailableState(sourceUrl, "feed_disabled");

    // Drizzle's Effect client returns an Effect in production, while the
    // in-memory database used by the unit tests exposes the same builder as an
    // iterator. Wrapping it in a generator supports both and keeps the DB
    // failure handling in the Effect channel.
    const rows = yield* Effect.gen(function* () {
      const result = yield* options.db
        .select()
        .from(options.schema.softwareUpdateFeed)
        .where(eq(options.schema.softwareUpdateFeed.id, SOFA_MACOS_FEED_ID))
        .limit(1);

      return result as Array<FeedRow>;
    }).pipe(Effect.catch(() => Effect.succeed<FeedRow[] | null>(null)));

    if (rows === null) return unavailableState(sourceUrl, "database_error");

    const stored = rows[0];

    const row: FeedRow | undefined = stored
      ? {
          payload:
            stored.payload == null
              ? null
              : Option.getOrNull(Schema.decodeUnknownOption(Schema.Json)(stored.payload)),
          sourceUrl: stored.sourceUrl,
          fetchedAt: stored.fetchedAt,
          checkedAt: stored.checkedAt,
          lastError: stored.lastError,
        }
      : undefined;

    const catalog = row?.payload == null ? null : decodeStoredCatalog(row.payload);
    const fetchedAt = parseDate(row?.fetchedAt ?? null);
    const checkedAt = parseDate(row?.checkedAt ?? null);
    const lastError = row?.lastError ?? null;
    const age = fetchedAt ? now.getTime() - fetchedAt.getTime() : Number.POSITIVE_INFINITY;
    const sinceAttempt = checkedAt ? now.getTime() - checkedAt.getTime() : Number.POSITIVE_INFINITY;

    // A cache entry only satisfies this request when it came from the same
    // feed URL. Changing SOFA_FEED_URL must not keep serving the old mirror for
    // the remainder of its TTL.
    if (catalog && row?.sourceUrl === sourceUrl && age >= 0 && age < cacheTtlMs)
      return {
        catalog,
        sourceUrl,
        available: true,
        stale: false,
        fetchedAt: iso(fetchedAt),
        error: null,
      };

    // A recent failure suppresses another attempt. Serve the last good catalog
    // if there is one; otherwise every macOS status stays unknown.
    if (lastError && sinceAttempt >= 0 && sinceAttempt < retryAfterFailureMs)
      return unavailableState(sourceUrl, lastError, catalog, catalog !== null, iso(fetchedAt));

    const memoryFailure = (yield* Ref.get(cache.failures)).get(key);

    if (
      memoryFailure &&
      now.getTime() - memoryFailure.at >= 0 &&
      now.getTime() - memoryFailure.at < retryAfterFailureMs
    )
      return unavailableState(
        sourceUrl,
        memoryFailure.error,
        catalog,
        catalog !== null,
        iso(fetchedAt),
      );

    // A caller that supplies no client is explicitly offline (for example the
    // in-process service used by unit tests). Never reach the network by
    // accident: serve the last catalog as stale or report unknown.
    if (!options.httpClient)
      return unavailableState(
        sourceUrl,
        "feed_unavailable",
        catalog,
        catalog !== null,
        iso(fetchedAt),
      );

    /**
     * Persist a failure without touching the last good payload. The insert
     * path is safe on an empty table; the update fallback handles the case
     * where the row exists but the insert's duplicate-key branch failed.
     */
    const persistFailure = (failureSourceUrl: string, failure: string) =>
      Effect.gen(function* () {
        yield* options.db
          .insert(options.schema.softwareUpdateFeed)
          .values({
            id: SOFA_MACOS_FEED_ID,
            sourceUrl: failureSourceUrl,
            payload: null,
            fetchedAt: null,
            checkedAt: now,
            lastError: failure.slice(0, 64),
          })
          .onDuplicateKeyUpdate({
            set: {
              sourceUrl: failureSourceUrl,
              checkedAt: now,
              lastError: failure.slice(0, 64),
            },
          });
      }).pipe(
        Effect.catch(() =>
          Effect.gen(function* () {
            yield* options.db
              .update(options.schema.softwareUpdateFeed)
              .set({ checkedAt: now, lastError: failure.slice(0, 64) })
              .where(eq(options.schema.softwareUpdateFeed.id, SOFA_MACOS_FEED_ID));
          }).pipe(Effect.catch(() => Effect.void)),
        ),
      );

    const result = yield* cache.refresh(
      key,
      fetchFeed(options.httpClient, sourceUrl, timeoutMs, maxBytes),
    );

    if (!result.ok) {
      yield* Ref.update(cache.failures, (current) =>
        new Map(current).set(key, {
          at: now.getTime(),
          error: result.error,
        }),
      );

      // Preserve the source URL of an existing row on failure. An operator who
      // switched mirrors should not lose the provenance of the cached payload
      // just because the new URL was unavailable.
      yield* persistFailure(row?.sourceUrl ?? sourceUrl, result.error);

      return unavailableState(sourceUrl, result.error, catalog, catalog !== null, iso(fetchedAt));
    }

    const written = yield* Effect.gen(function* () {
      yield* options.db
        .insert(options.schema.softwareUpdateFeed)
        .values({
          id: SOFA_MACOS_FEED_ID,
          sourceUrl,
          payload: result.catalog,
          fetchedAt: now,
          checkedAt: now,
          lastError: null,
        })
        .onDuplicateKeyUpdate({
          set: {
            sourceUrl,
            payload: result.catalog,
            fetchedAt: now,
            checkedAt: now,
            lastError: null,
          },
        });
    }).pipe(
      Effect.match({
        onFailure: () => false,
        onSuccess: () => true,
      }),
    );

    if (!written) {
      // The fetch succeeded but the cache write did not. Remember it so the
      // next request in this layer does not immediately fetch again while
      // the database is unhealthy.
      yield* Ref.update(cache.failures, (current) =>
        new Map(current).set(key, {
          at: now.getTime(),
          error: "cache_write_failed",
        }),
      );

      yield* persistFailure(row?.sourceUrl ?? sourceUrl, "cache_write_failed");

      return {
        catalog: result.catalog,
        sourceUrl,
        available: true,
        stale: false,
        fetchedAt: iso(now),
        error: "cache_write_failed",
      };
    }

    yield* Ref.update(cache.failures, (current) => {
      const next = new Map(current);
      next.delete(key);

      return next;
    });

    return {
      catalog: result.catalog,
      sourceUrl,
      available: true,
      stale: false,
      fetchedAt: iso(now),
      error: null,
    };
  }).pipe(Effect.catch(() => Effect.succeed(unavailableState(configuredUrl, "unexpected_error"))));

  // SAFETY: every database and network failure is caught above, and the Db
  // service is already resolved by the caller's layer. The requirement channel
  // inferred from the Drizzle Effect client is therefore never at runtime;
  // this annotation keeps it out of every API handler's error type.
  return load as Effect.Effect<SoftwareUpdateCatalogState>;
};
