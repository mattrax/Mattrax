import type { Schema } from "effect";
import { Context, Effect, Layer } from "effect";
import {
  HttpClient,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerResponse,
} from "effect/http";
import { describe, expect, it } from "vitest";
import { schema } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import {
  SoftwareUpdateBackground,
  SoftwareUpdateCache,
  SOFA_MACOS_FEED_ID,
  loadSoftwareUpdateCatalog,
} from "@mattrax/enterprise-backend";
import type { SoftwareUpdateCatalogState } from "@mattrax/enterprise-backend";
import { softwareUpdateRequestService } from "./softwareUpdateRuntime.js";

type FeedDbRow = {
  id: string;
  sourceUrl: string;
  payload: Schema.Json | null;
  fetchedAt: Date | null;
  checkedAt: Date;
  lastError: string | null;
};

const makeFeedDb = () => {
  const rows: FeedDbRow[] = [];
  let selects = 0;

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            selects++;

            return Effect.succeed([...rows]);
          },
        }),
      }),
    }),
    insert: () => ({
      values: (value: FeedDbRow) => ({
        onDuplicateKeyUpdate: ({ set }: { set: Partial<FeedDbRow> }) => {
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
          const existing = rows[0];

          if (existing) Object.assign(existing, patch);

          return Effect.succeed({ affectedRows: existing ? 1 : 0 });
        },
      }),
    }),
  };

  // SAFETY: the loader only calls the select/insert/update shapes above.
  // oxlint-disable-next-line quality/no-chained-type-assertions -- The loader uses only the stub shapes above.
  return { db: db as unknown as EnterpriseDb, rows, selects: () => selects };
};

const feedBody = (version = "26.7.2") => ({
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

const catalogVersion = (state: SoftwareUpdateCatalogState) =>
  state.catalog?.majors[0]?.latest.version;

const jsonResponse = (body: Schema.Json) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const clientForFetch = (fetchImpl: typeof globalThis.fetch) =>
  HttpClient.make((request, url, signal) =>
    Effect.promise(() => fetchImpl(url, { signal })).pipe(
      Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
    ),
  );

const countingFetch = (respond: () => Response | Promise<Response>) => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;

    return respond();
  }) satisfies typeof globalThis.fetch;

  return { client: clientForFetch(fetchImpl), calls: () => calls };
};

let feedCounter = 0;
const feedUrl = () => `https://hosted-feed.example.test/${++feedCounter}.json`;
const request = () => new Request("https://api.example.test/software-updates");

const contextFor = (tasks: Array<Promise<unknown>>) =>
  Context.makeUnsafe(
    new Map<string, unknown>([
      [
        SoftwareUpdateBackground.key,
        softwareUpdateRequestService({
          waitUntil: (task) => tasks.push(task),
        }),
      ],
    ]),
  );

/** Rebuild the handler Layer for every request, as the hosted Worker does. */
const makeHostedHandler = (
  db: EnterpriseDb,
  client: HttpClient.HttpClient,
  now: Date,
  configuredUrl: string,
) => {
  const route = HttpRouter.add("GET", "/software-updates", () =>
    Effect.gen(function* () {
      const cache = yield* SoftwareUpdateCache;
      const state = yield* loadSoftwareUpdateCatalog({
        db,
        schema,
        feedUrl: configuredUrl,
        cache,
        now,
        cacheTtlMs: 60_000,
        retryAfterFailureMs: 60_000,
        timeoutMs: 50,
        maxBytes: 1_024,
        httpClient: client,
      });

      return yield* HttpServerResponse.json(state);
    }),
  );

  // SAFETY: the route only needs the router and request services that
  // toWebHandler supplies; the cast keeps framework request types out of the test.
  return HttpRouter.toWebHandler(
    route.pipe(
      Layer.provideMerge(SoftwareUpdateCache.layer),
      Layer.provide(HttpServer.layerServices),
    ) as never,
    { disableLogger: true },
  ).handler;
};

describe("hosted software update runtime", () => {
  it("shares one I/O-free cache across rebuilt request Layers", async () => {
    const first = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* SoftwareUpdateCache;
      }).pipe(Effect.provide(SoftwareUpdateCache.layer)),
    );
    const second = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* SoftwareUpdateCache;
      }).pipe(Effect.provide(SoftwareUpdateCache.layer)),
    );

    expect(second).toBe(first);
  });

  it("serves the second hosted request without another feed SELECT", async () => {
    const configured = feedUrl();
    const now = new Date("2026-11-20T12:00:00Z");
    const firstDb = makeFeedDb();
    const secondDb = makeFeedDb();
    const fetch = countingFetch(() => jsonResponse(feedBody()));

    const first = await makeHostedHandler(
      firstDb.db,
      fetch.client,
      now,
      configured,
    )(request(), contextFor([]));
    const second = await makeHostedHandler(
      secondDb.db,
      fetch.client,
      now,
      configured,
    )(request(), contextFor([]));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(catalogVersion((await second.json()) as SoftwareUpdateCatalogState)).toBe("26.7.2");
    expect(firstDb.selects()).toBe(1);
    expect(secondDb.selects()).toBe(0);
    expect(fetch.calls()).toBe(1);
  });

  it("keeps expired-cache revalidation alive after the second response completes", async () => {
    const configured = feedUrl();
    const now = new Date("2026-11-20T12:00:00Z");
    const expiresAt = new Date(now.getTime() + 60_000);
    const firstDb = makeFeedDb();
    const secondDb = makeFeedDb();
    const thirdDb = makeFeedDb();
    const tasks: Array<Promise<unknown>> = [];
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let calls = 0;
    let version = "26.7.2";
    const fetch = countingFetch(async () => {
      calls++;

      if (calls === 2) await refreshGate;

      return jsonResponse(feedBody(version));
    });

    await makeHostedHandler(firstDb.db, fetch.client, now, configured)(request(), contextFor([]));

    version = "26.7.3";

    const second = await makeHostedHandler(
      secondDb.db,
      fetch.client,
      expiresAt,
      configured,
    )(request(), contextFor(tasks));
    expect(second.status).toBe(200);
    const stale = (await second.json()) as SoftwareUpdateCatalogState;

    expect(stale.stale).toBe(true);
    expect(catalogVersion(stale)).toBe("26.7.2");
    expect(secondDb.selects()).toBe(0);
    expect(fetch.calls()).toBe(2);
    expect(tasks).toHaveLength(1);

    let settled = false;
    void tasks[0]!.finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseRefresh();
    await tasks[0];

    expect(secondDb.rows[0]?.sourceUrl).toBe(configured);
    expect(secondDb.rows[0]?.fetchedAt).toEqual(expiresAt);
    expect(secondDb.rows[0]?.id).toBe(SOFA_MACOS_FEED_ID);

    const third = await makeHostedHandler(
      thirdDb.db,
      fetch.client,
      new Date(expiresAt.getTime() + 1),
      configured,
    )(request(), contextFor([]));
    const fresh = (await third.json()) as SoftwareUpdateCatalogState;

    expect(fresh.stale).toBe(false);
    expect(catalogVersion(fresh)).toBe("26.7.3");
    expect(thirdDb.selects()).toBe(0);
    expect(fetch.calls()).toBe(2);
  });
});
