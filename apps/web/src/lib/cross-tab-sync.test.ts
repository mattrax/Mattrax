import { describe, expect, test } from "vitest";
import { asFake, recorder } from "../../../../packages/config/testing/recorder.ts";
import {
  applyCrossTabMessage,
  CROSS_TAB_MAX_KEYS,
  crossTabTabId,
  decodeCrossTabMessage,
  invalidationScope,
  isOwnMessage,
  keyTouchesTenant,
  mergeInvalidationKeys,
  queryKeyId,
} from "./cross-tab-sync";
import type { CrossTabCache, CrossTabMessage } from "./cross-tab-sync";

const envelope = () => ({
  v: 1 as const,
  tabId: "tab-a",
  tenantId: "tenant-1",
  sentAt: 1,
});

const invalidate = (keys: (readonly unknown[])[] = []): CrossTabMessage => ({
  ...envelope(),
  type: "invalidate",
  scope: keys.length ? "keys" : "tenant",
  keys,
});

/** Only the methods the sync module calls; the rest of QueryClient is unused. */
const fakeClient = () => {
  const invalidateQueries = recorder<
    Parameters<CrossTabCache["invalidateQueries"]>,
    Promise<void>
  >();
  const removeQueries = recorder<Parameters<CrossTabCache["removeQueries"]>, void>();
  const setQueryData = recorder<Parameters<CrossTabCache["setQueryData"]>, unknown>();
  const clear = recorder<Parameters<CrossTabCache["clear"]>, void>();

  const client = asFake<CrossTabCache>({ invalidateQueries, removeQueries, setQueryData, clear });

  return { client, invalidateQueries, removeQueries, setQueryData, clear };
};

describe("cross-tab messages", () => {
  test("a tab ignores its own messages", () => {
    expect(isOwnMessage(invalidate(), "tab-a")).toBe(true);
    expect(isOwnMessage(invalidate(), "tab-b")).toBe(false);
    expect(isOwnMessage(invalidate(), crossTabTabId())).toBe(false);
  });

  test("untrusted payloads decode only when complete", () => {
    expect(
      decodeCrossTabMessage(invalidate([["enterprise", "device-search", "tenant-1"]])),
    ).toEqual(invalidate([["enterprise", "device-search", "tenant-1"]]));
    expect(decodeCrossTabMessage({ type: "invalidate" })).toBeUndefined();
    expect(decodeCrossTabMessage({ ...invalidate(), v: 2 })).toBeUndefined();
    expect(decodeCrossTabMessage("<not an object>")).toBeUndefined();
  });

  test("keys merge without duplicates and stay bounded", () => {
    const a = ["enterprise", "list", "tenant-1", "device"];
    const b = ["enterprise", "device-search", "tenant-1"];

    expect(mergeInvalidationKeys([a], [a, b])).toEqual([a, b]);
    expect(queryKeyId(a)).toBe(JSON.stringify(a));

    const many = Array.from({ length: CROSS_TAB_MAX_KEYS + 1 }, (_, index) => ["key", index]);
    expect(mergeInvalidationKeys([], many)).toBeUndefined();
  });

  test("an empty key list flushes as tenant scope instead of a no-op", () => {
    expect(invalidationScope([])).toEqual({ scope: "tenant" });
    expect(invalidationScope([["enterprise", "list", "tenant-1"]])).toEqual({
      scope: "keys",
      keys: [["enterprise", "list", "tenant-1"]],
    });
    expect(invalidationScope([], true)).toEqual({ scope: "tenant" });
  });

  test("tenant keys are matched by the tenant id inside the key", () => {
    const key = ["enterprise", "device-search", "tenant-1", {}];

    expect(keyTouchesTenant(key, "tenant-1")).toBe(true);
    expect(keyTouchesTenant(key, "tenant-2")).toBe(false);
    expect(keyTouchesTenant(["enterprise", "me"], null)).toBe(true);
  });
});

describe("applying messages to a cache", () => {
  test("key-scoped invalidation targets exactly those queries", () => {
    const { client, invalidateQueries } = fakeClient();

    const keys = [
      ["enterprise", "device-search", "tenant-1"],
      ["enterprise", "list", "tenant-1", "policy"],
    ];

    applyCrossTabMessage(client, invalidate(keys));

    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: keys[0] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: keys[1] });
  });

  test("tenant-scoped invalidation uses a predicate over the tenant id", () => {
    const { client, invalidateQueries } = fakeClient();

    applyCrossTabMessage(client, invalidate());

    expect(invalidateQueries).toHaveBeenCalledTimes(1);

    // SAFETY: a tenant-scope invalidation always passes `{ predicate }`; the
    // mock records arguments verbatim.
    const [{ predicate }] = invalidateQueries.mock.calls[0] as [
      { predicate: (query: { queryKey: readonly unknown[] }) => boolean },
    ];

    expect(predicate({ queryKey: ["enterprise", "list", "tenant-1"] })).toBe(true);
    expect(predicate({ queryKey: ["enterprise", "list", "tenant-2"] })).toBe(false);
  });

  test("optimistic data writes replace the receiver's copy", () => {
    const { client, setQueryData } = fakeClient();

    const message: CrossTabMessage = {
      ...envelope(),
      type: "set",
      key: ["enterprise", "item", "tenant-1", "device", "device-1"],
      data: { name: "Renamed" },
    };

    applyCrossTabMessage(client, message);

    expect(setQueryData).toHaveBeenCalledWith(message.key, message.data);
  });

  test("reset clears everything for a global sign-out and one tenant otherwise", () => {
    const global = fakeClient();
    applyCrossTabMessage(global.client, { ...envelope(), type: "reset", tenantId: null });
    expect(global.clear).toHaveBeenCalledTimes(1);

    const scoped = fakeClient();
    applyCrossTabMessage(scoped.client, { ...envelope(), type: "reset" });
    expect(scoped.clear).not.toHaveBeenCalled();

    // SAFETY: a tenant-scope reset always passes `{ predicate }`.
    const [{ predicate }] = scoped.removeQueries.mock.calls[0] as [
      { predicate: (query: { queryKey: readonly unknown[] }) => boolean },
    ];

    expect(predicate({ queryKey: ["enterprise", "list", "tenant-1"] })).toBe(true);
    expect(predicate({ queryKey: ["enterprise", "list", "tenant-2"] })).toBe(false);
  });
});
