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
 * date". A failed refresh is remembered both in the database and in this
 * isolate, so a database write failure cannot turn every dashboard request
 * into another five-second timeout.
 */

import { Effect, Option, Schema } from "effect";
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
  readonly fetch?: typeof globalThis.fetch;
  /** Injectable clock so cache/cooldown boundaries are testable. */
  readonly now?: Date;
};

type FetchResult =
  | { readonly ok: true; readonly catalog: MacOsUpdateCatalog }
  | { readonly ok: false; readonly error: string };

/**
 * One in-flight refresh per feed URL in this isolate. Concurrent dashboard or
 * device-list requests that all see an expired cache share this promise instead
 * of each starting a fetch.
 */
const inFlightFetches = new Map<string, Promise<FetchResult>>();

/**
 * In-isolate failure memory. The database row is the shared cooldown, but a
 * database write can fail at exactly the wrong moment; without this map every
 * subsequent request would retry the feed and block on its timeout again.
 */
const failureCooldowns = new Map<string, { readonly at: number; readonly error: string }>();

const feedKey = (sourceUrl: string) => `${SOFA_MACOS_FEED_ID}:${sourceUrl}`;

const fetchOnce = (key: string, run: () => Promise<FetchResult>): Promise<FetchResult> => {
  const existing = inFlightFetches.get(key);

  if (existing) return existing;

  const promise = run().finally(() => {
    if (inFlightFetches.get(key) === promise) inFlightFetches.delete(key);
  });

  inFlightFetches.set(key, promise);

  return promise;
};

const classifyFetchFailure = (cause: unknown): string => {
  if (cause instanceof Error && (cause.name === "AbortError" || cause.name === "TimeoutError"))
    return "timeout";

  return "fetch_failed";
};

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

/**
 * Read a response body with a hard byte cap.
 *
 * `response.text()` materialises the whole body before the caller can check
 * its size, so a chunked or hostile mirror could exhaust the Worker's memory
 * before the length check runs. Reading the stream lets us cancel as soon as
 * the cap is crossed. The caller still uses the `content-length` header as a
 * cheap fast path when the server provides it.
 */
const readBodyWithLimit = async (response: Response, maxBytes: number): Promise<BodyReadResult> => {
  if (!response.body) return { ok: false, error: "read_failed" };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      if (!value) continue;

      total += value.byteLength;

      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);

        return { ok: false, error: "payload_too_large" };
      }

      chunks.push(value);
    }
  } catch {
    return { ok: false, error: "read_failed" };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A cancelled reader may already have released its lock.
    }
  }

  return { ok: true, body: new TextDecoder().decode(joinChunks(chunks, total)) };
};

const fetchFeed = async (
  url: string,
  fetcher: typeof globalThis.fetch,
  timeoutMs: number,
  maxBytes: number,
): Promise<FetchResult> => {
  let response: Response;

  try {
    response = await fetcher(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    return { ok: false, error: classifyFetchFailure(cause) };
  }

  if (!response.ok) {
    const status = Math.trunc(response.status);

    return {
      ok: false,
      error: Number.isFinite(status) && status > 0 ? `http_${status}` : "http_error",
    };
  }

  const declared = Number(response.headers.get("content-length") ?? "");

  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);

    return { ok: false, error: "payload_too_large" };
  }

  const read = await readBodyWithLimit(response, maxBytes);

  if (!read.ok) return read;

  let json: Schema.Json | null = null;

  try {
    json = Option.getOrNull(Schema.decodeUnknownOption(Schema.Json)(JSON.parse(read.body)));
  } catch {
    return { ok: false, error: "invalid_json" };
  }

  if (json === null) return { ok: false, error: "invalid_json" };

  const catalog = parseSofaFeed(json);

  return catalog ? { ok: true, catalog } : { ok: false, error: "invalid_feed" };
};

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

    const fetcher = options.fetch;

    if (options.disabled) return unavailableState(sourceUrl, "feed_disabled");

    // Drizzle's Effect client returns an Effect in production, while the
    // in-memory database used by the unit tests exposes the same builder as an
    // iterator. Wrapping it in a generator supports both and keeps the DB
    // failure handling in the Effect channel.
    const rows = yield* Effect.gen(function* () {
      return yield* options.db
        .select()
        .from(options.schema.softwareUpdateFeed)
        .where(eq(options.schema.softwareUpdateFeed.id, SOFA_MACOS_FEED_ID))
        .limit(1);
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

    const memoryFailure = failureCooldowns.get(key);

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

    // A caller that supplies no fetch is explicitly offline (for example the
    // in-process service used by unit tests). Never reach the network by
    // accident: serve the last catalog as stale or report unknown.
    if (!fetcher)
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
        Effect.catchCause(() =>
          Effect.gen(function* () {
            yield* options.db
              .update(options.schema.softwareUpdateFeed)
              .set({ checkedAt: now, lastError: failure.slice(0, 64) })
              .where(eq(options.schema.softwareUpdateFeed.id, SOFA_MACOS_FEED_ID));
          }).pipe(Effect.catchCause(() => Effect.void)),
        ),
      );

    const result = yield* Effect.tryPromise({
      try: () => fetchOnce(key, () => fetchFeed(sourceUrl, fetcher, timeoutMs, maxBytes)),
      catch: (cause) => classifyFetchFailure(cause),
    }).pipe(Effect.catch((error) => Effect.succeed<FetchResult>({ ok: false, error })));

    if (!result.ok) {
      failureCooldowns.set(key, { at: now.getTime(), error: result.error });

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
      // next request in this isolate does not immediately fetch again while
      // the database is unhealthy.
      failureCooldowns.set(key, { at: now.getTime(), error: "cache_write_failed" });

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

    failureCooldowns.delete(key);

    return {
      catalog: result.catalog,
      sourceUrl,
      available: true,
      stale: false,
      fetchedAt: iso(now),
      error: null,
    };
  }).pipe(
    Effect.catchCause(() => Effect.succeed(unavailableState(configuredUrl, "unexpected_error"))),
  );

  // SAFETY: every database and network failure is caught above, and the Db
  // service is already resolved by the caller's layer. The requirement channel
  // inferred from the Drizzle Effect client is therefore `never` at runtime;
  // this annotation keeps it out of every API handler's error type.
  return load as Effect.Effect<SoftwareUpdateCatalogState>;
};
