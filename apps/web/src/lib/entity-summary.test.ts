// @vitest-environment happy-dom
import { QueryClient, QueryObserver } from "@tanstack/solid-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceRow, DeviceSearchRow, GroupRow } from "@mattrax/enterprise-domain/client";
import {
  cacheEntityRows,
  enterpriseKeys,
  enterpriseQueries,
  entitySummaryPlaceholder,
} from "~/lib/enterprise";

const tenantId = "tenant-1";

type CapturedRequest = { readonly method: string; readonly url: string };

const transport = vi.hoisted(() => ({
  requests: [] as Array<CapturedRequest>,
  responses: [] as Array<unknown>,
}));

// Keep the real generated client and its decoders; swap only the transport
// for a fake HttpClient layer (the webHttpClientLayer seam).
vi.mock("~/lib/web-http", async () => {
  const [{ Effect, Layer }, { HttpClient, HttpClientResponse }] = await Promise.all([
    import("effect"),
    import("effect/http"),
  ]);

  return {
    webHttpClientLayer: Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => {
          transport.requests.push({ method: request.method, url: request.url });

          return HttpClientResponse.fromWeb(
            request,
            Response.json(transport.responses.shift() ?? { status: "ok" }),
          );
        }),
      ),
    ),
  };
});

const at = "2026-06-01T12:00:00.000Z";

const deviceRow = (overrides: Partial<DeviceRow> = {}): DeviceRow => ({
  id: "device-a",
  proto: "apple",
  name: "Alice's MacBook",
  model: "MacBook Pro",
  modelIdentifier: "Mac14,2",
  serial: "SERIAL-A",
  status: "enrolled",
  enrolledAt: at,
  lastSeenAt: at,
  ...overrides,
});

const groupRow = (overrides: Partial<GroupRow> = {}): GroupRow => ({
  id: "group-a",
  name: "Staff",
  kind: "manual",
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const makeClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Number.POSITIVE_INFINITY,
        retry: false,
      },
    },
  });

const deferred = <A>() => {
  let resolve!: (value: A) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<A>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
};

beforeEach(() => {
  transport.requests.length = 0;
  transport.responses.length = 0;
});

describe("entity summary cache", () => {
  it("hydrates from search rows and paints detail before the authoritative response", async () => {
    const client = makeClient();
    const row: DeviceSearchRow = {
      ...deviceRow(),
      groups: [],
      health: { level: "healthy", reasons: [], lastSeenAt: at, stale: false },
    };
    transport.responses.push({ devices: [row], total: 1 });

    await client.fetchQuery(enterpriseQueries.deviceSearch(tenantId, { q: "Alice" }));

    const detailKey = enterpriseKeys.item(tenantId, "device", row.id);
    const full = deferred<DeviceRow>();
    let detailCalls = 0;
    const queryFn = () => {
      detailCalls += 1;

      return full.promise;
    };
    const observer = new QueryObserver(client, {
      queryKey: detailKey,
      queryFn,
      placeholderData: () => entitySummaryPlaceholder(client, tenantId, "device", row.id),
      retry: false,
    });
    const unsubscribe = observer.subscribe(() => undefined);

    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.method).toBe("GET");
    expect(new URL(transport.requests[0]!.url, "https://dashboard.test").pathname).toBe(
      "/api/v1/tenants/tenant-1/devices/search",
    );
    expect(observer.getCurrentResult()).toMatchObject({
      status: "success",
      isPlaceholderData: true,
      data: row,
    });
    expect(detailCalls).toBe(1);
    // The partial row has its own query entry; it is never written as detail.
    expect(client.getQueryData(detailKey)).toBeUndefined();

    const authoritative = deviceRow({
      name: "Alice's Work MacBook",
      notes: "Loaded from the detail endpoint",
      actions: ["sync"],
    });
    full.resolve(authoritative);

    await vi.waitFor(
      () => {
        expect(observer.getCurrentResult()).toMatchObject({
          status: "success",
          isPlaceholderData: false,
          data: authoritative,
        });
      },
      { interval: 1 },
    );
    expect(client.getQueryData(detailKey)).toEqual(authoritative);
    expect(entitySummaryPlaceholder(client, tenantId, "device", row.id)).toEqual(row);

    unsubscribe();
    client.clear();
  });

  it("lets an authoritative permission failure replace the placeholder", async () => {
    const client = makeClient();
    const row = deviceRow();
    cacheEntityRows(client, tenantId, "device", [row]);

    const detailKey = enterpriseKeys.item(tenantId, "device", row.id);
    const observer = new QueryObserver(client, {
      queryKey: detailKey,
      queryFn: async () => {
        throw new Error("Forbidden");
      },
      placeholderData: () => entitySummaryPlaceholder(client, tenantId, "device", row.id),
      retry: false,
    });
    const unsubscribe = observer.subscribe(() => undefined);

    expect(observer.getCurrentResult()).toMatchObject({
      status: "success",
      isPlaceholderData: true,
      data: row,
    });

    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe("error"), {
      interval: 1,
    });
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(client.getQueryData(detailKey)).toBeUndefined();

    unsubscribe();
    client.clear();
  });

  it("normalises plain list rows into the same tenant/entity/id namespace", async () => {
    const client = makeClient();
    const row = groupRow();
    transport.responses.push({ rows: [row] });

    await client.fetchQuery(enterpriseQueries.list(tenantId, "group"));

    expect(client.getQueryData(enterpriseKeys.entitySummary(tenantId, "group", row.id))).toEqual({
      tenantId,
      entity: "group",
      id: row.id,
      row,
    });
    expect(entitySummaryPlaceholder(client, tenantId, "group", row.id)).toEqual(row);
    expect(client.getQueryData(enterpriseKeys.item(tenantId, "group", row.id))).toBeUndefined();

    client.clear();
  });

  it("keeps identical ids isolated by tenant", () => {
    const client = makeClient();
    const first = deviceRow({ name: "Tenant one" });
    const second = deviceRow({ name: "Tenant two" });

    cacheEntityRows(client, "tenant-1", "device", [first]);
    cacheEntityRows(client, "tenant-2", "device", [second]);

    expect(enterpriseKeys.entitySummary("tenant-1", "device", first.id)).not.toEqual(
      enterpriseKeys.entitySummary("tenant-2", "device", second.id),
    );
    expect(entitySummaryPlaceholder(client, "tenant-1", "device", first.id)).toEqual(first);
    expect(entitySummaryPlaceholder(client, "tenant-2", "device", second.id)).toEqual(second);
    expect(entitySummaryPlaceholder(client, "tenant-3", "device", first.id)).toBeUndefined();

    client.clear();
  });

  it("ignores invalidated summaries until a fresh row replaces them", async () => {
    const client = makeClient();
    const row = deviceRow();
    const key = enterpriseKeys.entitySummary(tenantId, "device", row.id);
    cacheEntityRows(client, tenantId, "device", [row]);

    await client.invalidateQueries({ queryKey: key });

    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(entitySummaryPlaceholder(client, tenantId, "device", row.id)).toBeUndefined();

    const fresh = deviceRow({ name: "Fresh list row" });
    cacheEntityRows(client, tenantId, "device", [fresh]);

    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    expect(entitySummaryPlaceholder(client, tenantId, "device", row.id)).toEqual(fresh);

    client.clear();
  });

  it("rejects partial rows and malformed or cross-tenant cache entries", () => {
    const client = makeClient();
    const key = enterpriseKeys.entitySummary(tenantId, "device", "device-a");

    cacheEntityRows(client, tenantId, "device", [
      { id: "device-a", name: "Missing required device fields" },
      { ...deviceRow(), id: "" },
    ]);

    expect(client.getQueryData(key)).toBeUndefined();
    expect(
      client.getQueryData(enterpriseKeys.item(tenantId, "device", "device-a")),
    ).toBeUndefined();

    client.setQueryData(key, {
      tenantId: "tenant-2",
      entity: "device",
      id: "device-a",
      row: deviceRow(),
    });
    expect(entitySummaryPlaceholder(client, tenantId, "device", "device-a")).toBeUndefined();

    client.setQueryData(key, {
      tenantId,
      entity: "device",
      id: "device-a",
      row: { id: "device-a", name: "Still partial" },
    });
    expect(entitySummaryPlaceholder(client, tenantId, "device", "device-a")).toBeUndefined();

    client.clear();
  });
});
