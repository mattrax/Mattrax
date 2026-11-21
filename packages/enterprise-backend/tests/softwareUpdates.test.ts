import type { Schema } from "effect";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { deriveSoftwareUpdate, parseSofaFeed } from "@mattrax/enterprise-domain";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { loadSoftwareUpdateCatalog, SOFA_MACOS_FEED_ID } from "../src/Device/softwareUpdates.ts";
import type { LoadSoftwareUpdateCatalogOptions } from "../src/Device/softwareUpdates.ts";
import { createEnterpriseSchema } from "../src/schema.ts";
import { runEffect } from "./helpers.js";

const schema = createEnterpriseSchema();

type FeedDbRow = {
  id: string;
  sourceUrl: string;
  payload: Schema.Json | null;
  fetchedAt: Date | null;
  checkedAt: Date;
  lastError: string | null;
};

type FeedDbOptions = {
  readonly row?: Partial<FeedDbRow> | null;
  readonly failRead?: boolean;
  readonly failWrite?: boolean;
};

/**
 * A one-table stub with MySQL `ON DUPLICATE KEY UPDATE` replace semantics.
 *
 * The shared test helper appends every insert, which would make a cached-feed
 * test observe stale duplicate rows instead of the row the loader updated.
 */
const makeFeedDb = (options: FeedDbOptions = {}) => {
  const rows: FeedDbRow[] = options.row
    ? [
        {
          id: SOFA_MACOS_FEED_ID,
          sourceUrl: "https://old.example.test/feed.json",
          payload: null,
          fetchedAt: null,
          checkedAt: new Date(0),
          lastError: null,
          ...options.row,
        },
      ]
    : [];

  const failure = () => Effect.fail(new Error("database unavailable"));

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => (options.failRead ? failure() : Effect.succeed([...rows])),
        }),
      }),
    }),
    insert: () => ({
      values: (value: FeedDbRow) => ({
        onDuplicateKeyUpdate: ({ set }: { set: Partial<FeedDbRow> }) => {
          if (options.failWrite) return failure();

          const existing = rows.find((row) => row.id === value.id);

          if (existing) Object.assign(existing, set);
          else rows.push({ ...value });

          return Effect.void;
        },
      }),
    }),
    update: () => ({
      set: (patch: Partial<FeedDbRow>) => ({
        where: () => {
          if (options.failWrite) return failure();

          const existing = rows[0];

          if (existing) Object.assign(existing, patch);

          return Effect.succeed({ affectedRows: existing ? 1 : 0 });
        },
      }),
    }),
  };

  // SAFETY: the loader only calls select/insert/update with the shapes above;
  // the cast avoids implementing the rest of Drizzle's client surface.
  return { db: db as EnterpriseDb, rows };
};

const feedBody = (version = "26.7.3") => ({
  UpdateHash: `hash-${version}`,
  OSVersions: [
    {
      OSVersion: "Tahoe 26",
      Latest: {
        ProductVersion: version,
        ReleaseDate: "2026-11-09T00:00:00Z",
        SecurityInfo: "https://support.apple.com/en-us/149718",
        ActivelyExploitedCVEs: [],
      },
      SecurityReleases: [],
    },
  ],
});

const catalog = (version = "26.7.3") => {
  const parsed = parseSofaFeed(feedBody(version));

  if (!parsed) throw new Error("fixture did not parse");

  return parsed;
};

const jsonResponse = (body: Schema.Json, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const now = new Date("2026-11-20T12:00:00Z");

let feedCounter = 0;

const feedUrl = () => `https://feed.example.test/${++feedCounter}.json`;

const optionsFor = (
  db: EnterpriseDb,
  fetchImpl: typeof globalThis.fetch | undefined,
  overrides: Partial<LoadSoftwareUpdateCatalogOptions> = {},
): LoadSoftwareUpdateCatalogOptions => ({
  db,
  schema,
  feedUrl: feedUrl(),
  fetch: fetchImpl,
  now,
  cacheTtlMs: 60_000,
  retryAfterFailureMs: 60_000,
  timeoutMs: 50,
  maxBytes: 1_024,
  ...overrides,
});

const countingFetch = (respond: () => Response | Promise<Response>) => {
  let calls = 0;

  const fetchImpl = (async () => {
    calls++;

    return respond();
  }) satisfies typeof globalThis.fetch;

  return { fetchImpl, calls: () => calls };
};

describe("software update feed cache", () => {
  it("serves a fresh row from the configured URL without fetching", async () => {
    const configured = feedUrl();

    const { db } = makeFeedDb({
      row: {
        sourceUrl: configured,
        payload: catalog(),
        fetchedAt: now,
        checkedAt: now,
      },
    });

    const fetch = countingFetch(() => jsonResponse(feedBody()));

    const state = await runEffect(
      loadSoftwareUpdateCatalog(optionsFor(db, fetch.fetchImpl, { feedUrl: configured })),
    );

    expect(state.available).toBe(true);
    expect(state.stale).toBe(false);
    expect(fetch.calls()).toBe(0);
  });

  it("times out without throwing", async () => {
    const { db, rows } = makeFeedDb();

    const fetchImpl = ((_: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;

      return new Promise<Response>((_, reject) => {
        const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));

        if (!signal) {
          reject(new Error("missing abort signal"));
          return;
        }

        if (signal.aborted) {
          abort();
          return;
        }

        signal.addEventListener("abort", abort, { once: true });
      });
    }) satisfies typeof globalThis.fetch;

    const state = await runEffect(
      loadSoftwareUpdateCatalog(optionsFor(db, fetchImpl, { timeoutMs: 10 })),
    );

    expect(state.error).toBe("timeout");
    expect(state.available).toBe(false);
    expect(rows[0]?.lastError).toBe("timeout");
  });

  it("serves the last good catalog as stale on a non-2xx response", async () => {
    const configured = feedUrl();

    const oldCatalog = catalog("26.7.2");

    const { db, rows } = makeFeedDb({
      row: {
        sourceUrl: configured,
        payload: oldCatalog,
        fetchedAt: new Date(now.getTime() - 120_000),
        checkedAt: new Date(now.getTime() - 120_000),
      },
    });

    const fetch = countingFetch(() => jsonResponse({ error: "down" }, 503));

    const state = await runEffect(
      loadSoftwareUpdateCatalog(optionsFor(db, fetch.fetchImpl, { feedUrl: configured })),
    );

    expect(state.available).toBe(true);
    expect(state.stale).toBe(true);
    expect(state.catalog?.majors[0]?.latest.version).toBe("26.7.2");
    expect(state.error).toBe("http_503");
    expect(rows[0]?.lastError).toBe("http_503");
  });

  it("suppresses a second refresh inside the failure cooldown", async () => {
    const configured = feedUrl();

    const { db } = makeFeedDb({
      row: {
        sourceUrl: configured,
        payload: catalog(),
        fetchedAt: new Date(now.getTime() - 120_000),
        checkedAt: new Date(now.getTime() - 120_000),
      },
    });

    const fetch = countingFetch(() => jsonResponse({ error: "down" }, 503));

    const options = optionsFor(db, fetch.fetchImpl, { feedUrl: configured });

    const first = await runEffect(loadSoftwareUpdateCatalog(options));

    const second = await runEffect(
      loadSoftwareUpdateCatalog({
        ...options,
        now: new Date(now.getTime() + 1_000),
      }),
    );

    expect(first.error).toBe("http_503");
    expect(second.error).toBe("http_503");
    expect(fetch.calls()).toBe(1);
  });

  it("shares one refresh between parallel loads", async () => {
    const configured = feedUrl();

    const { db } = makeFeedDb({
      row: {
        sourceUrl: configured,
        payload: catalog(),
        fetchedAt: new Date(now.getTime() - 120_000),
        checkedAt: new Date(now.getTime() - 120_000),
      },
    });

    const fetch = countingFetch(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });

      return jsonResponse(feedBody("26.7.3"));
    });

    const options = optionsFor(db, fetch.fetchImpl, { feedUrl: configured });

    const [first, second] = await runEffect(
      Effect.all([loadSoftwareUpdateCatalog(options), loadSoftwareUpdateCatalog(options)], {
        concurrency: "unbounded",
      }),
    );

    expect(first.available).toBe(true);
    expect(second.available).toBe(true);
    expect(fetch.calls()).toBe(1);
  });

  it("never fetches when the feed is disabled", async () => {
    const { db } = makeFeedDb();

    const fetch = countingFetch(() => jsonResponse(feedBody()));

    const state = await runEffect(
      loadSoftwareUpdateCatalog(optionsFor(db, fetch.fetchImpl, { disabled: true })),
    );

    expect(state.error).toBe("feed_disabled");
    expect(state.available).toBe(false);
    expect(fetch.calls()).toBe(0);
  });

  it("reports invalid JSON and an invalid feed without a catalog", async () => {
    const invalidJson = countingFetch(() => new Response("not-json", { status: 200 }));

    const first = await runEffect(
      loadSoftwareUpdateCatalog(optionsFor(makeFeedDb().db, invalidJson.fetchImpl)),
    );

    expect(first.error).toBe("invalid_json");
    expect(first.catalog).toBeNull();

    const invalidFeed = countingFetch(() => jsonResponse({}));

    const second = await runEffect(
      loadSoftwareUpdateCatalog(optionsFor(makeFeedDb().db, invalidFeed.fetchImpl)),
    );

    expect(second.error).toBe("invalid_feed");
    expect(second.catalog).toBeNull();
  });

  it("returns database_error without fetching when the read fails", async () => {
    const { db } = makeFeedDb({ failRead: true });

    const fetch = countingFetch(() => jsonResponse(feedBody()));

    const state = await runEffect(loadSoftwareUpdateCatalog(optionsFor(db, fetch.fetchImpl)));

    expect(state.error).toBe("database_error");
    expect(state.available).toBe(false);
    expect(fetch.calls()).toBe(0);
  });

  it("cancels a never-ending body once the byte cap is crossed", async () => {
    const { db } = makeFeedDb();
    let pulls = 0;
    let cancelled = false;

    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(128));
      },
      cancel() {
        cancelled = true;
      },
    });

    const fetch = countingFetch(
      () => new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
    );

    const state = await runEffect(
      loadSoftwareUpdateCatalog(optionsFor(db, fetch.fetchImpl, { maxBytes: 64 })),
    );

    expect(state.error).toBe("payload_too_large");
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(5);
  });

  it("keeps an uncached macOS device unknown, never up to date", async () => {
    const { db } = makeFeedDb();

    const fetch = countingFetch(() => jsonResponse({}));

    const state = await runEffect(loadSoftwareUpdateCatalog(optionsFor(db, fetch.fetchImpl)));

    const info = deriveSoftwareUpdate(
      { proto: "apple", osEdition: "macOS", osVersion: "15.8.3" },
      state.catalog,
    );

    expect(state.catalog).toBeNull();
    expect(info.status).toBe("unknown");
    expect(info.code).toBe("feed_unavailable");
  });

  it("refreshes when the cached row came from a different feed URL", async () => {
    const configured = feedUrl();

    const { db, rows } = makeFeedDb({
      row: {
        sourceUrl: "https://old.example.test/feed.json",
        payload: catalog("15.8.3"),
        fetchedAt: now,
        checkedAt: now,
      },
    });

    const fetch = countingFetch(() => jsonResponse(feedBody("26.7.3")));

    const state = await runEffect(
      loadSoftwareUpdateCatalog(optionsFor(db, fetch.fetchImpl, { feedUrl: configured })),
    );

    expect(fetch.calls()).toBe(1);
    expect(state.sourceUrl).toBe(configured);
    expect(state.catalog?.majors[0]?.latest.version).toBe("26.7.3");
    expect(rows[0]?.sourceUrl).toBe(configured);
  });

  it("preserves the previous source URL when a changed feed fails", async () => {
    const configured = feedUrl();
    const oldSource = "https://old.example.test/feed.json";

    const { db, rows } = makeFeedDb({
      row: {
        sourceUrl: oldSource,
        payload: catalog("15.8.3"),
        fetchedAt: now,
        checkedAt: now,
      },
    });

    const fetch = countingFetch(() => jsonResponse({ error: "down" }, 500));

    const state = await runEffect(
      loadSoftwareUpdateCatalog(optionsFor(db, fetch.fetchImpl, { feedUrl: configured })),
    );

    expect(state.sourceUrl).toBe(configured);
    expect(state.stale).toBe(true);
    expect(rows[0]?.sourceUrl).toBe(oldSource);
    expect(rows[0]?.lastError).toBe("http_500");
  });

  it("remembers a failed cache write so the next request does not refetch", async () => {
    const { db } = makeFeedDb({ failWrite: true });

    const fetch = countingFetch(() => jsonResponse(feedBody()));

    const options = optionsFor(db, fetch.fetchImpl);

    const first = await runEffect(loadSoftwareUpdateCatalog(options));

    const second = await runEffect(
      loadSoftwareUpdateCatalog({
        ...options,
        now: new Date(now.getTime() + 1_000),
      }),
    );

    expect(first.available).toBe(true);
    expect(first.error).toBe("cache_write_failed");
    expect(second.available).toBe(false);
    expect(second.error).toBe("cache_write_failed");
    expect(fetch.calls()).toBe(1);
  });
});
