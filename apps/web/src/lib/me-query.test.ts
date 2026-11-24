import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/solid-query";
import type { MeResponse } from "@mattrax/enterprise-domain/client";
import { ME_QUERY_KEY } from "./me-keys";
import { buildMeQueryOptions, meQuerySeed } from "./me-options";
import {
  emailVerificationGate,
  ME_QUERY_GC_TIME,
  ME_QUERY_STALE_TIME,
  meQueryCachePolicy,
} from "./me-query";

/**
 * Regression guard for #631. An observer is what every page creates through
 * useQuery(() => meQueryOptions(...)); mounting one is the navigation path.
 * With the old zero stale window each mount fetched again. This mirrors that
 * sequence against the real query core and the policy meQueryOptions uses.
 */
const ME_KEY = ME_QUERY_KEY;

const makeClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // Keep entries alive for the whole test; unmounted observers must not
        // turn a cache read into a fetch.
        gcTime: Number.POSITIVE_INFINITY,
        retry: false,
      },
    },
  });

/**
 * Mount one observer and settle once it has a result. A fresh cache resolves
 * synchronously (the navigation case); a cold or stale cache waits for the
 * query to settle.
 */
const mountMeObserver = (client: QueryClient, queryFn: () => Promise<number>) =>
  new Promise<void>((resolve, reject) => {
    const observer = new QueryObserver(client, {
      queryKey: ME_KEY,
      queryFn,
      retry: false,
      ...meQueryCachePolicy(),
    });

    let settled = false;
    const subscription = { stop: undefined as (() => void) | undefined };

    function check() {
      if (settled) return;

      const result = observer.getCurrentResult();

      if (result.status === "success") {
        settled = true;
        subscription.stop?.();
        resolve();
      } else if (result.status === "error") {
        settled = true;
        subscription.stop?.();
        reject(result.error);
      }
    }

    subscription.stop = observer.subscribe(check);
    check();
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("me query cache policy", () => {
  it("reuses one request across repeated navigation mounts", async () => {
    const client = makeClient();
    let requests = 0;
    const queryFn = async () => ++requests;

    for (let mount = 0; mount < 10; mount += 1) await mountMeObserver(client, queryFn);

    // Before #631 this was 10: staleTime 0 made every page mount refetch.
    expect(requests).toBe(1);
  });

  it("refetches once the shell is stale", async () => {
    const client = makeClient();
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let requests = 0;
    const queryFn = async () => ++requests;

    await mountMeObserver(client, queryFn);
    expect(requests).toBe(1);

    now += ME_QUERY_STALE_TIME - 1;
    await mountMeObserver(client, queryFn);
    expect(requests).toBe(1);

    now += 2;
    await mountMeObserver(client, queryFn);
    expect(requests).toBe(2);
  });

  it("keeps a positive stale window and a longer retention window", () => {
    const policy = meQueryCachePolicy();

    expect(policy.staleTime).toBeGreaterThan(0);
    expect(policy.gcTime).toBeGreaterThan(policy.staleTime);
  });

  it("is actually wired into the shared /me options", () => {
    const options = buildMeQueryOptions({
      userId: "user-1",
      enabled: true,
      fetchMe: async () => ({}) as MeResponse,
    });

    expect(options.staleTime).toBe(ME_QUERY_STALE_TIME);
    expect(options.gcTime).toBe(ME_QUERY_GC_TIME);
  });

  it("marks the SSR preload stale once but keeps a stored entry's age", () => {
    const data = {} as MeResponse;

    expect(meQuerySeed(data, undefined)).toEqual({ data, initialDataUpdatedAt: 0 });
    expect(meQuerySeed(undefined, { userId: "user-1", data, updatedAt: 123 })).toEqual({
      data,
      initialDataUpdatedAt: 123,
    });
    expect(meQuerySeed(undefined, undefined)).toBeUndefined();
  });
});

describe("email verification gate", () => {
  it("allows a stale unverified /me row when the session was just refreshed", () => {
    expect(
      emailVerificationGate({
        meVerified: false,
        sessionVerified: true,
        meFetching: false,
      }),
    ).toBe("allow");
  });

  it("waits instead of redirecting while /me is refreshing", () => {
    expect(
      emailVerificationGate({
        meVerified: false,
        sessionVerified: false,
        meFetching: true,
      }),
    ).toBe("wait");
  });

  it("redirects only after both sources agree the address is unverified", () => {
    expect(
      emailVerificationGate({
        meVerified: false,
        sessionVerified: false,
        meFetching: false,
      }),
    ).toBe("verify");
    expect(
      emailVerificationGate({
        meVerified: true,
        sessionVerified: false,
        meFetching: false,
      }),
    ).toBe("allow");
    expect(
      emailVerificationGate({
        meVerified: undefined,
        sessionVerified: undefined,
        meFetching: false,
      }),
    ).toBe("wait");

    // A stale session claim alone must not redirect when /me has no row yet.
    expect(
      emailVerificationGate({
        meVerified: undefined,
        sessionVerified: false,
        meFetching: false,
      }),
    ).toBe("wait");
  });
});
