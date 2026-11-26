// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider, queryOptions } from "@tanstack/solid-query";
import type { TenantOnboardingState, TenantInfo } from "@mattrax/enterprise-domain/client";
import { render } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { createSignal, Errored, flush, Show } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installGlobal } from "../../../../packages/config/testing/globals.ts";
import { asFake, recorder } from "../../../../packages/config/testing/recorder.ts";
import type { enterprise } from "~/lib/enterprise";
import type { TenantPermissionsApi } from "~/lib/permissions";
import { readOnboardingDismissal, writeOnboardingDismissal } from "~/lib/onboarding-query";
import OnboardingChecklist from "./onboarding-checklist";
import type { OnboardingChecklistDeps } from "./onboarding-checklist";

const onboardingKey = (tenantId = "tenant-1") => ["enterprise", "onboarding", tenantId] as const;

/** Recorders provide the query and mutation fakes through the component's deps. */
const makeApi = () => ({
  getTenantOnboarding: recorder<[tenantId: string], Promise<TenantOnboardingState>>(),
  patchTenantOnboarding: recorder<
    [tenantId: string, dismissed: boolean],
    ReturnType<typeof enterprise.patchTenantOnboarding>
  >(),
});

let api = makeApi();

const account = { userId: "account-1" };
const access = { known: true, canWrite: true };

const permissions = (): TenantPermissionsApi => ({
  can: () => access.canWrite,
  canAny: () => access.canWrite,
  canAll: () => access.canWrite,
  known: () => access.known,
  tenant: () => ({ id: "tenant-1" }) as TenantInfo,
  permissions: () => new Set(),
  role: () => "owner",
  roleName: () => "Owner",
});

/** The query options are built by the real helper, with only the fetch faked. */
const onboardingQuery = (tenantId: string) =>
  queryOptions({
    queryKey: onboardingKey(tenantId),
    queryFn: () => api.getTenantOnboarding(tenantId),
    enabled: Boolean(tenantId),
    staleTime: 0,
    refetchOnMount: "always" as const,
  });

const deps = (): OnboardingChecklistDeps => ({
  session: () => ({ data: { user: { id: account.userId } } }),
  permissions,
  onboardingQuery: asFake<OnboardingChecklistDeps["onboardingQuery"]>(onboardingQuery),
  patchTenantOnboarding: asFake<OnboardingChecklistDeps["patchTenantOnboarding"]>(
    api.patchTenantOnboarding,
  ),
});

const onboardingState = (
  overrides: Partial<TenantOnboardingState> = {},
): TenantOnboardingState => ({
  dismissedAt: null,
  groups: 0,
  policies: 0,
  assignedPolicies: 0,
  devices: 0,
  administrators: 1,
  pendingInvitations: 0,
  firstPolicyId: null,
  ...overrides,
});

const deferred = <A,>() => {
  let resolve!: (value: A) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<A>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
};

const makeStorage = () => {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
};

/** A cache write during a component body, the way hydration primes an entry. */
function CacheWriter(props: { run: () => void }) {
  props.run();

  return null;
}

/** Per-test QueryClient; an optional cancellation override stays on this instance. */
const makeClient = (cancelQueries?: () => Promise<void>) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  });

  if (cancelQueries) client.cancelQueries = cancelQueries as typeof client.cancelQueries;

  return client;
};

const cleanups: Array<() => void> = [];

const mount = (node: () => JSX.Element, client: QueryClient, errors: unknown[]) => {
  const host = document.createElement("div");
  document.body.append(host);

  const dispose = render(
    () => (
      <Errored
        fallback={(error) => {
          errors.push(error());

          return <div data-testid="boundary">{String(error())}</div>;
        }}
      >
        <QueryClientProvider client={client}>{node()}</QueryClientProvider>
      </Errored>
    ),
    host,
    undefined,
    { onError: (error) => errors.push(error) },
  );

  cleanups.push(() => {
    dispose();
    client.clear();
  });

  return host;
};

const checklist = () => <OnboardingChecklist tenantId="tenant-1" deps={deps()} />;

const dismissButton = (host: HTMLElement) =>
  host.querySelector<HTMLButtonElement>('button[aria-label="Dismiss the Get started checklist"]');

let storage: ReturnType<typeof makeStorage>;
let restoreStorage: () => void;

beforeEach(() => {
  api = makeApi();
  storage = makeStorage();
  restoreStorage = installGlobal("localStorage", storage);
  account.userId = "account-1";
  access.known = true;
  access.canWrite = true;
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  restoreStorage();
  document.body.replaceChildren();
});

describe("OnboardingChecklist dismissal", () => {
  it("updates from a cache write in an owned scope without tripping the error boundary", async () => {
    const client = makeClient();
    api.getTenantOnboarding.mockResolvedValue(onboardingState());
    const errors: unknown[] = [];
    const [write, setWrite] = createSignal(false);

    const host = mount(
      () => (
        <>
          {checklist()}
          <Show when={write()}>
            <CacheWriter
              run={() => client.setQueryData(onboardingKey(), onboardingState({ groups: 1 }))}
            />
          </Show>
        </>
      ),
      client,
      errors,
    );

    flush();
    await vi.waitFor(() => expect(host.textContent).toContain("0 of 5 done"), { interval: 1 });
    expect(errors).toEqual([]);

    setWrite(true);
    flush();

    await vi.waitFor(() => expect(host.textContent).toContain("1 of 5 done"), { interval: 1 });
    expect(errors).toEqual([]);
    expect(host.querySelector('[data-testid="boundary"]')).toBeNull();
  });

  it("derives a server dismissal from the cache and reopens when the cache is restored", async () => {
    const client = makeClient();
    const errors: unknown[] = [];
    client.setQueryData(
      onboardingKey(),
      onboardingState({ dismissedAt: "2026-11-24T12:00:00.000Z" }),
    );

    const host = mount(() => checklist(), client, errors);
    flush();

    await vi.waitFor(() => expect(host.querySelector("#onboarding-title")).toBeNull(), {
      interval: 1,
    });
    expect(api.getTenantOnboarding).not.toHaveBeenCalled();

    client.setQueryData(onboardingKey(), onboardingState());
    flush();

    await vi.waitFor(() => expect(host.textContent).toContain("0 of 5 done"), { interval: 1 });
    expect(errors).toEqual([]);
  });

  it("disables refetching when an authoritative dismissal arrives after mount", async () => {
    const client = makeClient();
    const errors: unknown[] = [];
    api.getTenantOnboarding.mockResolvedValue(onboardingState());

    const host = mount(() => checklist(), client, errors);
    flush();
    await vi.waitFor(() => expect(host.textContent).toContain("Get started"), { interval: 1 });
    expect(api.getTenantOnboarding).toHaveBeenCalledTimes(1);

    // Prove invalidation can reach this query while it is eligible.
    await client.invalidateQueries({ queryKey: onboardingKey(), refetchType: "none" });
    await client.refetchQueries({ queryKey: onboardingKey(), type: "all" });
    await vi.waitFor(() => expect(api.getTenantOnboarding).toHaveBeenCalledTimes(2), {
      interval: 1,
    });

    client.setQueryData(
      onboardingKey(),
      onboardingState({ dismissedAt: "2026-11-24T12:00:00.000Z" }),
    );
    flush();

    await vi.waitFor(() => expect(host.querySelector("#onboarding-title")).toBeNull(), {
      interval: 1,
    });
    await vi.waitFor(
      () =>
        expect(client.getQueryCache().find({ queryKey: onboardingKey() })?.isDisabled()).toBe(true),
      { interval: 1 },
    );

    await client.invalidateQueries({ queryKey: onboardingKey() });
    await Promise.resolve();
    flush();

    expect(api.getTenantOnboarding).toHaveBeenCalledTimes(2);
    expect(errors).toEqual([]);
  });

  it("does not request the aggregate counts for a read-only member", async () => {
    const client = makeClient();
    const errors: unknown[] = [];
    access.canWrite = false;

    const host = mount(() => checklist(), client, errors);
    flush();

    await vi.waitFor(() => expect(host.querySelector("#onboarding-title")).toBeNull(), {
      interval: 1,
    });
    expect(api.getTenantOnboarding).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it("skips the request when this browser already recorded a dismissal", async () => {
    const client = makeClient();
    const errors: unknown[] = [];
    writeOnboardingDismissal(storage, "account-1", "tenant-1", true);

    const host = mount(() => checklist(), client, errors);
    flush();

    await vi.waitFor(() => expect(host.querySelector("#onboarding-title")).toBeNull(), {
      interval: 1,
    });
    expect(api.getTenantOnboarding).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it("rolls a failed dismissal back to authoritative data and clears the local marker", async () => {
    const client = makeClient();
    const errors: unknown[] = [];
    const request = deferred<void>();
    api.getTenantOnboarding.mockResolvedValue(onboardingState());
    api.patchTenantOnboarding.mockReturnValueOnce(request.promise as never);

    const host = mount(() => checklist(), client, errors);
    flush();
    await vi.waitFor(() => expect(host.textContent).toContain("Get started"), { interval: 1 });
    expect(api.getTenantOnboarding).toHaveBeenCalledTimes(1);

    dismissButton(host)!.click();
    await Promise.resolve();
    flush();

    await vi.waitFor(
      () => {
        flush();
        expect(host.querySelector("#onboarding-title")).toBeNull();
      },
      { interval: 1 },
    );
    await vi.waitFor(
      () => expect(readOnboardingDismissal(storage, "account-1", "tenant-1")).toBe(true),
      { interval: 1 },
    );

    request.reject(new Error("offline"));

    await vi.waitFor(
      () => expect(readOnboardingDismissal(storage, "account-1", "tenant-1")).toBe(false),
      { interval: 1 },
    );
    await vi.waitFor(() => expect(host.textContent).toContain("Get started"), { interval: 1 });

    expect(api.patchTenantOnboarding).toHaveBeenCalledWith("tenant-1", true);
    expect(api.getTenantOnboarding).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });

  it("clears the marker when the PATCH rejects before cancellation settles", async () => {
    const cancellation = deferred<void>();
    const client = makeClient(() => cancellation.promise);
    const errors: unknown[] = [];
    api.getTenantOnboarding.mockResolvedValue(onboardingState());
    api.patchTenantOnboarding.mockRejectedValueOnce(new Error("offline"));

    const host = mount(() => checklist(), client, errors);
    flush();
    await vi.waitFor(() => expect(host.textContent).toContain("Get started"), { interval: 1 });
    expect(api.getTenantOnboarding).toHaveBeenCalledTimes(1);

    dismissButton(host)!.click();
    await Promise.resolve();
    flush();

    await vi.waitFor(
      () => expect(readOnboardingDismissal(storage, "account-1", "tenant-1")).toBe(false),
      { interval: 1 },
    );
    await vi.waitFor(() => expect(host.textContent).toContain("Get started"), { interval: 1 });

    cancellation.resolve();
    flush();
    await Promise.resolve();
    flush();

    expect(readOnboardingDismissal(storage, "account-1", "tenant-1")).toBe(false);
    expect(host.querySelector("#onboarding-title")).not.toBeNull();
    expect(api.getTenantOnboarding).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });

  it("marks the cache when the PATCH succeeds before cancellation settles", async () => {
    const cancellation = deferred<void>();
    const client = makeClient(() => cancellation.promise);
    const errors: unknown[] = [];
    api.getTenantOnboarding.mockResolvedValue(onboardingState());
    api.patchTenantOnboarding.mockResolvedValue(
      asFake<{ readonly status: "ok" }>(
        onboardingState({ dismissedAt: "2026-11-24T12:00:00.000Z" }),
      ),
    );

    const host = mount(() => checklist(), client, errors);
    flush();
    await vi.waitFor(() => expect(host.textContent).toContain("Get started"), { interval: 1 });
    expect(api.getTenantOnboarding).toHaveBeenCalledTimes(1);

    dismissButton(host)!.click();
    await Promise.resolve();
    flush();

    await vi.waitFor(
      () => expect(readOnboardingDismissal(storage, "account-1", "tenant-1")).toBe(true),
      { interval: 1 },
    );
    await vi.waitFor(
      () => {
        flush();
        expect(host.querySelector("#onboarding-title")).toBeNull();
      },
      { interval: 1 },
    );

    cancellation.resolve();
    flush();
    await Promise.resolve();
    flush();

    expect(readOnboardingDismissal(storage, "account-1", "tenant-1")).toBe(true);
    expect(host.querySelector("#onboarding-title")).toBeNull();
    expect(api.getTenantOnboarding).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });

  it("keeps a successful dismissal and remembers it for the next mount", async () => {
    const client = makeClient();
    const errors: unknown[] = [];
    api.getTenantOnboarding.mockResolvedValue(onboardingState());
    api.patchTenantOnboarding.mockResolvedValue(
      asFake<{ readonly status: "ok" }>(
        onboardingState({ dismissedAt: "2026-11-24T12:00:00.000Z" }),
      ),
    );

    const host = mount(() => checklist(), client, errors);
    flush();
    await vi.waitFor(() => expect(host.textContent).toContain("Get started"), { interval: 1 });

    dismissButton(host)!.click();
    await Promise.resolve();
    flush();

    await vi.waitFor(() => expect(host.querySelector("#onboarding-title")).toBeNull(), {
      interval: 1,
    });
    await vi.waitFor(
      () => expect(readOnboardingDismissal(storage, "account-1", "tenant-1")).toBe(true),
      { interval: 1 },
    );
    expect(api.patchTenantOnboarding).toHaveBeenCalledWith("tenant-1", true);
    expect(api.getTenantOnboarding).toHaveBeenCalledTimes(1);

    api.getTenantOnboarding.mockClear();
    const next = mount(() => checklist(), makeClient(), errors);
    flush();

    await vi.waitFor(() => expect(next.querySelector("#onboarding-title")).toBeNull(), {
      interval: 1,
    });
    expect(api.getTenantOnboarding).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });
});
