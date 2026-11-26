import { describe, expect, it, vi } from "vitest";

vi.mock("@solidjs/web", () => ({ isServer: false, getRequestEvent: () => undefined }));
import {
  canonicalTenantParam,
  canonicalTenantSegment,
  createTenantDirectory,
  getRequestTenantDirectory,
  rememberTenantAlias,
  rememberTenants,
  resolveLandingTenant,
  resolveTenant,
  resolveTenantId,
  setRequestTenantDirectory,
  tenantLandingHref,
} from "./tenant";

const acme = { id: "tenant-a1b2", slug: "acme", name: "Acme" };

const globex = { id: "tenant-c3d4", slug: "globex", name: "Globex" };

const tenants = [acme, globex];

describe("tenant URL resolution", () => {
  it("prefers the slug as the canonical URL segment", () => {
    expect(canonicalTenantParam(acme)).toBe("acme");
    expect(canonicalTenantParam({ id: "tenant-1", slug: null })).toBe("tenant-1");
  });

  it("resolves a tenant from either its slug or its id", () => {
    expect(resolveTenant(tenants, "acme")).toBe(acme);
    expect(resolveTenant(tenants, "tenant-a1b2")).toBe(acme);
    expect(resolveTenant(tenants, "globex")).toBe(globex);
  });

  it("does not resolve another membership's slug", () => {
    expect(resolveTenant(tenants, "initech")).toBeUndefined();
    expect(resolveTenant(tenants, "tenant-z9")).toBeUndefined();
  });

  it("falls back to the first membership without a URL segment", () => {
    expect(resolveTenant(tenants, undefined)).toBe(acme);
    expect(resolveTenant(undefined, "acme")).toBeUndefined();
  });

  it("translates slugs to ids for API calls", () => {
    const directory = createTenantDirectory(tenants);

    expect(resolveTenantId("acme", directory)).toBe(acme.id);
    expect(resolveTenantId(acme.id, directory)).toBe(acme.id);
    expect(resolveTenantId("globex", directory)).toBe(globex.id);
    expect(canonicalTenantSegment(acme.id, directory)).toBe("acme");
  });

  it("resolves a slug saved in this account before the shell refreshes", () => {
    rememberTenants(tenants, "account-a");
    rememberTenantAlias("acme-renamed", acme.id, "account-a");
    const directory = createTenantDirectory(tenants, new Map([["acme-renamed", acme.id]]));

    expect(resolveTenant(tenants, "acme-renamed", directory)).toBe(acme);
    expect(resolveTenantId("acme-renamed", directory)).toBe(acme.id);
  });

  it("passes unknown values through so a freshly created id still works", () => {
    const directory = createTenantDirectory(tenants);

    expect(resolveTenantId("tenant-new", directory)).toBe("tenant-new");
    expect(resolveTenantId(undefined, directory)).toBeUndefined();
  });

  it("keeps interleaved SSR request directories isolated", () => {
    const first = new Request("https://mattrax.test/t/acme");
    const second = new Request("https://mattrax.test/t/other");
    const other = { id: "tenant-other", slug: "other" };
    setRequestTenantDirectory(first, tenants);
    setRequestTenantDirectory(second, [other]);

    expect(resolveTenantId("acme", getRequestTenantDirectory(first))).toBe(acme.id);
    expect(resolveTenantId("acme", getRequestTenantDirectory(second))).toBe("acme");
    expect(resolveTenantId("other", getRequestTenantDirectory(first))).toBe("other");
    expect(resolveTenantId("other", getRequestTenantDirectory(second))).toBe(other.id);
  });

  it("clears browser aliases when the signed-in account changes", () => {
    rememberTenants(tenants, "account-a");
    rememberTenantAlias("acme-renamed", acme.id, "account-a");
    expect(resolveTenantId("acme-renamed")).toBe(acme.id);

    rememberTenants([globex], "account-b");

    expect(resolveTenantId("acme-renamed")).toBe("acme-renamed");
    expect(resolveTenantId("globex")).toBe(globex.id);
  });
});

describe("landing tenant precedence", () => {
  it("prefers the account default over the browser's last tenant", () => {
    expect(
      resolveLandingTenant(tenants, {
        defaultTenantId: globex.id,
        lastTenantId: acme.id,
      }),
    ).toBe(globex);
  });

  it("matches the account default by id only", () => {
    expect(resolveLandingTenant(tenants, { defaultTenantId: globex.id })).toBe(globex);
    // The API stores ids; a slug-shaped default is not a membership id and must
    // not hijack the landing choice.
    expect(resolveLandingTenant(tenants, { defaultTenantId: "globex" })).toBe(acme);
  });

  it("resolves a slug for the browser's last-used key", () => {
    expect(resolveLandingTenant(tenants, { lastTenantId: "acme" })).toBe(acme);
    expect(resolveLandingTenant(tenants, { lastTenantId: globex.id })).toBe(globex);
  });

  it("prefers an exact id over a slug collision for the last-used key", () => {
    const colliding = [
      { id: "shared", slug: "shared-id", name: "Id match" },
      { id: "tenant-other", slug: "shared", name: "Slug match" },
    ];

    expect(resolveLandingTenant(colliding, { lastTenantId: "shared" })).toBe(colliding[0]);
  });

  it("falls back to the last tenant when the default is not a membership", () => {
    expect(
      resolveLandingTenant(tenants, {
        defaultTenantId: "tenant-left",
        lastTenantId: acme.id,
      }),
    ).toBe(acme);
  });

  it("ignores a stale last tenant and lands on the first membership", () => {
    expect(
      resolveLandingTenant(tenants, {
        defaultTenantId: null,
        lastTenantId: "tenant-left",
      }),
    ).toBe(acme);
  });

  it("preserves the last-used tenant when no default is set", () => {
    expect(resolveLandingTenant(tenants, { lastTenantId: globex.id })).toBe(globex);
  });

  it("returns nothing when the account has no memberships", () => {
    expect(resolveLandingTenant([], { defaultTenantId: acme.id })).toBeUndefined();
    expect(resolveLandingTenant(undefined, { lastTenantId: acme.id })).toBeUndefined();
  });

  it("builds the canonical /t redirect and keeps the tail intact", () => {
    expect(tenantLandingHref(tenants, { defaultTenantId: globex.id })).toBe("/t/globex");
    expect(
      tenantLandingHref(
        tenants,
        { defaultTenantId: globex.id, lastTenantId: acme.id },
        "?health=attention#fleet",
      ),
    ).toBe("/t/globex?health=attention#fleet");
    expect(tenantLandingHref(tenants, { lastTenantId: acme.id })).toBe("/t/acme");
    expect(tenantLandingHref([], { defaultTenantId: acme.id })).toBeUndefined();
  });

  it("encodes a slug that is not URL-safe", () => {
    expect(
      tenantLandingHref([{ id: "tenant-1", slug: "acme corp", name: "Acme" }], {
        defaultTenantId: "tenant-1",
      }),
    ).toBe("/t/acme%20corp");
  });
});
