import { beforeEach, describe, expect, it } from "vitest";
import {
  canonicalTenantParam,
  rememberTenantAlias,
  rememberTenants,
  resetTenantDirectory,
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
