// @vitest-environment happy-dom
import { render } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceRow } from "@mattrax/enterprise-domain/client";
import { enterpriseKeys } from "~/lib/enterprise";
import DeviceDetailPage from "./[deviceId]";
import DevicesPage from "./index";

const api = vi.hoisted(() => ({
  getDevice: vi.fn(),
  searchDevices: vi.fn(),
  list: vi.fn(),
  deviceHandoverImpact: vi.fn(),
  listDeviceCommands: vi.fn(),
  getDeviceHealth: vi.fn(),
  getDeviceActivity: vi.fn(),
  getDeviceWindowsSecurity: vi.fn(),
  listDeviceDiagnostics: vi.fn(),
  listWindowsFailures: vi.fn(),
  listAttributes: vi.fn(),
  listDeviceAttributeCollection: vi.fn(),
  listDirectory: vi.fn(),
  getDeviceUsers: vi.fn(),
  listDeviceAppleUsers: vi.fn(),
  getAppleBusinessManager: vi.fn(),
  getAbmDevice: vi.fn(),
  getDeviceEffectivePolicy: vi.fn(),
  listDeviceApplications: vi.fn(),
  getDeviceRestrictedSoftware: vi.fn(),
  patchGroupMembers: vi.fn(),
  listScopeTags: vi.fn(),
  listScopeTagAssignments: vi.fn(),
}));

const params = vi.hoisted(() => ({ tenantId: "tenant-1", deviceId: "device-1" }));

vi.mock("@solidjs/router", () => ({
  useParams: () => params,
  useSearchParams: () => [() => ({}), vi.fn()],
  useBeforeLeave: vi.fn(),
}));

vi.mock("~/lib/navigation", () => ({ useNavigate: () => vi.fn() }));
vi.mock("~/lib/page-data", () => ({ preloadPage: vi.fn() }));
vi.mock("~/lib/query-client", () => ({ queryClient: { ensureQueryData: vi.fn() } }));
vi.mock("~/lib/permissions", () => ({
  useCan: () => ({ can: () => true, canAny: () => true, canAll: () => true }),
  ReadOnlyNotice: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
}));
vi.mock("~/lib/unsaved-changes", () => ({
  useUnsavedChanges: () => ({ prompt: null, confirm: (run: () => void) => run() }),
}));
vi.mock("~/components/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  announce: vi.fn(),
}));
vi.mock("~/components/mdm/common", () => ({
  Page: (props: { children?: JSX.Element }) => <main>{props.children}</main>,
  PageHeader: (props: { title: string; children?: JSX.Element }) => (
    <header>
      <h1>{props.title}</h1>
      {props.children}
    </header>
  ),
  PageBreadcrumbs: () => null,
  PageSkeleton: () => <div data-testid="page-skeleton">Loading device…</div>,
  SkeletonRows: () => <div data-testid="rows-skeleton" />,
  Field: (props: { label: string; children?: JSX.Element }) => (
    <label>
      {props.label}
      {props.children}
    </label>
  ),
  ErrorText: () => null,
  QueryError: () => null,
  LinkButton: (props: { href: string; children?: JSX.Element }) => (
    <a href={props.href}>{props.children}</a>
  ),
  PlatformBadge: (props: { proto: string }) => <span>{props.proto}</span>,
  PlatformMark: (props: { proto: string }) => <span>{props.proto}</span>,
  PresenceDot: () => <span />,
  DevicePresenceBadge: () => <span />,
  devicePresence: () => ({ online: false }),
  formatDeviceDate: (value: string) => value,
  formatDate: (value: string) => value,
  relativeTime: (value: string) => value,
  usePresenceNow: () => () => Date.now(),
}));
vi.mock("~/components/mdm/table", () => ({
  MdmTable: (props: {
    rows?: ReadonlyArray<{ id: string; name?: string }>;
    loading?: boolean;
    empty?: JSX.Element;
  }) => (
    <div data-testid="devices-table" data-loading={props.loading ? "true" : "false"}>
      {props.loading
        ? "Loading rows…"
        : (props.rows?.length ?? 0) > 0
          ? props.rows!.map((row) => <div>{row.name}</div>)
          : props.empty}
    </div>
  ),
}));
vi.mock("~/components/entity-hover-card", () => ({
  default: (props: { href: string; children?: JSX.Element }) => (
    <a href={props.href}>{props.children}</a>
  ),
}));
vi.mock("~/components/mdm/entity-actions", () => ({ EntityActions: () => null }));
vi.mock("~/components/dashboard/query-builder", () => ({ DeviceQueryBuilder: () => null }));
vi.mock("~/components/scope-tags/scope-tag-select", () => ({
  ScopeTagAssignmentEditor: () => <div>Scope tag assignment</div>,
}));
vi.mock("~/components/mdm/device-handover-dialog", () => ({
  DeviceHandoverDialog: () => null,
  deviceHandoverSecretSummary: (kinds: ReadonlyArray<string>) => kinds.join(", "),
}));
vi.mock("~/components/dashboard/markdown", () => ({ default: () => null }));
vi.mock("~/components/software-update-badge", () => ({ SoftwareUpdateTag: () => null }));
vi.mock("~/components/os-compliance-badge", () => ({ default: () => null }));
vi.mock("~/components/ui/dialog", () => ({
  Dialog: (props: { open?: boolean; children?: JSX.Element }) => (
    <>{props.open ? <div role="dialog">{props.children}</div> : null}</>
  ),
  DialogContent: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  DialogDescription: (props: { children?: JSX.Element }) => <p>{props.children}</p>,
  DialogFooter: (props: { children?: JSX.Element }) => <footer>{props.children}</footer>,
  DialogHeader: (props: { children?: JSX.Element }) => <header>{props.children}</header>,
  DialogTitle: (props: { children?: JSX.Element }) => <h2>{props.children}</h2>,
}));
vi.mock("~/components/ui/sheet", () => ({
  Sheet: (props: { open?: boolean; children?: JSX.Element }) => (
    <>{props.open ? <div role="dialog">{props.children}</div> : null}</>
  ),
  SheetContent: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  SheetDescription: (props: { children?: JSX.Element }) => <p>{props.children}</p>,
  SheetFooter: (props: { children?: JSX.Element }) => <footer>{props.children}</footer>,
  SheetHeader: (props: { children?: JSX.Element }) => <header>{props.children}</header>,
  SheetTitle: (props: { children?: JSX.Element }) => <h2>{props.children}</h2>,
}));
vi.mock("~/components/ui/tooltip", () => ({
  Tooltip: (props: { children?: JSX.Element }) => <>{props.children}</>,
  TooltipTrigger: (props: { children?: JSX.Element }) => <>{props.children}</>,
  TooltipContent: (props: { children?: JSX.Element }) => <>{props.children}</>,
}));

vi.mock("~/lib/enterprise", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/enterprise")>();
  const { keepPreviousData, queryOptions } = await import("@tanstack/solid-query");
  const settled = <T,>(key: readonly unknown[], data: T) =>
    queryOptions({
      queryKey: key,
      queryFn: async () => data,
      initialData: data,
      staleTime: Number.POSITIVE_INFINITY,
    });

  return {
    ...actual,
    enterprise: {
      ...actual.enterprise,
      get: api.getDevice,
      searchDevices: api.searchDevices,
      list: api.list,
      deviceHandoverImpact: api.deviceHandoverImpact,
      listDeviceCommands: api.listDeviceCommands,
      getDeviceHealth: api.getDeviceHealth,
      getDeviceActivity: api.getDeviceActivity,
      getDeviceWindowsSecurity: api.getDeviceWindowsSecurity,
      listDeviceDiagnostics: api.listDeviceDiagnostics,
      listWindowsFailures: api.listWindowsFailures,
      listAttributes: api.listAttributes,
      listDeviceAttributeCollection: api.listDeviceAttributeCollection,
      listDirectory: api.listDirectory,
      getDeviceUsers: api.getDeviceUsers,
      listDeviceAppleUsers: api.listDeviceAppleUsers,
      getAppleBusinessManager: api.getAppleBusinessManager,
      getAbmDevice: api.getAbmDevice,
      getDeviceEffectivePolicy: api.getDeviceEffectivePolicy,
      listDeviceApplications: api.listDeviceApplications,
      getDeviceRestrictedSoftware: api.getDeviceRestrictedSoftware,
      patchGroupMembers: api.patchGroupMembers,
      listScopeTags: api.listScopeTags,
      listScopeTagAssignments: api.listScopeTagAssignments,
    },
    enterpriseQueries: {
      ...actual.enterpriseQueries,
      deviceSearch: (
        tenantId: string | undefined,
        query: Parameters<typeof actual.enterpriseQueries.deviceSearch>[1] = {},
      ) =>
        queryOptions({
          queryKey: actual.enterpriseKeys.deviceSearch(tenantId, query),
          queryFn: () => api.searchDevices(tenantId, query),
          enabled: Boolean(tenantId),
          placeholderData: keepPreviousData,
        }),
      list: (
        tenantId: string | undefined,
        entity: Parameters<typeof actual.enterpriseKeys.list>[1],
      ) => settled(actual.enterpriseKeys.list(tenantId, entity), { rows: [] }),
      attributes: (tenantId: string | undefined) =>
        settled(actual.enterpriseKeys.attributes(tenantId), { rows: [] }),
      deviceUsers: (tenantId: string | undefined, deviceId: string | undefined) =>
        settled(actual.enterpriseKeys.deviceUsers(tenantId, deviceId), { users: [] }),
      directory: (tenantId: string | undefined) =>
        settled(actual.enterpriseKeys.directory(tenantId), { users: [], groups: [] }),
      deviceAppleUsers: (tenantId: string | undefined, deviceId: string | undefined) =>
        settled(actual.enterpriseKeys.deviceAppleUsers(tenantId, deviceId), {
          users: [],
          enrollmentMode: "device",
        }),
      deviceWindowsFailures: (tenantId: string | undefined, deviceId: string | undefined) =>
        queryOptions({
          queryKey: actual.enterpriseKeys.windowsFailures(tenantId, deviceId),
          queryFn: () => api.listWindowsFailures(tenantId, { deviceId, limit: 5 }),
          enabled: Boolean(tenantId && deviceId),
        }),
      deviceEffectivePolicy: (tenantId: string | undefined, deviceId: string | undefined) =>
        settled(actual.enterpriseKeys.deviceEffectivePolicy(tenantId, deviceId), {
          deviceId: deviceId ?? "",
          configurations: [],
          policies: [],
          overridden: [],
          exclusions: [],
        }),
      deviceApplications: (tenantId: string | undefined, deviceId: string | undefined) =>
        settled(actual.enterpriseKeys.deviceApplications(tenantId, deviceId), {
          applications: [],
        }),
      deviceRestrictedSoftware: (tenantId: string | undefined, deviceId: string | undefined) =>
        settled(actual.enterpriseKeys.deviceRestrictedSoftware(tenantId, deviceId), {
          violations: [],
          rules: [],
        }),
      scopeTags: (tenantId: string | undefined) =>
        settled(actual.enterpriseKeys.scopeTags(tenantId), { tags: [] }),
      scopeTagAssignments: (
        tenantId: string | undefined,
        resourceType: string,
        resourceIds?: ReadonlyArray<string>,
      ) =>
        settled(
          actual.enterpriseKeys.scopeTagAssignments(tenantId, resourceType, resourceIds?.join(",")),
          { assignments: [] },
        ),
      abmDevice: (tenantId: string | undefined, serial: string | undefined) =>
        queryOptions({
          queryKey: actual.enterpriseKeys.abmDevice(tenantId, serial),
          queryFn: api.getAbmDevice,
          enabled: false,
        }),
      abm: (tenantId: string | undefined) =>
        queryOptions({
          queryKey: actual.enterpriseKeys.abm(tenantId),
          queryFn: () => api.getAppleBusinessManager(tenantId),
          enabled: Boolean(tenantId),
        }),
    },
  };
});

const at = "2026-11-24T12:00:00.000Z";

const deferred = <A,>() => {
  let resolve!: (value: A) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<A>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
};

const makeClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
    },
  });

const mount = (node: () => JSX.Element, client: QueryClient) => {
  cleanups.push(() => {
    dispose();
    client.clear();
  });

  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(
    () => <QueryClientProvider client={client}>{node()}</QueryClientProvider>,
    host,
  );

  return { host, dispose };
};

const cleanups: Array<() => void> = [];

const seedDeviceSummary = (client: QueryClient, row: DeviceRow) => {
  client.setQueryData(enterpriseKeys.entitySummary(params.tenantId, "device", row.id), {
    tenantId: params.tenantId,
    entity: "device",
    id: row.id,
    row,
  });
};

const textButton = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === label);

beforeEach(() => {
  params.tenantId = "tenant-1";
  params.deviceId = "device-1";
  api.getDevice.mockReset();
  api.searchDevices.mockReset().mockResolvedValue({ devices: [], total: 0 });
  api.list.mockReset().mockResolvedValue({ rows: [] });
  api.deviceHandoverImpact.mockResolvedValue({ devices: [], canExport: true });
  api.listDeviceCommands.mockResolvedValue({ commands: [] });
  api.getDeviceHealth.mockResolvedValue({
    health: { level: "healthy", reasons: [], lastSeenAt: at, stale: false },
    declarations: [],
    certificates: [],
    managedCertificates: [],
    push: {
      configured: false,
      consecutiveFailures: 0,
      invalidToken: false,
    },
  });
  api.getDeviceActivity.mockResolvedValue({ events: [], hasMore: false });
  api.getDeviceWindowsSecurity.mockResolvedValue({
    platformSupported: true,
    laps: { supported: true, configured: false, retrievable: false },
    bitlocker: {
      encrypted: false,
      joined: false,
      rotationInProgress: false,
      keys: [],
      escrowMissing: false,
    },
  });
  api.listDeviceDiagnostics.mockResolvedValue({ supported: true, archives: [] });
  api.listWindowsFailures.mockResolvedValue({ retentionDays: 30, count: 0, failures: [] });
  api.listAttributes.mockResolvedValue({ rows: [] });
  api.listDeviceAttributeCollection.mockResolvedValue({ collection: {} });
  api.listDirectory.mockResolvedValue({ users: [], groups: [] });
  api.getDeviceUsers.mockResolvedValue({ users: [] });
  api.listDeviceAppleUsers.mockResolvedValue({ users: [], enrollmentMode: "device" });
  api.getAppleBusinessManager.mockResolvedValue({
    configured: false,
    status: "unconfigured",
    deviceCount: 0,
    assignedCount: 0,
  });
  api.getAbmDevice.mockRejectedValue(new Error("ABM is not configured"));
  api.getDeviceEffectivePolicy.mockResolvedValue({
    configurations: [],
    policies: [],
    overridden: [],
    exclusions: [],
  });
  api.listDeviceApplications.mockResolvedValue({ applications: [] });
  api.getDeviceRestrictedSoftware.mockResolvedValue({ violations: [], rules: [] });
  api.patchGroupMembers.mockReset().mockResolvedValue(undefined);
  api.listScopeTags.mockResolvedValue({ tags: [] });
  api.listScopeTagAssignments.mockResolvedValue({ assignments: [] });
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("device detail async boundary", () => {
  it("paints the cached placeholder heading while health is pending", async () => {
    params.deviceId = "placeholder-health";
    const placeholder: DeviceRow = {
      id: params.deviceId,
      proto: "apple",
      name: "Cached health MacBook",
      serial: "CACHED-HEALTH",
      status: "enrolled",
      enrolledAt: at,
      lastSeenAt: at,
      actions: ["sync"],
    };
    const deviceResponse = deferred<DeviceRow>();
    const healthResponse = deferred<{
      health: { level: string; reasons: never[]; lastSeenAt: string; stale: boolean };
      declarations: never[];
      certificates: never[];
      managedCertificates: never[];
      push: { configured: boolean; consecutiveFailures: number; invalidToken: boolean };
    }>();
    api.getDevice.mockReturnValue(deviceResponse.promise);
    api.getDeviceHealth.mockReturnValue(healthResponse.promise);
    const client = makeClient();
    seedDeviceSummary(client, placeholder);
    const { host } = mount(() => <DeviceDetailPage />, client);

    await vi.waitFor(() => {
      expect(host.querySelector("h1")?.textContent).toBe(placeholder.name);
    });
    expect(host.querySelector('[data-testid="page-skeleton"]')).toBeNull();
    expect(host.textContent).toContain("Health");

    healthResponse.resolve({
      health: { level: "healthy", reasons: [], lastSeenAt: at, stale: false },
      declarations: [],
      certificates: [],
      managedCertificates: [],
      push: { configured: false, consecutiveFailures: 0, invalidToken: false },
    });
    deviceResponse.resolve({ ...placeholder, name: "Authoritative health MacBook" });
    flush();

    await vi.waitFor(() => {
      expect(host.querySelector("h1")?.textContent).toBe("Authoritative health MacBook");
    });
  });

  it("keeps a cached list placeholder read-only until authoritative detail arrives", async () => {
    params.deviceId = "placeholder-apple";
    const placeholder: DeviceRow = {
      id: params.deviceId,
      proto: "apple",
      name: "Cached MacBook",
      serial: "CACHED-MAC",
      status: "enrolled",
      enrolledAt: at,
      lastSeenAt: at,
      actions: ["sync"],
    };
    const pending = deferred<DeviceRow>();
    const authoritative = {
      ...placeholder,
      name: "Authoritative MacBook",
      serial: "AUTHORITATIVE-SERIAL",
    };
    api.getDevice.mockReturnValue(pending.promise);
    api.searchDevices.mockResolvedValue({ devices: [{ ...authoritative, groups: [] }], total: 1 });
    const client = makeClient();
    seedDeviceSummary(client, placeholder);
    const { host } = mount(() => <DeviceDetailPage />, client);

    await vi.waitFor(() => {
      expect(host.querySelector("h1")?.textContent).toBe(placeholder.name);
    });
    expect(host.querySelector('[aria-label="Edit device details"]')).toBeNull();
    expect(host.querySelector('[aria-label="Sync device now"]')).toBeNull();

    textButton(host, "Scope")!.click();
    flush();
    expect(api.searchDevices).not.toHaveBeenCalled();

    pending.resolve(authoritative);
    flush();

    await vi.waitFor(() => {
      expect(host.querySelector("h1")?.textContent).toBe("Authoritative MacBook");
      expect(host.querySelector('[aria-label="Edit device details"]')).not.toBeNull();
      expect(host.querySelector('[aria-label="Sync device now"]')).not.toBeNull();
    });
    await vi.waitFor(() => {
      expect(api.searchDevices).toHaveBeenCalledWith(params.tenantId, {
        q: "AUTHORITATIVE-SERIAL",
        limit: 200,
      });
    });
  });

  it("serializes membership mutations and rolls back deferred or fast rejections", async () => {
    params.deviceId = "membership-device";
    const row: DeviceRow = {
      id: params.deviceId,
      proto: "apple",
      name: "Membership MacBook",
      serial: "MEMBERSHIP-SERIAL",
      status: "enrolled",
      enrolledAt: at,
      lastSeenAt: at,
      actions: ["sync"],
      groups: [{ id: "group-existing", name: "Existing group" }],
    };
    api.getDevice.mockResolvedValue(row);
    api.searchDevices.mockResolvedValue({ devices: [row], total: 1 });
    api.list.mockResolvedValue({
      rows: [
        {
          id: "group-existing",
          name: "Existing group",
          kind: "manual",
          createdAt: at,
          updatedAt: at,
        },
        {
          id: "group-new",
          name: "New group",
          kind: "manual",
          createdAt: at,
          updatedAt: at,
        },
        {
          id: "group-other",
          name: "Other group",
          kind: "manual",
          createdAt: at,
          updatedAt: at,
        },
      ],
    });
    const client = makeClient();
    const { host } = mount(() => <DeviceDetailPage />, client);

    await vi.waitFor(() => {
      expect(host.querySelector('[aria-label="Sync device now"]')).not.toBeNull();
    });
    flush();
    textButton(host, "Scope")!.click();
    flush();
    await vi.waitFor(() => expect(host.textContent).toContain("Effective policy"));
    await vi.waitFor(() => {
      expect(api.searchDevices).toHaveBeenCalledWith(params.tenantId, {
        q: "MEMBERSHIP-SERIAL",
        limit: 200,
      });
    });
    await vi.waitFor(() => {
      expect(host.querySelector('a[href$="/groups/group-existing"]')).not.toBeNull();
      expect(host.querySelector<HTMLSelectElement>("#device-group-select")).not.toBeNull();
    });

    const add = deferred<unknown>();
    api.patchGroupMembers.mockReturnValueOnce(add.promise);
    const select = host.querySelector<HTMLSelectElement>("#device-group-select")!;
    select.value = "group-new";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    flush();
    const addButton = textButton(host, "Add")!;
    addButton.click();

    await vi.waitFor(() => expect(api.patchGroupMembers).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => {
      expect(host.querySelector('a[href$="/groups/group-new"]')).not.toBeNull();
    });
    await vi.waitFor(() => {
      const pendingAdd = textButton(host, "Adding…") ?? textButton(host, "Add");
      expect(pendingAdd?.disabled).toBe(true);
      expect(textButton(host, "Remove")?.disabled).toBe(true);
    });
    textButton(host, "Remove")!.click();
    expect(api.patchGroupMembers).toHaveBeenCalledTimes(1);

    add.reject(new Error("add rejected"));
    flush();
    await vi.waitFor(() => {
      expect(host.querySelector('a[href$="/groups/group-new"]')).toBeNull();
      expect(host.querySelector('a[href$="/groups/group-existing"]')).not.toBeNull();
      expect(textButton(host, "Add")?.disabled).toBe(false);
    });

    const remove = deferred<unknown>();
    api.patchGroupMembers.mockReturnValueOnce(remove.promise);
    textButton(host, "Remove")!.click();

    await vi.waitFor(() => {
      expect(host.querySelector('a[href$="/groups/group-existing"]')).toBeNull();
    });
    await vi.waitFor(() => expect(textButton(host, "Add")!.disabled).toBe(true));
    textButton(host, "Add")!.click();
    expect(api.patchGroupMembers).toHaveBeenCalledTimes(2);

    remove.reject(new Error("remove rejected"));
    flush();
    await vi.waitFor(() => {
      expect(host.querySelector('a[href$="/groups/group-existing"]')).not.toBeNull();
    });

    let optimisticBeforeRequest = false;
    const membershipKey = [
      ...enterpriseKeys.item(params.tenantId, "device", params.deviceId),
      "groups",
      "MEMBERSHIP-SERIAL",
    ] as const;
    api.patchGroupMembers.mockImplementationOnce(() => {
      const current = client.getQueryData<{
        groups: ReadonlyArray<{ id: string }>;
      }>(membershipKey);
      optimisticBeforeRequest = Boolean(current?.groups.some((group) => group.id === "group-new"));

      return Promise.reject(new Error("fast rejection"));
    });
    textButton(host, "Add")!.click();

    await vi.waitFor(() => {
      expect(host.querySelector('a[href$="/groups/group-new"]')).toBeNull();
      expect(host.querySelector('a[href$="/groups/group-existing"]')).not.toBeNull();
    });
    expect(optimisticBeforeRequest).toBe(true);
  });

  const platforms = [
    {
      proto: "apple",
      name: "Alice's MacBook",
      actions: ["sync", "lock", "wipe", "start-lost-mode"],
      actionLabel: "Start lost mode",
    },
    {
      proto: "win",
      name: "Windows workstation",
      actions: ["sync", "lock", "wipe", "restart"],
      actionLabel: "Restart",
    },
    {
      proto: "android",
      name: "Android work phone",
      actions: ["sync", "lock", "wipe", "relinquish-ownership"],
      actionLabel: "Relinquish ownership",
    },
  ] as const;

  for (const platform of platforms) {
    it(`renders ${platform.proto} inventory, health, Scope, editing and allowed actions after a pending read`, async () => {
      params.deviceId = `device-${platform.proto}`;
      const pending = deferred<DeviceRow>();
      api.getDevice.mockReturnValue(pending.promise);
      const client = makeClient();
      const { host } = mount(() => <DeviceDetailPage />, client);

      await vi.waitFor(() => expect(api.getDevice).toHaveBeenCalledOnce());
      expect(host.querySelector('[data-testid="page-skeleton"]')).not.toBeNull();
      expect(host.textContent).not.toContain("Check your details");

      pending.resolve({
        id: params.deviceId,
        proto: platform.proto,
        name: platform.name,
        model: `${platform.proto} model`,
        serial: `SERIAL-${platform.proto}`,
        status: "enrolled",
        enrolledAt: at,
        lastSeenAt: at,
        actions: [...platform.actions],
      });
      flush();

      await vi.waitFor(() => {
        expect(host.querySelector("h1")?.textContent).toBe(platform.name);
        expect(host.querySelector('[aria-label="Edit device details"]')).not.toBeNull();
        expect(host.querySelector('[aria-label="Sync device now"]')).not.toBeNull();
      });
      expect(host.textContent).toContain("Device inventory");
      expect(host.textContent).toContain("Health");
      expect(host.textContent).toContain("Healthy");
      expect(host.textContent).toContain("Remote actions");
      expect(host.querySelector('[aria-label="Sync device now"]')).not.toBeNull();
      expect(host.querySelector('[aria-label="Edit device details"]')).not.toBeNull();
      expect(textButton(host, platform.actionLabel)).toBeDefined();
      expect(host.textContent).toContain("Scope tag assignment");

      host.querySelector<HTMLButtonElement>('[aria-label="Edit device details"]')!.click();
      flush();
      await vi.waitFor(() => expect(host.textContent).toContain("Edit device details"));

      const scope = textButton(host, "Scope");
      expect(scope).toBeDefined();
      scope!.click();
      flush();
      await vi.waitFor(() => {
        expect(host.textContent).toContain("Groups");
        expect(host.textContent).toContain("Effective policy");
      });
    });
  }
});

describe("Devices pending search", () => {
  it("keeps the heading and table skeleton visible until the held search settles", async () => {
    const pending = deferred<{ devices: DeviceRow[]; total: number }>();
    api.searchDevices.mockReturnValue(pending.promise);
    const client = makeClient();
    const { host } = mount(() => <DevicesPage />, client);

    await vi.waitFor(() => expect(api.searchDevices).toHaveBeenCalled());
    await vi.waitFor(() => {
      const pendingTable =
        host.querySelector('[data-testid="devices-table-skeleton"]') ??
        host.querySelector('[data-testid="devices-table"][data-loading="true"]');

      expect(pendingTable, host.innerHTML).not.toBeNull();
    });
    expect(host.querySelector("h1")?.textContent).toBe("Devices");
    expect(host.textContent).toContain("Loading rows…");
    expect(host.textContent).not.toContain("No devices");

    pending.resolve({ devices: [], total: 0 });
    flush();

    await vi.waitFor(() => {
      expect(host.querySelector('[data-testid="devices-table-skeleton"]')).toBeNull();
      expect(host.querySelector('[data-testid="devices-table"]')).not.toBeNull();
      expect(host.textContent).toContain("No devices");
    });
    expect(host.querySelector("h1")?.textContent).toBe("Devices");
  });
});
