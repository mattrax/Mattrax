import { beforeEach, describe, expect, it } from "vitest";
import {
  canonicalTenantParam,
  rememberTenantAlias,
  rememberTenants,
  resetTenantDirectory,
  resolveLandingTenant,
  resolveTenant,
  resolveTenantId,
} from "./tenant";

const acme = { id: "tenant-a1b2", slug: "acme", name: "Acme" };

const globex = { id: "tenant-c3d4", slug: "globex", name: "Globex" };

const tenants = [acme, globex];

describe("tenant URL resolution", () => {
  beforeEach(() => resetTenantDirectory());

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
    rememberTenants(tenants);

    expect(resolveTenantId("acme")).toBe(acme.id);
    expect(resolveTenantId(acme.id)).toBe(acme.id);
    expect(resolveTenantId("globex")).toBe(globex.id);
  });

  it("resolves a slug saved in this tab before the shell refreshes", () => {
    rememberTenants(tenants);
    rememberTenantAlias("acme-renamed", acme.id);

    expect(resolveTenant(tenants, "acme-renamed")).toBe(acme);
    expect(resolveTenantId("acme-renamed")).toBe(acme.id);
  });

  it("passes unknown values through so a freshly created id still works", () => {
    rememberTenants(tenants);

    expect(resolveTenantId("tenant-new")).toBe("tenant-new");
    expect(resolveTenantId(undefined)).toBeUndefined();
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
});
