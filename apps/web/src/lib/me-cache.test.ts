import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "@mattrax/enterprise-domain";
import { clearMeCache, readMeCache, writeMeCache } from "./me-cache";

const data = {
  user: {
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    mfaEnabled: false,
    totpEnabled: false,
    passkeyEnabled: false,
    mfaRequired: false,
    hasPassword: true,
  },
  tenants: [{ id: "tenant-1", name: "Acme", slug: "acme", role: "owner" }],
} as MeResponse;

const fakeStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
};

afterEach(() => vi.unstubAllGlobals());

describe("me cache", () => {
  it("round-trips an account's shell data", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    writeMeCache(data);
    expect(readMeCache("user-1")?.data).toEqual(data);
    expect(readMeCache("user-2")).toBeUndefined();
    clearMeCache();
    expect(readMeCache("user-1")).toBeUndefined();
  });

  it("ignores corrupt or mismatched cache entries", () => {
    const storage = fakeStorage();
    storage.setItem("mattrax:me-cache:v1", '{"userId":"user-2","updatedAt":0,"data":{}}');
    vi.stubGlobal("localStorage", storage);
    expect(readMeCache("user-1")).toBeUndefined();
    storage.setItem("mattrax:me-cache:v1", "{broken");
    expect(readMeCache("user-1")).toBeUndefined();
  });
});
