import { HttpApi, OpenApi } from "effect/http-api";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  ADMIN_ACCOUNT_OFFSET_MAX,
  ADMIN_ACCOUNT_PAGE_DEFAULT,
  ADMIN_ACCOUNT_PAGE_MAX,
  ADMIN_ACCOUNT_SEARCH_MAX_LENGTH,
  AdminAccountsQuery,
  PatchAdminAccountSuperadminRequest,
  normalizeAdminAccountsQuery,
} from "./Admin.js";
import { enterpriseAdminApi } from "./Http/AdminApi.js";
import { EnterpriseForbidden, EnterpriseInternal } from "./Errors.js";

const decodeQuery = Schema.decodeUnknownSync(AdminAccountsQuery);

describe("admin account query", () => {
  it("defaults to one bounded page", () => {
    expect(normalizeAdminAccountsQuery({})).toEqual({
      q: undefined,
      limit: ADMIN_ACCOUNT_PAGE_DEFAULT,
      offset: 0,
    });
  });

  it("trims the term and drops a blank one", () => {
    expect(normalizeAdminAccountsQuery({ q: "  acme  " }).q).toBe("acme");
    expect(normalizeAdminAccountsQuery({ q: "   " }).q).toBeUndefined();
  });

  it("enforces the search and pagination bounds at the HTTP boundary", () => {
    expect(decodeQuery({})).toEqual({});
    // A tenant id is not part of the platform contract and is dropped rather
    // than becoming a filter.
    expect(decodeQuery({ tenantId: "tenant-a" })).toEqual({});
    expect(() => decodeQuery({ q: "a".repeat(ADMIN_ACCOUNT_SEARCH_MAX_LENGTH + 1) })).toThrow();
    // The maximum page size and offset are inclusive.
    expect(decodeQuery({ limit: 1, offset: 0 })).toEqual({ limit: 1, offset: 0 });
    expect(decodeQuery({ limit: ADMIN_ACCOUNT_PAGE_MAX })).toEqual({ limit: ADMIN_ACCOUNT_PAGE_MAX });
    expect(() => decodeQuery({ limit: ADMIN_ACCOUNT_PAGE_MAX + 1 })).toThrow();
    expect(() => decodeQuery({ limit: 0 })).toThrow();
    expect(() => decodeQuery({ offset: -1 })).toThrow();
    expect(decodeQuery({ offset: ADMIN_ACCOUNT_OFFSET_MAX })).toEqual({
      offset: ADMIN_ACCOUNT_OFFSET_MAX,
    });
    expect(() => decodeQuery({ offset: ADMIN_ACCOUNT_OFFSET_MAX + 1 })).toThrow();
  });

  it("clamps an internal caller to the same bounds", () => {
    expect(normalizeAdminAccountsQuery({ limit: 1_000, offset: 10_000_000 })).toEqual({
      q: undefined,
      limit: ADMIN_ACCOUNT_PAGE_MAX,
      offset: ADMIN_ACCOUNT_OFFSET_MAX,
    });
  });

  it("requires an explicit boolean for the superadmin patch", () => {
    const decode = Schema.decodeUnknownSync(PatchAdminAccountSuperadminRequest);

    expect(decode({ superadmin: true })).toEqual({ superadmin: true });
    expect(decode({ superadmin: false })).toEqual({ superadmin: false });
    expect(() => decode({ superadmin: "true" })).toThrow();
    expect(() => decode({})).toThrow();
  });
});

describe("admin account routes", () => {
  const document = OpenApi.fromApi(HttpApi.make("Test").add(enterpriseAdminApi));

  it("mounts outside every tenant path", () => {
    expect(Object.keys(document.paths).sort()).toEqual([
      "/api/v1/admin/accounts",
      "/api/v1/admin/accounts/{accountId}/superadmin",
    ]);
  });

  it("declares the platform permission failures and an internal fallback", () => {
    for (const [name, endpoint] of Object.entries(enterpriseAdminApi.endpoints)) {
      const union = Schema.Union([...endpoint.error]);

      expect(
        Schema.is(union)(new EnterpriseForbidden({ message: "no" })),
        `${name} does not encode Forbidden`,
      ).toBe(true);
      expect(
        Schema.is(union)(new EnterpriseInternal({ message: "internal" })),
        `${name} does not encode Internal`,
      ).toBe(true);
      // A tenant permission is not part of this contract.
      expect(name).not.toContain("Tenant");
    }
  });
});
