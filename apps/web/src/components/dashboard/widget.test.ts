// @vitest-environment happy-dom
import { createComponent, flush } from "solid-js";
import { render } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { Option } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dashboardQueryForWidget } from "@mattrax/enterprise-domain/client";
import type {
  DashboardQueryBatchResponse,
  DashboardQueryRequest,
  DashboardWidget,
} from "@mattrax/enterprise-domain/client";
import { asFake, recorder } from "../../../../../packages/config/testing/recorder.ts";
import {
  createDashboardWidgetConfigResolver,
  DashboardWidgetBatchProvider,
  DashboardWidgetServicesProvider,
  DashboardWidgetView,
  dashboardPreviewQueryRequest,
  dashboardWidgetQueryRequest,
  dashboardWidgetRequestChunks,
  useDashboardWidgetBatch,
} from "./widget";
import type { DashboardWidgetServices } from "./widget";

type CapturedQuery = {
  queryKey: readonly [
    "enterprise",
    "dashboard-query-batch",
    string,
    ReadonlyArray<DashboardQueryRequest>,
  ];
  queryFn: () => Promise<DashboardQueryBatchResponse>;
};

let queriesOptions: (() => { queries: CapturedQuery[] }) | undefined;
const cleanups: Array<() => void> = [];

/** Fakes supplied through the widget's injectable query seams. */
const useQueries = recorder((options: () => { queries: CapturedQuery[] }) => {
  queriesOptions = options;

  return [];
});

const useQuery = recorder(() => ({
  data: undefined,
  isSuccess: false,
  isPending: true,
  error: undefined,
  refetch: recorder(),
}));

const queryDashboard = recorder(async (_tenantId: string, _request: DashboardQueryRequest) => ({
  total: 0,
  rows: [],
  buckets: [],
}));

const queryDashboardBatch = recorder(
  async (_tenantId: string, _requests: ReadonlyArray<DashboardQueryRequest>) => ({ results: [] }),
);

const services: DashboardWidgetServices = {
  useQueries: asFake<DashboardWidgetServices["useQueries"]>(useQueries),
  useQuery: asFake<DashboardWidgetServices["useQuery"]>(useQuery),
  queryDashboard,
  queryDashboardBatch,
};

const withServices = (child: () => JSX.Element) =>
  createComponent(DashboardWidgetServicesProvider, {
    value: services,
    get children() {
      return child();
    },
  });

const renderHtml = (view: () => JSX.Element) => {
  const container = document.createElement("div");

  document.body.append(container);
  cleanups.push(render(view, container));
  flush();

  return { html: container.innerHTML, text: container.textContent ?? "" };
};

const COLUMNS = [
  "name",
  "platform",
  "osVersion",
  "status",
  "health",
  "lastSeenAt",
  "enrolledAt",
  "model",
  "serial",
];

const countedConfig = () => {
  const accesses = { dataset: 0, columns: 0, limit: 0 };
  const config = {
    get dataset() {
      accesses.dataset += 1;

      return "devices";
    },
    get columns() {
      accesses.columns += 1;

      return COLUMNS;
    },
    get limit() {
      accesses.limit += 1;

      return 200;
    },
  };

  return { config, accesses };
};

const widget = (overrides: Partial<DashboardWidget> = {}): DashboardWidget => ({
  id: "widget-1",
  type: "table",
  title: "Devices",
  config: {
    dataset: "devices",
    query: { all: [] },
    columns: COLUMNS,
    limit: 200,
  },
  x: 0,
  y: 0,
  w: 12,
  h: 4,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const rows = Array.from({ length: 200 }, (_, index) => ({
  id: `device-${index}`,
  name: `Device ${index}`,
  platform: "apple",
  osVersion: "15.1",
  status: "active",
  health: "healthy",
  lastSeenAt: "2026-01-01T00:00:00.000Z",
  enrolledAt: "2026-01-01T00:00:00.000Z",
  model: "MacBook Pro",
  serial: `SERIAL-${index}`,
}));

const batch = {
  data: { total: 200, rows, buckets: [] },
  pending: false,
  error: undefined,
  retry: recorder(),
};

function ModeConsumer(props: { preview?: boolean }) {
  useDashboardWidgetBatch({ preview: props.preview });

  return document.createElement("span");
}

function FullWidgetConsumer(props: { widget: DashboardWidget; tenantId: string }) {
  const batchFor = useDashboardWidgetBatch();

  return createComponent(DashboardWidgetView, {
    widget: props.widget,
    tenantId: props.tenantId,
    batch: batchFor?.(props.widget),
  });
}

const renderProvider = (widgets: ReadonlyArray<DashboardWidget>, preview: boolean) =>
  renderHtml(() =>
    withServices(() =>
      createComponent(DashboardWidgetBatchProvider, {
        widgets,
        tenantId: "tenant-1",
        get children() {
          return createComponent(ModeConsumer, { preview });
        },
      }),
    ),
  );

const capturedRequests = () => {
  const options = queriesOptions?.();

  if (!options) throw new Error("Expected useQueries options to be captured");

  return options.queries.map((query) => query.queryKey[3]);
};

beforeEach(() => {
  queriesOptions = undefined;
  useQueries.mockClear();
  useQuery.mockClear();
  queryDashboard.mockClear();
  queryDashboardBatch.mockClear();
  queryDashboard.mockResolvedValue({ total: 0, rows: [], buckets: [] });
  queryDashboardBatch.mockResolvedValue({ results: [] });
});

afterEach(() => {
  for (const dispose of cleanups.splice(0).reverse()) dispose();

  document.body.replaceChildren();
});

describe("dashboard widget config decoding", () => {
  it("decodes an immutable config once and decodes a new version again", () => {
    const decode = recorder((_config: unknown) => Option.some({}));
    const resolve = createDashboardWidgetConfigResolver(decode);
    const first = { limit: 200 };
    const second = { limit: 100 };

    expect(resolve(first)).toBe(resolve(first));
    expect(decode).toHaveBeenCalledTimes(1);

    resolve(second);

    expect(decode).toHaveBeenCalledTimes(2);
  });

  it("decodes once for a 200-row, nine-column table with no per-cell decode", () => {
    const probe = countedConfig();

    dashboardWidgetQueryRequest(widget({ config: probe.config }));

    expect(Object.values(probe.accesses).every((count) => count > 0)).toBe(true);

    const { config, accesses } = countedConfig();
    const { html, text } = renderHtml(() =>
      withServices(() =>
        createComponent(DashboardWidgetView, {
          widget: widget({ config }),
          tenantId: "tenant-1",
          batch,
        }),
      ),
    );

    expect(html.match(/<td/g)).toHaveLength(1_800);
    expect(html).toContain('scope="col"');
    expect(html).toContain("Devices matching this widget");
    expect(text).toContain("200 of 200 rows");
    expect(accesses).toEqual(probe.accesses);
  });

  it("shares one decode between the batch provider and its widget view", () => {
    const probe = countedConfig();

    dashboardWidgetQueryRequest(widget({ config: probe.config }));

    const { config, accesses } = countedConfig();
    const device = widget({ config });

    renderHtml(() =>
      withServices(() =>
        createComponent(DashboardWidgetBatchProvider, {
          widgets: [device],
          tenantId: "tenant-1",
          get children() {
            return createComponent(FullWidgetConsumer, {
              widget: device,
              tenantId: "tenant-1",
            });
          },
        }),
      ),
    );

    expect(accesses).toEqual(probe.accesses);
  });
});

describe("dashboard widget query requests", () => {
  it.each([
    { dataset: "devices", query: { all: [] }, limit: 200 },
    {
      dataset: "software",
      query: { any: [{ field: "status", op: "eq", value: "active" }] },
      limit: 25,
    },
    { dataset: "users", userFilter: { status: "active", source: "entra" }, limit: 10 },
    { dataset: "devices", dimension: "platform", limit: 50 },
    {},
  ])("keeps full-dashboard request semantics for $dataset", (config) => {
    const device = widget({ config });

    expect(dashboardWidgetQueryRequest(device)).toEqual(dashboardQueryForWidget(device));
  });

  it("clamps preview rows without mutating the full request or dropping count-only stats", () => {
    const request: DashboardQueryRequest = {
      dataset: "devices",
      query: { all: [] },
      userFilter: undefined,
      groupBy: undefined,
      limit: 200,
      countOnly: true,
    };

    const preview = dashboardPreviewQueryRequest(request);

    expect(preview).toEqual({ ...request, limit: 3 });
    expect(preview).not.toBe(request);
    expect(request.limit).toBe(200);
    expect(preview.countOnly).toBe(true);
  });
});

describe("dashboard widget batch modes", () => {
  it("activates only three-row queries for gallery preview consumers", () => {
    const devices = [
      widget({ id: "table", config: { dataset: "devices", limit: 200 } }),
      widget({ id: "stat", type: "stat", config: { dataset: "devices", limit: 50 } }),
      widget({ id: "note", type: "markdown", config: { markdown: "# Note" } }),
    ];

    renderProvider(devices, true);

    expect(capturedRequests()).toEqual([
      [
        expect.objectContaining({ limit: 3, countOnly: false }),
        expect.objectContaining({ limit: 3, countOnly: true }),
      ],
    ]);
  });

  it("activates only existing-limit queries for full-dashboard consumers", () => {
    const devices = [
      widget({ id: "table", config: { dataset: "devices", limit: 200 } }),
      widget({ id: "default", config: { dataset: "software" } }),
      widget({ id: "stat", type: "stat", config: { dataset: "devices", limit: 50 } }),
    ];

    renderProvider(devices, false);

    expect(capturedRequests()).toEqual([
      [
        expect.objectContaining({ limit: 200, countOnly: false }),
        expect.objectContaining({ limit: undefined, countOnly: false }),
        expect.objectContaining({ limit: 50, countOnly: true }),
      ],
    ]);
  });
});

describe("dashboard widget request chunks", () => {
  it("clamps every preview row request to three while preserving count-only stats", () => {
    const devices = [
      widget({ id: "table", config: { dataset: "devices", limit: 200 } }),
      widget({ id: "default", config: { dataset: "software" } }),
      widget({ id: "stat", type: "stat", config: { dataset: "devices", limit: 50 } }),
      widget({ id: "note", type: "markdown", config: { markdown: "# Note" } }),
    ];
    const requests = devices.flatMap((device) =>
      device.type === "markdown" ? [] : [dashboardWidgetQueryRequest(device)],
    );

    expect(dashboardWidgetRequestChunks(requests, { preview: true })).toEqual([
      [
        expect.objectContaining({ limit: 3, countOnly: false }),
        expect.objectContaining({ limit: 3, countOnly: false }),
        expect.objectContaining({ limit: 3, countOnly: true }),
      ],
    ]);
  });

  it("keeps configured and default limits for full dashboards", () => {
    const devices = [
      widget({ id: "table", config: { dataset: "devices", limit: 200 } }),
      widget({ id: "default", config: { dataset: "software" } }),
      widget({ id: "stat", type: "stat", config: { dataset: "devices", limit: 50 } }),
    ];
    const requests = devices.map(dashboardWidgetQueryRequest);

    expect(dashboardWidgetRequestChunks(requests)).toEqual([
      [
        expect.objectContaining({ limit: 200, countOnly: false }),
        expect.objectContaining({ limit: undefined, countOnly: false }),
        expect.objectContaining({ limit: 50, countOnly: true }),
      ],
    ]);
  });

  it("preserves 24-query batching in both modes", () => {
    const devices = Array.from({ length: 25 }, (_, index) =>
      widget({ id: `widget-${index}`, config: { dataset: "devices", limit: 200 } }),
    );
    const requests = devices.map(dashboardWidgetQueryRequest);
    const preview = dashboardWidgetRequestChunks(requests, { preview: true });
    const full = dashboardWidgetRequestChunks(requests);

    expect(preview.map((chunk) => chunk.length)).toEqual([24, 1]);
    expect(preview.flat().every((request) => request.limit === 3)).toBe(true);
    expect(full.map((chunk) => chunk.length)).toEqual([24, 1]);
    expect(full.flat().every((request) => request.limit === 200)).toBe(true);
  });
});
