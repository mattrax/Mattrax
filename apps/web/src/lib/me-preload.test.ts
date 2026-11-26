import { afterEach, describe, expect, it } from "vitest";
import { installGlobal } from "../../../../packages/config/testing/globals.ts";
import type { MeResponse } from "@mattrax/enterprise-domain/client";
import { clearMeCache } from "./me-cache";
import { peekMePreloadFor, persistBrowserPreloadedMe, resetMePreload } from "./me-preload";

const data = {
  account: {
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    mfaEnabled: false,
    totpEnabled: false,
    passkeyEnabled: false,
    mfaRequired: false,
  },
  tenants: [],
} satisfies MeResponse;

const fakeStorage = () => {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
};

let restoreGlobals = () => {};

afterEach(() => {
  restoreGlobals();
  restoreGlobals = () => {};
  resetMePreload();
});

describe("me preload lifetime", () => {
  it("resets on sign-out but not when a session commit clears the cache", () => {
    restoreGlobals = installGlobal("localStorage", fakeStorage());
    persistBrowserPreloadedMe(data);
    expect(peekMePreloadFor()).toBe("user-1");

    // A token/MFA commit clears the persisted shell; the document preload can
    // stay because it is still the same tab and account.
    clearMeCache();
    expect(peekMePreloadFor()).toBe("user-1");

    resetMePreload();
    expect(peekMePreloadFor()).toBeUndefined();
  });
});
